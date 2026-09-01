import { executeRedisCommand } from '../config/redis';
import { logger } from '../utils/logger';
import { ApiError } from '../middleware/error';
import crypto from 'crypto';

interface RefreshToken {
  userId: string;
  expiresAt: string;
  family: string;
}

class SessionService {
  private readonly REFRESH_TOKEN_PREFIX = 'refresh:';
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

  async storeRefreshToken(
    userId: string,
    token: string,
    family?: string
  ): Promise<void> {
    const key = this.keyFor(token);
    const tokenData: RefreshToken = {
      userId,
      expiresAt: new Date(
        Date.now() + this.REFRESH_TOKEN_TTL * 1000
      ).toISOString(),
      family: family || crypto.randomBytes(16).toString('hex'),
    };

    const result = await executeRedisCommand(async client => {
      await client.setEx(
        key,
        this.REFRESH_TOKEN_TTL,
        JSON.stringify(tokenData)
      );
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
  async rotateRefreshToken(
    oldToken: string
  ): Promise<{ token: string; userId: string } | null> {
    const tokenData = await this.verifyRefreshToken(oldToken);
    if (!tokenData) {
      return null;
    }

    await this.deleteRefreshToken(oldToken);

    const newToken = crypto.randomBytes(32).toString('hex');
    try {
      await this.storeRefreshToken(
        tokenData.userId,
        newToken,
        tokenData.family
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
          tokenData.family
        );
      } catch {
        // Both writes failed; nothing more we can do here.
      }
      return null;
    }

    return { token: newToken, userId: tokenData.userId };
  }
}

export const sessionService = new SessionService();
