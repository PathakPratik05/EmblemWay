import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { AuthedRequest, IS_PUBLIC_KEY, ROLES_KEY } from '../../common/decorators/auth.decorators';

/** Role hierarchy: SUPER_ADMIN ⊃ ADMIN ⊃ USER. */
const RANK: Record<UserRole, number> = { USER: 0, ADMIN: 1, SUPER_ADMIN: 2 };

export function hasRequiredRole(actual: UserRole, required: readonly UserRole[]): boolean {
  if (required.length === 0) return true;
  const min = Math.min(...required.map((r) => RANK[r]));
  return RANK[actual] >= min;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const required =
      this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user || !hasRequiredRole(req.user.role, required)) throw AppError.forbidden();
    return true;
  }
}
