import { HttpStatus, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { AppError, ErrorCode } from '../common/errors/app-error';
import { verifyPassword } from '../common/utils/crypto.util';
import { normalizePhone } from '../common/utils/phone.util';
import { RequestMeta } from '../common/decorators/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OtpChallenge, OtpService } from './otp/otp.service';
import { TokenPair, TokenService } from './token.service';
import { AdminLoginDto, RefreshTokenDto, RequestOtpDto, VerifyOtpDto } from './dto/auth.dto';

export interface AuthResult {
  tokens: TokenPair;
  user: { id: string; firstName: string; lastName: string; role: User['role'] };
  isNewUser: boolean;
  profileComplete: boolean;
}

// Pre-computed so failed admin logins for unknown emails take as long as real checks.
const DUMMY_HASH = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /** Never reveals whether an account exists for the number (anti-enumeration). */
  async requestOtp(dto: RequestOtpDto, meta: RequestMeta): Promise<OtpChallenge> {
    const phone = normalizePhone(dto.countryCode, dto.mobileNumber);
    if (!phone.ok) {
      throw new AppError(
        ErrorCode.INVALID_PHONE_NUMBER,
        phone.reason === 'UNSUPPORTED_COUNTRY'
          ? 'This country code is not supported yet'
          : 'Enter a valid 10-digit Indian mobile number',
        HttpStatus.BAD_REQUEST,
      );
    }
    const challenge = await this.otp.request(phone.e164, meta.ip);
    await this.audit.record({
      action: 'auth.otp_requested',
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
    return challenge;
  }

  async verifyOtp(dto: VerifyOtpDto, meta: RequestMeta): Promise<AuthResult> {
    const { otpId, phoneE164 } = await this.otp.check(dto.requestId, dto.code);

    const existing = await this.prisma.user.findFirst({
      where: { phoneE164, deletedAt: null },
      include: { profile: { select: { profileCompletedAt: true } } },
    });
    if (existing?.status === 'SUSPENDED') {
      throw new AppError(
        ErrorCode.ACCOUNT_SUSPENDED,
        'This account has been suspended',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!existing && !(dto.firstName?.trim() && dto.lastName?.trim())) {
      // Code stays valid (not consumed) so the client can resubmit with registration details.
      throw new AppError(
        ErrorCode.REGISTRATION_DETAILS_REQUIRED,
        'No account exists for this number. Provide first and last name to register.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    await this.otp.consume(otpId);
    const now = new Date();
    let user: User;
    let isNewUser = false;
    let profileComplete: boolean;
    if (existing) {
      user = await this.prisma.user.update({
        where: { id: existing.id },
        data: { lastLoginAt: now },
      });
      profileComplete = !!existing.profile?.profileCompletedAt;
    } else {
      isNewUser = true;
      profileComplete = false;
      user = await this.prisma.user.create({
        data: {
          firstName: dto.firstName!.trim(),
          lastName: dto.lastName!.trim(),
          phoneE164,
          phoneCountryCode: phoneE164.startsWith('+91') ? '+91' : null,
          email: dto.email?.trim().toLowerCase(),
          lastLoginAt: now,
          profile: { create: {} },
        },
      });
    }
    const tokens = await this.tokens.issueForNewSession(user.id, user.role, {
      deviceId: dto.deviceId,
      deviceName: dto.deviceName,
      platform: dto.platform,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.audit.record({
      action: isNewUser ? 'auth.registered' : 'auth.login',
      actorUserId: user.id,
      actorRole: user.role,
      entityType: 'user',
      entityId: user.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
    return {
      tokens,
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
      isNewUser,
      profileComplete,
    };
  }

  async refresh(dto: RefreshTokenDto, meta: RequestMeta): Promise<TokenPair> {
    return this.tokens.rotate(dto.refreshToken, {
      deviceId: dto.deviceId,
      deviceName: dto.deviceName,
      platform: dto.platform,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  async logout(userId: string, sessionId: string, meta: RequestMeta): Promise<void> {
    await this.tokens.revokeSession(sessionId, 'logout');
    await this.audit.record({
      action: 'auth.logout',
      actorUserId: userId,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
  }

  async logoutAll(userId: string, meta: RequestMeta): Promise<number> {
    const count = await this.tokens.revokeAllForUser(userId, 'logout_all');
    await this.audit.record({
      action: 'auth.logout_all',
      actorUserId: userId,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { sessions: count },
    });
    return count;
  }

  async adminLogin(dto: AdminLoginDto, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email.trim(), mode: 'insensitive' },
        deletedAt: null,
        role: { in: ['ADMIN', 'SUPER_ADMIN'] },
      },
    });
    const ok = await verifyPassword(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      await this.audit.record({
        action: 'auth.admin_login_failed',
        requestId: meta.requestId,
        ipAddress: meta.ip,
      });
      throw AppError.unauthenticated('Invalid email or password', ErrorCode.INVALID_CREDENTIALS);
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError(
        ErrorCode.ACCOUNT_SUSPENDED,
        'Account is not active',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tokens = await this.tokens.issueForNewSession(user.id, user.role, {
      platform: 'web',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.audit.record({
      action: 'auth.admin_login',
      actorUserId: user.id,
      actorRole: user.role,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
    return {
      tokens,
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
      isNewUser: false,
      profileComplete: true,
    };
  }
}
