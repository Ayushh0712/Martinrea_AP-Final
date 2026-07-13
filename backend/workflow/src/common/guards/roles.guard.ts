import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { Role } from '../enums/role.enum';

/**
 * Enforces @Roles(...) metadata on route handlers.
 *
 * Per PRD WF-01 acceptance criteria:
 *   "API-level authorization: Approval endpoints return 403 Forbidden
 *    if called by an AP_Clerk."
 *
 * If no @Roles() metadata is present the guard is a no-op (route is
 * still protected by JwtAuthGuard, but any authenticated role passes).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Role '${user.role}' is not authorised for this action`,
      );
    }

    return true;
  }
}
