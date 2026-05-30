import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tokenRefreshManager } from '@/lib/tokenRefresh';

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  default: {
    refreshAccessToken: vi.fn().mockResolvedValue(undefined),
  },
}));

// 13 minutes in ms — matches REFRESH_INTERVAL_MS in tokenRefresh.ts
const REFRESH_INTERVAL_MS = 13 * 60 * 1000;

describe('TokenRefreshManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tokenRefreshManager.stopTokenRefreshManager();
  });

  afterEach(() => {
    tokenRefreshManager.stopTokenRefreshManager();
    vi.useRealTimers();
  });

  describe('stopTokenRefreshManager', () => {
    it('clears the interval without error when no timer is set', () => {
      expect(() => tokenRefreshManager.stopTokenRefreshManager()).not.toThrow();
    });

    it('clears an active interval so refreshAccessToken does not fire after stop', async () => {
      const { default: apiClient } = await import('@/lib/api');
      vi.mocked(apiClient.refreshAccessToken).mockResolvedValue(undefined);

      tokenRefreshManager.startTokenRefreshManager();
      tokenRefreshManager.stopTokenRefreshManager();

      // Advance past the interval — should NOT trigger since timer was cleared
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS + 1000);

      expect(vi.mocked(apiClient.refreshAccessToken)).not.toHaveBeenCalled();
    });

    it('calling stop multiple times does not throw', () => {
      tokenRefreshManager.startTokenRefreshManager();
      expect(() => {
        tokenRefreshManager.stopTokenRefreshManager();
        tokenRefreshManager.stopTokenRefreshManager();
      }).not.toThrow();
    });
  });

  describe('startTokenRefreshManager', () => {
    it('sets an interval that triggers refreshAccessToken after ~13 minutes', async () => {
      const { default: apiClient } = await import('@/lib/api');
      vi.mocked(apiClient.refreshAccessToken).mockResolvedValue(undefined);

      tokenRefreshManager.startTokenRefreshManager();

      // Not yet triggered before interval
      expect(vi.mocked(apiClient.refreshAccessToken)).not.toHaveBeenCalled();

      // Advance exactly one interval
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);

      expect(vi.mocked(apiClient.refreshAccessToken)).toHaveBeenCalledTimes(1);
    });

    it('fires again after two intervals', async () => {
      const { default: apiClient } = await import('@/lib/api');
      vi.mocked(apiClient.refreshAccessToken).mockResolvedValue(undefined);

      tokenRefreshManager.startTokenRefreshManager();
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2);

      expect(vi.mocked(apiClient.refreshAccessToken)).toHaveBeenCalledTimes(2);
    });

    it('replacing an existing timer does not cause double-firing', async () => {
      const { default: apiClient } = await import('@/lib/api');
      vi.mocked(apiClient.refreshAccessToken).mockResolvedValue(undefined);

      tokenRefreshManager.startTokenRefreshManager();
      // Start again — should clear the first timer
      tokenRefreshManager.startTokenRefreshManager();

      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);

      // Exactly one call despite two starts (second start cleared first timer)
      expect(vi.mocked(apiClient.refreshAccessToken)).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshTokenIfNeeded', () => {
    it('calls refreshAccessToken and returns true on success', async () => {
      const { default: apiClient } = await import('@/lib/api');
      vi.mocked(apiClient.refreshAccessToken).mockResolvedValue(undefined);

      const result = await tokenRefreshManager.refreshTokenIfNeeded();

      expect(result).toBe(true);
      expect(vi.mocked(apiClient.refreshAccessToken)).toHaveBeenCalledTimes(1);
    });

    it('returns false and stops the timer when refreshAccessToken throws', async () => {
      const { default: apiClient } = await import('@/lib/api');
      vi.mocked(apiClient.refreshAccessToken).mockRejectedValue(
        new Error('Network error')
      );

      tokenRefreshManager.startTokenRefreshManager();
      const result = await tokenRefreshManager.refreshTokenIfNeeded();

      expect(result).toBe(false);

      // Timer should have been stopped — further interval ticks should not re-fire
      vi.mocked(apiClient.refreshAccessToken).mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2);
      // The only call was the one inside refreshTokenIfNeeded above (which rejected)
      expect(vi.mocked(apiClient.refreshAccessToken)).toHaveBeenCalledTimes(1);
    });

    it('does not refresh concurrently (deduplicates in-flight refresh)', async () => {
      const { default: apiClient } = await import('@/lib/api');

      let resolveRefresh!: () => void;
      vi.mocked(apiClient.refreshAccessToken).mockReturnValue(
        new Promise<void>(res => {
          resolveRefresh = () => res();
        })
      );

      const p1 = tokenRefreshManager.refreshTokenIfNeeded();
      const p2 = tokenRefreshManager.refreshTokenIfNeeded();

      resolveRefresh();
      const [r1, r2] = await Promise.all([p1, p2]);

      // First call succeeds, second is deduplicated via isRefreshing guard
      expect(r1).toBe(true);
      expect(r2).toBe(false);
      expect(vi.mocked(apiClient.refreshAccessToken)).toHaveBeenCalledTimes(1);
    });

    it('allows a second refresh after the first completes', async () => {
      const { default: apiClient } = await import('@/lib/api');
      vi.mocked(apiClient.refreshAccessToken).mockResolvedValue(undefined);

      const r1 = await tokenRefreshManager.refreshTokenIfNeeded();
      const r2 = await tokenRefreshManager.refreshTokenIfNeeded();

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(vi.mocked(apiClient.refreshAccessToken)).toHaveBeenCalledTimes(2);
    });
  });

  describe('start / stop integration', () => {
    it('stop after start prevents interval from firing', async () => {
      const { default: apiClient } = await import('@/lib/api');
      vi.mocked(apiClient.refreshAccessToken).mockResolvedValue(undefined);

      tokenRefreshManager.startTokenRefreshManager();
      tokenRefreshManager.stopTokenRefreshManager();

      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3);

      expect(vi.mocked(apiClient.refreshAccessToken)).not.toHaveBeenCalled();
    });

    it('start after stop resumes the interval', async () => {
      const { default: apiClient } = await import('@/lib/api');
      vi.mocked(apiClient.refreshAccessToken).mockResolvedValue(undefined);

      tokenRefreshManager.startTokenRefreshManager();
      tokenRefreshManager.stopTokenRefreshManager();
      tokenRefreshManager.startTokenRefreshManager();

      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);

      expect(vi.mocked(apiClient.refreshAccessToken)).toHaveBeenCalledTimes(1);
    });
  });
});
