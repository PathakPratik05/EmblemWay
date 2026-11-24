import { HttpStatus, Injectable } from '@nestjs/common';
import { JourneyStatus, Prisma, UserStatus } from '@prisma/client';
import { AppError, ErrorCode } from '../common/errors/app-error';
import { paginate, toSkipTake } from '../common/pagination/pagination';
import { maskPhone } from '../common/utils/phone.util';
import { addDays } from '../common/utils/time.util';
import { AuditService } from '../audit/audit.service';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';

export interface AdminActor {
  userId: string;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
  requestId?: string;
  ip?: string;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async overview(now = new Date()) {
    const [usersTotal, usersActive, usersNew7d, byStatus, matches, activeNow, avgScore] =
      await Promise.all([
        this.prisma.user.count({ where: { deletedAt: null, role: 'USER' } }),
        this.prisma.user.count({
          where: { deletedAt: null, role: 'USER', lastLoginAt: { gte: addDays(now, -30) } },
        }),
        this.prisma.user.count({
          where: { deletedAt: null, role: 'USER', createdAt: { gte: addDays(now, -7) } },
        }),
        this.prisma.journey.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.journeyMatch.count(),
        this.prisma.journey.count({ where: { status: 'ACTIVE' } }),
        this.prisma.journeyMatch.aggregate({ _avg: { score: true } }),
      ]);
    const statusCounts = Object.fromEntries(
      Object.values(JourneyStatus).map((s) => [s, 0]),
    ) as Record<JourneyStatus, number>;
    for (const row of byStatus) statusCounts[row.status] = row._count._all;
    return {
      users: { total: usersTotal, activeLast30Days: usersActive, newLast7Days: usersNew7d },
      journeys: {
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        byStatus: statusCounts,
        activeNow,
      },
      // Stored pairs are bidirectional, so each traveller pair is counted once here.
      matches: {
        pairs: Math.round(matches / 2),
        averageScore: avgScore._avg.score ? Math.round(avgScore._avg.score * 10) / 10 : null,
      },
      generatedAt: now.toISOString(),
    };
  }

