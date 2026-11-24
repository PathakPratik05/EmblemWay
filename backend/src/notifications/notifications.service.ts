import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma, UserProfile } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { paginate, toSkipTake } from '../common/pagination/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_PROVIDER, PushProvider } from './push.provider';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Same key for the same user ⇒ notification is created at most once. */
  dedupeKey?: string;
}

/** Which profile preference governs each notification type (SYSTEM / RIDE_POOL are always on). */
const PREFERENCE: Partial<Record<NotificationType, keyof UserProfile>> = {
  JOURNEY_REMINDER: 'notifyJourneyReminders',
  MATCH_FOUND: 'notifyMatches',
  JOURNEY_STATUS: 'notifyStatusUpdates',
  TRAFFIC_ALERT: 'notifyTrafficAlerts',
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  /** Stores an in-app notification and attempts push delivery. Never throws to the caller. */
  async notify(input: NotifyInput): Promise<{ created: boolean; pushed: boolean }> {
    try {
      const profile = await this.prisma.userProfile.findUnique({ where: { userId: input.userId } });
      const prefKey = PREFERENCE[input.type];
      if (!profile || (prefKey && profile[prefKey] === false))
        return { created: false, pushed: false };

      let notification;
      try {
        notification = await this.prisma.notification.create({
          data: {
            userId: input.userId,
            type: input.type,
            title: input.title.slice(0, 120),
            body: input.body.slice(0, 500),
            data: input.data ?? {},
            dedupeKey: input.dedupeKey,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
          return { created: false, pushed: false };
        throw err;
      }

      const tokens = await this.prisma.deviceToken.findMany({
        where: { userId: input.userId },
        select: { token: true },
      });
      if (!this.push.configured || tokens.length === 0) {
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: { pushStatus: 'SKIPPED' },
        });
        return { created: true, pushed: false };
      }
      const res = await this.push.send(
        tokens.map((t) => t.token),
        {
          title: notification.title,
          body: notification.body,
          data: { ...(input.data ?? {}), notificationId: notification.id, type: input.type },
        },
      );
      if (res.invalidTokens.length)
        await this.prisma.deviceToken.deleteMany({ where: { token: { in: res.invalidTokens } } });
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: {
          pushStatus: res.delivered > 0 ? 'SENT' : 'FAILED',
          sentAt: res.delivered > 0 ? new Date() : null,
        },
      });
      return { created: true, pushed: res.delivered > 0 };
    } catch (err) {
      this.logger.error(`Failed to notify user: ${(err as Error).message}`);
      return { created: false, pushed: false };
    }
  }

  async list(userId: string, q: { page: number; pageSize: number; unreadOnly?: boolean }) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(q.unreadOnly ? { readAt: null } : {}),
    };
    const [total, unread, items] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(q),
      }),
    ]);
    const page = paginate(
      items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
      total,
      q,
    );
    return { ...page, unreadCount: unread };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const res = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0 && !(await this.prisma.notification.findFirst({ where: { id, userId } })))
      throw AppError.notFound('Notification');
  }

  async markAllRead(userId: string): Promise<number> {
    return (
      await this.prisma.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
      })
    ).count;
  }

  async registerDevice(userId: string, token: string, platform: string): Promise<void> {
    // A token belongs to one device; if it moved to a new account, re-own it.
    await this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async unregisterDevice(userId: string, token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
  }

  get pushConfigured(): boolean {
    return this.push.configured;
  }
}
