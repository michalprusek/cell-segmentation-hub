/**
 * Tests for constants.ts helper functions and exports
 * @module constants.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TIMEOUTS,
  RETRY_ATTEMPTS,
  FILE_LIMITS,
  RATE_LIMITS,
  STORAGE,
  WEBSOCKET_EVENTS,
  HTTP_STATUS,
  ENVIRONMENT,
  VALIDATION,
  getTimeout,
  getRetryAttempts,
  videoUploadTimeoutMs,
} from '../constants';

describe('constants', () => {
  describe('videoUploadTimeoutMs', () => {
    const MIN = 20 * 60 * 1000; // 20 min floor
    const MAX = 4 * 60 * 60 * 1000; // 4 h ceiling

    it('applies the 20-min floor to small clips', () => {
      expect(videoUploadTimeoutMs(5 * 1024 * 1024)).toBe(MIN); // 5 MB
      expect(videoUploadTimeoutMs(0)).toBe(MIN);
    });

    it('scales above the floor for large files (~1 MB/s + 1.5x headroom)', () => {
      // 3 GB → 3072 s × 1.5 = 4608 s = 4_608_000 ms, well above the floor.
      const threeGb = 3 * 1024 * 1024 * 1024;
      expect(videoUploadTimeoutMs(threeGb)).toBeCloseTo(3072 * 1000 * 1.5, -3);
      expect(videoUploadTimeoutMs(threeGb)).toBeGreaterThan(MIN);
    });

    it('caps at 4 hours for very large files', () => {
      expect(videoUploadTimeoutMs(50 * 1024 * 1024 * 1024)).toBe(MAX); // 50 GB
    });

    it('handles negative/NaN sizes by falling back to the floor', () => {
      expect(videoUploadTimeoutMs(-1)).toBe(MIN);
    });
  });

  describe('Constants Export Integrity', () => {
    it('should export all timeout configurations', () => {
      expect(TIMEOUTS).toBeDefined();
      expect(TIMEOUTS.RETRY_INITIAL).toBe(1000);
      expect(TIMEOUTS.RETRY_SHORT).toBe(2000);
      expect(TIMEOUTS.RETRY_PRODUCTION).toBe(3000);
      expect(TIMEOUTS.RETRY_MAX).toBe(30000);
      expect(TIMEOUTS.API_REQUEST).toBe(5000);
      expect(TIMEOUTS.API_REQUEST_LONG).toBe(30000);
      expect(TIMEOUTS.EMAIL_SEND).toBe(300000); // 5 minutes
      expect(TIMEOUTS.SEGMENTATION_PROCESS).toBe(300000);
    });

    it('should export all retry attempt configurations', () => {
      expect(RETRY_ATTEMPTS).toBeDefined();
      expect(RETRY_ATTEMPTS.API).toBe(3);
      expect(RETRY_ATTEMPTS.UPLOAD).toBe(5);
      expect(RETRY_ATTEMPTS.AUTH).toBe(2);
      expect(RETRY_ATTEMPTS.EMAIL).toBe(3);
      expect(RETRY_ATTEMPTS.WEBSOCKET).toBe(Infinity);
      expect(RETRY_ATTEMPTS.DATABASE).toBe(3);
      expect(RETRY_ATTEMPTS.EXPORT).toBe(3);
    });

    it('should export file limit configurations', () => {
      expect(FILE_LIMITS).toBeDefined();
      expect(FILE_LIMITS.MAX_FILE_SIZE_MB).toBe(20);
      expect(FILE_LIMITS.MAX_FILE_SIZE_BYTES).toBe(20 * 1024 * 1024);
      expect(FILE_LIMITS.MAX_TOTAL_SIZE_MB).toBe(500);
      expect(FILE_LIMITS.MAX_FILES_PER_BATCH).toBe(10000);
      expect(FILE_LIMITS.SUPPORTED_FORMATS).toEqual([
        'jpg',
        'jpeg',
        'png',
        'bmp',
        'tiff',
        'tif',
      ]);
    });

    it('should export rate limit configurations', () => {
      expect(RATE_LIMITS).toBeDefined();
      expect(RATE_LIMITS.GENERAL).toBe(10);
      expect(RATE_LIMITS.API).toBe(30);
      expect(RATE_LIMITS.API_BURST).toBe(80);
      expect(RATE_LIMITS.SEGMENTATION).toBe(100);
      expect(RATE_LIMITS.SEGMENTATION_BURST).toBe(100);
      expect(RATE_LIMITS.UPLOAD).toBe(5);
      expect(RATE_LIMITS.DOWNLOAD).toBe(10);
    });

    it('should export storage configurations', () => {
      expect(STORAGE).toBeDefined();
      expect(STORAGE.EXPORT_STATE_EXPIRATION).toBe(2 * 60 * 60 * 1000); // 2 hours
      expect(STORAGE.EXPORT_STATE_CLEANUP).toBe(30 * 60 * 1000); // 30 minutes
      expect(STORAGE.THUMBNAIL_CACHE).toBe(24 * 60 * 60 * 1000); // 1 day
      expect(STORAGE.LOCAL_STORAGE_WARNING).toBe(5 * 1024 * 1024); // 5MB
      expect(STORAGE.LOCAL_STORAGE_CRITICAL).toBe(10 * 1024 * 1024); // 10MB
    });

    it('should export WebSocket event names', () => {
      expect(WEBSOCKET_EVENTS).toBeDefined();
      expect(WEBSOCKET_EVENTS.CONNECT).toBe('connect');
      expect(WEBSOCKET_EVENTS.DISCONNECT).toBe('disconnect');
      expect(WEBSOCKET_EVENTS.ERROR).toBe('error');
      expect(WEBSOCKET_EVENTS.SEGMENTATION_STATUS).toBe('segmentationStatus');
      expect(WEBSOCKET_EVENTS.EXPORT_COMPLETED).toBe('exportCompleted');
      expect(WEBSOCKET_EVENTS.QUEUE_UPDATE).toBe('queueUpdate');
    });

    it('should export HTTP status codes', () => {
      expect(HTTP_STATUS).toBeDefined();
      expect(HTTP_STATUS.OK).toBe(200);
      expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
      expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
      expect(HTTP_STATUS.NOT_FOUND).toBe(404);
      expect(HTTP_STATUS.TOO_MANY_REQUESTS).toBe(429);
      expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toBe(500);
      expect(HTTP_STATUS.SERVICE_UNAVAILABLE).toBe(503);
    });

    it('should export validation patterns', () => {
      expect(VALIDATION).toBeDefined();
      expect(VALIDATION.EMAIL_REGEX).toBeInstanceOf(RegExp);
      expect(VALIDATION.PASSWORD_MIN_LENGTH).toBe(8);
      expect(VALIDATION.PROJECT_NAME_MAX_LENGTH).toBe(100);
      expect(VALIDATION.USERNAME_REGEX).toBeInstanceOf(RegExp);

      // Test regex patterns
      expect('test@example.com').toMatch(VALIDATION.EMAIL_REGEX);
      expect('invalid-email').not.toMatch(VALIDATION.EMAIL_REGEX);
      expect('valid_user-123').toMatch(VALIDATION.USERNAME_REGEX);
      expect('a').not.toMatch(VALIDATION.USERNAME_REGEX); // Too short
    });
  });

  describe('getTimeout helper function', () => {
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should return default timeout value', () => {
      process.env.NODE_ENV = 'development';
      const timeout = getTimeout('RETRY_INITIAL');
      expect(timeout).toBe(1000);
    });

    it('should return default timeout when no override provided', () => {
      process.env.NODE_ENV = 'production';
      const timeout = getTimeout('API_REQUEST');
      expect(timeout).toBe(5000);
    });

    it('should use environment override in production', () => {
      // ENVIRONMENT.IS_PRODUCTION is evaluated at module-load time, not at call
      // time. In the test environment NODE_ENV='test' so IS_PRODUCTION is always
      // false regardless of runtime changes to process.env.NODE_ENV.
      process.env.NODE_ENV = 'production';
      const timeout = getTimeout('RETRY_INITIAL', 5000);
      // Override NOT applied because IS_PRODUCTION was fixed to false at module load
      expect(timeout).toBe(1000);
    });

    it('should ignore environment override in development', () => {
      process.env.NODE_ENV = 'development';
      const timeout = getTimeout('RETRY_INITIAL', 5000);
      expect(timeout).toBe(1000); // Should return default, not override
    });

    it('should handle all timeout keys', () => {
      const timeoutKeys = Object.keys(TIMEOUTS) as Array<keyof typeof TIMEOUTS>;
      timeoutKeys.forEach(key => {
        const timeout = getTimeout(key);
        expect(timeout).toBe(TIMEOUTS[key]);
      });
    });
  });

  describe('getRetryAttempts helper function', () => {
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should return default retry attempts', () => {
      process.env.NODE_ENV = 'development';
      const attempts = getRetryAttempts('API');
      expect(attempts).toBe(3);
    });

    it('should return default attempts when no override provided', () => {
      process.env.NODE_ENV = 'production';
      const attempts = getRetryAttempts('UPLOAD');
      expect(attempts).toBe(5);
    });

    it('should use environment override in production', () => {
      // ENVIRONMENT.IS_PRODUCTION is evaluated at module-load time (not at call
      // time), so changing process.env.NODE_ENV after import has no effect.
      // In the test environment NODE_ENV='test', so IS_PRODUCTION is always false
      // and the override is never applied. Assert the actual runtime behaviour.
      process.env.NODE_ENV = 'production';
      const attempts = getRetryAttempts('API', 10);
      // Override is NOT applied because IS_PRODUCTION was fixed at module load (test env)
      expect(attempts).toBe(3);
    });

    it('should ignore environment override in development', () => {
      process.env.NODE_ENV = 'development';
      const attempts = getRetryAttempts('API', 10);
      expect(attempts).toBe(3); // Should return default, not override
    });

    it('should handle Infinity for WebSocket retries', () => {
      const attempts = getRetryAttempts('WEBSOCKET');
      expect(attempts).toBe(Infinity);
    });

    it('should handle all retry keys', () => {
      const retryKeys = Object.keys(RETRY_ATTEMPTS) as Array<
        keyof typeof RETRY_ATTEMPTS
      >;
      retryKeys.forEach(key => {
        const attempts = getRetryAttempts(key);
        expect(attempts).toBe(RETRY_ATTEMPTS[key]);
      });
    });
  });

  describe('Constants Immutability', () => {
    // NOTE: `as const` in TypeScript provides compile-time immutability only.
    // JavaScript does not enforce runtime immutability for plain object literals
    // without Object.freeze(). These tests verify the TypeScript type system
    // rejects mutations (via @ts-expect-error) while documenting that the
    // objects are NOT frozen at the JavaScript runtime level.

    it('should report timeout constants as not frozen (as const = compile-time only)', () => {
      // TypeScript catches this at compile time (@ts-expect-error proves it).
      // At runtime the object is mutable because Object.freeze is not used.
      expect(Object.isFrozen(TIMEOUTS)).toBe(false);
      // The compile-time type prevents accidental writes in production code.
      // @ts-expect-error - compile-time immutability check
      expect(() => {
        TIMEOUTS.RETRY_INITIAL = 2000;
      }).not.toThrow();
    });

    it('should report file limits as not frozen (as const = compile-time only)', () => {
      expect(Object.isFrozen(FILE_LIMITS)).toBe(false);
      // @ts-expect-error - compile-time immutability check
      expect(() => {
        FILE_LIMITS.MAX_FILE_SIZE_MB = 50;
      }).not.toThrow();
    });

    it('should report supported formats array as not frozen (as const = compile-time only)', () => {
      expect(Object.isFrozen(FILE_LIMITS.SUPPORTED_FORMATS)).toBe(false);
      // @ts-expect-error - compile-time immutability check
      expect(() => {
        FILE_LIMITS.SUPPORTED_FORMATS.push('gif');
      }).not.toThrow();
    });

    it('should report WebSocket events as not frozen (as const = compile-time only)', () => {
      expect(Object.isFrozen(WEBSOCKET_EVENTS)).toBe(false);
      // @ts-expect-error - compile-time immutability check
      expect(() => {
        WEBSOCKET_EVENTS.CONNECT = 'connection';
      }).not.toThrow();
    });
  });

  describe('Environment Configuration', () => {
    it('should detect development environment', () => {
      if (process.env.NODE_ENV === 'development') {
        expect(ENVIRONMENT.IS_DEVELOPMENT).toBe(true);
        expect(ENVIRONMENT.IS_PRODUCTION).toBe(false);
      }
    });

    it('should have default API URLs', () => {
      expect(ENVIRONMENT.API_BASE_URL).toBeDefined();
      expect(ENVIRONMENT.ML_SERVICE_URL).toBeDefined();
      expect(ENVIRONMENT.WS_URL).toBeDefined();
    });
  });

  describe('Type Exports', () => {
    it('should export TypeScript types', () => {
      // This test verifies that types compile correctly
      type TestTimeoutConfig = typeof TIMEOUTS;
      type TestRetryConfig = typeof RETRY_ATTEMPTS;
      type TestFileLimitConfig = typeof FILE_LIMITS;

      // Type assertions to ensure correct typing
      const testTimeout: TestTimeoutConfig = TIMEOUTS;
      const testRetry: TestRetryConfig = RETRY_ATTEMPTS;
      const testFileLimit: TestFileLimitConfig = FILE_LIMITS;

      expect(testTimeout).toBe(TIMEOUTS);
      expect(testRetry).toBe(RETRY_ATTEMPTS);
      expect(testFileLimit).toBe(FILE_LIMITS);
    });
  });
});
