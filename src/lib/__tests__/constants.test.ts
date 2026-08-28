/**
 * Tests for constants.ts helper functions and exports
 * @module constants.test
 */

import { describe, it, expect } from 'vitest';
import {
  TIMEOUTS,
  RETRY_ATTEMPTS,
  FILE_LIMITS,
  STORAGE,
  HTTP_STATUS,
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
      // 3 GB → 3072 s × 1.5 = 4608 s = 4_608_000 ms (exact, no rounding).
      const threeGb = 3 * 1024 * 1024 * 1024;
      expect(videoUploadTimeoutMs(threeGb)).toBe(3072 * 1000 * 1.5);
    });

    it('caps at 4 hours for very large files', () => {
      expect(videoUploadTimeoutMs(50 * 1024 * 1024 * 1024)).toBe(MAX); // 50 GB
    });

    it('falls back to the floor for negative, NaN, and non-finite sizes', () => {
      // A non-finite timeout would reach axios as "no timeout" — guard it.
      expect(videoUploadTimeoutMs(-1)).toBe(MIN);
      expect(videoUploadTimeoutMs(NaN)).toBe(MIN);
      expect(videoUploadTimeoutMs(Infinity)).toBe(MIN);
      // @ts-expect-error — exercise a careless non-number caller at runtime.
      expect(videoUploadTimeoutMs(undefined)).toBe(MIN);
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

    it('should export storage configurations', () => {
      expect(STORAGE).toBeDefined();
      expect(STORAGE.EXPORT_STATE_EXPIRATION).toBe(2 * 60 * 60 * 1000); // 2 hours
      expect(STORAGE.EXPORT_STATE_CLEANUP).toBe(30 * 60 * 1000); // 30 minutes
      expect(STORAGE.THUMBNAIL_CACHE).toBe(24 * 60 * 60 * 1000); // 1 day
      expect(STORAGE.LOCAL_STORAGE_WARNING).toBe(5 * 1024 * 1024); // 5MB
      expect(STORAGE.LOCAL_STORAGE_CRITICAL).toBe(10 * 1024 * 1024); // 10MB
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
  });

  describe('Constants Immutability', () => {
    // NOTE: `as const` in TypeScript provides compile-time immutability only.
    // JavaScript does not enforce runtime immutability for plain object literals
    // without Object.freeze(). These tests verify the TypeScript type system
    // rejects mutations (via @ts-expect-error) while documenting that the
    // objects are NOT frozen at the JavaScript runtime level.
    //
    // Each @ts-expect-error must sit on the assignment itself. It used to sit
    // on the enclosing `expect(() => {` line, where it suppressed nothing —
    // tsc reported the real TS2540 on the assignment AND a TS2578 for the
    // unused directive, so the "TypeScript rejects this" half of each test was
    // asserting nothing.

    it('should report timeout constants as not frozen (as const = compile-time only)', () => {
      // TypeScript catches this at compile time (@ts-expect-error proves it).
      // At runtime the object is mutable because Object.freeze is not used.
      expect(Object.isFrozen(TIMEOUTS)).toBe(false);
      // The compile-time type prevents accidental writes in production code.
      expect(() => {
        // @ts-expect-error - compile-time immutability check
        TIMEOUTS.RETRY_INITIAL = 2000;
      }).not.toThrow();
    });

    it('should report file limits as not frozen (as const = compile-time only)', () => {
      expect(Object.isFrozen(FILE_LIMITS)).toBe(false);
      expect(() => {
        // @ts-expect-error - compile-time immutability check
        FILE_LIMITS.MAX_FILE_SIZE_MB = 50;
      }).not.toThrow();
    });

    it('should report supported formats array as not frozen (as const = compile-time only)', () => {
      expect(Object.isFrozen(FILE_LIMITS.SUPPORTED_FORMATS)).toBe(false);
      expect(() => {
        // @ts-expect-error - compile-time immutability check
        FILE_LIMITS.SUPPORTED_FORMATS.push('gif');
      }).not.toThrow();
    });
  });
});
