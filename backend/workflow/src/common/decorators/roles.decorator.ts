import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/**
 * Attach one or more required roles to a route handler. The RolesGuard
 * reads this metadata and enforces it against the authenticated user.
 *
 * @example
 *   @Roles(Role.FINANCE_DIRECTOR)
 *   approve(...) { ... }
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
