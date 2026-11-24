import { HttpStatus, Injectable } from '@nestjs/common';
import { JourneyStatus, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AppError, ErrorCode } from '../common/errors/app-error';
import { paginate, toSkipTake } from '../common/pagination/pagination';
import { LatLng } from '../common/utils/geo.util';
import { addSeconds, IST_TIMEZONE } from '../common/utils/time.util';
import { AuditService } from '../audit/audit.service';
import { CitiesService } from '../cities/cities.service';
import { RouteSegmentsService } from '../hotspots/route-segments.service';
import { JobsService } from '../jobs/jobs.service';
import { RoutingService } from '../maps/routing.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import {
  ACTION_TARGET,
  canTransition,
  HISTORY_STATUSES,
  isEditable,
  JourneyAction,
  sourcesFor,
  UPCOMING_STATUSES,
} from './domain/journey-state.machine';
import {
  parseDepartureIso,
  validateDeparture,
  validateJourneyGeo,
  validateTimezone,
} from './domain/journey-validation';
import { CreateJourneyDto, ListJourneysQueryDto, UpdateJourneyDto } from './dto/journey.dto';
import { JourneysRepository, LocationRecord } from './journeys.repository';
import { JOURNEY_DETAIL_INCLUDE, toJourneyView } from './journey.view';

const IDEMPOTENCY_SCOPE = 'journey.create';
const IDEMPOTENCY_TTL_SECONDS = 24 * 3600;

