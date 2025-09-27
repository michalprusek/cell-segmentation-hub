import { logger } from '@/lib/logger';
import apiClient from '@/lib/api';

class TokenRefreshManager {
  private refreshTimer: NodeJS.Timeout | null = null;
  private isRefreshing = false;

  /**
   * Schedule token refresh before access token expires
   */
  scheduleTokenRefresh(accessToken: string) {
    this.clearRefreshTimer();

    if (!accessToken) return;

    try {
      // Decode JWT to get expiry time
      const tokenParts = accessToken.split('.');
      if (tokenParts.length !== 3) return;

      let payload;
      try {
        // Handle URL-safe base64 decoding
        const base64 = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
        // Add padding if necessary
        const paddedBase64 = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        payload = JSON.parse(atob(paddedBase64));
      } catch (parseError) {
        logger.warn('Failed to parse JWT token:', parseError);
        return;
      }

      if (!payload.exp || typeof payload.exp !== 'number') {
        logger.warn('JWT token missing or invalid exp claim');
        return;
      }

      const expiryTime = payload.exp * 1000; // Convert to milliseconds
      const currentTime = Date.now();
      const timeToExpiry = expiryTime - currentTime;

      // Refresh token 2 minutes before it expires, but at least 30 seconds from now
      const refreshTime = Math.max(timeToExpiry - 2 * 60 * 1000, 30 * 1000);

      if (refreshTime > 0) {
        logger.debug(
          '🔄 Scheduling token refresh in',
          refreshTime / 1000,
          'seconds'
        );
        this.refreshTimer = setTimeout(() => {
          this.refreshTokenIfNeeded();
        }, refreshTime);
      }
    } catch (error) {
      logger.error('Failed to schedule token refresh:', error);
    }
  }

  /**
   * Manually refresh token if needed
   */
  async refreshTokenIfNeeded(): Promise<boolean> {
    if (this.isRefreshing) {
      logger.debug('Token refresh already in progress');
      return false;
    }

    if (!apiClient.isAuthenticated()) {
      logger.debug('User not authenticated, skipping token refresh');
      return false;
    }

    try {
      this.isRefreshing = true;
      logger.debug('🔄 Refreshing access token...');

      // The API client will handle the refresh automatically through its interceptor
      // We just need to make a request that will trigger the refresh if needed
      await apiClient.getUserProfile();

      // If we get here, the token was successfully refreshed
      const newAccessToken = apiClient.getAccessToken();
      if (newAccessToken) {
        this.scheduleTokenRefresh(newAccessToken);
        logger.debug('✅ Token refreshed successfully');
        return true;
      }
    } catch (error) {
      logger.error('Token refresh failed:', error);
      // Clear tokens on refresh failure
      this.clearRefreshTimer();
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Clear the refresh timer
   */
  clearRefreshTimer() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Start token refresh management
   */
  startTokenRefreshManager() {
    const accessToken = apiClient.getAccessToken();
    if (accessToken) {
      this.scheduleTokenRefresh(accessToken);
    }
  }

  /**
   * Stop token refresh management
   */
  stopTokenRefreshManager() {
    this.clearRefreshTimer();
    this.isRefreshing = false;
  }
}

export const tokenRefreshManager = new TokenRefreshManager();
