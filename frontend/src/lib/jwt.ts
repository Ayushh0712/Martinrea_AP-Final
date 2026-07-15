/**
 * Minimal, defensive JWT payload reader.
 *
 * Used only to decide UI/routing behaviour (e.g. "is this token still valid
 * enough to be worth keeping the user in the app?"). Signature verification is
 * always done server-side by the backends -- this helper is purely a client-
 * side hint.
 *
 * Intentionally dependency-free and runtime-agnostic (uses only `atob` +
 * `JSON.parse`) so it works both in the browser and inside the Next
 * edge/proxy runtime that runs `frontend/src/proxy.ts`.
 *
 * Every function fails CLOSED-on-decode / OPEN-on-outcome: any parse error
 * yields `null` / `false` so a malformed or unusual token can never cause a
 * false logout.
 */

/**
 * Base64URL -> UTF-8 string. Returns `null` if the input is not decodable.
 * `atob` only understands standard base64, so we normalise the JWT segment
 * (`-` -> `+`, `_` -> `/`) and re-pad to a multiple of 4.
 */
function decodeBase64Url(segment: string): string | null {
  try {
    const normalised = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
    const binary = atob(padded);
    try {
      return decodeURIComponent(
        Array.from(binary)
          .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
          .join(''),
      );
    } catch {
      return binary;
    }
  } catch {
    return null;
  }
}

/**
 * Returns the JWT's `exp` claim in **milliseconds since epoch**, or `null` if
 * the token can't be parsed or has no numeric `exp`.
 */
export function getJwtExpMs(token: string | null | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const json = decodeBase64Url(parts[1]);
  if (json == null) return null;
  try {
    const payload = JSON.parse(json) as { exp?: unknown };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return null;
    }
    // JWT `exp` is in seconds; convert to ms for parity with Date.now().
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

/**
 * Returns `true` ONLY when the token is confidently past its `exp` at `now`.
 * Any parse failure returns `false` -- an unreadable token is treated as
 * "still present" so it goes through the normal server-side verification
 * path (which will 401 if truly invalid) instead of triggering a false
 * client-side logout.
 */
export function isJwtExpired(
  token: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const expMs = getJwtExpMs(token);
  if (expMs == null) return false;
  return expMs <= now;
}
