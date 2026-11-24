import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { AppConfigService } from '../config/app-config.service';
import { AppError, ErrorCode } from '../common/errors/app-error';
import { maskPhone } from '../common/utils/phone.util';
import { AuditService } from '../audit/audit.service';
import { TokenService } from '../auth/token.service';
import { CitiesService } from '../cities/cities.service';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { UpdatePreferencesDto, UpdateProfileDto } from './users.dto';

const IMAGE_SIGNATURES: Array<{ mime: string; ext: string; magic: number[] }> = [
  { mime: 'image/jpeg', ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/webp', ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly cities: CitiesService,
    private readonly vehicles: VehiclesService,
  ) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: { include: { preferredCity: true, defaultVehicleType: true } } },
    });
    if (!user || user.deletedAt) throw AppError.notFound('User');
    const p = user.profile;
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      // Owners see a masked number; nobody else ever sees it.
      mobileNumberMasked: user.phoneE164 ? maskPhone(user.phoneE164) : null,
      role: user.role,
      profileImageUrl: p?.profileImagePath
        ? `${this.config.get('PUBLIC_BASE_URL')}/uploads/${p.profileImagePath}`
        : null,
      preferredCity: p?.preferredCity
        ? { code: p.preferredCity.code, name: p.preferredCity.name }
        : null,
      defaultVehicleType: p?.defaultVehicleType
        ? { code: p.defaultVehicleType.code, name: p.defaultVehicleType.name }
        : null,
      profileComplete: !!p?.profileCompletedAt,
      privacy: {
        shareJourneysForMatching: p?.shareJourneysForMatching ?? true,
        showFirstNameToMatches: p?.showFirstNameToMatches ?? true,
      },
      notifications: {
        journeyReminders: p?.notifyJourneyReminders ?? true,
        matches: p?.notifyMatches ?? true,
        statusUpdates: p?.notifyStatusUpdates ?? true,
        trafficAlerts: p?.notifyTrafficAlerts ?? true,
      },
      locationConsentAt: p?.locationConsentAt ?? null,
      createdAt: user.createdAt,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const cityId = dto.preferredCityCode
      ? (await this.cities.findByCode(dto.preferredCityCode))?.id
      : undefined;
    if (dto.preferredCityCode && !cityId)
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Unknown city', HttpStatus.BAD_REQUEST);
    const vehicleTypeId = dto.defaultVehicleTypeCode
      ? (await this.vehicles.getActiveByCode(dto.defaultVehicleTypeCode)).id
      : undefined;
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          firstName: dto.firstName?.trim(),
          lastName: dto.lastName?.trim(),
          email: dto.email === undefined ? undefined : dto.email.trim().toLowerCase() || null,
          profile: {
            upsert: {
              create: {
                preferredCityId: cityId,
                defaultVehicleTypeId: vehicleTypeId,
                profileCompletedAt: dto.completeProfile ? new Date() : undefined,
              },
              update: {
                preferredCityId: cityId,
                defaultVehicleTypeId: vehicleTypeId,
                ...(dto.completeProfile ? { profileCompletedAt: new Date() } : {}),
              },
            },
          },
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002')
        throw AppError.conflict('This email address is already in use');
      throw err;
    }
    return this.getMe(userId);
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    await this.prisma.userProfile.update({
      where: { userId },
      data: {
        shareJourneysForMatching: dto.shareJourneysForMatching,
        showFirstNameToMatches: dto.showFirstNameToMatches,
        notifyJourneyReminders: dto.notifyJourneyReminders,
        notifyMatches: dto.notifyMatches,
        notifyStatusUpdates: dto.notifyStatusUpdates,
        notifyTrafficAlerts: dto.notifyTrafficAlerts,
        ...(dto.locationConsent === undefined
          ? {}
          : { locationConsentAt: dto.locationConsent ? new Date() : null }),
      },
    });
    if (dto.shareJourneysForMatching === false) {
      // Opting out removes this user from everyone's stored match results immediately.
      await this.prisma.journeyMatch.deleteMany({
        where: { OR: [{ matchedUserId: userId }, { journey: { userId } }] },
      });
    }
    await this.audit.record({
      action: 'user.preferences_updated',
      actorUserId: userId,
      entityType: 'user',
      entityId: userId,
      metadata: { ...dto },
    });
    return this.getMe(userId);
  }

  async uploadAvatar(
    userId: string,
    file: { buffer: Buffer; size: number; mimetype: string } | undefined,
  ) {
    if (!file)
      throw new AppError(ErrorCode.UPLOAD_INVALID, 'No image uploaded', HttpStatus.BAD_REQUEST);
    if (file.size > this.config.get('MAX_UPLOAD_BYTES'))
      throw new AppError(
        ErrorCode.UPLOAD_INVALID,
        'Image is too large',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    // Trust file content, not the client-declared MIME type.
    const sig = IMAGE_SIGNATURES.find((s) => s.magic.every((b, i) => file.buffer[i] === b));
    if (!sig)
      throw new AppError(
        ErrorCode.UPLOAD_INVALID,
        'Only JPEG, PNG or WebP images are allowed',
        HttpStatus.BAD_REQUEST,
      );
    const dir = resolve(this.config.get('UPLOAD_DIR'), 'avatars');
    await mkdir(dir, { recursive: true });
    const name = `avatars/${randomUUID()}.${sig.ext}`;
    await writeFile(join(resolve(this.config.get('UPLOAD_DIR')), name), file.buffer, {
      mode: 0o640,
    });
    const previous = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { profileImagePath: true },
    });
    await this.prisma.userProfile.update({ where: { userId }, data: { profileImagePath: name } });
    if (previous?.profileImagePath) await this.removeFile(previous.profileImagePath);
    return this.getMe(userId);
  }

  async removeAvatar(userId: string) {
    const p = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { profileImagePath: true },
    });
    if (p?.profileImagePath) {
      await this.prisma.userProfile.update({ where: { userId }, data: { profileImagePath: null } });
      await this.removeFile(p.profileImagePath);
    }
    return this.getMe(userId);
  }

  private async removeFile(relative: string): Promise<void> {
    if (!/^avatars\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(relative)) return;
    await unlink(join(resolve(this.config.get('UPLOAD_DIR')), relative)).catch(() => undefined);
  }

  /** Personal data export (DPDP Act - right to access). */
  async exportData(userId: string) {
    const [me, journeys, savedPlaces, savedRoutes, vehicles, notifications, sessions] =
      await Promise.all([
        this.getMe(userId),
        this.prisma.journey.findMany({
          where: { userId },
          include: { locations: true, vehicleType: { select: { code: true } } },
          orderBy: { departureAt: 'desc' },
        }),
        this.prisma.savedPlace.findMany({ where: { userId } }),
        this.prisma.savedRoute.findMany({ where: { userId } }),
        this.prisma.userVehicle.findMany({ where: { userId, deletedAt: null } }),
        this.prisma.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 500,
        }),
        this.prisma.userSession.findMany({
          where: { userId },
          select: {
            createdAt: true,
            platform: true,
            deviceName: true,
            revokedAt: true,
            expiresAt: true,
          },
        }),
      ]);
    await this.audit.record({
      action: 'user.data_exported',
      actorUserId: userId,
      entityType: 'user',
      entityId: userId,
    });
    return {
      exportedAt: new Date().toISOString(),
      profile: me,
      journeys: journeys.map((j) => ({
        id: j.id,
        status: j.status,
        purpose: j.purpose,
        vehicleType: j.vehicleType.code,
        departureAt: j.departureAt,
        locations: j.locations.map((l) => ({
          kind: l.kind,
          name: l.name,
          address: l.address,
          latitude: l.latitude,
          longitude: l.longitude,
        })),
        createdAt: j.createdAt,
      })),
      savedPlaces: savedPlaces.map((p) => ({
        label: p.label,
        name: p.name,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
      })),
      savedRoutes,
      vehicles,
      notifications,
      sessions,
    };
  }

  /**
   * Account deletion (DPDP Act - right to erasure). Personal data and all location history
   * are deleted; the user row is kept only as an anonymised tombstone so foreign keys in
   * audit logs stay valid. Sessions are revoked immediately.
   */
  async deleteAccount(userId: string, meta: { requestId?: string; ip?: string }): Promise<void> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { profileImagePath: true },
    });
    const offers = await this.prisma.ridePoolOffer.findMany({
      where: { ownerUserId: userId, status: { in: ['OPEN', 'FULL'] } },
      select: { id: true },
    });
    await this.prisma.withTransaction(async (tx) => {
      if (offers.length) {
        await tx.ridePoolRequest.updateMany({
          where: {
            offerId: { in: offers.map((o) => o.id) },
            status: { in: ['PENDING', 'ACCEPTED'] },
          },
          data: { status: 'CANCELLED' },
        });
      }
      await tx.journey.deleteMany({ where: { userId } }); // cascades locations, routes, matches, segments, offers
      await tx.journeyMatch.deleteMany({ where: { matchedUserId: userId } });
      await tx.ridePoolRequest.deleteMany({ where: { requesterUserId: userId } });
      await tx.savedPlace.deleteMany({ where: { userId } });
      await tx.savedRoute.deleteMany({ where: { userId } });
      await tx.userVehicle.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.deviceToken.deleteMany({ where: { userId } });
      await tx.userProfile.deleteMany({ where: { userId } });
      await tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'account_deleted' },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
          firstName: 'Deleted',
          lastName: 'User',
          phoneE164: null,
          phoneCountryCode: null,
          email: null,
          passwordHash: null,
        },
      });
      await this.audit.record(
        {
          action: 'user.account_deleted',
          actorUserId: userId,
          entityType: 'user',
          entityId: userId,
          requestId: meta.requestId,
          ipAddress: meta.ip,
        },
        tx,
      );
    });
    if (profile?.profileImagePath) await this.removeFile(profile.profileImagePath);
    this.logger.log(`Account ${userId} deleted`);
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, rotatedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, deviceName: true, platform: true, lastUsedAt: true, createdAt: true },
    });
    return sessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const s = await this.prisma.userSession.findFirst({ where: { id: sessionId, userId } });
    if (!s) throw AppError.notFound('Session');
    await this.tokens.revokeFamily(s.familyId, 'user_revoked');
  }
}
