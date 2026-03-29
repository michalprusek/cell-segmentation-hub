import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, throttle } from '@/lib/debounce';

describe('debounce', () => {
  beforeEach(() => {
    // Fake timers also mock Date.now(), which debounce relies on internally
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic trailing-edge behaviour (default)', () => {
    it('delays function execution by the specified wait time', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 200);

      debounced();
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(199);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1); // total 200 ms
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('executes only the last call within the delay window', () => {
      const fn = vi.fn((...args: any[]) => args);
      const debounced = debounce(fn, 100);

      debounced('first');
      vi.advanceTimersByTime(50);
      debounced('second');
      vi.advanceTimersByTime(50);
      debounced('third');

      vi.advanceTimersByTime(100); // wait expires after third call
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('third');
    });

    it('resets the timer on every subsequent call within the delay', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      vi.advanceTimersByTime(80);
      debounced(); // resets timer
      vi.advanceTimersByTime(80);
      // Only 80 ms since last call — should not have fired yet
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(20); // total 100 ms since second call
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('executes again after the wait period if called again later', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);

      debounced();
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('cancel()', () => {
    it('prevents the pending call from executing', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 200);

      debounced();
      vi.advanceTimersByTime(100);
      debounced.cancel();

      vi.advanceTimersByTime(200); // past the original deadline
      expect(fn).not.toHaveBeenCalled();
    });

    it('allows a fresh call to be scheduled after cancel', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      debounced.cancel();

      debounced(); // new call
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('flush()', () => {
    it('immediately invokes the pending call', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 500);

      debounced();
      expect(fn).not.toHaveBeenCalled();

      debounced.flush();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns undefined when there is no pending call', () => {
      const fn = vi.fn(() => 42);
      const debounced = debounce(fn, 100);

      const result = debounced.flush(); // nothing pending
      expect(result).toBeUndefined();
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('leading-edge option', () => {
    it('executes immediately on the first call when leading=true', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100, { leading: true, trailing: false });

      debounced();
      expect(fn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1); // trailing is off, no second call
    });

    it('does not call again during the wait window with leading+no-trailing', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100, { leading: true, trailing: false });

      debounced();
      debounced(); // within wait — should be suppressed
      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('maxWait option', () => {
    it('forces execution when maxWait is exceeded even if calls keep coming', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100, { maxWait: 200 });

      // Keep calling every 50 ms — normally would never fire without maxWait
      debounced();
      vi.advanceTimersByTime(50);
      debounced();
      vi.advanceTimersByTime(50);
      debounced();
      vi.advanceTimersByTime(50);
      debounced();
      vi.advanceTimersByTime(50); // 200 ms elapsed since first call

      // maxWait of 200 ms has been reached, so fn should have been called
      expect(fn).toHaveBeenCalled();
    });
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes on the leading edge by default', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ignores calls within the wait window after leading invocation', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    throttled(); // within wait
    throttled(); // within wait
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires again after the wait window has elapsed', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    vi.advanceTimersByTime(100);
    throttled();

    // The trailing call after first + the second leading call
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
