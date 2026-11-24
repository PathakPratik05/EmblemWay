import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Marks an endpoint as not requiring a bearer token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts an endpoint to the given roles (checked by RolesGuard). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  userId: string;
  sessionId: string;
  role: UserRole;
}

export type AuthedRequest = Request & { user?: AuthUser; id?: string };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw new Error('CurrentUser used on an unauthenticated route');
    return req.user;
  },
);

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export const ReqMeta = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestMeta => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return { ip: req.ip, userAgent: req.header('user-agent')?.slice(0, 255), requestId: req.id };
  },
);
