import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError, ErrorCode } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService, Tx } from '../prisma/prisma.service';

/**
 * Explicit, opt-in ride pooling. Sharing a road (route matching) never implies two people
 * travel together: a driver must OFFER seats and accept each REQUEST individually.
 * Seat allocation uses row locks (SELECT … FOR UPDATE) so concurrent accepts can't overbook,
 * and the CHECK constraint available_seats >= 0 is the final safety net.
 * Phone numbers are never shared - only first names (subject to privacy settings).
 */
@Injectable()
export class RidePoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async createOffer(userId: string, journeyId: string, totalSeats: number, notes?: string) {
    const journey = await this.prisma.journey.findFirst({
      where: { id: journeyId, userId },
      include: { vehicleType: true, ridePoolOffer: true },
    });
    if (!journey) throw AppError.notFound('Journey');
    if (journey.status !== 'PLANNED' || journey.departureAt <= new Date()) {
      throw new AppError(
        ErrorCode.POOL_NOT_ELIGIBLE,
        'Seats can only be offered on upcoming planned journeys',
        HttpStatus.CONFLICT,
      );
    }
    if (!journey.vehicleType.poolingEligible) {
      throw new AppError(
        ErrorCode.POOL_NOT_ELIGIBLE,
        `${journey.vehicleType.name} journeys cannot offer shared seats`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (journey.ridePoolOffer && journey.ridePoolOffer.status !== 'CANCELLED') {
      throw AppError.conflict('This journey already has a ride offer');
    }
    const maxSeats = Math.max(1, journey.vehicleType.defaultSeats);
    if (totalSeats < 1 || totalSeats > maxSeats) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Seats must be between 1 and ${maxSeats} for ${journey.vehicleType.name}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const offer = journey.ridePoolOffer
      ? await this.prisma.ridePoolOffer.update({
          where: { id: journey.ridePoolOffer.id },
          data: { totalSeats, availableSeats: totalSeats, status: 'OPEN', notes },
        })
      : await this.prisma.ridePoolOffer.create({
          data: { journeyId, ownerUserId: userId, totalSeats, availableSeats: totalSeats, notes },
        });
    await this.audit.record({
      action: 'ride_pool.offer_created',
      actorUserId: userId,
      entityType: 'ride_pool_offer',
      entityId: offer.id,
    });
    return offer;
  }

  async getOffer(userId: string, offerId: string) {
    const offer = await this.prisma.ridePoolOffer.findUnique({
      where: { id: offerId },
      include: {
        journey: {
          select: {
            departureAt: true,
            status: true,
            vehicleType: { select: { code: true, name: true } },
          },
        },
        owner: {
          select: { firstName: true, profile: { select: { showFirstNameToMatches: true } } },
        },
        requests: {
          include: {
            requester: {
              select: { firstName: true, profile: { select: { showFirstNameToMatches: true } } },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!offer) throw AppError.notFound('Ride offer');
    const isOwner = offer.ownerUserId === userId;
    const myRequest = offer.requests.find((r) => r.requesterUserId === userId);
    if (!isOwner && !myRequest && offer.status !== 'OPEN') throw AppError.notFound('Ride offer');
    const name = (u: { firstName: string; profile: { showFirstNameToMatches: boolean } | null }) =>
      u.profile?.showFirstNameToMatches === false ? 'EmblemWay traveller' : u.firstName;
    return {
      id: offer.id,
      status: offer.status,
      totalSeats: offer.totalSeats,
      availableSeats: offer.availableSeats,
      notes: offer.notes,
      departureAt: offer.journey.departureAt.toISOString(),
      vehicleType: offer.journey.vehicleType,
      owner: { displayName: name(offer.owner) },
      isOwner,
      requests: isOwner
        ? offer.requests.map((r) => ({
            id: r.id,
            status: r.status,
            seats: r.seats,
            message: r.message,
            requester: { displayName: name(r.requester) },
            createdAt: r.createdAt,
          }))
        : myRequest
          ? [
              {
                id: myRequest.id,
                status: myRequest.status,
                seats: myRequest.seats,
                message: myRequest.message,
                createdAt: myRequest.createdAt,
              },
            ]
          : [],
    };
  }

  async requestSeat(
    userId: string,
    offerId: string,
    requesterJourneyId: string,
    seats: number,
    message?: string,
  ) {
    const offer = await this.prisma.ridePoolOffer.findUnique({ where: { id: offerId } });
    if (!offer) throw AppError.notFound('Ride offer');
    if (offer.ownerUserId === userId)
      throw new AppError(
        ErrorCode.POOL_REQUEST_INVALID,
        'You cannot request a seat on your own ride',
        HttpStatus.BAD_REQUEST,
      );
    if (offer.status !== 'OPEN')
      throw new AppError(
        ErrorCode.POOL_FULL,
        'This ride is not accepting requests',
        HttpStatus.CONFLICT,
      );
    if (seats < 1 || seats > offer.availableSeats)
      throw new AppError(ErrorCode.POOL_FULL, 'Not enough seats available', HttpStatus.CONFLICT);
    const myJourney = await this.prisma.journey.findFirst({
      where: { id: requesterJourneyId, userId, status: { in: ['PLANNED', 'ACTIVE'] } },
    });
    if (!myJourney)
      throw new AppError(
        ErrorCode.POOL_REQUEST_INVALID,
        'Select one of your upcoming journeys',
        HttpStatus.BAD_REQUEST,
      );
    // Only travellers whose journey actually matches the offered journey may request a seat.
    const match = await this.prisma.journeyMatch.findUnique({
      where: {
        journeyId_matchedJourneyId: {
          journeyId: requesterJourneyId,
          matchedJourneyId: offer.journeyId,
        },
      },
    });
    if (!match)
      throw new AppError(
        ErrorCode.POOL_REQUEST_INVALID,
        'Your journey does not match this ride',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    try {
      const req = await this.prisma.ridePoolRequest.create({
        data: { offerId, requesterUserId: userId, requesterJourneyId, seats, message },
      });
      await this.notifications.notify({
        userId: offer.ownerUserId,
        type: 'RIDE_POOL',
        title: 'New seat request',
        body: `Someone travelling your route requested ${seats} seat${seats > 1 ? 's' : ''}.`,
        data: { offerId, requestId: req.id },
        dedupeKey: `pool-request:${req.id}`,
      });
      return req;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002')
        throw AppError.conflict('You already have an open request for this ride');
      throw err;
    }
  }

  async decide(ownerUserId: string, requestId: string, decision: 'ACCEPT' | 'REJECT') {
    const result = await this.prisma.withTransaction(async (tx) => {
      const req = await tx.ridePoolRequest.findUnique({ where: { id: requestId } });
      if (!req) throw AppError.notFound('Seat request');
      const offer = await lockOffer(tx, req.offerId);
      if (offer.owner_user_id !== ownerUserId) throw AppError.forbidden();
      if (req.status !== 'PENDING')
        throw new AppError(
          ErrorCode.POOL_REQUEST_INVALID,
          `Request is already ${req.status.toLowerCase()}`,
          HttpStatus.CONFLICT,
        );
      if (decision === 'REJECT') {
        return tx.ridePoolRequest.update({
          where: { id: requestId },
          data: { status: 'REJECTED', decidedAt: new Date() },
        });
      }
      if (offer.status !== 'OPEN' || offer.available_seats < req.seats) {
        throw new AppError(
          ErrorCode.POOL_FULL,
          'Not enough seats left to accept this request',
          HttpStatus.CONFLICT,
        );
      }
      const remaining = offer.available_seats - req.seats;
      await tx.ridePoolOffer.update({
        where: { id: offer.id },
        data: { availableSeats: remaining, status: remaining === 0 ? 'FULL' : 'OPEN' },
      });
      await tx.ridePoolMember.create({
        data: { offerId: offer.id, userId: req.requesterUserId, requestId, seats: req.seats },
      });
      return tx.ridePoolRequest.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED', decidedAt: new Date() },
      });
    });
    await this.notifications.notify({
      userId: result.requesterUserId,
      type: 'RIDE_POOL',
      title: decision === 'ACCEPT' ? 'Seat request accepted' : 'Seat request declined',
      body:
        decision === 'ACCEPT'
          ? 'Your seat is confirmed. Check the journey for details.'
          : 'The driver could not accommodate your request.',
      data: { offerId: result.offerId, requestId },
      dedupeKey: `pool-decision:${requestId}`,
    });
    return result;
  }

  async withdraw(userId: string, requestId: string) {
    const result = await this.prisma.withTransaction(async (tx) => {
      const req = await tx.ridePoolRequest.findFirst({
        where: { id: requestId, requesterUserId: userId },
      });
      if (!req) throw AppError.notFound('Seat request');
      if (req.status !== 'PENDING' && req.status !== 'ACCEPTED') {
        throw new AppError(
          ErrorCode.POOL_REQUEST_INVALID,
          `Request is already ${req.status.toLowerCase()}`,
          HttpStatus.CONFLICT,
        );
      }
      if (req.status === 'ACCEPTED') await releaseSeats(tx, req.offerId, requestId, req.seats);
      return tx.ridePoolRequest.update({
        where: { id: requestId },
        data: { status: 'WITHDRAWN', decidedAt: new Date() },
      });
    });
    const offer = await this.prisma.ridePoolOffer.findUnique({ where: { id: result.offerId } });
    if (offer) {
      await this.notifications.notify({
        userId: offer.ownerUserId,
        type: 'RIDE_POOL',
        title: 'Seat request withdrawn',
        body: 'A traveller withdrew their seat request.',
        data: { offerId: offer.id },
        dedupeKey: `pool-withdraw:${requestId}`,
      });
    }
    return result;
  }

  async cancelOffer(userId: string, offerId: string) {
    const offer = await this.prisma.ridePoolOffer.findFirst({
      where: { id: offerId, ownerUserId: userId },
    });
    if (!offer) throw AppError.notFound('Ride offer');
    await this.closeOffer(
      offer.id,
      'Ride offer cancelled',
      'The driver cancelled this ride offer.',
    );
  }

  /** Called when a journey is cancelled / expired / completed. */
  async onJourneyClosed(
    journeyId: string,
    reason: 'CANCELLED' | 'EXPIRED' | 'COMPLETED',
  ): Promise<void> {
    const offer = await this.prisma.ridePoolOffer.findUnique({ where: { journeyId } });
    if (offer && offer.status !== 'CANCELLED' && offer.status !== 'CLOSED') {
      if (reason === 'COMPLETED')
        await this.prisma.ridePoolOffer.update({
          where: { id: offer.id },
          data: { status: 'CLOSED' },
        });
      else
        await this.closeOffer(
          offer.id,
          'Ride cancelled',
          'The journey you requested a seat on is no longer available.',
        );
    }
    // Requests made FROM this journey are withdrawn.
    const mine = await this.prisma.ridePoolRequest.findMany({
      where: { requesterJourneyId: journeyId, status: { in: ['PENDING', 'ACCEPTED'] } },
    });
    for (const r of mine) {
      if (reason !== 'COMPLETED')
        await this.withdraw(r.requesterUserId, r.id).catch(() => undefined);
    }
  }

  private async closeOffer(offerId: string, title: string, body: string): Promise<void> {
    const affected = await this.prisma.withTransaction(async (tx) => {
      await lockOffer(tx, offerId);
      const open = await tx.ridePoolRequest.findMany({
        where: { offerId, status: { in: ['PENDING', 'ACCEPTED'] } },
      });
      await tx.ridePoolRequest.updateMany({
        where: { offerId, status: { in: ['PENDING', 'ACCEPTED'] } },
        data: { status: 'CANCELLED', decidedAt: new Date() },
      });
      await tx.ridePoolMember.updateMany({
        where: { offerId, leftAt: null },
        data: { leftAt: new Date() },
      });
      await tx.ridePoolOffer.update({ where: { id: offerId }, data: { status: 'CANCELLED' } });
      return open;
    });
    for (const r of affected) {
      await this.notifications.notify({
        userId: r.requesterUserId,
        type: 'RIDE_POOL',
        title,
        body,
        data: { offerId },
        dedupeKey: `pool-cancel:${r.id}`,
      });
    }
  }

  async myRequests(userId: string) {
    return this.prisma.ridePoolRequest.findMany({
      where: { requesterUserId: userId },
      include: {
        offer: {
          select: {
            id: true,
            status: true,
            availableSeats: true,
            journey: { select: { departureAt: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async myOffers(userId: string) {
    return this.prisma.ridePoolOffer.findMany({
      where: { ownerUserId: userId },
      include: {
        _count: { select: { requests: { where: { status: 'PENDING' } } } },
        journey: { select: { departureAt: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

interface LockedOffer {
  id: string;
  owner_user_id: string;
  available_seats: number;
  total_seats: number;
  status: string;
}

async function lockOffer(tx: Tx, offerId: string): Promise<LockedOffer> {
  const rows = await tx.$queryRaw<LockedOffer[]>`
    SELECT id, owner_user_id, available_seats, total_seats, status::text AS status
      FROM ride_pool_offers WHERE id = ${offerId}::uuid FOR UPDATE`;
  if (!rows[0]) throw AppError.notFound('Ride offer');
  return rows[0];
}

async function releaseSeats(
  tx: Tx,
  offerId: string,
  requestId: string,
  seats: number,
): Promise<void> {
  const offer = await lockOffer(tx, offerId);
  const available = Math.min(offer.total_seats, offer.available_seats + seats);
  await tx.ridePoolOffer.update({
    where: { id: offerId },
    data: { availableSeats: available, status: offer.status === 'FULL' ? 'OPEN' : undefined },
  });
  await tx.ridePoolMember.updateMany({
    where: { requestId, leftAt: null },
    data: { leftAt: new Date() },
  });
}
