import { getRedisClient, executeRedisCommand } from '../config/redis';
import { logger } from '../utils/logger';
import crypto from 'crypto';

interface SessionData {
  userId: number;
  email: string;
  createdAt: Date;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

interface RefreshToken {
  userId: number;
  token: string;
  expiresAt: Date;
  family?: string; // For refresh token rotation
}

class SessionService {
  private readonly SESSION_PREFIX = 'session:';
  private readonly REFRESH_TOKEN_PREFIX = 'refresh:';
  private readonly USER_SESSIONS_PREFIX = 'user_sessions:';
  private readonly SESSION_TTL = 60 * 60 * 24; // 24 hours in seconds
  private readonly REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days in seconds
  
  /**
   * Create a new session
   */
  async createSession(userId: number, email: string, metadata?: Record<string, unknown>): Promise<string | null> {
    try {
      const sessionId = this.generateSessionId();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.SESSION_TTL * 1000);
      
      const sessionData: SessionData = {
        userId,
        email,
        createdAt: now,
        expiresAt,
        metadata,
      };
      
      const key = `${this.SESSION_PREFIX}${sessionId}`;
      
      const result = await executeRedisCommand(async (client) => {
        // Store session
        await client.setEx(key, this.SESSION_TTL, JSON.stringify(sessionData));
        
        // Add to user's session list
        const userSessionKey = `${this.USER_SESSIONS_PREFIX}${userId}`;
        await client.sAdd(userSessionKey, sessionId);
        await client.expire(userSessionKey, this.SESSION_TTL);
        
        return true;
      });
      
      if (result) {
        logger.info(`Session created for user ${userId}`);
        return sessionId;
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to create session:', error);
      return null;
    }
  }
  
  /**
   * Get session data
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const key = `${this.SESSION_PREFIX}${sessionId}`;
      
      const data = await executeRedisCommand(async (client) => {
        return await client.get(key);
      });
      
      if (!data) {
        return null;
      }
      
      const sessionData = JSON.parse(data) as SessionData;
      
      // Check if session is expired
      if (new Date(sessionData.expiresAt) < new Date()) {
        await this.deleteSession(sessionId);
        return null;
      }
      
      return sessionData;
    } catch (error) {
      logger.error('Failed to get session:', error);
      return null;
    }
  }
  
  /**
   * Update session expiry (sliding expiration)
   */
  async touchSession(sessionId: string): Promise<boolean> {
    try {
      const key = `${this.SESSION_PREFIX}${sessionId}`;
      
      const result = await executeRedisCommand(async (client) => {
        return await client.expire(key, this.SESSION_TTL);
      });
      
      return result === true;
    } catch (error) {
      logger.error('Failed to touch session:', error);
      return false;
    }
  }
  
  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return true; // Already deleted
      }
      
      const key = `${this.SESSION_PREFIX}${sessionId}`;
      
      const result = await executeRedisCommand(async (client) => {
        // Remove from session store
        await client.del(key);
        
        // Remove from user's session list
        const userSessionKey = `${this.USER_SESSIONS_PREFIX}${session.userId}`;
        await client.sRem(userSessionKey, sessionId);
        
        return true;
      });
      
      if (result) {
        logger.info(`Session deleted: ${sessionId}`);
      }
      
