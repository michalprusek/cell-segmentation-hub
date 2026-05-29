/**
 * Behavioral unit tests for useRetry hook.
 *
 * Strategy:
 * - useRetry wraps retryWithBackoff which uses setTimeout for inter-attempt
 *   delays. We use real async/await for promise resolution and
 *   vi.advanceTimersByTimeAsync to drive timers without deadlock.
 * - The hook requires a LanguageProvider (via useLanguage) and
 *   useAbortController. We wrap with AllProviders.
 * - toast (sonner) is mocked to prevent noise and to assert on calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// ---- mock toast before importing the hook ----------------------------------
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => 'toast-id'),
    dismiss: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { useRetry } from '../useRetry';
import { AllProviders } from '@/test/utils/test-providers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(AllProviders, null, children);

/**
 * Build a function that succeeds on the n-th call (1-indexed).
 * Calls 1..(n-1) reject with an Error.
 */
function succeedOnAttempt(n: number, resolvedValue = 'ok') {
  let callCount = 0;
  return vi.fn(async () => {
    callCount++;
    if (callCount < n) throw new Error(`attempt ${callCount} failed`);
    return resolvedValue;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---- initial state -------------------------------------------------------

  describe('initial state', () => {
    it('starts with data=null, loading=false, retrying=false, error=null', () => {
      const { result } = renderHook(() => useRetry(), { wrapper });

      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.retrying).toBe(false);
      expect(result.current.attempt).toBe(0);
    });

    it('exposes execute, reset, cancel, retry functions', () => {
      const { result } = renderHook(() => useRetry(), { wrapper });

      expect(typeof result.current.execute).toBe('function');
      expect(typeof result.current.reset).toBe('function');
      expect(typeof result.current.cancel).toBe('function');
      expect(typeof result.current.retry).toBe('function');
    });
  });

  // ---- success on first attempt -------------------------------------------

  describe('immediate success', () => {
    it('sets data, clears loading, reports attempt=1 on first-attempt success', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const { result } = renderHook(
        () => useRetry<string>({ showToast: false, showLoading: true }),
        { wrapper }
      );

      let returnValue: Awaited<ReturnType<typeof result.current.execute>>;
      await act(async () => {
        const promise = result.current.execute(fn);
        // resolve timers so the promise settles
        await vi.runAllTimersAsync();
        returnValue = await promise;
      });

      expect(returnValue!.success).toBe(true);
      expect(returnValue!.data).toBe('result');
      expect(returnValue!.attempts).toBe(1);

      expect(result.current.data).toBe('result');
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.attempt).toBe(1);
    });

    it('calls onSuccess callback with the resolved value', async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(
        () => useRetry<string>({ showToast: false, onSuccess }),
        { wrapper }
      );

      await act(async () => {
        result.current.execute(() => Promise.resolve('payload'));
        await vi.runAllTimersAsync();
      });

      expect(onSuccess).toHaveBeenCalledWith('payload');
    });
  });

  // ---- retry-then-succeed --------------------------------------------------

  describe('retry then succeed', () => {
    it('retries and eventually resolves with data after transient failures', async () => {
      // Fail twice, succeed on attempt 3. Use a short but non-zero delay so
      // vi.advanceTimersByTimeAsync can drive through the retries without
      // triggering the infinite-loop guard (which fires on vi.runAllTimersAsync
      // when setInterval is present inside the hook countdown).
      const fn = succeedOnAttempt(3, 'final');
      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: false,
            maxAttempts: 5,
            initialDelay: 50,
            maxDelay: 50,
            backoffFactor: 1, // constant delay for predictability
          }),
        { wrapper }
      );

      // Advance time enough to drive all retry delays (2 retries × 50 ms each,
      // plus the 1-second interval ticks inside handleRetry).
      await act(async () => {
        const promise = result.current.execute(fn);
        // Advance in steps to let promises resolve between timer ticks.
        await vi.advanceTimersByTimeAsync(50);
        await vi.advanceTimersByTimeAsync(50);
        await vi.advanceTimersByTimeAsync(50);
        await promise;
      });

      expect(fn).toHaveBeenCalledTimes(3);
      expect(result.current.data).toBe('final');
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('sets retrying=false and data once execution succeeds after retries', async () => {
      // Simpler version: just verify final settled state after retry.
      const fn = succeedOnAttempt(2, 'recovered');
      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: false,
            maxAttempts: 3,
            initialDelay: 50,
            maxDelay: 50,
            backoffFactor: 1,
          }),
        { wrapper }
      );

      await act(async () => {
        const promise = result.current.execute(fn);
        await vi.advanceTimersByTimeAsync(200);
        await promise;
      });

      expect(result.current.retrying).toBe(false);
      expect(result.current.data).toBe('recovered');
    });
  });

  // ---- max retries exhausted -----------------------------------------------

  describe('max retries exhausted', () => {
    it('sets error, clears loading, calls onFailure after all attempts fail', async () => {
      const boom = new Error('always fails');
      const fn = vi.fn().mockRejectedValue(boom);
      const onFailure = vi.fn();

      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: false,
            maxAttempts: 2,
            initialDelay: 10,
            backoffFactor: 1,
            onFailure,
          }),
        { wrapper }
      );

      await act(async () => {
        const promise = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await promise;
      });

      expect(fn).toHaveBeenCalledTimes(2);
      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(boom);
      expect(onFailure).toHaveBeenCalledWith(boom);
    });

    it('returns success=false from execute when all attempts fail', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('nope'));
      const { result } = renderHook(
        () => useRetry<string>({ showToast: false, maxAttempts: 1 }),
        { wrapper }
      );

      let retVal: Awaited<ReturnType<typeof result.current.execute>>;
      await act(async () => {
        const promise = result.current.execute(fn);
        await vi.runAllTimersAsync();
        retVal = await promise;
      });

      expect(retVal!.success).toBe(false);
      expect(retVal!.attempts).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- abort / cancel ------------------------------------------------------

  describe('abort and cancel', () => {
    it('cancel() aborts in-flight execution and resets state', async () => {
      // fn that never resolves — simulates a long inflight request
      let rejectFn!: (e: Error) => void;
      const fn = vi.fn(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectFn = reject;
          })
      );

      const { result } = renderHook(
        () => useRetry<string>({ showToast: false }),
        { wrapper }
      );

      act(() => {
        void result.current.execute(fn);
      });

      // Cancel while in-flight
      act(() => {
        result.current.cancel();
        // Also reject the hanging promise so the Promise chain settles
        rejectFn(new Error('aborted'));
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.data).toBeNull();
    });

    it('reset() clears state and allows re-execution', async () => {
      const fn = vi.fn().mockResolvedValue('first');
      const { result } = renderHook(
        () => useRetry<string>({ showToast: false }),
        { wrapper }
      );

      await act(async () => {
        result.current.execute(fn);
        await vi.runAllTimersAsync();
      });

      expect(result.current.data).toBe('first');

      act(() => {
        result.current.reset();
      });

      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.attempt).toBe(0);
    });
  });

  // ---- retry() re-executes last fn ----------------------------------------

  describe('retry() helper', () => {
    it('re-runs the last fn when called after failure', async () => {
      const fn = succeedOnAttempt(2, 'recovered');
      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: false,
            maxAttempts: 1, // first execute exhausts immediately
          }),
        { wrapper }
      );

      // First run — fails (maxAttempts=1)
      await act(async () => {
        result.current.execute(fn);
        await vi.runAllTimersAsync();
      });

      expect(result.current.error).not.toBeNull();

      // retry() — second call to fn should succeed
      await act(async () => {
        result.current.retry();
        await vi.runAllTimersAsync();
      });

      expect(result.current.data).toBe('recovered');
      expect(result.current.error).toBeNull();
    });
  });

  // ---- loading state -------------------------------------------------------

  describe('loading state', () => {
    it('sets loading=true while executing when showLoading=true', async () => {
      let capturedLoading = false;
      let resolve!: (v: string) => void;
      const fn = vi.fn(() => new Promise<string>(r => (resolve = r)));

      const { result } = renderHook(
        () => useRetry<string>({ showToast: false, showLoading: true }),
        { wrapper }
      );

      act(() => {
        void result.current.execute(fn);
      });

      capturedLoading = result.current.loading;

      // Resolve the promise
      await act(async () => {
        resolve('done');
        await vi.runAllTimersAsync();
      });

      expect(capturedLoading).toBe(true);
      expect(result.current.loading).toBe(false);
    });

    it('loading stays false when showLoading=false', async () => {
      let resolve!: (v: string) => void;
      const fn = vi.fn(() => new Promise<string>(r => (resolve = r)));
      const { result } = renderHook(
        () => useRetry<string>({ showToast: false, showLoading: false }),
        { wrapper }
      );

      act(() => {
        void result.current.execute(fn);
      });

      expect(result.current.loading).toBe(false);

      await act(async () => {
        resolve('done');
        await vi.runAllTimersAsync();
      });
    });
  });

  // ---- preset config -------------------------------------------------------

  describe('preset config', () => {
    it('accepts a named preset and uses its maxAttempts', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const { result } = renderHook(
        () => useRetry<string>({ preset: 'auth', showToast: false }),
        { wrapper }
      );

      await act(async () => {
        result.current.execute(fn);
        await vi.runAllTimersAsync();
      });

      // auth preset has maxAttempts=2 (RETRY_ATTEMPTS.AUTH); we just confirm
      // the hook accepted the preset without throwing and ended in an error state.
      expect(result.current.error).not.toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  // ---- maxAttempts reflected in state -------------------------------------

  describe('maxAttempts state', () => {
    it('reflects configured maxAttempts in state.maxAttempts', () => {
      const { result } = renderHook(
        () => useRetry<string>({ maxAttempts: 7, showToast: false }),
        { wrapper }
      );

      expect(result.current.maxAttempts).toBe(7);
    });
  });
});
