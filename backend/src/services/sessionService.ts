import { executeRedisCommand } from '../config/redis';
import { logger } from '../utils/logger';
import { ApiError } from '../middleware/error';
import crypto from 'crypto';
import { config } from '../utils/config';

interface RefreshToken {
  userId: string;
  expiresAt: string;
  family: string;
  /**
   * Set only on an IMPERSONATED session: the admin who is really acting.
   *
   * This is the DURABLE copy of the impersonation, and it lives here rather
   * than in the JWT for one specific reason. `authService.refreshToken`
   * rebuilds the access-token payload from the database row, and the frontend
   * refreshes proactively every 13 minutes — so a claim that exists only in
   * the JWT is silently dropped on the first refresh and the admin is thrown
   * back into the target's account with no way out. `family` was already
   * carried across rotation for the same reason; these ride along with it.
   */
  impersonatorId?: string;
  /** Correlates the impersonation's audit rows. See `ImpersonationLog`. */
  impersonationSessionId?: string;
  /**
   * When THIS record was written (ISO). Compared with the user's
   * `sessionsValidAfter` on refresh - see `auth/sessionCutoff.ts`. Absent on
   * records written before 2026-10-07.
   */
  createdAt?: string;
  /**
   * `false` for a login without "remember me": the short TTL, and the short
   * cookie. Carried across rotation like `family`, because the refresh
   * endpoint used to hand every session the 30-day lifetime on its first
   * refresh - 13 minutes after login - which made the checkbox decorative.
   * Absent on older records, which were all issued 30 days and stay so.
   */
  rememberMe?: boolean;
}

/** What is remembered about a token after it has been rotated. No token. */
interface UsedToken {
  family: string;
  userId: string;
  /** ms since the epoch. */
  rotatedAt: number;
  rememberMe: boolean;
  /** `createdAt` of the record that was consumed. */
  createdAt?: string;
  impersonatorId?: string;
  impersonationSessionId?: string;
}

export interface RotationResult {
  token: string;
  userId: string;
  rememberMe: boolean;
  /** When the PRESENTED record was written; undefined on a legacy record. */
  presentedCreatedAt?: string;
  impersonatorId?: string;
  impersonationSessionId?: string;
}

export interface StoreRefreshTokenOptions {
  family?: string;
  impersonation?: {
    impersonatorId: string;
    impersonationSessionId: string;
  };
  /** Defaults to true: registration and impersonation never ask. */
  rememberMe?: boolean;
}

class SessionService {
  private readonly REFRESH_TOKEN_PREFIX = 'refresh:';
  private readonly IMPERSONATION_INDEX_PREFIX = 'impersonation:';
  private readonly REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days in seconds
  /** A login without "remember me". Matches JWT_REFRESH_EXPIRY's default. */
  private readonly REFRESH_TOKEN_TTL_SHORT = 60 * 60 * 24 * 7;
  /**
   * After a rotation, how long the token that was just used keeps yielding
   * its (same) successor.
   *
   * Two requests with one cookie are ordinary - every tab runs its own
   * refresh timer, and a laptop waking from sleep fires them together - and
   * a response can be lost on the way back. Okta's default grace period is
   * 30 s (configurable 0-60); Auth0 calls the same thing the reuse interval.
   */
  private readonly ROTATION_GRACE_MS = 30_000;
  /**
   * How long a used token is REMEMBERED as used. Presenting one after the
   * grace period is the signature of a copied token - one of the two holders
   * is not the user - and ends the whole session. After this TTL an old
   * token is merely unknown.
   */
  private readonly USED_TOKEN_TTL = 60 * 60 * 24;
  private readonly USED_TOKEN_PREFIX = 'refresh-used:';
  /** How long a replay waits for the claiming rotation to finish: 10 x 25 ms. */
  private readonly SUCCESSOR_WAIT_ATTEMPTS = 10;
  private readonly SUCCESSOR_WAIT_MS = 25;
  private readonly FAMILY_PREFIX = 'refresh-family:';
  /**
   * Server-side lifetime of an IMPERSONATED session, in seconds.
   *
   * Shorter than the ordinary 30 days on purpose. An impersonated session is
   * a debugging session, not a login: if the admin closes the tab without
   * clicking "return", nothing revokes it, and at the normal TTL a live
   * ticket into someone else's account would sit in Redis for a month. This
   * is the SERVER-side bound — the cookie's own Max-Age was already 7 days,
   * which bounds only the browser's copy and not a leaked one.
   */
  private readonly IMPERSONATION_TOKEN_TTL = 60 * 60 * 24; // 24 hours

