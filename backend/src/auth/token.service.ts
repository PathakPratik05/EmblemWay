import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { AppError, ErrorCode } from '../common/errors/app-error';
import { generateOpaqueToken, hmacSha256 } from '../common/utils/crypto.util';
import { addDays } from '../common/utils/time.util';
import { PrismaService } from '../prisma/prisma.service';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  role: UserRole;
  typ: 'access';
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tokenType: 'Bearer';
}

export interface SessionContext {
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  ipAddress?: string;
  userAgent?: string;
}

export const JWT_ISSUER = 'emblemway';
export const JWT_AUDIENCE = 'emblemway-api';

/**
 * Access tokens: short-lived signed JWTs (stateless verification + a session check).
 * Refresh tokens: opaque random strings, stored only as HMAC digests, rotated on every use.
 * Re-use of a rotated refresh token revokes the whole session family (token theft signal).
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  private hashRefresh(token: string): string {
    return hmacSha256(this.config.get('HASH_PEPPER'), `refresh:${token}`);
  }

  private signAccess(
    userId: string,
    sessionId: string,
    role: UserRole,
    now: Date,
  ): { token: string; expiresAt: Date } {
    const ttl = this.config.get('JWT_ACCESS_TTL_SECONDS');
    const claims: AccessTokenClaims = { sub: userId, sid: sessionId, role, typ: 'access' };
    const token = this.jwt.sign(claims, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: ttl,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithm: 'HS256',
    });
    return { token, expiresAt: new Date(now.getTime() + ttl * 1000) };
  }

  async issueForNewSession(
    userId: string,
    role: UserRole,
    ctx: SessionContext,
    now = new Date(),
  ): Promise<TokenPair> {
    const refreshToken = generateOpaqueToken();
    const expiresAt = addDays(now, this.config.get('REFRESH_TOKEN_TTL_DAYS'));
    const session = await this.prisma.userSession.create({
      data: {
        userId,
        familyId: randomUUID(),
        refreshTokenHash: this.hashRefresh(refreshToken),
        expiresAt,
        lastUsedAt: now,
        ...this.ctxData(ctx),
      },
    });
    const access = this.signAccess(userId, session.id, role, now);
    return this.pair(access, refreshToken, expiresAt);
  }

  async rotate(refreshToken: string, ctx: SessionContext, now = new Date()): Promise<TokenPair> {
    const hash = this.hashRefresh(refreshToken);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: { select: { id: true, role: true, status: true, deletedAt: true } } },
    });
    if (!session)
      throw AppError.unauthenticated('Invalid refresh token', ErrorCode.INVALID_REFRESH_TOKEN);

    if (session.rotatedAt) {
      await this.revokeFamily(session.familyId, 'refresh_token_reuse', now);
      this.logger.warn(
        `Refresh token reuse detected for session family ${session.familyId}; family revoked`,
      );
      throw AppError.unauthenticated(
        'Session is no longer valid. Please sign in again.',
        ErrorCode.REFRESH_TOKEN_REUSED,
      );
    }
    if (session.revokedAt || session.expiresAt <= now) {
      throw AppError.unauthenticated(
        'Session expired. Please sign in again.',
        ErrorCode.INVALID_REFRESH_TOKEN,
      );
    }
    if (session.user.deletedAt || session.user.status === 'DELETED') {
      throw AppError.unauthenticated('Account deleted', ErrorCode.ACCOUNT_DELETED);
    }
    if (session.user.status === 'SUSPENDED') {
      throw new AppError(ErrorCode.ACCOUNT_SUSPENDED, 'Account suspended', HttpStatus.FORBIDDEN);
    }

    const newToken = generateOpaqueToken();
    const expiresAt = addDays(now, this.config.get('REFRESH_TOKEN_TTL_DAYS'));
    const next = await this.prisma.$transaction(async (tx) => {
      // Conditional update: only one concurrent refresh can win the rotation.
      const claimed = await tx.userSession.updateMany({
        where: { id: session.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: now, lastUsedAt: now },
      });
      if (claimed.count !== 1) return null;
      const created = await tx.userSession.create({
        data: {
          userId: session.userId,
          familyId: session.familyId,
          refreshTokenHash: this.hashRefresh(newToken),
          expiresAt,
          lastUsedAt: now,
          deviceId: ctx.deviceId ?? session.deviceId,
          deviceName: ctx.deviceName ?? session.deviceName,
          platform: ctx.platform ?? session.platform,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      await tx.userSession.update({
        where: { id: session.id },
        data: { replacedById: created.id },
      });
      return created;
    });
    if (!next) {
      await this.revokeFamily(session.familyId, 'refresh_token_reuse', now);
      throw AppError.unauthenticated(
        'Session is no longer valid. Please sign in again.',
        ErrorCode.REFRESH_TOKEN_REUSED,
      );
    }
    const access = this.signAccess(session.userId, next.id, session.user.role, now);
    return this.pair(access, newToken, expiresAt);
  }

  async verifyAccess(token: string): Promise<AccessTokenClaims> {
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (claims.typ !== 'access' || !claims.sub || !claims.sid) throw new Error('bad claims');
      return claims;
    } catch (err) {
      if ((err as Error).name === 'TokenExpiredError') {
        throw AppError.unauthenticated('Access token expired', ErrorCode.TOKEN_EXPIRED);
      }
      throw AppError.unauthenticated('Invalid access token');
    }
  }

  /** Revokes the family that `sessionId` belongs to (logout from this device). */
  async revokeSession(sessionId: string, reason: string, now = new Date()): Promise<void> {
    const s = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: { familyId: true },
    });
    if (s) await this.revokeFamily(s.familyId, reason, now);
  }

  async revokeFamily(familyId: string, reason: string, now = new Date()): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
  }

  async revokeAllForUser(userId: string, reason: string, now = new Date()): Promise<number> {
    const res = await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    return res.count;
  }

  private ctxData(ctx: SessionContext) {
    return {
      deviceId: ctx.deviceId?.slice(0, 128),
      deviceName: ctx.deviceName?.slice(0, 128),
      platform: ctx.platform?.slice(0, 16),
      ipAddress: ctx.ipAddress?.slice(0, 64),
      userAgent: ctx.userAgent?.slice(0, 255),
    };
  }

  private pair(
    access: { token: string; expiresAt: Date },
    refreshToken: string,
    refreshExpiresAt: Date,
  ): TokenPair {
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      tokenType: 'Bearer',
    };
  }
}
