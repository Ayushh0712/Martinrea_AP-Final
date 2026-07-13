import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Server-side auth gate (Next 16 `proxy` convention, formerly `middleware`).
 * Reads the `mtr_token` cookie (set client-side at login) and:
 *   - redirects unauthenticated users away from protected routes to /login
 *   - redirects already-authenticated users away from /login to /dashboard
 *
 * Role-based access is still enforced client-side in the (app) layout, since
 * that depends on the fetched user record rather than the token itself.
 */
const AUTH_COOKIE = 'mtr_token';
const PUBLIC_PATHS = ['/login'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (token && isPublic) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  if (!token && !isPublic) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except API routes, Next internals, and files with an
  // extension (static assets like the logo/favicon live in /public).
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
