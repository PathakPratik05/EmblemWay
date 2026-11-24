import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AuthedRequest, IS_PUBLIC_KEY } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../token.service';

/**
 * Global guard. Verifies the bearer JWT and then checks the backing session so that
 * logout, account suspension and deletion take effect immediately (not at token expiry).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw AppError.unauthenticated();

    const claims = await this.tokens.verifyAccess(token);
    const session = await this.prisma.userSession.findUnique({
      where: { id: claims.sid },
      select: {
        revokedAt: true,
        expiresAt: true,
        userId: true,
        user: { select: { status: true, role: true, deletedAt: true } },
      },
    });
    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw AppError.unauthenticated('Session is no longer valid');
    }
    if (session.user.deletedAt || session.user.status === 'DELETED') {
      throw AppError.unauthenticated('Account deleted', ErrorCode.ACCOUNT_DELETED);
    }
    if (session.user.status === 'SUSPENDED') {
      throw new AppError(ErrorCode.ACCOUNT_SUSPENDED, 'Account suspended', HttpStatus.FORBIDDEN);
    }
    // Role is read from the database, so demotions apply immediately.
    req.user = { userId: claims.sub, sessionId: claims.sid, role: session.user.role };
    return true;
  }
}
