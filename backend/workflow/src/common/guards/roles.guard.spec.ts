import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

function buildContext(user: unknown): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows the request when no @Roles() metadata is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(
      guard.canActivate(buildContext({ id: '1', role: Role.AP_CLERK })),
    ).toBe(true);
  });

  it('throws 403 when an AP_Clerk hits an approval endpoint (PRD WF-01)', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) =>
        key === ROLES_KEY ? [Role.PLANT_MANAGER, Role.FINANCE_DIRECTOR] : undefined,
      );

    expect(() =>
      guard.canActivate(
        buildContext({ id: 'u1', email: 'clerk@x', role: Role.AP_CLERK }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows Finance_Director on an approval endpoint', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) =>
        key === ROLES_KEY ? [Role.PLANT_MANAGER, Role.FINANCE_DIRECTOR] : undefined,
      );

    expect(
      guard.canActivate(
        buildContext({ id: 'u2', email: 'fd@x', role: Role.FINANCE_DIRECTOR }),
      ),
    ).toBe(true);
  });

  it('throws 403 when no user is present on the request', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) =>
        key === ROLES_KEY ? [Role.FINANCE_DIRECTOR] : undefined,
      );

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
