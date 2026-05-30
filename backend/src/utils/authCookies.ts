import type { CookieOptions, Response } from 'express';
import { config } from './config';

/**
 * Single source of truth for the auth cookies that carry the access and
 * refresh tokens. JavaScript can never read these (`httpOnly`), so an XSS
 * injection cannot exfiltrate the credentials — the reason this module
 * exists (see docs/superpowers/specs/2026-05-30-auth-httponly-cookies-design.md).
 *
 * Cookie design:
 *   access_token  — Path=/          Max-Age=access-token expiry (15m)
 *   refresh_token — Path=/api/auth  Max-Age=refresh expiry (7d, or 30d w/ rememberMe)
 *
 * The refresh cookie is path-scoped to /api/auth so the browser only sends
 * it to the refresh/logout endpoints, not on every API call.
 */

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
/**
 * Non-secret, JS-readable presence flag. The httpOnly tokens are invisible to
 * the SPA, so without this it would have to probe /auth/profile on every cold
 * load just to learn "am I logged in?" — generating a guaranteed 401 (and a
 * console error) for every logged-out visitor. This cookie carries NO
 * credential — only the boolean fact that a session was established — and is
 * set/cleared atomically with the auth cookies so it can't drift out of sync.
 */
export const AUTH_HINT_COOKIE = 'authenticated';

/** The refresh cookie is only ever sent to the auth endpoints. */
const REFRESH_TOKEN_PATH = '/api/auth';

/**
 * Convert a JWT-style duration string (`'15m'`, `'7d'`, `'12h'`, `'3600s'`,
 * or a bare seconds count `'900'`) to milliseconds for the cookie `Max-Age`.
 * The same `JWT_*_EXPIRY` config strings drive the token signer, so the
 * cookie lifetime stays in lock-step with the token it carries — no
 * duplicated magic numbers.
 */
export const durationToMs = (value: string): number => {
  const match = /^(\d+)\s*([smhd]?)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Unsupported duration format for cookie Max-Age: "${value}"`);
  }
  const amount = Number(match[1]);
  const unitMs: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    '': 1000, // bare number → seconds (jsonwebtoken's convention)
  };
  return amount * unitMs[match[2]];
};

/**
 * Base flags shared by both cookies. `Secure` is production-only: the dev
 * server is served over plain http through the Vite proxy, and a `Secure`
 * cookie would be silently dropped there. `SameSite=Strict` blocks the
 * cookie from riding along on cross-site requests, which is our CSRF
 * defence for this same-origin SPA. Computed per call so a runtime
 * NODE_ENV change (e.g. across tests) is always reflected.
 */
const baseCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'strict',
});

/**
 * Set both auth cookies on the response. `rememberMe` only affects the
 * refresh cookie's Max-Age (7d vs 30d), mirroring the refresh-token expiry.
 */
export const setAuthCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string,
  { rememberMe = false }: { rememberMe?: boolean } = {}
): void => {
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...baseCookieOptions(),
    path: '/',
    maxAge: durationToMs(config.JWT_ACCESS_EXPIRY),
  });

  const refreshExpiry = rememberMe
    ? config.JWT_REFRESH_EXPIRY_REMEMBER
    : config.JWT_REFRESH_EXPIRY;
  const refreshMaxAge = durationToMs(refreshExpiry);
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...baseCookieOptions(),
    path: REFRESH_TOKEN_PATH,
    maxAge: refreshMaxAge,
  });

  // JS-readable presence hint (NOT httpOnly), lives as long as the session can
  // be refreshed. Lets the SPA skip the cold-load /auth/profile probe when
  // logged out. Carries no secret.
  res.cookie(AUTH_HINT_COOKIE, '1', {
    httpOnly: false,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: refreshMaxAge,
  });
};

/**
 * Extract the access token from a raw `Cookie` request-header string. The
 * socket.io handshake exposes `handshake.headers.cookie` as the unparsed
 * header (cookie-parser only populates `req.cookies` on the Express side),
 * so the WebSocket auth layer needs this. Keeping it here keeps the cookie
 * name in one place. Returns null when the cookie is absent or empty.
 */
export const getAccessTokenFromCookieHeader = (
  cookieHeader: string | undefined
): string | null => {
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === ACCESS_TOKEN_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    }
  }
  return null;
};

/**
 * Clear both auth cookies. The flags (path included) must match the ones
 * used to set them, or the browser keeps the originals. Always called on
 * logout, even if server-side session revocation fails.
 */
export const clearAuthCookies = (res: Response): void => {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...baseCookieOptions(), path: '/' });
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    ...baseCookieOptions(),
    path: REFRESH_TOKEN_PATH,
  });
  res.clearCookie(AUTH_HINT_COOKIE, {
    ...baseCookieOptions(),
    httpOnly: false,
    path: '/',
  });
};