  /**
   * Redis key for a refresh token: the prefix plus a SHA-256 of the token,
   * never the token itself.
   *
   * Until 2026-08-31 the raw JWT was the key AND was stored again inside the
   * value, so anyone who could read Redis -- a dump, a backup, the metrics
   * exporter, another tenant on the box -- held working refresh tokens for
   * every logged-in user. 235 were live when this was found.
   *
   * SHA-256 with no salt or iteration count is the right primitive here and
   * not an oversight: the input is 32 bytes of `crypto.randomBytes`, so it
   * has 256 bits of entropy and cannot be brute-forced or rainbow-tabled the
   * way a password can. What a slow KDF would buy is nothing; what it would
   * cost is a hash on the hot path of every request that refreshes.
   *
   * Lookup stays O(1) because the caller always presents the token itself --
   * we hash what we are given and read that key.
   */
  private keyFor(token: string): string {
    return (
      this.REFRESH_TOKEN_PREFIX +
      crypto.createHash('sha256').update(token).digest('hex')
    );
  }

  /**
   * Index from an impersonation session id to the refresh key that session
   * currently uses.
   *
   * It exists so that "stop impersonating" can REVOKE the impersonated
   * refresh token instead of merely replacing the browser's cookie. The stop
   * endpoint lives under `/api/admin`, and the refresh cookie is path-scoped
   * to `/api/auth`, so the server never receives the token it needs to delete
   * — and putting a copy of the token in Redis is precisely what `keyFor`'s
   * docstring says not to do. The index stores the KEY (a SHA-256 of the
   * token), which is not a credential: it cannot be presented to anything.
   *
   * Kept in step with rotation because `rotateRefreshToken` passes the
   * impersonation through to `storeRefreshToken`, which rewrites this entry.
   */
  private impersonationKeyFor(sessionId: string): string {
    return this.IMPERSONATION_INDEX_PREFIX + sessionId;
  }

  async storeRefreshToken(
    userId: string,
    token: string,
    options: StoreRefreshTokenOptions = {}
  ): Promise<void> {
    const { family, impersonation } = options;
    const rememberMe = options.rememberMe ?? true;
    const key = this.keyFor(token);
    // An impersonated session gets the short TTL, and it survives rotation
    // because `rotateRefreshToken` passes the impersonation back in — so a
    // refresh cannot quietly promote a debugging session to a 30-day one.
    const ttl = impersonation
      ? this.IMPERSONATION_TOKEN_TTL
      : rememberMe
        ? this.REFRESH_TOKEN_TTL
        : this.REFRESH_TOKEN_TTL_SHORT;
    const now = Date.now();
    const tokenData: RefreshToken = {
      userId,
      expiresAt: new Date(now + ttl * 1000).toISOString(),
      family: family || crypto.randomBytes(16).toString('hex'),
      createdAt: new Date(now).toISOString(),
      rememberMe,
      ...(impersonation
        ? {
            impersonatorId: impersonation.impersonatorId,
            impersonationSessionId: impersonation.impersonationSessionId,
          }
        : {}),
    };

    const result = await executeRedisCommand(async client => {
      await client.setEx(key, ttl, JSON.stringify(tokenData));
      // Where this session's ONE live token is. A rotation is linear, so a
      // family has a single current record; this is how a detected reuse
      // finds it without holding any token.
      await client.setEx(this.FAMILY_PREFIX + tokenData.family, ttl, key);
      if (impersonation) {
        // Same TTL and same write, so the index cannot outlive or lag behind
        // the token it points at. See `impersonationKeyFor`.
        await client.setEx(
          this.impersonationKeyFor(impersonation.impersonationSessionId),
          ttl,
          key
        );
      }
      return true;
    });

    if (result !== true) {
      // Redis outage or write rejection — the caller MUST surface this
      // rather than hand the client a usable access token that can
      // never be refreshed (pre-fix behaviour presented to users as a
      // mysterious 15-min logout).
      throw ApiError.serviceUnavailable(
        'Nelze uložit refresh token: Redis je dočasně nedostupný'
      );
    }
  }

