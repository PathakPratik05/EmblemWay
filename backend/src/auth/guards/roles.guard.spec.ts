import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../../common/decorators/auth.decorators';
import { hasRequiredRole, RolesGuard } from './roles.guard';

function ctx(
  role: UserRole | undefined,
  meta: Record<string, unknown>,
): { context: ExecutionContext; reflector: Reflector } {
  const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { userId: 'u', sessionId: 's', role } : undefined }),
    }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('RBAC', () => {
  it.each([
    ['USER', ['ADMIN'], false],
    ['ADMIN', ['ADMIN'], true],
    ['SUPER_ADMIN', ['ADMIN'], true],
    ['ADMIN', ['SUPER_ADMIN'], false],
    ['USER', [], true],
  ] as const)('%s with required %j -> %s', (role, required, ok) => {
    expect(hasRequiredRole(role, required)).toBe(ok);
  });

  it('blocks ordinary users from admin routes', () => {
    const { context, reflector } = ctx('USER', { [ROLES_KEY]: ['ADMIN'] });
    expect(() => new RolesGuard(reflector).canActivate(context)).toThrow(AppError);
  });

  it('allows admins on admin routes', () => {
    const { context, reflector } = ctx('ADMIN', { [ROLES_KEY]: ['ADMIN'] });
    expect(new RolesGuard(reflector).canActivate(context)).toBe(true);
  });

  it('blocks unauthenticated requests on role-protected routes', () => {
    const { context, reflector } = ctx(undefined, { [ROLES_KEY]: ['ADMIN'] });
    expect(() => new RolesGuard(reflector).canActivate(context)).toThrow(AppError);
  });

  it('public routes and routes without roles pass', () => {
    expect(
      new RolesGuard(ctx(undefined, { [IS_PUBLIC_KEY]: true }).reflector).canActivate(
        ctx(undefined, {}).context,
      ),
    ).toBe(true);
    expect(new RolesGuard(ctx('USER', {}).reflector).canActivate(ctx('USER', {}).context)).toBe(
      true,
    );
  });
});
