import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { JourneyStatus } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';
import { AppConfigService } from '../config/app-config.service';
import { formatLocalTime } from '../common/utils/time.util';
import { ComputedMatch, MatchingService } from '../matching/matching.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RidePoolService } from '../ride-pool/ride-pool.service';
import { SettingsService } from '../settings/settings.service';
import { MaintenanceService } from './maintenance.service';

const QUEUE = 'emblemway';

type JobName = 'match' | 'reminder' | 'expire' | 'auto-complete' | 'hotspots' | 'retention';

/**
 * Background work. With JOBS_ENABLED=true work goes through a Redis-backed BullMQ queue
 * (retries with exponential backoff, de-duplicated job ids, repeatable maintenance jobs).
 * With JOBS_ENABLED=false (tests, single-process dev) the same work runs inline.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly stats = { completed: 0, failed: 0, lastFailure: null as string | null };

  constructor(
    private readonly config: AppConfigService,
    private readonly matching: MatchingService,
    private readonly notifications: NotificationsService,
    private readonly ridePool: RidePoolService,
    private readonly maintenance: MaintenanceService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  get enabled(): boolean {
    return this.config.get('JOBS_ENABLED');
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    const connection = { url: this.config.get('REDIS_URL'), maxRetriesPerRequest: null };
    this.queue = new Queue(QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
    this.worker = new Worker(QUEUE, (job: Job) => this.process(job), {
      connection,
      concurrency: 4,
    });
    this.worker.on('completed', () => (this.stats.completed += 1));
    this.worker.on('failed', (job, err) => {
      this.stats.failed += 1;
      this.stats.lastFailure = `${job?.name ?? '?'}: ${err.message}`;
      this.logger.error(
        `Job ${job?.name} ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
      );
    });
    await this.queue.upsertJobScheduler('expire', { every: 5 * 60_000 }, { name: 'expire' });
    await this.queue.upsertJobScheduler(
      'auto-complete',
      { every: 15 * 60_000 },
      { name: 'auto-complete' },
    );
    await this.queue.upsertJobScheduler('hotspots', { every: 60 * 60_000 }, { name: 'hotspots' });
    await this.queue.upsertJobScheduler(
      'retention',
      { pattern: '30 21 * * *' },
      { name: 'retention' },
    ); // 03:00 IST
    this.logger.log('Background jobs started');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async process(job: Job): Promise<unknown> {
    const name = job.name as JobName;
    switch (name) {
      case 'match':
        return this.runMatching((job.data as { journeyId: string }).journeyId);
      case 'reminder':
        return this.maintenance.sendReminder((job.data as { journeyId: string }).journeyId);
      case 'expire':
        return this.maintenance.expireStaleJourneys();
      case 'auto-complete':
        return this.maintenance.autoCompleteJourneys();
      case 'hotspots':
        return this.maintenance.aggregateHotspots();
      case 'retention':
        return this.maintenance.applyRetention();
      default:
        throw new Error(`Unknown job ${String(name)}`);
    }
  }

  /** Called after any journey create/update/transition. */
  async afterJourneyChanged(
    journeyId: string,
    status: JourneyStatus,
    previous?: JourneyStatus,
  ): Promise<void> {
    if (status === 'PLANNED' || status === 'ACTIVE') {
      await this.enqueue('match', { journeyId }, `match-${journeyId}-${Date.now()}`);
      if (status === 'PLANNED') await this.scheduleReminder(journeyId);
    } else if (status === 'CANCELLED' || status === 'EXPIRED' || status === 'COMPLETED') {
      await this.removeReminder(journeyId);
      await this.ridePool
        .onJourneyClosed(journeyId, status)
        .catch((err: Error) => this.logger.error(`Ride pool cleanup failed: ${err.message}`));
      if (previous === 'PLANNED' || previous === 'ACTIVE')
        await this.matching.clearMatches(journeyId);
    }
  }

  async runMatching(journeyId: string): Promise<number> {
    const matches = await this.matching.computeAndStore(journeyId);
    await this.notifyNewMatches(journeyId, matches);
    return matches.length;
  }

  /** Tell travellers whose journeys gained a new compatible traveller (once per pair). */
  private async notifyNewMatches(journeyId: string, matches: ComputedMatch[]): Promise<void> {
    const strong = matches.filter((m) => m.confidence !== 'LOW');
    if (strong.length === 0) return;
    const j = await this.prisma.journey.findUnique({
      where: { id: journeyId },
      select: { userId: true },
    });
    for (const m of strong.slice(0, 50)) {
      const other = await this.prisma.journey.findUnique({
        where: { id: m.matchedJourneyId },
        select: { departureAt: true, timezone: true },
      });
      if (!other) continue;
      await this.notifications.notify({
        userId: m.matchedUserId,
        type: 'MATCH_FOUND',
        title: 'New traveller on your route',
        body: `Someone is travelling ${Math.round(m.sharedDistanceMeters / 100) / 10} km of your ${formatLocalTime(other.departureAt, other.timezone)} journey around the same time.`,
        data: { journeyId: m.matchedJourneyId },
        dedupeKey: `match:${m.matchedJourneyId}:${journeyId}`,
      });
    }
    if (j) {
      await this.notifications.notify({
        userId: j.userId,
        type: 'MATCH_FOUND',
        title: 'Travellers found on your route',
        body: `${strong.length} compatible traveller${strong.length > 1 ? 's' : ''} found for your journey.`,
        data: { journeyId },
        dedupeKey: `match-summary:${journeyId}:${strong.length}`,
      });
    }
  }

  private async scheduleReminder(journeyId: string): Promise<void> {
    if (!this.queue) return; // inline mode: reminders require the scheduler
    const j = await this.prisma.journey.findUnique({
      where: { id: journeyId },
      select: { departureAt: true },
    });
    if (!j) return;
    const { reminderLeadMinutes } = await this.settings.get('journeys');
    const delay = j.departureAt.getTime() - reminderLeadMinutes * 60_000 - Date.now();
    if (delay <= 0) return;
    await this.removeReminder(journeyId);
    await this.queue.add('reminder', { journeyId }, { jobId: `reminder-${journeyId}`, delay });
  }

  private async removeReminder(journeyId: string): Promise<void> {
    if (!this.queue) return;
    await this.queue.remove(`reminder-${journeyId}`).catch(() => undefined);
  }

  private async enqueue(
    name: JobName,
    data: Record<string, unknown>,
    jobId: string,
  ): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.add(name, data, { jobId });
        return;
      } catch (err) {
        this.logger.error(`Queue unavailable, running ${name} inline: ${(err as Error).message}`);
      }
    }
    try {
      if (name === 'match') await this.runMatching(data.journeyId as string);
    } catch (err) {
      // Matching is recomputed lazily on read, so a failure here is not fatal.
      this.logger.error(`Inline ${name} failed: ${(err as Error).message}`);
    }
  }

  async health(): Promise<Record<string, unknown>> {
    if (!this.queue) return { mode: 'inline' };
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
      'completed',
    );
    return {
      mode: 'queue',
      counts,
      workerRunning: this.worker?.isRunning() ?? false,
      processed: this.stats,
    };
  }
}
