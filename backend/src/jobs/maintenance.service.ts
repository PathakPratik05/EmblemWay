import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { addDays, addMinutes, formatLocalTime } from '../common/utils/time.util';
import { OtpService } from '../auth/otp/otp.service';
import { HotspotsService } from '../hotspots/hotspots.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RidePoolService } from '../ride-pool/ride-pool.service';
import { SettingsService } from '../settings/settings.service';
import { TrafficService } from '../traffic/traffic.service';

/**
 * Periodic housekeeping. Every method is idempotent and safe to run concurrently with
 * user traffic (all state changes are conditional UPDATEs).
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly ridePool: RidePoolService,
    private readonly traffic: TrafficService,
    private readonly hotspots: HotspotsService,
    private readonly otp: OtpService,
    private readonly config: AppConfigService,
  ) {}

  /** PLANNED journeys never started within the grace period become EXPIRED. */
  async expireStaleJourneys(now = new Date()): Promise<number> {
    const { expiryGraceMinutes } = await this.settings.get('journeys');
    const cutoff = addMinutes(now, -expiryGraceMinutes);
    const stale = await this.prisma.journey.findMany({
      where: { status: 'PLANNED', departureAt: { lt: cutoff } },
      select: { id: true, userId: true, departureAt: true, timezone: true },
      take: 500,
    });
    let expired = 0;
    for (const j of stale) {
      const res = await this.prisma.journey.updateMany({
        where: { id: j.id, status: 'PLANNED' },
        data: { status: 'EXPIRED', expiredAt: now, version: { increment: 1 } },
      });
      if (res.count !== 1) continue;
      expired += 1;
      await this.prisma.journeyMatch.deleteMany({
        where: { OR: [{ journeyId: j.id }, { matchedJourneyId: j.id }] },
      });
      await this.ridePool.onJourneyClosed(j.id, 'EXPIRED');
      await this.notifications.notify({
        userId: j.userId,
        type: 'JOURNEY_STATUS',
        title: 'Journey expired',
        body: `Your journey planned for ${formatLocalTime(j.departureAt, j.timezone)} was not started and has expired.`,
        data: { journeyId: j.id, status: 'EXPIRED' },
        dedupeKey: `expired:${j.id}`,
      });
    }
    if (expired) this.logger.log(`Expired ${expired} journeys`);
    return expired;
  }

  /** ACTIVE journeys are completed automatically once well past their expected arrival. */
  async autoCompleteJourneys(now = new Date()): Promise<number> {
    const s = await this.settings.get('journeys');
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT j.id FROM journeys j JOIN journey_routes r ON r.journey_id = j.id AND r.is_selected
       WHERE j.status = 'ACTIVE'
         AND COALESCE(j.started_at, j.departure_at)
             + make_interval(secs => (r.duration_seconds * ${s.autoCompleteDurationFactor}::float8 + ${s.autoCompleteBufferMinutes}::int * 60)::float8) < ${now}
       LIMIT 500`;
    let done = 0;
    for (const { id } of ids) {
      const res = await this.prisma.journey.updateMany({
        where: { id, status: 'ACTIVE' },
        data: { status: 'COMPLETED', completedAt: now, version: { increment: 1 } },
      });
      if (res.count === 1) {
        done += 1;
        await this.prisma.journeyMatch.deleteMany({
          where: { OR: [{ journeyId: id }, { matchedJourneyId: id }] },
        });
        await this.ridePool.onJourneyClosed(id, 'COMPLETED');
      }
    }
    return done;
  }

  /** Reminder + optional traffic alert ahead of departure. */
  async sendReminder(journeyId: string): Promise<void> {
    const j = await this.prisma.journey.findUnique({
      where: { id: journeyId },
      include: { locations: true },
    });
    if (!j || j.status !== 'PLANNED') return;
    const dest = j.locations.find((l) => l.kind === 'DESTINATION');
    await this.notifications.notify({
      userId: j.userId,
      type: 'JOURNEY_REMINDER',
      title: 'Upcoming journey',
      body: `Your journey${dest ? ` to ${dest.name}` : ''} departs at ${formatLocalTime(j.departureAt, j.timezone)}.`,
      data: { journeyId },
      dedupeKey: `reminder:${journeyId}:${j.departureAt.getTime()}`,
    });
    try {
      const prediction = await this.traffic.predictForJourney(journeyId, j.userId);
      const now = prediction.estimates.find((e) => e.scenario === 'NOW');
      const { alertDelayRatio } = await this.settings.get('traffic');
      if (
        now?.status === 'OK' &&
        now.freshness !== 'STALE' &&
        now.staticDurationSeconds &&
        now.durationSeconds
      ) {
        const ratio = now.durationSeconds / now.staticDurationSeconds - 1;
        if (ratio >= alertDelayRatio) {
          await this.notifications.notify({
            userId: j.userId,
            type: 'TRAFFIC_ALERT',
            title: 'Heavier traffic than usual',
            body: `Expect about ${Math.round((now.delaySeconds ?? 0) / 60)} min of delay on your route. ${prediction.recommendation.message}`,
            data: { journeyId },
            dedupeKey: `traffic:${journeyId}:${j.departureAt.getTime()}`,
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Traffic check for reminder failed: ${(err as Error).message}`);
    }
  }

  /**
   * Data retention: removes precise locations & route geometry of journeys that finished
   * more than LOCATION_RETENTION_DAYS ago (aggregated hotspot statistics are kept), plus
   * expired OTPs, idempotency records, old traffic snapshots and revoked sessions.
   */
  async applyRetention(now = new Date()): Promise<Record<string, number>> {
    const cutoff = addDays(now, -this.config.get('LOCATION_RETENTION_DAYS'));
    const old = await this.prisma.journey.findMany({
      where: {
        status: { in: ['COMPLETED', 'CANCELLED', 'EXPIRED'] },
        departureAt: { lt: cutoff },
        locationsPurgedAt: null,
      },
      select: { id: true },
      take: 1000,
    });
    const ids = old.map((j) => j.id);
    let purgedJourneys = 0;
    if (ids.length) {
      await this.prisma.withTransaction(async (tx) => {
        await tx.journeyLocation.deleteMany({ where: { journeyId: { in: ids } } });
        await tx.journeyRoute.deleteMany({ where: { journeyId: { in: ids } } });
        await tx.journeyRouteSegment.deleteMany({ where: { journeyId: { in: ids } } });
        await tx.trafficSnapshot.updateMany({
          where: { journeyId: { in: ids } },
          data: { journeyId: null },
        });
        purgedJourneys = (
          await tx.journey.updateMany({
            where: { id: { in: ids } },
            data: { locationsPurgedAt: now },
          })
        ).count;
      });
    }
    const [otps, idem, snaps, sessions] = await Promise.all([
      this.otp.purgeOlderThan(addDays(now, -1)),
      this.prisma.idempotencyRecord
        .deleteMany({ where: { expiresAt: { lt: now } } })
        .then((r) => r.count),
      this.traffic.purgeSnapshotsOlderThan(addDays(now, -30)),
      this.prisma.userSession
        .deleteMany({
          where: {
            OR: [{ expiresAt: { lt: addDays(now, -7) } }, { revokedAt: { lt: addDays(now, -30) } }],
          },
        })
        .then((r) => r.count),
    ]);
    const result = {
      purgedJourneys,
      otps,
      idempotencyRecords: idem,
      trafficSnapshots: snaps,
      sessions,
    };
    this.logger.log({ result }, 'Retention applied');
    return result;
  }

  async aggregateHotspots(now = new Date()) {
    return this.hotspots.aggregate(now);
  }
}
