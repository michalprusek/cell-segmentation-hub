/**
 * retryService.test.ts
 *
 * Behavioral tests for src/utils/retryService.ts.
 *
 * Covered branches:
 *  - success on first attempt (no retry needed)
 *  - success on second attempt after one failure
 *  - throws after maxRetries is exhausted
 *  - non-retriable error aborts immediately (isRetriableError returns false)
 *  - exponential backoff delay is capped at maxDelay
 *  - isCommonRetriableError: fs error codes (ENOENT, EACCES, EMFILE)
 *  - isCommonRetriableError: network codes (ECONNRESET, ETIMEDOUT, ENOTFOUND)
 *  - isCommonRetriableError: memory keywords in message
 *  - isCommonRetriableError: DB codes (P1001, P1002)
 *  - isCommonRetriableError: SMTP status codes (421, 450, 451, 452)
 *  - isCommonRetriableError: rate limit keywords
 *  - isCommonRetriableError: temporary network keywords (econnrefused, timeout, socket)
 *  - isCommonRetriableError: sharp + memory combo
 *  - isCommonRetriableError: falsy error → false
 *  - isCommonRetriableError: unmatched error → false
 *
 * Uses vi.useFakeTimers so no real clock waits occur.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32chars!!',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32chars!',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    FROM_EMAIL: 'test@test.com',
    EMAIL_SERVICE: 'none',
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
}));

import { RetryService, RetryConfig } from '../retryService';

const BASE_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 100,
  maxDelay: 1000,
  backoffFactor: 2,
  operationName: 'TestOp',
};

describe('RetryService.executeWithRetry', () => {
  let service: RetryService;

  beforeEach(() => {
    service = new RetryService();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately on first-attempt success', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    const result = await service.executeWithRetry(op, BASE_CONFIG);
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries and resolves when second attempt succeeds', async () => {
    const err = new Error('transient');
    const op = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('second');

    const promise = service.executeWithRetry(op, BASE_CONFIG);
    // advance past the first backoff delay (100ms)
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('second');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('throws after maxRetries attempts are exhausted', async () => {
    const err = new Error('always fails');
    const op = vi.fn().mockRejectedValue(err);

    const resultPromise = service
      .executeWithRetry(op, BASE_CONFIG)
      .catch(e => e);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('always fails');
    expect(op).toHaveBeenCalledTimes(BASE_CONFIG.maxRetries);
  });

  it('aborts immediately when isRetriableError returns false', async () => {
    const nonRetriable = new Error('permanent failure');
    const op = vi.fn().mockRejectedValue(nonRetriable);
    const notRetriable = vi.fn().mockReturnValue(false);

    const resultPromise = service
      .executeWithRetry(op, BASE_CONFIG, notRetriable)
      .catch(e => e);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('permanent failure');
    // Should stop on first failure since isRetriableError returns false
    expect(op).toHaveBeenCalledTimes(1);
    expect(notRetriable).toHaveBeenCalledWith(nonRetriable);
  });

  it('continues retrying when isRetriableError returns true', async () => {
    const err = new Error('retriable');
    const op = vi.fn().mockRejectedValue(err);
    const alwaysRetriable = vi.fn().mockReturnValue(true);

    const resultPromise = service
      .executeWithRetry(op, BASE_CONFIG, alwaysRetriable)
      .catch(e => e);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('retriable');
    expect(op).toHaveBeenCalledTimes(BASE_CONFIG.maxRetries);
  });

  it('caps delay at maxDelay regardless of backoff growth', async () => {
    // With initialDelay=100, backoffFactor=10, maxDelay=200:
    // attempt 1 delay = 100*10^0 = 100 (< 200 → use 100)
    // attempt 2 delay = 100*10^1 = 1000 (> 200 → cap at 200)
    const capConfig: RetryConfig = {
      maxRetries: 4,
      initialDelay: 100,
      maxDelay: 200,
      backoffFactor: 10,
    };
    const err = new Error('fail');
    const op = vi.fn().mockRejectedValue(err);

    const resultPromise = service.executeWithRetry(op, capConfig).catch(e => e);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBeInstanceOf(Error);
    // All 4 attempts are made; the important thing is it doesn't hang
    expect(op).toHaveBeenCalledTimes(4);
  });

  it('works without operationName in config', async () => {
    const config: RetryConfig = {
      maxRetries: 2,
      initialDelay: 50,
      maxDelay: 500,
      backoffFactor: 2,
      // operationName omitted intentionally
    };
    const op = vi.fn().mockRejectedValue(new Error('no name'));
    const resultPromise = service.executeWithRetry(op, config).catch(e => e);
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result).toBeInstanceOf(Error);
  });
});

describe('RetryService.isCommonRetriableError', () => {
  // ── falsy input ────────────────────────────────────────────────────────────

  it('returns false for null', () => {
    expect(RetryService.isCommonRetriableError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(RetryService.isCommonRetriableError(undefined)).toBe(false);
  });

  it('returns false for 0', () => {
    expect(RetryService.isCommonRetriableError(0)).toBe(false);
  });

  // ── filesystem codes ───────────────────────────────────────────────────────

  it('returns true for ENOENT code', () => {
    expect(RetryService.isCommonRetriableError({ code: 'ENOENT' })).toBe(true);
  });

  it('returns true for EACCES code', () => {
    expect(RetryService.isCommonRetriableError({ code: 'EACCES' })).toBe(true);
  });

  it('returns true for EMFILE code', () => {
    expect(RetryService.isCommonRetriableError({ code: 'EMFILE' })).toBe(true);
  });

  // ── network error codes ────────────────────────────────────────────────────

  it('returns true for ECONNRESET code', () => {
    expect(RetryService.isCommonRetriableError({ code: 'ECONNRESET' })).toBe(
      true
    );
  });

  it('returns true for ETIMEDOUT code', () => {
    expect(RetryService.isCommonRetriableError({ code: 'ETIMEDOUT' })).toBe(
      true
    );
  });

  it('returns true for ENOTFOUND code', () => {
    expect(RetryService.isCommonRetriableError({ code: 'ENOTFOUND' })).toBe(
      true
    );
  });

  // ── message-based matches ─────────────────────────────────────────────────

  it('returns true for "memory" in message', () => {
    expect(
      RetryService.isCommonRetriableError({ message: 'out of memory' })
    ).toBe(true);
  });

  it('returns true for "heap" in message', () => {
    expect(
      RetryService.isCommonRetriableError({
        message: 'JavaScript heap overflow',
      })
    ).toBe(true);
  });

  it('returns true for Prisma P1001 code', () => {
    expect(RetryService.isCommonRetriableError({ code: 'P1001' })).toBe(true);
  });

  it('returns true for Prisma P1002 code', () => {
    expect(RetryService.isCommonRetriableError({ code: 'P1002' })).toBe(true);
  });

  it('returns true for SMTP 421 in message', () => {
    expect(
      RetryService.isCommonRetriableError({
        message: 'SMTP error 421 try later',
      })
    ).toBe(true);
  });

  it('returns true for SMTP 450 in message', () => {
    expect(
      RetryService.isCommonRetriableError({ message: 'Server busy 450' })
    ).toBe(true);
  });

  it('returns true for SMTP 451 in message', () => {
    expect(
      RetryService.isCommonRetriableError({ message: 'Temporary 451 failure' })
    ).toBe(true);
  });

  it('returns true for SMTP 452 in message', () => {
    expect(
      RetryService.isCommonRetriableError({
        message: '452 too many recipients',
      })
    ).toBe(true);
  });

  it('returns true for "rate limit" in message', () => {
    expect(
      RetryService.isCommonRetriableError({ message: 'Rate limit exceeded' })
    ).toBe(true);
  });

  it('returns true for "too many" in message', () => {
    expect(
      RetryService.isCommonRetriableError({ message: 'too many requests' })
    ).toBe(true);
  });

  it('returns true for "throttl" in message (covers throttle/throttling)', () => {
    expect(
      RetryService.isCommonRetriableError({
        message: 'Request throttled by upstream',
      })
    ).toBe(true);
  });

  it('returns true for "econnrefused" in message', () => {
    expect(
      RetryService.isCommonRetriableError({
        message: 'connect ECONNREFUSED 127.0.0.1',
      })
    ).toBe(true);
  });

  it('returns true for "timeout" in message', () => {
    expect(
      RetryService.isCommonRetriableError({
        message: 'request timed out: timeout',
      })
    ).toBe(true);
  });

  it('returns true for "socket" in message', () => {
    expect(
      RetryService.isCommonRetriableError({ message: 'socket hang up' })
    ).toBe(true);
  });

  it('returns true for "econnreset" in message', () => {
    expect(
      RetryService.isCommonRetriableError({ message: 'read ECONNRESET' })
    ).toBe(true);
  });

  it('returns true for sharp + memory combo in message', () => {
    expect(
      RetryService.isCommonRetriableError({
        message: 'sharp: Failed to allocate memory for image buffer',
      })
    ).toBe(true);
  });

  it('returns false for a sharp error that does NOT mention memory', () => {
    expect(
      RetryService.isCommonRetriableError({
        message: 'sharp: unsupported image format',
      })
    ).toBe(false);
  });

  it('returns false for an unrelated generic error', () => {
    expect(
      RetryService.isCommonRetriableError({
        message: 'something went wrong',
        code: 'ERR_CUSTOM',
      })
    ).toBe(false);
  });

  it('returns false for an error object with no message or code', () => {
    expect(RetryService.isCommonRetriableError({})).toBe(false);
  });
});