  async verifyRefreshToken(token: string): Promise<RefreshToken | null> {
    const key = this.keyFor(token);

    const data = await executeRedisCommand(async client => client.get(key));
    if (!data) {
      return null;
    }

    const tokenData = JSON.parse(data) as RefreshToken;

    // Redis TTL handles expiry, but double-check the embedded field
    // in case clocks drift or a manually-inserted token slipped in.
    if (new Date(tokenData.expiresAt) < new Date()) {
      await this.deleteRefreshToken(token);
      return null;
    }

    return tokenData;
  }

  /**
   * Revoke an impersonated session by its id, without ever holding the token.
   *
   * Called when the admin stops impersonating. Without it the impersonated
   * refresh token would stay live in Redis for its full 7-day window after
   * the operator believed they had ended the session — the browser's cookie
   * is replaced, but a leaked copy would still work.
   *
   * Returns true when something was actually revoked. False is not an error:
   * a session that already expired, or a Redis blip, both land here, and
   * neither is a reason to refuse to hand the admin their own account back.
   */
  async revokeImpersonatedSession(sessionId: string): Promise<boolean> {
    const indexKey = this.impersonationKeyFor(sessionId);

    const result = await executeRedisCommand(async client => {
      const refreshKey = await client.get(indexKey);
      let deleted = 0;
      if (refreshKey) {
        deleted = await client.del(refreshKey);
      }
      await client.del(indexKey);
      return deleted > 0;
    });

    return result === true;
  }

  async deleteRefreshToken(token: string): Promise<boolean> {
    const key = this.keyFor(token);

    const result = await executeRedisCommand(async client => {
      const deleted = await client.del(key);
      return deleted > 0;
    });

    return result === true;
  }

  /**
   * The token that follows `oldToken`, derived rather than drawn.
   *
   * Deterministic on purpose: two concurrent rotations of one token must
   * agree on its successor, or the session forks into two live tokens and
   * only one of them is in the browser's cookie jar. Being derivable also
   * means the grace-period path can hand the successor out again without the
   * token itself ever having been stored - Redis holds hashes only.
   * Unpredictable to anyone without the server secret.
   */
  private successorOf(oldToken: string): string {
    return crypto
      .createHmac('sha256', config.JWT_REFRESH_SECRET)
      .update(`rotate:${oldToken}`)
      .digest('hex');
  }

