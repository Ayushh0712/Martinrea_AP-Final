/**
 * Tiny typed wrapper around window.localStorage with JSON serialisation.
 * Safe to call in non-browser contexts (returns null / no-op).
 */

import { getJwtExpMs } from './jwt';

function safeGet(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readJSON<T>(key: string, fallback: T): T {
  const ls = safeGet();
  if (!ls) return fallback;
  const raw = ls.getItem(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON<T>(key: string, value: T): void {
  const ls = safeGet();
  if (!ls) return;
  try {
    ls.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded — ignore */
  }
}

export function remove(key: string): void {
  const ls = safeGet();
  if (!ls) return;
  ls.removeItem(key);
}

export const STORAGE_KEYS = {
  authToken: 'martinrea.auth.token',
  authUser: 'martinrea.auth.user',
  invoiceRegistry: 'martinrea.invoices.knownIds',
  recentSearches: 'martinrea.search.recent',
  notificationsRead: 'martinrea.notifications.read',
} as const;

/**
 * Auth token cookie. Stored as a cookie (not just localStorage) so Next.js
 * middleware can read it server-side and gate protected routes before render.
 * Non-httpOnly because the axios client reads it to attach the Bearer header;
 * this is the same exposure profile as the previous localStorage approach.
 */
export const AUTH_COOKIE = 'mtr_token';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function setCookie(name: string, value: string, maxAge = COOKIE_MAX_AGE): void {
  if (typeof document === 'undefined') return;
  const secure =
    typeof location !== 'undefined' && location.protocol === 'https:'
      ? '; Secure'
      : '';
  document.cookie = `${name}=${encodeURIComponent(
    value,
  )}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

/**
 * Store the auth JWT in the cookie with a lifetime that TRACKS THE TOKEN.
 *
 * Previously the cookie lived 7 days regardless of the token inside it, so a
 * Keycloak access token (30 min) would die long before the cookie did -- the
 * app kept treating the user as "logged in" while carrying a dead token, and
 * the next protected call failed with `"exp" claim timestamp check failed`.
 *
 * Now the cookie's Max-Age is derived from the JWT's `exp` claim, so when the
 * token expires the cookie disappears too and the route guard cleanly bounces
 * the user to /login. Falls back to COOKIE_MAX_AGE when the token has no
 * readable `exp` (unusual, but keeps us from accidentally locking a user out).
 */
export function setAuthCookie(token: string): void {
  const expMs = getJwtExpMs(token);
  const secondsUntilExp =
    expMs != null ? Math.floor((expMs - Date.now()) / 1000) : null;
  const maxAge =
    secondsUntilExp != null && secondsUntilExp > 0
      ? secondsUntilExp
      : COOKIE_MAX_AGE;
  setCookie(AUTH_COOKIE, token, maxAge);
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const escaped = name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&');
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${escaped}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}