@Injectable()
export class JourneysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: JourneysRepository,
    private readonly routing: RoutingService,
    private readonly vehicles: VehiclesService,
    private readonly cities: CitiesService,
    private readonly segments: RouteSegmentsService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  // ─── Create ────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateJourneyDto, idempotencyKey: string | undefined) {
    if (idempotencyKey !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(idempotencyKey)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Idempotency-Key must be 8-64 URL-safe characters',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (idempotencyKey) {
      const replay = await this.claimIdempotencyKey(userId, idempotencyKey, dto);
      if (replay) return { journey: await this.getForUser(replay, userId), replayed: true };
    }
    try {
      const journeyId = await this.createInternal(userId, dto, idempotencyKey);
      if (idempotencyKey) {
        await this.prisma.idempotencyRecord.update({
          where: { userId_scope_key: { userId, scope: IDEMPOTENCY_SCOPE, key: idempotencyKey } },
          data: { statusCode: 201, responseBody: { journeyId } },
        });
      }
      return { journey: await this.getForUser(journeyId, userId), replayed: false };
    } catch (err) {
      // Release the key so the client can retry the same request after a failure.
      if (idempotencyKey) {
        await this.prisma.idempotencyRecord
          .deleteMany({
            where: { userId, scope: IDEMPOTENCY_SCOPE, key: idempotencyKey, statusCode: null },
          })
          .catch(() => undefined);
      }
      throw err;
    }
  }

  /** Returns an existing journey id for a completed replay, or null when this call owns the key. */
  private async claimIdempotencyKey(
    userId: string,
    key: string,
    dto: CreateJourneyDto,
  ): Promise<string | null> {
    const requestHash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          userId,
          scope: IDEMPOTENCY_SCOPE,
          key,
          requestHash,
          expiresAt: addSeconds(new Date(), IDEMPOTENCY_TTL_SECONDS),
        },
      });
      return null;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: { userId_scope_key: { userId, scope: IDEMPOTENCY_SCOPE, key } },
      });
      if (!existing) return this.claimIdempotencyKey(userId, key, dto); // expired & purged between calls
      if (existing.requestHash !== requestHash) {
        throw AppError.conflict(
          'This Idempotency-Key was already used with a different request',
          ErrorCode.IDEMPOTENCY_KEY_REUSED,
        );
      }
      const journeyId = (existing.responseBody as { journeyId?: string } | null)?.journeyId;
      if (!journeyId)
        throw AppError.conflict(
          'An identical request is still being processed',
          ErrorCode.IDEMPOTENCY_IN_PROGRESS,
        );
      return journeyId;
    }
  }

  private async createInternal(
    userId: string,
    dto: CreateJourneyDto,
    idempotencyKey?: string,
  ): Promise<string> {
    const jSettings = await this.settings.get('journeys');
    const departureAt = parseDepartureIso(dto.departureAt);
    validateDeparture(departureAt, jSettings);
    const timezone = dto.timezone ?? IST_TIMEZONE;
    validateTimezone(timezone);
    const pickup = dto.pickup ?? dto.source;
    validateJourneyGeo({ source: dto.source, destination: dto.destination, pickup });
    const vehicleType = await this.vehicles.getActiveByCode(dto.vehicleTypeCode);
    if (dto.userVehicleId) await this.assertUserVehicle(userId, dto.userVehicleId, vehicleType.id);

    // External call happens BEFORE the transaction so we never hold DB locks during network I/O.
    const routes = await this.routing.planRoutes({
      source: dto.source,
      destination: dto.destination,
      pickup,
      profile: vehicleType.routingProfile,
    });
    const selectedIndex = Math.min(dto.routeAlternativeIndex ?? 0, routes.length - 1);
    const selected = routes[selectedIndex]!;
    const city = await this.cities.resolve(dto.source);
    const status: JourneyStatus = dto.saveAsDraft ? 'DRAFT' : 'PLANNED';

    const journeyId = await this.prisma.withTransaction(async (tx) => {
      const journey = await tx.journey.create({
        data: {
          userId,
          cityId: city?.id ?? null,
          vehicleTypeId: vehicleType.id,
          userVehicleId: dto.userVehicleId,
          status,
          purpose: dto.purpose ?? 'COMMUTE',
          departureAt,
          estimatedArrivalAt: addSeconds(departureAt, selected.durationSeconds),
          timezone,
          notes: dto.notes?.trim() || null,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
      await this.repo.replaceLocations(
        tx,
        journey.id,
        buildLocations(dto.source, dto.destination, pickup),
      );
      await this.repo.replaceRoutes(
        tx,
        journey.id,
        routes,
        selectedIndex,
        this.routing.providerName,
        vehicleType.routingProfile,
      );
      await this.segments.assign(tx, journey.id, city?.id ?? null, selected.points);
      await this.audit.record(
        {
          action: 'journey.created',
          actorUserId: userId,
          entityType: 'journey',
          entityId: journey.id,
          metadata: { status, vehicle: vehicleType.code },
        },
        tx,
      );
      return journey.id;
    });

    await this.jobs.afterJourneyChanged(journeyId, status);
    return journeyId;
  }

  private async assertUserVehicle(
    userId: string,
    userVehicleId: string,
    vehicleTypeId: string,
  ): Promise<void> {
    const v = await this.prisma.userVehicle.findFirst({
      where: { id: userVehicleId, userId, deletedAt: null },
    });
    if (!v)
      throw new AppError(
        ErrorCode.INVALID_VEHICLE_TYPE,
        'Vehicle not found in your profile',
        HttpStatus.BAD_REQUEST,
      );
    if (v.vehicleTypeId !== vehicleTypeId) {
      throw new AppError(
        ErrorCode.INVALID_VEHICLE_TYPE,
        'Selected vehicle does not match the vehicle category',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ─── Update ────────────────────────────────────────────────────────────

  async update(userId: string, journeyId: string, dto: UpdateJourneyDto) {
    const current = await this.prisma.journey.findFirst({
      where: { id: journeyId, userId },
      include: JOURNEY_DETAIL_INCLUDE,
    });
    if (!current) throw AppError.notFound('Journey');
    if (current.version !== dto.version) {
      throw AppError.conflict(
        'This journey was changed elsewhere. Reload and try again.',
        ErrorCode.VERSION_CONFLICT,
        { currentVersion: current.version },
      );
    }
    if (!isEditable(current.status, current.departureAt)) {
      throw new AppError(
        ErrorCode.JOURNEY_NOT_EDITABLE,
        'Only upcoming journeys that have not started can be edited',
        HttpStatus.CONFLICT,
      );
    }

    const jSettings = await this.settings.get('journeys');
    const departureAt = dto.departureAt ? parseDepartureIso(dto.departureAt) : current.departureAt;
    if (dto.departureAt) validateDeparture(departureAt, jSettings);
    if (dto.timezone) validateTimezone(dto.timezone);

    const loc = (kind: string) => current.locations.find((l) => l.kind === kind)!;
    const source = dto.source ?? toInput(loc('SOURCE'));
    const destination = dto.destination ?? toInput(loc('DESTINATION'));
    const pickup =
      dto.pickup ?? (dto.source ? dto.source : toInput(loc('PICKUP') ?? loc('SOURCE')));
    const geoChanged = !!(dto.source || dto.destination || dto.pickup);
    const vehicleType = dto.vehicleTypeCode
      ? await this.vehicles.getActiveByCode(dto.vehicleTypeCode)
      : await this.vehicles.getById(current.vehicleTypeId);
    const profileChanged = vehicleType.routingProfile !== current.vehicleType.routingProfile;
    if (geoChanged) validateJourneyGeo({ source, destination, pickup });

    // Route recalculation only when geometry-relevant inputs changed.
    const routes =
      geoChanged || profileChanged
        ? await this.routing.planRoutes({
            source,
            destination,
            pickup,
            profile: vehicleType.routingProfile,
          })
        : null;
    const city = geoChanged ? await this.cities.resolve(source) : undefined;

    await this.prisma.withTransaction(async (tx) => {
      // Optimistic lock: the version must still match at write time.
      const res = await tx.journey.updateMany({
        where: {
          id: journeyId,
          userId,
          version: dto.version,
          status: { in: ['DRAFT', 'PLANNED'] },
        },
        data: {
          departureAt,
          timezone: dto.timezone,
          vehicleTypeId: vehicleType.id,
          purpose: dto.purpose,
          notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
          cityId: city === undefined ? undefined : (city?.id ?? null),
          estimatedArrivalAt: addSeconds(
            departureAt,
            routes?.[0]?.durationSeconds ??
              current.routes.find((r) => r.isSelected)?.durationSeconds ??
              0,
          ),
          version: { increment: 1 },
          matchesComputedAt: null,
          ...(vehicleType.id !== current.vehicleTypeId ? { userVehicleId: null } : {}),
        },
      });
      if (res.count !== 1)
        throw AppError.conflict(
          'This journey was changed elsewhere. Reload and try again.',
          ErrorCode.VERSION_CONFLICT,
        );
      if (geoChanged)
        await this.repo.replaceLocations(
          tx,
          journeyId,
          buildLocations(source, destination, pickup),
        );
      if (routes) {
        await this.repo.replaceRoutes(
          tx,
          journeyId,
          routes,
          0,
          this.routing.providerName,
          vehicleType.routingProfile,
        );
        await this.segments.assign(tx, journeyId, city?.id ?? current.cityId, routes[0]!.points);
      }
      await this.audit.record(
        {
          action: 'journey.updated',
          actorUserId: userId,
          entityType: 'journey',
          entityId: journeyId,
          metadata: { routeRecalculated: !!routes },
        },
        tx,
      );
    });
    await this.jobs.afterJourneyChanged(journeyId, current.status);
    return this.getForUser(journeyId, userId);
  }

  // ─── Status transitions ────────────────────────────────────────────────

  async transition(
    userId: string | null,
    journeyId: string,
    action: JourneyAction,
    reason?: string,
    now = new Date(),
  ) {
    const target = ACTION_TARGET[action];
    const journey = await this.prisma.journey.findFirst({
      where: { id: journeyId, ...(userId ? { userId } : {}) },
    });
    if (!journey) throw AppError.notFound('Journey');
    if (!canTransition(journey.status, target)) {
      throw new AppError(
        ErrorCode.INVALID_STATUS_TRANSITION,
        `Cannot ${action} a journey that is ${journey.status.toLowerCase()}`,
        HttpStatus.CONFLICT,
        {
          from: journey.status,
          to: target,
        },
      );
    }
    if (action === 'publish')
      validateDeparture(journey.departureAt, await this.settings.get('journeys'), now);

    const data: Prisma.JourneyUpdateManyMutationInput = {
      status: target,
      version: { increment: 1 },
    };
    if (target === 'ACTIVE') data.startedAt = now;
    if (target === 'COMPLETED') data.completedAt = now;
    if (target === 'CANCELLED')
      Object.assign(data, { cancelledAt: now, cancelReason: reason?.trim() || null });
    if (target === 'EXPIRED') data.expiredAt = now;

    await this.prisma.withTransaction(async (tx) => {
      // Conditional on the source status: two concurrent transitions can't both win.
      const res = await tx.journey.updateMany({
        where: { id: journeyId, status: { in: sourcesFor(target) } },
        data,
      });
      if (res.count !== 1) {
        throw new AppError(
          ErrorCode.INVALID_STATUS_TRANSITION,
          'Journey status changed concurrently, please reload',
          HttpStatus.CONFLICT,
        );
      }
      if (target === 'CANCELLED' || target === 'EXPIRED' || target === 'COMPLETED') {
        // Finished journeys never appear in anyone's active match counts.
        await tx.journeyMatch.deleteMany({
          where: { OR: [{ journeyId }, { matchedJourneyId: journeyId }] },
        });
      }
      await this.audit.record(
        {
          action: `journey.${action}`,
          actorUserId: userId,
          entityType: 'journey',
          entityId: journeyId,
          metadata: { from: journey.status, to: target },
        },
        tx,
      );
    });
    await this.jobs.afterJourneyChanged(journeyId, target, journey.status);
    return userId ? this.getForUser(journeyId, userId) : null;
  }

  // ─── Queries ───────────────────────────────────────────────────────────

  async getForUser(journeyId: string, userId: string) {
    const journey = await this.prisma.journey.findFirst({
      where: { id: journeyId, userId },
      include: JOURNEY_DETAIL_INCLUDE,
    });
    if (!journey) throw AppError.notFound('Journey');
    return toJourneyView(journey, this.routing.isLive);
  }

  async list(userId: string, q: ListJourneysQueryDto) {
    const statuses: JourneyStatus[] =
      q.scope === 'history'
        ? [...HISTORY_STATUSES]
        : q.scope === 'drafts'
          ? ['DRAFT']
          : UPCOMING_STATUSES.filter((s) => s !== 'DRAFT');
    const where: Prisma.JourneyWhereInput = {
      userId,
      status: q.status ? (statuses.includes(q.status) ? q.status : { in: [] }) : { in: statuses },
    };
    const [total, rows] = await Promise.all([
      this.prisma.journey.count({ where }),
      this.prisma.journey.findMany({
        where,
        include: JOURNEY_DETAIL_INCLUDE,
        orderBy: { departureAt: q.scope === 'history' ? 'desc' : 'asc' },
        ...toSkipTake(q),
      }),
    ]);
    return paginate(
      rows.map((j) => toJourneyView(j, this.routing.isLive, { includePolyline: false })),
      total,
      q,
    );
  }
}

function buildLocations(
  source: LocInput,
  destination: LocInput,
  pickup: LocInput,
): LocationRecord[] {
  const rec = (kind: LocationRecord['kind'], l: LocInput): LocationRecord => ({
    kind,
    name: l.name.trim(),
    address: l.address?.trim() || null,
    placeId: l.placeId ?? null,
    latitude: l.latitude,
    longitude: l.longitude,
  });
  return [rec('SOURCE', source), rec('DESTINATION', destination), rec('PICKUP', pickup)];
}

type LocInput = LatLng & { name: string; address?: string | null; placeId?: string | null };

function toInput(l: {
  name: string;
  address: string | null;
  placeId: string | null;
  latitude: number;
  longitude: number;
}): LocInput {
  return {
    name: l.name,
    address: l.address,
    placeId: l.placeId,
    latitude: l.latitude,
    longitude: l.longitude,
  };
}
