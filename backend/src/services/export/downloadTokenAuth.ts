import {
  DownloadTokenPayload,
  InvalidDownloadTokenError,
  verifyDownloadToken,
} from './downloadTokenService';

/**
 * How a download request proved who it is.
 *
 * `session` — no `?token=` on the URL, so the session cookie is the only
 * credential the request can present and the standard `authenticate`
 * middleware has to run.
 * `token` — a `?token=` that VERIFIED. `payload.userId` is the subject the
 * server signed, not anything the caller asserted.
 * `invalid` — a `?token=` was present and did not verify (bad signature,
 * expired, malformed). Deliberately distinct from `session`: the caller HAD a
 * link, which is an event the export audit log wants a row for.
 */
export type DownloadTokenAuth =
  | { mode: 'session' }
  | { mode: 'token'; payload: DownloadTokenPayload }
  | { mode: 'invalid'; reason: string };

/**
 * The ONE place that decides what a `?token=` on a download URL means.
 *
 * Both download routes (`/projects/:projectId/export/:jobId/download` and
 * `/essays/jobs/:jobId/download`) let the URL carry its own credential,
 * because a native `<a href>` download cannot attach the session's auth. That
 * makes "is there a token here?" a security decision — it is what decides
 * whether `authenticate` runs — and until this function existed the predicate
 * was hand-copied into FOUR places: `optionalJwtAuth` in each of the two route
 * files, and again in each of the two controllers.
 *
 * They had already drifted once. The controllers tested `typeof token ===
 * 'string'` while the routers tested that AND `length > 0`, so `?token=`
 * (empty — a stale link, or a template that interpolated `undefined`) ran the
 * session middleware and was then audited as a token pull, mis-attributing the
 * one field the log exists to record. The next drift is worse than a smudged
 * audit row: a router predicate that is broader than its controller's skips
 * `authenticate` on a request the controller then treats as a session pull.
 * The same reasoning is why `CHANNEL_NAME_RE` is a shared constant — see the
 * Institut Curie incident in `services/video/types.ts`.
 *
 * `raw` is `unknown` on purpose: `req.query.token` is `string | string[] |
 * ParsedQs | undefined`, and `?token=a&token=b` arrives as an array. Anything
 * that is not a non-empty string is `session`, i.e. it falls through to the
 * cookie, which fails closed.
 *
 * Verification is NOT conditional on anything the caller controls beyond
 * "there is a string here to verify": the branch that decides who the caller
 * is reads `verifyDownloadToken`'s result, never the raw parameter.
 */
export function resolveDownloadToken(raw: unknown): DownloadTokenAuth {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { mode: 'session' };
  }
  try {
    return { mode: 'token', payload: verifyDownloadToken(raw) };
  } catch (err) {
    if (err instanceof InvalidDownloadTokenError) {
      return { mode: 'invalid', reason: err.message };
    }
    // Not a token problem — a bug or a misconfigured secret. Let the caller's
    // error handler turn it into a 500 rather than silently reading as "this
    // token is bad", which would answer 401 to an outage.
    throw err;
  }
}
