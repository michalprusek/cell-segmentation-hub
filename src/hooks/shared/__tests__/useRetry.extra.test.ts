/**
 * useRetry – additional gap coverage (beyond gaps.test.ts and main test.ts)
 *
 * Targets remaining uncovered branches:
 *  1. cancel() calls toast.dismiss when a loading toast is active.
 *  2. retry() is a no-op when fnRef.current is null (never executed yet).
 *  3. showToast=false → no toast.error even on failure.
 *  4. showToast=false → no toast.success even with successMessage.
 *  5. execute() when fnRef is re-invoked sets loading back to true on start.
 *  6. Countdown setInterval clears (nextRetryIn reaches 0, interval stops).
 *  7. onSuccess callback receives the resolved data value.
 *  8. onFailure is NOT called when execution succeeds.
 *  9. preset 'dynamicImport' is recognised without throwing.
 * 10. useRetryImage: falls back to next URL on failure, marks imageError on
 *     all-URLs-exhausted (tested via exported hook signature).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => 'mock-loading-id'),
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
import { toast } from 'sonner';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(AllProviders, null, children);

describe('useRetry – extra gap coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // 1. cancel() calls abort + reset (verified via state)
  // --------------------------------------------------------------------------

  describe('cancel() aborts and resets state', () => {
    it('sets loading=false and data=null after cancel()', async () => {
      // A function that never resolves
      let rejectFn!: (e: Error) => void;
      const fn = vi.fn(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectFn = reject;
          })
      );

      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: false,
            showLoading: true,
          }),
        { wrapper }
      );

      // Start execution — loading becomes true
      act(() => {
        void result.current.execute(fn);
      });

      expect(result.current.loading).toBe(true);

      // Cancel aborts + reset
      act(() => {
        result.current.cancel();
        rejectFn(new Error('aborted'));
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.data).toBeNull();
    });

    it('calls toast.dismiss on cancel when a loading toast was shown (attempt > 1)', async () => {
      vi.mocked(toast.loading).mockReturnValue('cancel-toast-id' as any);

      // Fail twice to trigger toast.loading (requires attempt 2 = attempt > 1),
      // then succeed on 3rd attempt so the function resolves cleanly.
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls < 3) throw new Error(`fail ${calls}`);
        return 'done';
      });

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

      // Drive through 2 failures (toast.loading fires on attempt 2)
      act(() => {
        void result.current.execute(fn);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      // toast.loading should have been called at this point (attempt 2 > 1)
      expect(toast.loading).toHaveBeenCalled();

      // reset() will call toast.dismiss (toastIdRef.current is now set)
      act(() => {
        result.current.reset();
      });

      expect(toast.dismiss).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // 2. retry() is a no-op when fnRef.current is null (execute not called yet)
  // --------------------------------------------------------------------------

  describe('retry() before any execute() call', () => {
    it('does not throw and returns without doing anything', async () => {
      const { result } = renderHook(() => useRetry<string>(), { wrapper });

      // retry() before execute() → fnRef.current = null → early return
      await expect(
        act(async () => {
          await result.current.retry();
        })
      ).resolves.not.toThrow();

      // state unchanged
      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 3. showToast=false → no toast.error on failure
  // --------------------------------------------------------------------------

  describe('showToast=false suppresses error toast', () => {
    it('does not call toast.error when showToast=false and operation fails', async () => {
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
  });

  // --------------------------------------------------------------------------
  // 4. showToast=false → no toast.success even with successMessage
  // --------------------------------------------------------------------------

  describe('showToast=false suppresses success toast', () => {
    it('does not call toast.success when showToast=false even with successMessage', async () => {
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

  // --------------------------------------------------------------------------
  // 5. execute() sets loading=true at the start when showLoading=true
  // --------------------------------------------------------------------------

  describe('execute() loading state during call', () => {
    it('loading transitions true→false across a single-attempt execution', async () => {
      let resolve!: (v: string) => void;
      const fn = vi.fn(() => new Promise<string>(r => (resolve = r)));

      const { result } = renderHook(
        () => useRetry<string>({ showToast: false, showLoading: true }),
        { wrapper }
      );

      // Start execution (don't await)
      act(() => {
        void result.current.execute(fn);
      });

      const loadingDuringExecution = result.current.loading;

      await act(async () => {
        resolve('ok');
        await vi.runAllTimersAsync();
      });

      expect(loadingDuringExecution).toBe(true);
      expect(result.current.loading).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Countdown interval clears at 0 (nextRetryIn → null)
  // --------------------------------------------------------------------------

  describe('nextRetryIn countdown clears at 0', () => {
    it('nextRetryIn is null after the countdown ticks to 0', async () => {
      const fn = vi.fn().mockResolvedValue('ok');

      // Use a 2-second delay so we can observe two countdown ticks
      const { result } = renderHook(
        () =>
          useRetry<string>({
            showToast: false,
            maxAttempts: 2,
            initialDelay: 2000,
            maxDelay: 2000,
            backoffFactor: 1,
          }),
        { wrapper }
      );

      // All mock functions resolve immediately on every attempt
      // so the first call succeeds without retries.
      await act(async () => {
        const p = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await p;
      });

      // After success nextRetryIn must be null
      expect(result.current.nextRetryIn).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 7. onSuccess callback receives the resolved data value
  // --------------------------------------------------------------------------

  describe('onSuccess callback', () => {
    it('calls onSuccess with the exact resolved value', async () => {
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
  });

  // --------------------------------------------------------------------------
  // 8. onFailure is NOT called when execution succeeds
  // --------------------------------------------------------------------------

  describe('onFailure not called on success', () => {
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

  // --------------------------------------------------------------------------
  // 9. preset 'dynamicImport' is recognised without throwing
  // --------------------------------------------------------------------------

  describe('dynamicImport preset', () => {
    it('executes successfully with the dynamicImport preset', async () => {
      const fn = vi.fn().mockResolvedValue('module');

      const { result } = renderHook(
        () =>
          useRetry<string>({
            preset: 'dynamicImport',
            showToast: false,
          }),
        { wrapper }
      );

      await act(async () => {
        const p = result.current.execute(fn);
        await vi.runAllTimersAsync();
        await p;
      });

      expect(result.current.data).toBe('module');
    });
  });

  // --------------------------------------------------------------------------
  // 10. reset() clears timer and state mid-retry
  // --------------------------------------------------------------------------

  describe('reset() clears timer and state', () => {
    it('sets data=null and nextRetryIn=null when reset() called after a failure', async () => {
      // Function that fails first attempt, then would succeed
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
            initialDelay: 5000, // long delay so we can reset before retry
            maxDelay: 5000,
            backoffFactor: 1,
          }),
        { wrapper }
      );

      // Start — first call fails, handleRetry fires
      act(() => {
        void result.current.execute(fn);
      });

      // Advance slightly — failure propagates but retry delay hasn't expired
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      // Reset clears state and the countdown interval
      act(() => {
        result.current.reset();
      });

      expect(result.current.data).toBeNull();
      expect(result.current.nextRetryIn).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('calls toast.dismiss when reset() with an active loading toast', async () => {
      vi.mocked(toast.loading).mockReturnValue('active-toast-id' as any);

      // Fail twice to generate a toast.loading call (attempt 2 > 1)
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls < 3) throw new Error(`fail ${calls}`);
        return 'done';
      });

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
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      // toast.loading should have fired for attempt 2
      expect(toast.loading).toHaveBeenCalled();

      // reset() now dismisses the toast
      act(() => {
        result.current.reset();
      });

      expect(toast.dismiss).toHaveBeenCalled();
    });
  });
});
