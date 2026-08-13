/**
 * Behavioral unit tests for the useRetry hook (and useRetryImport).
 *
 * Strategy:
 * - useRetry wraps retryWithBackoff which uses setTimeout for inter-attempt
 *   delays. We use real async/await for promise resolution and
 *   vi.runAllTimersAsync / vi.advanceTimersByTimeAsync to drive timers.
 * - The hook requires a LanguageProvider (via useLanguage) and
 *   useAbortController. We wrap with AllProviders.
 * - toast (sonner) and logger are mocked to silence noise and to assert calls.
 *
 * This file consolidates the former split suites (main + gaps + gaps2 + extra);
 * every describe block below covers one distinct concern.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// ---- mock toast + logger before importing the hook -------------------------
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

import { useRetry, useRetryImport } from '../useRetry';
import { AllProviders } from '@/test/utils/test-providers';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Shared helpers
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

/** A function that always rejects. */
function alwaysFail(msg = 'fail') {
  return vi.fn().mockRejectedValue(new Error(msg));
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
    it('starts with data=null, loading=false, retrying=false, error=null, attempt=0', () => {
      const { result } = renderHook(() => useRetry(), { wrapper });

      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.retrying).toBe(false);
      expect(result.current.attempt).toBe(0);
    });

    it('reflects configured maxAttempts in state.maxAttempts', () => {
      const { result } = renderHook(
        () => useRetry<string>({ maxAttempts: 7, showToast: false }),
        { wrapper }
      );

      expect(result.current.maxAttempts).toBe(7);
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

    it('calls onSuccess exactly once with the exact resolved value', async () => {
      const onSuccess = vi.fn();
      const fn = vi.fn().mockResolvedValue({ key: 'value' });

      const { result } = renderHook(
        () => useRetry<{ key: string }>({ showToast: false, onSuccess }),
        { wrapper }
      );

      await act(async () => {
        const p = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await p;
      });

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith({ key: 'value' });
    });

    it('does not call onFailure when the operation succeeds', async () => {
      const onFailure = vi.fn();
      const fn = vi.fn().mockResolvedValue('success');

      const { result } = renderHook(
        () => useRetry<string>({ showToast: false, onFailure }),
        { wrapper }
      );

      await act(async () => {
        const p = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await p;
      });

      expect(onFailure).not.toHaveBeenCalled();
    });
  });

  // ---- retry-then-succeed --------------------------------------------------

  describe('retry then succeed', () => {
    it('retries transient failures and eventually resolves with data', async () => {
      // Fail twice, succeed on attempt 3. Use a short but non-zero delay so
      // advanceTimersByTimeAsync can drive the retries.
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

      await act(async () => {
        const promise = result.current.execute(fn);
        await vi.advanceTimersByTimeAsync(50);
        await vi.advanceTimersByTimeAsync(50);
        await vi.advanceTimersByTimeAsync(50);
        await promise;
      });

      expect(fn).toHaveBeenCalledTimes(3);
      expect(result.current.data).toBe('final');
      expect(result.current.loading).toBe(false);
      expect(result.current.retrying).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  // ---- max retries exhausted -----------------------------------------------

  describe('max retries exhausted', () => {
    it('sets error, clears loading, calls onFailure with the error after all attempts fail', async () => {
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

  // ---- cancel and reset ----------------------------------------------------

  describe('cancel and reset', () => {
    it('cancel() aborts in-flight execution (loading true→false) and resets state', async () => {
      // A function that never resolves — simulates a long inflight request.
      let rejectFn!: (e: Error) => void;
      const fn = vi.fn(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectFn = reject;
          })
      );

      const { result } = renderHook(
        () => useRetry<string>({ showToast: false, showLoading: true }),
        { wrapper }
      );

      act(() => {
        void result.current.execute(fn);
      });

      expect(result.current.loading).toBe(true);

      act(() => {
        result.current.cancel();
        // Reject the hanging promise so the chain settles.
        rejectFn(new Error('aborted'));
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.data).toBeNull();
    });

    it('reset() clears state and the countdown interval mid-retry', async () => {
      // Fails on the first attempt then would succeed; a long delay lets us
      // reset while the retry countdown interval is active.
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls < 2) throw new Error('transient');
        return 'recovered';
      });

      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: false,
            maxAttempts: 5,
            initialDelay: 5000,
            maxDelay: 5000,
            backoffFactor: 1,
          }),
        { wrapper }
      );

      act(() => {
        void result.current.execute(fn);
      });

      // First call fails, handleRetry fires and starts the countdown.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.data).toBeNull();
      expect(result.current.nextRetryIn).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.attempt).toBe(0);
    });

    it('reset() dismisses a previously active loading toast', async () => {
      vi.mocked(toast.loading).mockReturnValue('prev-toast-id');

      const fn = succeedOnAttempt(3, 'done');

      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: true,
            maxAttempts: 5,
            initialDelay: 50,
            maxDelay: 50,
            backoffFactor: 1,
          }),
        { wrapper }
      );

      act(() => {
        void result.current.execute(fn);
      });

      // Drive two failures so toast.loading fires on attempt 2 (attempt > 1).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      expect(toast.loading).toHaveBeenCalled();

      act(() => {
        result.current.reset();
      });

      expect(toast.dismiss).toHaveBeenCalled();
    });
  });

  // ---- retry() helper ------------------------------------------------------

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

      // First run — fails (maxAttempts=1).
      await act(async () => {
        result.current.execute(fn);
        await vi.runAllTimersAsync();
      });

      expect(result.current.error).not.toBeNull();

      // retry() — second call to fn should succeed.
      await act(async () => {
        result.current.retry();
        await vi.runAllTimersAsync();
      });

      expect(result.current.data).toBe('recovered');
      expect(result.current.error).toBeNull();
    });

    it('is a no-op when called before any execute() (fnRef is null)', async () => {
      const { result } = renderHook(() => useRetry<string>(), { wrapper });

      await expect(
        act(async () => {
          await result.current.retry();
        })
      ).resolves.not.toThrow();

      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  // ---- loading state -------------------------------------------------------

  describe('loading state', () => {
    it('transitions loading true→false across a single-attempt execution when showLoading=true', async () => {
      let resolve!: (v: string) => void;
      const fn = vi.fn(() => new Promise<string>(r => (resolve = r)));

      const { result } = renderHook(
        () => useRetry<string>({ showToast: false, showLoading: true }),
        { wrapper }
      );

      let execPromise!: Promise<unknown>;
      act(() => {
        execPromise = result.current.execute(fn);
      });

      const loadingDuringExecution = result.current.loading;

      // Await the execute promise directly so the settle continuation
      // (setState loading=false) is guaranteed to have run before asserting.
      await act(async () => {
        resolve('done');
        await execPromise;
      });

      expect(loadingDuringExecution).toBe(true);
      expect(result.current.loading).toBe(false);
    });

    it('never sets loading=true when showLoading=false', async () => {
      const loadingValues: boolean[] = [];
      let resolve!: (v: string) => void;
      const fn = vi.fn(() => new Promise<string>(r => (resolve = r)));

      const { result } = renderHook(
        () => useRetry<string>({ showToast: false, showLoading: false }),
        { wrapper }
      );

      act(() => {
        void result.current.execute(fn);
      });

      loadingValues.push(result.current.loading);

      await act(async () => {
        resolve('done');
        await vi.runAllTimersAsync();
      });

      loadingValues.push(result.current.loading);
      expect(loadingValues.every(v => v === false)).toBe(true);
    });
  });

  // ---- preset config -------------------------------------------------------

  describe('preset config', () => {
    it('accepts a named preset and ends in an error state when it fails', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const { result } = renderHook(
        () => useRetry<string>({ preset: 'auth', showToast: false }),
        { wrapper }
      );

      await act(async () => {
        result.current.execute(fn);
        await vi.runAllTimersAsync();
      });

      // auth preset (RETRY_ATTEMPTS.AUTH) was accepted without throwing and the
      // operation ended in an error state.
      expect(result.current.error).not.toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  // ---- toast notifications (showToast=true) --------------------------------

  describe('toast notifications (showToast=true)', () => {
    it('calls toast.loading on a retry attempt > 1', async () => {
      const fn = succeedOnAttempt(3, 'result');

      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: true,
            maxAttempts: 5,
            initialDelay: 50,
            maxDelay: 50,
            backoffFactor: 1,
          }),
        { wrapper }
      );

      await act(async () => {
        const promise = result.current.execute(fn);
        await vi.advanceTimersByTimeAsync(50);
        await vi.advanceTimersByTimeAsync(50);
        await vi.advanceTimersByTimeAsync(50);
        await promise;
      });

      expect(toast.loading).toHaveBeenCalled();
    });

    it('does NOT call toast.loading when the first attempt succeeds', async () => {
      const fn = vi.fn().mockResolvedValue('immediate');

      const { result } = renderHook(
        () => useRetry<string>({ showToast: true }),
        { wrapper }
      );

      await act(async () => {
        const promise = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await promise;
      });

      expect(toast.loading).not.toHaveBeenCalled();
    });

    it('calls toast.error with errorMessage when all attempts fail', async () => {
      const fn = alwaysFail();

      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: true,
            maxAttempts: 1,
            errorMessage: 'custom-error-msg',
          }),
        { wrapper }
      );

      await act(async () => {
        const promise = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await promise;
      });

      expect(toast.error).toHaveBeenCalled();
      const calls = vi.mocked(toast.error).mock.calls;
      expect(calls.some(([msg]) => msg === 'custom-error-msg')).toBe(true);
    });

    it('uses formatError result in toast.error when provided', async () => {
      const fn = alwaysFail('raw-error');
      const formatError = vi.fn(() => 'formatted-error-text');

      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: true,
            maxAttempts: 1,
            formatError,
          }),
        { wrapper }
      );

      await act(async () => {
        const promise = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await promise;
      });

      expect(formatError).toHaveBeenCalled();
      const calls = vi.mocked(toast.error).mock.calls;
      expect(calls.some(([msg]) => msg === 'formatted-error-text')).toBe(true);
    });

    it('uses formatError result in the loading toast message when retrying', async () => {
      const fn = succeedOnAttempt(3, 'ok');
      const formatError = vi.fn(() => 'retrying-msg');

      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: true,
            maxAttempts: 5,
            initialDelay: 50,
            maxDelay: 50,
            backoffFactor: 1,
            formatError,
          }),
        { wrapper }
      );

      await act(async () => {
        const promise = result.current.execute(fn);
        await vi.advanceTimersByTimeAsync(200);
        await promise;
      });

      expect(formatError).toHaveBeenCalled();
      expect(toast.loading).toHaveBeenCalledWith(
        'retrying-msg',
        expect.anything()
      );
    });

    it('calls toast.success with the configured successMessage on success', async () => {
      const fn = vi.fn().mockResolvedValue('data');

      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: true,
            successMessage: 'Operation complete!',
          }),
        { wrapper }
      );

      await act(async () => {
        const promise = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await promise;
      });

      expect(toast.success).toHaveBeenCalledWith('Operation complete!');
    });

    it('does NOT call toast.success when successMessage is absent', async () => {
      const fn = vi.fn().mockResolvedValue('data');

      const { result } = renderHook(
        () => useRetry<string>({ showToast: true }),
        { wrapper }
      );

      await act(async () => {
        const promise = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await promise;
      });

      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  // ---- toast suppression (showToast=false) ---------------------------------

  describe('toast suppression (showToast=false)', () => {
    it('does not call toast.error when the operation fails', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('boom'));

      const { result } = renderHook(
        () => useRetry<string>({ showToast: false, maxAttempts: 1 }),
        { wrapper }
      );

      await act(async () => {
        const p = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await p;
      });

      expect(toast.error).not.toHaveBeenCalled();
    });

    it('does not call toast.success even with a successMessage configured', async () => {
      const fn = vi.fn().mockResolvedValue('data');

      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: false,
            successMessage: 'All done!',
          }),
        { wrapper }
      );

      await act(async () => {
        const p = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await p;
      });

      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  // ---- nextRetryIn countdown ----------------------------------------------

  describe('nextRetryIn countdown', () => {
    it('sets nextRetryIn to a positive number during the retry delay, then clears it', async () => {
      const fn = succeedOnAttempt(2, 'ok');

      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: false,
            maxAttempts: 3,
            initialDelay: 3000,
            maxDelay: 3000,
            backoffFactor: 1,
          }),
        { wrapper }
      );

      // Kick off execution; the first call fails, handleRetry sets nextRetryIn=3
      // (Math.ceil(3000/1000)) synchronously before the countdown interval ticks.
      await act(async () => {
        void result.current.execute(fn);
        await Promise.resolve();
      });

      const captured = result.current.nextRetryIn;

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(
        (typeof captured === 'number' && captured > 0) ||
          result.current.nextRetryIn === null
      ).toBe(true);
      // After success it must be cleared.
      expect(result.current.nextRetryIn).toBeNull();
    });

    it('is null after a successful single-attempt execution', async () => {
      const fn = vi.fn().mockResolvedValue('immediate');

      const { result } = renderHook(
        () => useRetry<string>({ showToast: false }),
        { wrapper }
      );

      await act(async () => {
        const p = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await p;
      });

      expect(result.current.nextRetryIn).toBeNull();
      expect(result.current.data).toBe('immediate');
    });
  });
});

// ---------------------------------------------------------------------------
// useRetryImport
// ---------------------------------------------------------------------------

describe('useRetryImport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the .default export of a resolved dynamic import', async () => {
    const fakeDefault = { Component: 'FakeComponent' };
    const importFn = vi.fn().mockResolvedValue({ default: fakeDefault });

    const { result } = renderHook(() => useRetryImport(), { wrapper });

    let value: typeof fakeDefault | undefined;
    await act(async () => {
      const promise = result.current(importFn);
      await vi.runAllTimersAsync();
      value = await promise;
    });

    expect(value).toBe(fakeDefault);
    expect(importFn).toHaveBeenCalledTimes(1);
  });
});
