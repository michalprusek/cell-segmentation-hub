import { logger } from '@/lib/logger';
import apiClient from '@/lib/api';

// Proactively refresh the access cookie on a fixed cadence, comfortably
// shorter than the backend's access-token lifetime (JWT_ACCESS_EXPIRY = 15m).
// The tokens are httpOnly cookies now, so the client can't read their expiry
// to schedule precisely — a fixed interval below the lifetime is both simpler
// and sufficient. This keeps the session (and the WebSocket handshake's auth
// cookie) alive during long idle periods, rather than waiting for the next
// request's 401 to trigger a reactive refresh.
const REFRESH_INTERVAL_MS = 13 * 60 * 1000; // 13 min (< 15 min access expiry)

class TokenRefreshManager {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private isRefreshing = false;

  /**
   * Refresh the access cookie via the refresh_token cookie. No-ops if a
   * refresh is already in flight. On failure (refresh cookie gone/expired)
   * the timer is stopped; the next API call's 401 interceptor routes the
   * user to sign-in.
   */
  async refreshTokenIfNeeded(): Promise<boolean> {
    if (this.isRefreshing) {
      logger.debug('Token refresh already in progress');
      return false;
    }

    try {
      this.isRefreshing = true;
      logger.debug('Proactive token refresh...');
      await apiClient.refreshAccessToken();
      return true;
    } catch (error) {
      logger.error('Proactive token refresh failed:', error);
      this.stopTokenRefreshManager();
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Start the proactive refresh interval. Called by AuthContext once a
   * session is established (login, register, or a valid init probe).
   */
  startTokenRefreshManager() {
    this.stopTokenRefreshManager();
    this.refreshTimer = setInterval(() => {
      void this.refreshTokenIfNeeded();
    }, REFRESH_INTERVAL_MS);
  }

  /**
   * Stop the proactive refresh interval. Called on logout/account deletion
   * or when a refresh fails.
   */
  stopTokenRefreshManager() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.isRefreshing = false;
  }
}

export const tokenRefreshManager = new TokenRefreshManager();