  /**
   * Rotate a refresh token: retire the old one and issue its successor in
   * the same family. Returns the new token with what the caller needs from
   * the record that was PRESENTED - its owner, its lifetime, its
   * impersonation, and when it was written (`presentedCreatedAt`, for the
   * session cut-off).
   *
   * A ROTATION IS IDEMPOTENT, NOT EXCLUSIVE. The successor is derived from
   * the old token (`successorOf`), so any number of requests rotating the
   * same token at the same moment write the same record and return the same
   * string: one session, one live token. Read-then-delete with a RANDOM
   * successor, which this used to be, let two requests both read the record
   * before either deleted it: both rotated, the session forked into two live
   * tokens, and a thief replaying a copied token alongside its owner walked
   * away with a session of their own.
   *
   * (An atomic "claim" was tried here first - `SET NX` on the used-marker -
   * and removed: with a derived successor it changes no outcome, as mutation
   * testing showed, and after a crash between claim and store it would have
   * read the owner's retry as a reuse and signed them out.)
   *
   * Once the old record is gone, presenting the old token again is a REPLAY,
   * and what it gets depends on when:
   *
   *  - within `ROTATION_GRACE_MS`: the same successor. The second tab, or
   *    the retry after a lost response.
   *  - later: nothing, and the session's current token is revoked. A token
   *    used twice, minutes apart, has two holders.
   *
   * Order matters: mark the token used, store the successor, and only then
   * delete the old record. If the store fails the old record was never
   * touched, so a Redis blip does not sign the user out. Null means "not
   * rotated" in every case.
   */
  async rotateRefreshToken(oldToken: string): Promise<RotationResult | null> {
    const oldKey = this.keyFor(oldToken);
    const usedKey = this.USED_TOKEN_PREFIX + oldKey;
    const newToken = this.successorOf(oldToken);

    const raw = await executeRedisCommand(async client => client.get(oldKey));
    if (!raw) {
      return this.replay(usedKey, newToken);
    }

    const tokenData = JSON.parse(raw) as RefreshToken;
    if (new Date(tokenData.expiresAt) < new Date()) {
      await this.deleteRefreshToken(oldToken);
      return null;
    }

    // An impersonated session must survive rotation, or the 13-minute
    // proactive refresh silently strands the admin inside the target's
    // account. Carried through exactly like `family`.
    const impersonation =
      tokenData.impersonatorId && tokenData.impersonationSessionId
        ? {
            impersonatorId: tokenData.impersonatorId,
            impersonationSessionId: tokenData.impersonationSessionId,
          }
        : undefined;
    // A record from before the field existed was issued for 30 days.
    const rememberMe = tokenData.rememberMe ?? true;

    // What is remembered about the used token - by whom and when, never the
    // token itself.
    const used: UsedToken = {
      family: tokenData.family,
      userId: tokenData.userId,
      rotatedAt: Date.now(),
      rememberMe,
      createdAt: tokenData.createdAt,
      ...(impersonation ?? {}),
    };
    await executeRedisCommand(async client =>
      client.setEx(usedKey, this.USED_TOKEN_TTL, JSON.stringify(used))
    );

    try {
      await this.storeRefreshToken(tokenData.userId, newToken, {
        family: tokenData.family,
        impersonation,
        rememberMe,
      });
    } catch (err) {
      logger.error(
        `Refresh token rotation failed mid-write for user ${tokenData.userId}`,
        err as Error,
        'SessionService'
      );
      // The old record is still there - it is deleted only below - so the
      // same token rotates normally once Redis is back.
      return null;
    }

    await executeRedisCommand(async client => client.del(oldKey));

    return {
      token: newToken,
      userId: tokenData.userId,
      rememberMe,
      presentedCreatedAt: tokenData.createdAt,
      ...(impersonation ?? {}),
    };
  }

  /**
   * A token that somebody has already rotated (or is rotating). How long ago
   * decides everything.
   */
  private async replay(
    usedKey: string,
    successor: string
  ): Promise<RotationResult | null> {
    const rawUsed = await executeRedisCommand(async client =>
      client.get(usedKey)
    );
    if (!rawUsed) {
      // Never ours, or used longer ago than we remember.
      return null;
    }
    const used = JSON.parse(rawUsed) as UsedToken;

    const age = Date.now() - used.rotatedAt;
    if (age > this.ROTATION_GRACE_MS) {
      // Reuse. Whoever is presenting this is not necessarily the thief - the
      // thief may have rotated first and the owner be the one arriving late -
      // so the only safe answer ends the session for both.
      logger.warn(
        `Refresh token reused ${Math.round(age / 1000)} s after rotation; revoking session family for user ${used.userId}`,
        'SessionService'
      );
      await this.revokeFamily(used.family);
      return null;
    }

    // Within the grace period: the same successor - once it exists. The
    // rotation that claimed the token may still be writing it, a few
    // milliseconds away, so wait for it briefly rather than answer 401 to
    // a request that arrives in between. A successor that never appears has been
    // rotated onward, revoked or signed out, and is not handed out again.
    for (let attempt = 0; attempt < this.SUCCESSOR_WAIT_ATTEMPTS; attempt++) {
      const live = await this.verifyRefreshToken(successor);
      if (live) {
        return {
          token: successor,
          userId: used.userId,
          rememberMe: used.rememberMe,
          presentedCreatedAt: used.createdAt,
          ...(used.impersonatorId && used.impersonationSessionId
            ? {
                impersonatorId: used.impersonatorId,
                impersonationSessionId: used.impersonationSessionId,
              }
            : {}),
        };
      }
      await new Promise(resolve =>
        setTimeout(resolve, this.SUCCESSOR_WAIT_MS)
      );
    }
    return null;
  }

  /** Delete a session's current token, found through its family pointer. */
  private async revokeFamily(family: string): Promise<void> {
    await executeRedisCommand(async client => {
      const currentKey = await client.get(this.FAMILY_PREFIX + family);
      if (currentKey) {
        await client.del(currentKey);
      }
      await client.del(this.FAMILY_PREFIX + family);
      return true;
    });
  }
}

export const sessionService = new SessionService();
