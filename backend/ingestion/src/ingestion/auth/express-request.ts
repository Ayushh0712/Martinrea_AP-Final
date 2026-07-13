/**
 * Global module augmentation for Express's Request so `req.user` is typed
 * everywhere -- not only in files that happen to import the guard.
 *
 * This file emits no runtime code (only `declare module` blocks), so the
 * side-effect import from keycloak-auth.guard.ts is free.
 */
import type { AuthUser } from './keycloak-auth.guard';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}
