import { Request, Response, NextFunction } from 'express';
import { verifyApiKey, ApiKeyVerification } from '../services/apiKeyService';
import { sendProblem } from '../api/v1/problem';
import { logger } from '../utils/logger';
import { isCredentialQueryParam } from '../utils/redactUrl';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `authenticateApiKey`; absent on cookie-authenticated requests. */
    apiKey?: { id: string; name: string; prefix: string };
  }
}

const REALM = 'spheroseg-api';

/**
 * Authenticate a `/api/v1` request by API key.
 *
 * Transport is `Authorization: Bearer <key>` and nothing else (RFC 6750
 * §2.1). Two alternatives are refused on purpose:
 *
 *  - A key in the QUERY STRING is rejected with 400 rather than ignored.
 *    URLs are what gets logged — by this app (which redacts these
 *    parameters, see `utils/redactUrl`) and by the nginx in front of it
 *    (which does not). A client that "worked" this way would leak its key on
 *    every call; failing loudly is the only way it finds out.
 *  - The session COOKIE is not consulted. The app's cookie auth relies on
 *    SameSite alone — there is no CSRF token — which is acceptable for the
 *    app's own JSON routes and not for an API meant to be scripted.
 *
 * Challenges follow RFC 6750 §3: no credentials gets a bare `Bearer` challenge
 * with no error code, a rejected key gets `error="invalid_token"`.
 *
 * Unknown, expired and malformed keys are deliberately indistinguishable in
 * the response; the log says which.
 */
export const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (Object.keys(req.query).some(isCredentialQueryParam)) {
      sendProblem(res, 'credentials-in-url', {
        detail:
          'Send the API key in the Authorization header: "Authorization: Bearer <key>". ' +
          'A key that has appeared in a URL should be treated as leaked and revoked.',
      });
      return;
    }

    // The key is verified UNCONDITIONALLY, and only the answer is branched on.
    // Written the other way round - "no header? return; no match? skip
    // verification" - whether the check runs at all is decided by a value
    // the caller controls, which is what CodeQL's user-controlled-bypass
    // flags and, more to the point, the shape in which a future edit can
    // open a path around the check. An absent or non-Bearer header becomes
    // the empty string, which fails the checksum without a database read.
    const header = req.headers.authorization;
    const presented = /^Bearer +(\S+)$/i.exec(header ?? '')?.[1] ?? '';
    const verification: ApiKeyVerification = await verifyApiKey(presented);

    if (verification.ok === false && !header) {
      sendProblem(res, 'authentication-required', {
        detail:
          'This endpoint needs an API key: "Authorization: Bearer <key>". ' +
          'Create one under Settings → API.',
        headers: { 'WWW-Authenticate': `Bearer realm="${REALM}"` },
      });
      return;
    }

    // `=== false`, not `!`: this tsconfig has strictNullChecks off, and
    // without it a truthiness test does not narrow a discriminated union.
    if (verification.ok === false) {
      logger.warn(
        `API key rejected (${verification.reason}) for ${req.method} ${req.path}`,
        'ApiKeyAuth',
        { ip: req.ip }
      );
      sendProblem(res, 'invalid-api-key', {
        detail: 'The API key is not valid. It may have been revoked or expired.',
        headers: {
          'WWW-Authenticate': `Bearer realm="${REALM}", error="invalid_token"`,
        },
      });
      return;
    }

    // `isAdmin: false` whatever the account is: a key reaches `/api/v1` only,
    // and nothing there is an admin action. `profile` is not loaded — no v1
    // handler reads it.
    req.user = { ...verification.user, isAdmin: false, profile: null };
    req.apiKey = verification.apiKey;
    return next();
  } catch (error) {
    logger.error('API key authentication failed', error as Error, 'ApiKeyAuth');
    sendProblem(res, 'internal-error');
  }
};