  async journeysPerDay(days: number, now = new Date()) {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; total: bigint; cancelled: bigint; completed: bigint }>
    >`
      SELECT date_trunc('day', departure_at AT TIME ZONE 'Asia/Kolkata') AS day,
             count(*) AS total,
             count(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
             count(*) FILTER (WHERE status = 'COMPLETED') AS completed
        FROM journeys
       WHERE departure_at >= ${addDays(now, -days)} AND departure_at < ${addDays(now, 7)}
       GROUP BY 1 ORDER BY 1`;
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      total: Number(r.total),
      cancelled: Number(r.cancelled),
      completed: Number(r.completed),
    }));
  }

  async vehicleStats() {
    const rows = await this.prisma.$queryRaw<
      Array<{ code: string; name: string; journeys: bigint; travellers: bigint; active: bigint }>
    >`
      SELECT vt.code, vt.name, count(j.id) AS journeys, count(DISTINCT j.user_id) AS travellers,
             count(j.id) FILTER (WHERE j.status IN ('PLANNED', 'ACTIVE')) AS active
        FROM vehicle_types vt LEFT JOIN journeys j ON j.vehicle_type_id = vt.id
       GROUP BY vt.code, vt.name, vt.sort_order ORDER BY vt.sort_order`;
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      journeys: Number(r.journeys),
      travellers: Number(r.travellers),
      upcomingOrActive: Number(r.active),
    }));
  }

  async cityStats() {
    const rows = await this.prisma.$queryRaw<
      Array<{
        code: string | null;
        name: string | null;
        journeys: bigint;
        travellers: bigint;
        active: bigint;
      }>
    >`
      SELECT c.code, c.name, count(j.id) AS journeys, count(DISTINCT j.user_id) AS travellers,
             count(j.id) FILTER (WHERE j.status IN ('PLANNED', 'ACTIVE')) AS active
        FROM journeys j LEFT JOIN cities c ON c.id = j.city_id
       GROUP BY c.code, c.name ORDER BY journeys DESC`;
    return rows.map((r) => ({
      code: r.code ?? 'OTHER',
      name: r.name ?? 'Outside launch cities',
      journeys: Number(r.journeys),
      travellers: Number(r.travellers),
      upcomingOrActive: Number(r.active),
    }));
  }

  /** Most common origin → destination corridors (1 km cells), with representative place names. */
  async popularRoutes(limit: number, days: number, now = new Date()) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        src_cell: string;
        dst_cell: string;
        journeys: bigint;
        travellers: bigint;
        source_name: string;
        destination_name: string;
        avg_km: number;
      }>
    >`
      WITH j AS (
        SELECT j.id, j.user_id, s.name AS sname, d.name AS dname, r.distance_meters,
               (emblemway_grid_cell(s.latitude, s.longitude, 1000)).cell_key AS src_cell,
               (emblemway_grid_cell(d.latitude, d.longitude, 1000)).cell_key AS dst_cell
          FROM journeys j
          JOIN journey_locations s ON s.journey_id = j.id AND s.kind = 'SOURCE'
          JOIN journey_locations d ON d.journey_id = j.id AND d.kind = 'DESTINATION'
          LEFT JOIN journey_routes r ON r.journey_id = j.id AND r.is_selected
         WHERE j.status IN ('PLANNED', 'ACTIVE', 'COMPLETED') AND j.departure_at >= ${addDays(now, -days)}
      )
      SELECT src_cell, dst_cell, count(*) AS journeys, count(DISTINCT user_id) AS travellers,
             mode() WITHIN GROUP (ORDER BY sname) AS source_name,
             mode() WITHIN GROUP (ORDER BY dname) AS destination_name,
             avg(distance_meters) / 1000.0 AS avg_km
        FROM j GROUP BY src_cell, dst_cell ORDER BY journeys DESC, travellers DESC LIMIT ${limit}`;
    return rows.map((r) => ({
      sourceName: r.source_name,
      destinationName: r.destination_name,
      journeys: Number(r.journeys),
      travellers: Number(r.travellers),
      averageDistanceKm: r.avg_km === null ? null : Math.round(Number(r.avg_km) * 10) / 10,
    }));
  }

  async trafficStats(now = new Date()) {
    const since = addDays(now, -1);
    const [byStatus, errors, delay] = await Promise.all([
      this.prisma.trafficSnapshot.groupBy({
        by: ['status'],
        where: { fetchedAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.trafficSnapshot.groupBy({
        by: ['errorCode'],
        where: { fetchedAt: { gte: since }, status: 'UNAVAILABLE' },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ avg_delay_ratio: number | null; samples: bigint }>>`
        SELECT avg(duration_seconds::float8 / NULLIF(static_duration_seconds, 0) - 1) AS avg_delay_ratio, count(*) AS samples
          FROM traffic_snapshots WHERE status = 'OK' AND fetched_at >= ${since} AND departure_offset_minutes = 0`,
    ]);
    return {
      windowHours: 24,
      requestsByStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      failuresByCode: Object.fromEntries(
        errors.map((e) => [e.errorCode ?? 'UNKNOWN', e._count._all]),
      ),
      averageDelayRatioNow:
        delay[0]?.avg_delay_ratio === null || delay[0] === undefined
          ? null
          : Math.round(Number(delay[0].avg_delay_ratio) * 1000) / 1000,
      samples: Number(delay[0]?.samples ?? 0),
    };
  }

  async listUsers(q: { search?: string; status?: UserStatus; page: number; pageSize: number }) {
    const term = q.search?.trim();
    const digits = term?.replace(/\D/g, '');
    const where: Prisma.UserWhereInput = {
      role: 'USER',
      ...(q.status ? { status: q.status } : { status: { not: 'DELETED' } }),
      ...(term
        ? {
            OR: [
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
              ...(digits && digits.length >= 4 ? [{ phoneE164: { endsWith: digits } }] : []),
            ],
          }
        : {}),
    };
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(q),
        include: { _count: { select: { journeys: true } } },
      }),
    ]);
    return paginate(
      users.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        mobileNumberMasked: u.phoneE164 ? maskPhone(u.phoneE164) : null,
        email: u.email,
        status: u.status,
        journeys: u._count.journeys,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      })),
      total,
      q,
    );
  }

  async setUserStatus(actor: AdminActor, userId: string, status: 'ACTIVE' | 'SUSPENDED') {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw AppError.notFound('User');
    if (user.role !== 'USER' && actor.role !== 'SUPER_ADMIN')
      throw AppError.forbidden('Only a super admin can change administrator accounts');
    if (user.id === actor.userId)
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'You cannot change your own status',
        HttpStatus.FORBIDDEN,
      );
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
    if (status === 'SUSPENDED') await this.tokens.revokeAllForUser(userId, 'suspended_by_admin');
    await this.audit.record({
      action: `admin.user_${status.toLowerCase()}`,
      actorUserId: actor.userId,
      actorRole: actor.role,
      entityType: 'user',
      entityId: userId,
      requestId: actor.requestId,
      ipAddress: actor.ip,
    });
    return { id: userId, status };
  }

  async listJourneys(q: {
    status?: JourneyStatus;
    city?: string;
    vehicleType?: string;
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.JourneyWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.city ? { city: { code: q.city.toUpperCase() } } : {}),
      ...(q.vehicleType ? { vehicleType: { code: q.vehicleType.toUpperCase() } } : {}),
      ...(q.from || q.to
        ? { departureAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.journey.count({ where }),
      this.prisma.journey.findMany({
        where,
        orderBy: { departureAt: 'desc' },
        ...toSkipTake(q),
        include: {
          vehicleType: { select: { code: true, name: true } },
          city: { select: { code: true, name: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
          locations: { select: { kind: true, name: true } },
          routes: {
            where: { isSelected: true },
            select: { distanceMeters: true, durationSeconds: true, provider: true },
          },
          _count: { select: { matches: true } },
        },
      }),
    ]);
    return paginate(
      rows.map((j) => ({
        id: j.id,
        status: j.status,
        departureAt: j.departureAt,
        vehicleType: j.vehicleType,
        city: j.city,
        user: j.user,
        source: j.locations.find((l) => l.kind === 'SOURCE')?.name ?? null,
        destination: j.locations.find((l) => l.kind === 'DESTINATION')?.name ?? null,
        distanceMeters: j.routes[0]?.distanceMeters ?? null,
        durationSeconds: j.routes[0]?.durationSeconds ?? null,
        provider: j.routes[0]?.provider ?? null,
        matches: j._count.matches,
        createdAt: j.createdAt,
      })),
      total,
      q,
    );
  }

  async auditLogs(q: { action?: string; actorUserId?: string; page: number; pageSize: number }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(q),
        include: { actor: { select: { firstName: true, lastName: true, role: true } } },
      }),
    ]);
    return paginate(rows, total, q);
  }
}
