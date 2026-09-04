import { executeRedisCommand } from '../config/redis';
import { logger } from '../utils/logger';
import { ApiError } from '../middleware/error';
import crypto from 'crypto';

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
}

class SessionService {
  private readonly REFRESH_TOKEN_PREFIX = 'refresh:';
  private readonly IMPERSONATION_INDEX_PREFIX = 'impersonation:';
  private readonly REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days in seconds

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
    family?: string,
    impersonation?: {
      impersonatorId: string;
      impersonationSessionId: string;
    }
  ): Promise<void> {
    const key = this.keyFor(token);
    const tokenData: RefreshToken = {
      userId,
      expiresAt: new Date(
        Date.now() + this.REFRESH_TOKEN_TTL * 1000
      ).toISOString(),
      family: family || crypto.randomBytes(16).toString('hex'),
      ...(impersonation
        ? {
            impersonatorId: impersonation.impersonatorId,
            impersonationSessionId: impersonation.impersonationSessionId,
          }
        : {}),
    };

    const result = await executeRedisCommand(async client => {
      await client.setEx(
        key,
        this.REFRESH_TOKEN_TTL,
        JSON.stringify(tokenData)
      );
      if (impersonation) {
        // Same TTL and same write, so the index cannot outlive or lag behind
        // the token it points at. See `impersonationKeyFor`.
        await client.setEx(
          this.impersonationKeyFor(impersonation.impersonationSessionId),
          this.REFRESH_TOKEN_TTL,
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
   * Rotate a refresh token: verifies the old one, deletes it, and issues a
   * fresh one within the same family. Returns the new token together with
   * the verified userId so callers don't have to look it up twice.
   *
   * If Redis fails mid-rotation (old token already deleted, new store
   * throws) we best-effort re-insert the old token so the user's
   * session is preserved across the outage. Both branches return null
   * to signal "not rotated".
   */
  async rotateRefreshToken(oldToken: string): Promise<{
    token: string;
    userId: string;
    impersonatorId?: string;
    impersonationSessionId?: string;
  } | null> {
    const tokenData = await this.verifyRefreshToken(oldToken);
    if (!tokenData) {
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

    await this.deleteRefreshToken(oldToken);

    const newToken = crypto.randomBytes(32).toString('hex');
    try {
      await this.storeRefreshToken(
        tokenData.userId,
        newToken,
        tokenData.family,
        impersonation
      );
    } catch (err) {
      logger.error(
        `Refresh token rotation failed mid-write for user ${tokenData.userId}; attempting rollback`,
        err as Error,
        'SessionService'
      );
      // Best-effort: try to restore the original token so the user
      // isn't logged out by a transient Redis blip. If this also fails,
      // we surface null and the caller will reject as 401 — better than
      // silent partial state.
      try {
        await this.storeRefreshToken(
          tokenData.userId,
          oldToken,
          tokenData.family,
          impersonation
        );
      } catch {
        // Both writes failed; nothing more we can do here.
      }
      return null;
    }

    return {
      token: newToken,
      userId: tokenData.userId,
      ...(impersonation ?? {}),
    };
  }
}

export const sessionService = new SessionService();
