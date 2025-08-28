import { logger } from '../utils/logger';

export interface TokenPayload {
  userId: string;
  email: string;
}

export interface SessionData {
  rememberMe?: boolean;
  userAgent?: string;
  ipAddress?: string;
}

export interface SessionInfo extends SessionData {
  sessionId: string;
  userId: string;
  email: string;
  createdAt: Date;
  expiresAt: Date;
}

// In-memory session store (replace with Redis in production)
const sessionStore = new Map<string, SessionInfo>();
const refreshTokenToSessionId = new Map<string, string>();

export const sessionService = {
  /**
   * Create a new session for a user
   */
  async createSession(
    refreshToken: string,
    tokenPayload: TokenPayload,
    sessionData: SessionData
  ): Promise<string> {
    try {
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const expirationTime = sessionData.rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 30 days or 1 day
      
      const session: SessionInfo = {
        sessionId,
        userId: tokenPayload.userId,
        email: tokenPayload.email,
        rememberMe: sessionData.rememberMe,
        userAgent: sessionData.userAgent,
        ipAddress: sessionData.ipAddress,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + expirationTime)
      };

      sessionStore.set(sessionId, session);
      refreshTokenToSessionId.set(refreshToken, sessionId);

      logger.info('Session created', 'SessionService', { 
        sessionId, 
        userId: tokenPayload.userId,
        rememberMe: sessionData.rememberMe 
      });

      return sessionId;
    } catch (error) {
      logger.error('Failed to create session', 'SessionService', error as Error);
      throw error;
    }
  },

  /**
   * Refresh a session and generate new tokens
   */
  async refreshSession(refreshToken: string): Promise<{
    sessionId: string;
    accessToken: string;
    refreshToken: string;
  } | null> {
    try {
      const sessionId = refreshTokenToSessionId.get(refreshToken);
      if (!sessionId) {
        logger.warn('Refresh token not found', 'SessionService');
        return null;
      }

      const session = sessionStore.get(sessionId);
      if (!session) {
        logger.warn('Session not found', 'SessionService', { sessionId });
        return null;
      }

      // Check if session is expired
      if (session.expiresAt < new Date()) {
        logger.warn('Session expired', 'SessionService', { sessionId });
        this.invalidateSession(sessionId);
        return null;
      }

      // Generate new tokens (simplified for testing)
      const newAccessToken = `access_token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newRefreshToken = `refresh_token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Update refresh token mapping
      refreshTokenToSessionId.delete(refreshToken);
      refreshTokenToSessionId.set(newRefreshToken, sessionId);

      // Update session expiry
      const expirationTime = session.rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      session.expiresAt = new Date(Date.now() + expirationTime);

      logger.info('Session refreshed', 'SessionService', { sessionId });

      return {
        sessionId,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      };
    } catch (error) {
      logger.error('Failed to refresh session', 'SessionService', error as Error);
      return null;
    }
  },

  /**
   * Invalidate a session by refresh token
   */
  async invalidateSessionByRefreshToken(refreshToken: string): Promise<boolean> {
    try {
      const sessionId = refreshTokenToSessionId.get(refreshToken);
      if (!sessionId) {
        logger.warn('Refresh token not found for invalidation', 'SessionService');
        return false;
      }

      return await this.invalidateSession(sessionId, refreshToken);
    } catch (error) {
      logger.error('Failed to invalidate session by refresh token', 'SessionService', error as Error);
      return false;
    }
  },

  /**
   * Invalidate a session by session ID
   */
  async invalidateSession(sessionId: string, refreshToken?: string): Promise<boolean> {
    try {
      const session = sessionStore.get(sessionId);
      if (!session) {
        logger.warn('Session not found for invalidation', 'SessionService', { sessionId });
        return false;
      }

      // Remove from stores
      sessionStore.delete(sessionId);
      
      if (refreshToken) {
        refreshTokenToSessionId.delete(refreshToken);
      } else {
        // Find and remove refresh token mapping
        for (const [token, sid] of refreshTokenToSessionId.entries()) {
          if (sid === sessionId) {
            refreshTokenToSessionId.delete(token);
            break;
          }
        }
      }

      logger.info('Session invalidated', 'SessionService', { sessionId });
      return true;
    } catch (error) {
      logger.error('Failed to invalidate session', 'SessionService', error as Error);
      return false;
    }
  },

  /**
   * Get session information
   */
  async getSession(sessionId: string): Promise<SessionInfo | null> {
    try {
      const session = sessionStore.get(sessionId);
      if (!session) {
        return null;
      }

      // Check if session is expired
      if (session.expiresAt < new Date()) {
        this.invalidateSession(sessionId);
        return null;
      }

      return session;
    } catch (error) {
      logger.error('Failed to get session', 'SessionService', error as Error);
      return null;
    }
  },

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      let cleanupCount = 0;
      const now = new Date();

      for (const [sessionId, session] of sessionStore.entries()) {
        if (session.expiresAt < now) {
          await this.invalidateSession(sessionId);
          cleanupCount++;
        }
      }

      if (cleanupCount > 0) {
        logger.info(`Cleaned up ${cleanupCount} expired sessions`, 'SessionService');
      }

      return cleanupCount;
    } catch (error) {
      logger.error('Failed to cleanup expired sessions', 'SessionService', error as Error);
      return 0;
    }
  }
};