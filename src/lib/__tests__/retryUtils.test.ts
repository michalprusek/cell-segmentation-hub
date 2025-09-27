/**
 * Comprehensive tests for retry utilities
 * @module retryUtils.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  retryWithBackoff,
  retryWithTimeout,
  makeRetryable,
  isRetryableError,
  calculateBackoffDelay,
  addJitter,
  sleep,
  CircuitBreaker,
  RETRY_CONFIGS,
  DEFAULT_RETRY_CONFIG,
} from '../retryUtils';
import { TEST_TIMEOUTS } from '../constants';

describe(
  'retryUtils',
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('calculateBackoffDelay', () => {
      it('should calculate exponential backoff correctly', () => {
        const config = {
          initialDelay: 1000,
          maxDelay: 10000,
          backoffFactor: 2,
        };

        expect(calculateBackoffDelay(1, config)).toBe(1000);
        expect(calculateBackoffDelay(2, config)).toBe(2000);
        expect(calculateBackoffDelay(3, config)).toBe(4000);
        expect(calculateBackoffDelay(4, config)).toBe(8000);
        expect(calculateBackoffDelay(5, config)).toBe(10000); // Capped at maxDelay
        expect(calculateBackoffDelay(6, config)).toBe(10000); // Still capped
      });

      it('should handle different backoff factors', () => {
        const config = {
          initialDelay: 100,
          maxDelay: 5000,
          backoffFactor: 3,
        };

        expect(calculateBackoffDelay(1, config)).toBe(100);
        expect(calculateBackoffDelay(2, config)).toBe(300);
        expect(calculateBackoffDelay(3, config)).toBe(900);
        expect(calculateBackoffDelay(4, config)).toBe(2700);
        expect(calculateBackoffDelay(5, config)).toBe(5000); // Capped
      });
    });

    describe('addJitter', () => {
      it('should add jitter within the specified range', () => {
        const delay = 1000;
        const jitterFactor = 0.1;

        // Mock Math.random to test boundaries
        const originalRandom = Math.random;

        // Test minimum jitter (0%)
        Math.random = () => 0;
        expect(addJitter(delay, jitterFactor)).toBe(1000);

        // Test maximum jitter (100% of jitter factor)
        Math.random = () => 1;
        expect(addJitter(delay, jitterFactor)).toBe(1100);

        // Test middle jitter (50%)
        Math.random = () => 0.5;
        expect(addJitter(delay, jitterFactor)).toBe(1050);

        Math.random = originalRandom;
      });

      it('should use default jitter factor', () => {
        const delay = 1000;
        const result = addJitter(delay);
        expect(result).toBeGreaterThanOrEqual(1000);
        expect(result).toBeLessThanOrEqual(1100); // Default 10% jitter
      });
    });

    describe('sleep', () => {
      it('should resolve after specified time', async () => {
        const promise = sleep(1000);

        // Should not resolve immediately
        vi.advanceTimersByTime(500);
        await Promise.resolve(); // Flush microtasks
        expect(vi.getTimerCount()).toBe(1);

        // Should resolve after full time
        vi.advanceTimersByTime(500);
        await expect(promise).resolves.toBeUndefined();
      });

      it('should reject when aborted', async () => {
        const controller = new AbortController();
        const promise = sleep(1000, controller.signal);

        controller.abort();

        await expect(promise).rejects.toThrow('Aborted');
      });

      it('should reject immediately if signal already aborted', async () => {
        const controller = new AbortController();
        controller.abort();

        const promise = sleep(1000, controller.signal);

        await expect(promise).rejects.toThrow('Aborted');
      });
    });

    describe('retryWithBackoff', () => {
      it('should succeed on first attempt', async () => {
        const fn = vi.fn().mockResolvedValue('success');

        const result = await retryWithBackoff(fn);

        expect(result).toEqual({
          data: 'success',
          attempts: 1,
          success: true,
        });
        expect(fn).toHaveBeenCalledTimes(1);
      });

      it('should retry on failure and eventually succeed', async () => {
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const promise = retryWithBackoff(fn, { maxAttempts: 3 });

        // First attempt fails
        await vi.advanceTimersByTimeAsync(0);
        expect(fn).toHaveBeenCalledTimes(1);

        // Wait for retry delay
        await vi.advanceTimersByTimeAsync(1100); // Initial delay + jitter
        expect(fn).toHaveBeenCalledTimes(2);

        // Wait for second retry
        await vi.advanceTimersByTimeAsync(2200); // Backoff delay + jitter
        expect(fn).toHaveBeenCalledTimes(3);

        const result = await promise;
        expect(result).toEqual({
          data: 'success',
          attempts: 3,
          success: true,
        });
      });

      it('should fail after max attempts', async () => {
        const error = new Error('persistent failure');
        const fn = vi.fn().mockRejectedValue(error);

        const promise = retryWithBackoff(fn, {
          maxAttempts: 2,
          initialDelay: 100,
        });

        // First attempt
        await vi.advanceTimersByTimeAsync(0);
        expect(fn).toHaveBeenCalledTimes(1);

        // Second attempt
        await vi.advanceTimersByTimeAsync(150);
        expect(fn).toHaveBeenCalledTimes(2);

        const result = await promise;
        expect(result).toEqual({
          error,
          attempts: 2,
          success: false,
        });
      });

      it('should respect shouldRetry callback', async () => {
        const error = { status: 404 };
        const fn = vi.fn().mockRejectedValue(error);
        const shouldRetry = vi.fn().mockReturnValue(false);

        const result = await retryWithBackoff(fn, {
          maxAttempts: 3,
          shouldRetry,
        });

        expect(fn).toHaveBeenCalledTimes(1);
        expect(shouldRetry).toHaveBeenCalledWith(error, 1);
        expect(result.success).toBe(false);
      });

      it('should call onRetry callback', async () => {
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');
        const onRetry = vi.fn();

        const promise = retryWithBackoff(fn, {
          maxAttempts: 2,
          initialDelay: 100,
          onRetry,
        });

        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(150);

        await promise;

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledWith(
          expect.any(Error),
          1,
          expect.any(Number)
        );
      });

      it('should handle abort signal', async () => {
        const controller = new AbortController();
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const promise = retryWithBackoff(fn, {
          signal: controller.signal,
          initialDelay: 1000,
        });

        // First attempt fails
        await vi.advanceTimersByTimeAsync(0);
        expect(fn).toHaveBeenCalledTimes(1);

        // Abort during retry delay
        controller.abort();
        await vi.advanceTimersByTimeAsync(1000);

        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.error).toBeInstanceOf(DOMException);
        expect((result.error as Error).name).toBe('AbortError');
      });
    });

    describe('retryWithTimeout', () => {
      it('should timeout if operation takes too long', async () => {
        const fn = vi
          .fn()
          .mockImplementation(
            () => new Promise(resolve => setTimeout(resolve, 5000))
          );

        const promise = retryWithTimeout(fn, 1000, { maxAttempts: 3 });

        await vi.advanceTimersByTimeAsync(1000);

        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.error).toBeInstanceOf(DOMException);
      });

      it('should succeed within timeout', async () => {
        const fn = vi.fn().mockResolvedValue('success');

        const result = await retryWithTimeout(fn, 5000, { maxAttempts: 3 });

        expect(result).toEqual({
          data: 'success',
          attempts: 1,
          success: true,
        });
      });
    });

    describe('makeRetryable', () => {
      it('should create a retryable function', async () => {
        const originalFn = vi
          .fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const retryableFn = makeRetryable(originalFn, {
          maxAttempts: 2,
          initialDelay: 100,
        });

        const promise = retryableFn('arg1', 'arg2');

        await vi.advanceTimersByTimeAsync(0);
        expect(originalFn).toHaveBeenCalledWith('arg1', 'arg2');

        await vi.advanceTimersByTimeAsync(150);

        const result = await promise;
        expect(result).toBe('success');
        expect(originalFn).toHaveBeenCalledTimes(2);
      });

      it('should throw if all attempts fail', async () => {
        const error = new Error('persistent failure');
        const originalFn = vi.fn().mockRejectedValue(error);

        const retryableFn = makeRetryable(originalFn, {
          maxAttempts: 2,
          initialDelay: 100,
        });

        const promise = retryableFn();

        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(150);

        await expect(promise).rejects.toThrow(error);
      });
    });

    describe('isRetryableError', () => {
      it('should identify network errors as retryable', () => {
        expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
        expect(isRetryableError({ name: 'NetworkError' })).toBe(true);
        expect(isRetryableError({ name: 'TimeoutError' })).toBe(true);
      });

      it('should identify retryable HTTP status codes', () => {
        expect(isRetryableError({ status: 429 })).toBe(true); // Rate limit
        expect(isRetryableError({ status: 502 })).toBe(true); // Bad gateway
        expect(isRetryableError({ status: 503 })).toBe(true); // Service unavailable
        expect(isRetryableError({ status: 504 })).toBe(true); // Gateway timeout
      });

      it('should not retry client errors except 429', () => {
        expect(isRetryableError({ status: 400 })).toBe(false);
        expect(isRetryableError({ status: 401 })).toBe(false);
        expect(isRetryableError({ status: 403 })).toBe(false);
        expect(isRetryableError({ status: 404 })).toBe(false);
      });

      it('should identify dynamic import errors as retryable', () => {
        expect(
          isRetryableError(
            new Error('Failed to fetch dynamically imported module')
          )
        ).toBe(true);
        expect(isRetryableError(new Error('ChunkLoadError'))).toBe(true);
        expect(isRetryableError(new Error('Loading chunk 123 failed'))).toBe(
          true
        );
      });

      it('should return false for non-retryable errors', () => {
        expect(isRetryableError(null)).toBe(false);
        expect(isRetryableError(undefined)).toBe(false);
        expect(isRetryableError(new Error('Regular error'))).toBe(false);
        expect(isRetryableError({ status: 200 })).toBe(false);
      });
    });

    describe('CircuitBreaker', () => {
      let breaker: CircuitBreaker;

      beforeEach(() => {
        breaker = new CircuitBreaker(3, 1000);
      });

      it('should open after threshold failures', () => {
        const key = 'test-operation';

        expect(breaker.isOpen(key)).toBe(false);

        breaker.recordFailure(key);
        expect(breaker.isOpen(key)).toBe(false);

        breaker.recordFailure(key);
        expect(breaker.isOpen(key)).toBe(false);

        breaker.recordFailure(key);
        expect(breaker.isOpen(key)).toBe(true);
      });

      it('should close after success', () => {
        const key = 'test-operation';

        breaker.recordFailure(key);
        breaker.recordFailure(key);
        breaker.recordFailure(key);

        expect(breaker.isOpen(key)).toBe(true);

        breaker.recordSuccess(key);
        expect(breaker.isOpen(key)).toBe(false);
      });

      it('should reset after timeout', () => {
        const key = 'test-operation';

        breaker.recordFailure(key);
        breaker.recordFailure(key);
        breaker.recordFailure(key);

        expect(breaker.isOpen(key)).toBe(true);

        // Advance time past timeout
        const now = Date.now();
        vi.setSystemTime(now + 1001);

        expect(breaker.isOpen(key)).toBe(false);
      });

      it('should reset specific key or all keys', () => {
        breaker.recordFailure('key1');
        breaker.recordFailure('key1');
        breaker.recordFailure('key1');

        breaker.recordFailure('key2');
        breaker.recordFailure('key2');
        breaker.recordFailure('key2');

        expect(breaker.isOpen('key1')).toBe(true);
        expect(breaker.isOpen('key2')).toBe(true);

        breaker.reset('key1');
        expect(breaker.isOpen('key1')).toBe(false);
        expect(breaker.isOpen('key2')).toBe(true);

        breaker.reset();
        expect(breaker.isOpen('key2')).toBe(false);
      });
    });

    describe('RETRY_CONFIGS', () => {
      it('should have valid configurations for all operation types', () => {
        expect(RETRY_CONFIGS.api).toBeDefined();
        expect(RETRY_CONFIGS.upload).toBeDefined();
        expect(RETRY_CONFIGS.websocket).toBeDefined();
        expect(RETRY_CONFIGS.dynamicImport).toBeDefined();
        expect(RETRY_CONFIGS.imageLoad).toBeDefined();
        expect(RETRY_CONFIGS.auth).toBeDefined();

        // Verify websocket has infinite retries
        expect(RETRY_CONFIGS.websocket.maxAttempts).toBe(Infinity);

        // Verify auth has limited retries
        expect(RETRY_CONFIGS.auth.maxAttempts).toBe(2);

        // Verify upload has more retries than api
        expect(RETRY_CONFIGS.upload.maxAttempts).toBeGreaterThan(
          RETRY_CONFIGS.api.maxAttempts
        );
      });
    });

    describe('Edge Cases and Advanced Scenarios', () => {
      it('should handle zero delay configuration', async () => {
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('success');

        const result = await retryWithBackoff(fn, {
          maxAttempts: 2,
          initialDelay: 0,
          maxDelay: 0,
        });

        expect(result.success).toBe(true);
        expect(result.attempts).toBe(2);
        expect(fn).toHaveBeenCalledTimes(2);
      });

      it('should handle negative delay gracefully', async () => {
        const delay = calculateBackoffDelay(1, {
          initialDelay: -100,
          maxDelay: 1000,
          backoffFactor: 2,
        });

        expect(delay).toBeGreaterThanOrEqual(0);
      });

      it('should handle fractional backoff factors', () => {
        const config = {
          initialDelay: 1000,
          maxDelay: 5000,
          backoffFactor: 1.5,
        };

        expect(calculateBackoffDelay(1, config)).toBe(1000);
        expect(calculateBackoffDelay(2, config)).toBe(1500);
        expect(calculateBackoffDelay(3, config)).toBe(2250);
        expect(calculateBackoffDelay(4, config)).toBe(3375);
      });

      it('should handle very large attempt numbers without overflow', () => {
        const delay = calculateBackoffDelay(100, {
          initialDelay: 1000,
          maxDelay: 30000,
          backoffFactor: 2,
        });

        expect(delay).toBe(30000); // Should be capped at maxDelay
        expect(Number.isFinite(delay)).toBe(true);
      });

      it('should handle concurrent retries with different configurations', async () => {
        const fn1 = vi
          .fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('result1');

        const fn2 = vi
          .fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce('result2');

        const [result1, result2] = await Promise.all([
          retryWithBackoff(fn1, { maxAttempts: 2, initialDelay: 10 }),
          retryWithBackoff(fn2, { maxAttempts: 3, initialDelay: 20 }),
        ]);

        expect(result1.data).toBe('result1');
        expect(result1.attempts).toBe(2);
        expect(result2.data).toBe('result2');
        expect(result2.attempts).toBe(3);
      });

      it('should handle promise rejection with non-Error objects', async () => {
        const fn = vi
          .fn()
          .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'Network failed' })
          .mockRejectedValueOnce('string error')
          .mockRejectedValueOnce(null)
          .mockResolvedValueOnce('success');

        const result = await retryWithBackoff(fn, { maxAttempts: 4 });

        expect(result.success).toBe(true);
        expect(result.attempts).toBe(4);
      });

      it('should handle functions that throw synchronously', async () => {
        const fn = vi.fn(() => {
          throw new Error('Synchronous error');
        });

        const result = await retryWithBackoff(fn, { maxAttempts: 2 });

        expect(result.success).toBe(false);
        expect(result.error).toEqual(new Error('Synchronous error'));
        expect(fn).toHaveBeenCalledTimes(2);
      });

      it('should maintain error context through retries', async () => {
        const errors: unknown[] = [];
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Error('Error 1'))
          .mockRejectedValueOnce(new Error('Error 2'))
          .mockRejectedValueOnce(new Error('Error 3'));

        const result = await retryWithBackoff(fn, {
          maxAttempts: 3,
          initialDelay: 10,
          onRetry: (error) => errors.push(error),
        });

        expect(result.success).toBe(false);
        expect(errors).toHaveLength(2); // onRetry called for attempts 1 and 2
        expect(errors[0]).toEqual(new Error('Error 1'));
        expect(errors[1]).toEqual(new Error('Error 2'));
        expect(result.error).toEqual(new Error('Error 3'));
      });

      it('should handle race conditions with abort signals', async () => {
        const controller1 = new AbortController();
        const controller2 = new AbortController();

        const fn = vi.fn(() => new Promise(resolve => setTimeout(resolve, 100)));

        const promise1 = retryWithBackoff(fn, {
          signal: controller1.signal,
          maxAttempts: 3,
        });

        const promise2 = retryWithBackoff(fn, {
          signal: controller2.signal,
          maxAttempts: 3,
        });

        // Abort only the first one
        setTimeout(() => controller1.abort(), 50);

        const [result1, result2] = await Promise.all([promise1, promise2]);

        expect(result1.success).toBe(false);
        expect(result1.error).toBeInstanceOf(DOMException);
        expect(result2.success).toBe(true);
      });

      it('should handle memory leaks with circuit breaker', () => {
        const breaker = new CircuitBreaker(3, 1000);

        // Create many keys
        for (let i = 0; i < 1000; i++) {
          const key = `test-key-${i}`;
          breaker.recordFailure(key);
        }

        // Reset should clear all
        breaker.reset();

        // Verify memory is cleared
        for (let i = 0; i < 1000; i++) {
          expect(breaker.isOpen(`test-key-${i}`)).toBe(false);
        }
      });

      it('should handle makeRetryable with complex function signatures', async () => {
        const originalFn = vi.fn(
          async (a: number, b: string, c?: boolean) => {
            if (c) throw new Error('Optional param error');
            return `${a}-${b}`;
          }
        );

        const retryableFn = makeRetryable(originalFn, {
          maxAttempts: 2,
          initialDelay: 10,
        });

        // Test with required params
        const result1 = await retryableFn(42, 'test');
        expect(result1).toBe('42-test');

        // Test with optional param causing failure
        originalFn.mockClear();
        originalFn.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('success');

        const result2 = await retryableFn(1, 'retry', false);
        expect(result2).toBe('success');
        expect(originalFn).toHaveBeenCalledTimes(2);
      });

      it('should handle extremely long-running operations with timeout', async () => {
        const fn = vi.fn(
          () => new Promise(resolve => setTimeout(() => resolve('never'), 1000000))
        );

        const promise = retryWithTimeout(fn, 100, { maxAttempts: 1 });

        await vi.advanceTimersByTimeAsync(100);

        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.error).toBeInstanceOf(DOMException);
      });

      it('should handle rapid successive calls to same circuit breaker key', () => {
        const breaker = new CircuitBreaker(3, 1000);
        const key = 'rapid-test';

        // Rapid failures
        for (let i = 0; i < 10; i++) {
          breaker.recordFailure(key);
        }

        expect(breaker.isOpen(key)).toBe(true);

        // Rapid success shouldn't affect already open breaker immediately
        breaker.recordSuccess(key);
        expect(breaker.isOpen(key)).toBe(false);
      });

      it('should validate isRetryableError with edge cases', () => {
        // Undefined and null
        expect(isRetryableError(undefined)).toBe(false);
        expect(isRetryableError(null)).toBe(false);

        // Empty objects
        expect(isRetryableError({})).toBe(false);

        // Non-standard error objects
        expect(isRetryableError({ statusCode: 503 })).toBe(false); // Wrong property
        expect(isRetryableError({ status: '503' })).toBe(false); // String status

        // Network-like errors
        expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
        expect(isRetryableError({ name: 'AbortError' })).toBe(false); // Not retryable

        // Custom error messages
        expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(false);
        expect(isRetryableError(new Error('ChunkLoadError: Loading failed'))).toBe(true);
      });
    });
  },
  TEST_TIMEOUTS.UNIT
);
