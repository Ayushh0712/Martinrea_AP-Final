import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  plantId: string | null;
  managerId: string | null;
}

/**
 * Resolves the authenticated user from the request, as populated by
 * the JwtStrategy.validate() return value.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthenticatedUser;
  },
);
