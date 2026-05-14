import { executeRedisCommand } from '../config/redis';
import { logger } from '../utils/logger';
import crypto from 'crypto';

interface RefreshToken {
  userId: string;
  token: string;
  expiresAt: string;
  family: string;
}

class SessionService {
  private readonly REFRESH_TOKEN_PREFIX = 'refresh:';
  private readonly REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days in seconds

  async storeRefreshToken(
    userId: string,
    token: string,
    family?: string
  ): Promise<boolean> {
    const key = `${this.REFRESH_TOKEN_PREFIX}${token}`;
    const tokenData: RefreshToken = {
      userId,
      token,
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

    return result === true;
  }

  async verifyRefreshToken(token: string): Promise<RefreshToken | null> {
    const key = `${this.REFRESH_TOKEN_PREFIX}${token}`;

    const data = await executeRedisCommand(async client => client.get(key));
    if (!data) return null;

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
    const key = `${this.REFRESH_TOKEN_PREFIX}${token}`;

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
   */
  async rotateRefreshToken(
    oldToken: string
  ): Promise<{ token: string; userId: string } | null> {
    const tokenData = await this.verifyRefreshToken(oldToken);
    if (!tokenData) return null;

    await this.deleteRefreshToken(oldToken);

    const newToken = crypto.randomBytes(32).toString('hex');
    const success = await this.storeRefreshToken(
      tokenData.userId,
      newToken,
      tokenData.family
    );
    if (!success) {
      logger.error('Failed to persist rotated refresh token', undefined, {
        userId: tokenData.userId,
      });
      return null;
    }

    return { token: newToken, userId: tokenData.userId };
  }
}

export const sessionService = new SessionService();
