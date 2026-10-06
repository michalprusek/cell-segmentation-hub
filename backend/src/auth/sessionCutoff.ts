/**
 * "Sign out everywhere", for a session store that cannot be enumerated.
 *
 * Refresh records live in Redis under a SHA-256 of the token, so there is no
 * way to list one user's sessions and delete them. Instead the user row
 * carries `sessionsValidAfter`, and anything issued before it is refused:
 *
 *  - an ACCESS token by its `iatMs` (see `tokenIssuedAtMs`), in `authenticate` (which loads that row on
 *    every request already, so the check costs no query);
 *  - a REFRESH record by its `createdAt`, in `authService.refreshToken`.
 *
 * Checking both matters. Revoking only refresh records would leave every
 * stolen access token good for the rest of its 15 minutes.
 *
 * An IMPERSONATED session is exempt, at both call sites: it is the admin's
 * credential, not the user's, and a user changing their password must not
 * throw support out of the account mid-diagnosis. It has its own, stricter
 * kill switches (the admin flag is re-read on every request and refresh).
 */

/**
 * @param issuedAtMs when the token or record was issued. `undefined` - a
 *   refresh record written before this field existed - counts as "before
 *   any cut-off": it is refused once the user has one, and unaffected until
 *   then.
 */
export function isIssuedBeforeCutoff(
  issuedAtMs: number | undefined,
  sessionsValidAfter: Date | null | undefined
): boolean {
  if (!sessionsValidAfter) {
    return false;
  }
  if (issuedAtMs === undefined || !Number.isFinite(issuedAtMs)) {
    return true;
  }
  return issuedAtMs < sessionsValidAfter.getTime();
}

/**
 * When an access token was issued, in milliseconds.
 *
 * `iatMs` is this app's own claim, set beside the standard `iat` when the
 * token is signed. `iat` alone is whole seconds, which is too coarse here: a
 * password change and the replacement session it issues happen within the
 * same second, so on `iat` the two cannot be told apart. A token from before
 * `iatMs` existed falls back to `iat` - the START of its second, i.e. never
 * later than it really was, so it can only be revoked too eagerly, not kept
 * too long.
 */
export function tokenIssuedAtMs(payload: {
  iat?: number;
  iatMs?: number;
}): number | undefined {
  if (typeof payload.iatMs === 'number') {
    return payload.iatMs;
  }
  return typeof payload.iat === 'number' ? payload.iat * 1000 : undefined;
}

/**
 * The cut-off to store when revoking NOW: this instant, to the millisecond.
 * Everything issued before it is void; the replacement session is signed
 * afterwards and carries a later (or equal) `iatMs`.
 */
export function cutoffForNow(now: number = Date.now()): Date {
  return new Date(now);
}
