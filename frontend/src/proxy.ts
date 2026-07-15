import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isJwtExpired } from '@/lib/jwt';

/**
 * Server-side auth gate (Next 16 `proxy` convention, formerly `middleware`).
 * Reads the `mtr_token` cookie (set client-side at login) and:
 *   - redirects unauthenticated users away from protected routes to /login
 *   - redirects already-authenticated users away from /login to /dashboard
 *
 * A token whose `exp` is in the past is treated as "not authenticated": the
 * stale cookie is cleared on the response and the user is bounced to /login.
 * This prevents the app from appearing logged in while carrying a token that
 * the backends will reject with `"exp" claim timestamp check failed`.
 *
 * Role-based access is still enforced client-side in the (app) layout, since
 * that depends on the fetched user record rather than the token itself.
 */
const AUTH_COOKIE = 'mtr_token';
const PUBLIC_PATHS = ['/login'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const expired = !!token && isJwtExpired(token);
  const hasValidToken = !!token && !expired;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (hasValidToken && isPublic) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  if (!hasValidToken && !isPublic) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('from', pathname);
    const res = NextResponse.redirect(loginUrl);
    // Clear the stale cookie so subsequent requests don't repeat the same
    // "expired token in cookie" cycle. Non-httpOnly to match how it was set.
    if (expired) {
      res.cookies.set({
        name: AUTH_COOKIE,
        value: '',
        path: '/',
        maxAge: 0,
        sameSite: 'lax',
      });
    }
    return res;
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except API routes, Next internals, and files with an
  // extension (static assets like the logo/favicon live in /public).
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
