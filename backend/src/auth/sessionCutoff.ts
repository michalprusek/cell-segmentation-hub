/**
 * "Sign out everywhere", for a session store that cannot be enumerated.
 *
 * Refresh records live in Redis under a SHA-256 of the token, so there is no
 * way to list one user's sessions and delete them. Instead the user row
 * carries `sessionsValidAfter`, and anything issued before it is refused:
 *
 *  - an ACCESS token by its `iat`, in `authenticate` (which loads that row on
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
 * The cut-off to store when revoking NOW.
 *
 * Floored to the second because a JWT's `iat` is whole seconds: with a
 * millisecond cut-off, the replacement session minted a moment later in the
 * same second would carry an `iat` that reads as EARLIER than the cut-off
 * and be refused - the user would change their password and be signed out
 * by it. The price is that a token issued earlier in that same second
 * survives. Closing that would need a millisecond-precision claim in every
 * access token, for a window that requires the thief's token to have been
 * minted in the very second of the password change.
 */
export function cutoffForNow(now: number = Date.now()): Date {
  return new Date(Math.floor(now / 1000) * 1000);
}
