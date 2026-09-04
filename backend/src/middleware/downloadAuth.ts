import { Request, Response, NextFunction } from 'express';
import { authenticate } from './auth';
import { resolveDownloadToken } from '../services/export/downloadTokenAuth';

/**
 * Session-or-signed-token auth for the two download routes.
 *
 * A native browser download (`<a href>`) cannot attach the session's
 * credential, so those URLs may carry a short-lived HMAC-signed token instead.
 * This middleware decides which of the two the request is presenting, using
 * `resolveDownloadToken` — the same function the controllers use to read the
 * subject out of that token, so the router and the controller can no longer
 * disagree about what counts as a token. See the drift note there.
 *
 * A token that does NOT verify still reaches the controller rather than being
 * 401'd here. That is deliberate: the export audit log wants a `denied` row
 * for a forwarded link retried after it lapsed, and only the controller knows
 * which resource (`kind`, `projectId`, `jobId`) the refusal was about.
 * Nothing is granted on that path — the controller derives `userId` from a
 * verified payload or from the session, never from the raw parameter.
 *
 * The result is deliberately NOT stashed for the controller to reuse. The
 * second HMAC costs microseconds, and handing the decision over on `res.locals`
 * would mean a controller mounted without this middleware silently reads
 * `undefined` and treats a signed token as no token at all. Resolving twice
 * cannot drift, because it is the same function; the only way the two calls
 * disagree is a token expiring between them, and that direction fails closed.
 */
export const downloadTokenAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (resolveDownloadToken(req.query.token).mode !== 'session') {
    // The URL carries its own credential; the controller verifies it again
    // through the same function and answers 401 if it does not hold up.
    next();
    return;
  }
  // No token: the session cookie is the only credential on offer.
  void authenticate(req, res, next);
};