      return result || false;
    } catch (error) {
      logger.error('Failed to delete session:', error);
      return false;
    }
  }
  
  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: number): Promise<string[]> {
    try {
      const userSessionKey = `${this.USER_SESSIONS_PREFIX}${userId}`;
      
      const sessions = await executeRedisCommand(async (client) => {
        return await client.sMembers(userSessionKey);
      });
      
      return sessions || [];
    } catch (error) {
      logger.error('Failed to get user sessions:', error);
      return [];
    }
  }
  
  /**
   * Delete all sessions for a user
   */
  async deleteUserSessions(userId: number): Promise<boolean> {
    try {
      const sessions = await this.getUserSessions(userId);
      
      for (const sessionId of sessions) {
        await this.deleteSession(sessionId);
      }
      
      logger.info(`All sessions deleted for user ${userId}`);
      return true;
    } catch (error) {
      logger.error('Failed to delete user sessions:', error);
      return false;
    }
  }
  
  /**
   * Store refresh token
   */
  async storeRefreshToken(userId: number, token: string, family?: string): Promise<boolean> {
    try {
      const key = `${this.REFRESH_TOKEN_PREFIX}${token}`;
      const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);
      
      const tokenData: RefreshToken = {
        userId,
        token,
        expiresAt,
        family: family || crypto.randomBytes(16).toString('hex'),
      };
      
      const result = await executeRedisCommand(async (client) => {
        await client.setEx(key, this.REFRESH_TOKEN_TTL, JSON.stringify(tokenData));
        return true;
      });
      
      if (result) {
        logger.info(`Refresh token stored for user ${userId}`);
      }
      
      return result || false;
    } catch (error) {
      logger.error('Failed to store refresh token:', error);
      return false;
    }
  }
  
  /**
   * Verify refresh token
   */
  async verifyRefreshToken(token: string): Promise<RefreshToken | null> {
    try {
      const key = `${this.REFRESH_TOKEN_PREFIX}${token}`;
      
      const data = await executeRedisCommand(async (client) => {
        return await client.get(key);
      });
      
      if (!data) {
        return null;
      }
      
      const tokenData = JSON.parse(data) as RefreshToken;
      
      // Check if token is expired
      if (new Date(tokenData.expiresAt) < new Date()) {
        await this.deleteRefreshToken(token);
        return null;
      }
      
      return tokenData;
    } catch (error) {
      logger.error('Failed to verify refresh token:', error);
      return null;
    }
  }
  
  /**
   * Delete refresh token
   */
  async deleteRefreshToken(token: string): Promise<boolean> {
    try {
      const key = `${this.REFRESH_TOKEN_PREFIX}${token}`;
      
      const result = await executeRedisCommand(async (client) => {
        const deleted = await client.del(key);
        return deleted > 0;
      });
      
      if (result) {
        logger.info('Refresh token deleted');
      }
      
      return result || false;
    } catch (error) {
      logger.error('Failed to delete refresh token:', error);
      return false;
    }
  }
  
  /**
   * Rotate refresh token (for security)
   */
  async rotateRefreshToken(oldToken: string): Promise<string | null> {
    try {
      const tokenData = await this.verifyRefreshToken(oldToken);
      if (!tokenData) {
        return null;
      }
      
      // Delete old token
      await this.deleteRefreshToken(oldToken);
      
      // Create new token with same family
      const newToken = crypto.randomBytes(32).toString('hex');
      const success = await this.storeRefreshToken(
        tokenData.userId, 
        newToken, 
        tokenData.family
      );
      
      return success ? newToken : null;
    } catch (error) {
      logger.error('Failed to rotate refresh token:', error);
      return null;
    }
  }
  
  /**
   * Clean expired sessions and tokens
   */
  async cleanupExpired(): Promise<void> {
    try {
      const client = getRedisClient();
      if (!client) {
        return;
      }
      
      // This would typically be done with a Redis script or scheduled job
      logger.info('Cleanup of expired sessions initiated');
      
      // Get all session keys
      const sessionKeys = await client.keys(`${this.SESSION_PREFIX}*`);
      const tokenKeys = await client.keys(`${this.REFRESH_TOKEN_PREFIX}*`);
      
      let cleanedSessions = 0;
      let cleanedTokens = 0;
      
      // Check and clean sessions
      for (const key of sessionKeys) {
        const data = await client.get(key);
        if (data) {
          try {
            const session = JSON.parse(data) as SessionData;
            if (new Date(session.expiresAt) < new Date()) {
              await client.del(key);
              cleanedSessions++;
            }
          } catch {
            // Invalid data, delete it
            await client.del(key);
            cleanedSessions++;
          }
        }
      }
      
      // Check and clean tokens
      for (const key of tokenKeys) {
        const data = await client.get(key);
        if (data) {
          try {
            const token = JSON.parse(data) as RefreshToken;
            if (new Date(token.expiresAt) < new Date()) {
              await client.del(key);
              cleanedTokens++;
            }
          } catch {
            // Invalid data, delete it
            await client.del(key);
            cleanedTokens++;
          }
        }
      }
      
      logger.info(`Cleanup completed: ${cleanedSessions} sessions, ${cleanedTokens} tokens removed`);
    } catch (error) {
      logger.error('Failed to cleanup expired sessions:', error);
    }
  }
  
  /**
   * Get session statistics
   */
  async getStats(): Promise<{
    totalSessions: number;
    totalRefreshTokens: number;
    totalUsers: number;
  }> {
    try {
      const client = getRedisClient();
      if (!client) {
        return { totalSessions: 0, totalRefreshTokens: 0, totalUsers: 0 };
      }
      
      const sessionKeys = await client.keys(`${this.SESSION_PREFIX}*`);
      const tokenKeys = await client.keys(`${this.REFRESH_TOKEN_PREFIX}*`);
      const userKeys = await client.keys(`${this.USER_SESSIONS_PREFIX}*`);
      
      return {
        totalSessions: sessionKeys.length,
        totalRefreshTokens: tokenKeys.length,
        totalUsers: userKeys.length,
      };
    } catch (error) {
      logger.error('Failed to get session stats:', error);
      return { totalSessions: 0, totalRefreshTokens: 0, totalUsers: 0 };
    }
  }
  
  /**
   * Generate a secure session ID
   */
  private generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}

// Export singleton instance
export const sessionService = new SessionService();