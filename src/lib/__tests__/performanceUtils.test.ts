import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  rafThrottle,
  debounce,
  ProgressiveRenderer,
} from '../performanceUtils';

describe('Performance Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock RAF and cancel RAF properly
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = Math.floor(Math.random() * 1000) + 1;
        setTimeout(() => callback(performance.now()), 16);
        return id;
      })
    );

    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('rafThrottle', () => {
    test('should throttle calls based on interval', async () => {
      const callback = vi.fn();
      const { fn: throttled } = rafThrottle(callback, 32); // ~30fps

      // With fake timers, performance.now() starts at 0. Advance time past the
      // interval so that the currentTime check (currentTime - lastTime >= 32)
      // passes when the RAF callback fires.
      vi.advanceTimersByTime(100); // advance past 32ms interval

      // Override RAF to execute callback immediately for this test
      vi.mocked(global.requestAnimationFrame).mockImplementation(
        (cb: FrameRequestCallback) => {
          cb(performance.now()); // performance.now() is now ≥ 100
          return 1;
        }
      );

      throttled('first');
      expect(global.requestAnimationFrame).toHaveBeenCalledTimes(1);

      // Test multiple rapid calls - should be throttled based on interval
      throttled('second');
      throttled('third');

      // Verify throttling is working (callback called but not excessively)
      expect(callback).toHaveBeenCalledWith('first');
      expect(callback.mock.calls.length).toBeLessThanOrEqual(2);
    });

    test('should use default 16ms interval', async () => {
      const callback = vi.fn();
      const { fn: throttled } = rafThrottle(callback);

      throttled('test');
      expect(global.requestAnimationFrame).toHaveBeenCalledTimes(1);

      // Execute the scheduled callback
      vi.runAllTimers();
      await vi.runAllTimersAsync();

      expect(callback).toHaveBeenCalledWith('test');
    });

    test('should cancel scheduled frames', () => {
      const callback = vi.fn();
      const rafId = 123;
      vi.mocked(global.requestAnimationFrame).mockReturnValue(rafId);

      const { fn: throttled, cancel } = rafThrottle(callback);

      throttled('test');
      expect(global.requestAnimationFrame).toHaveBeenCalledWith(
        expect.any(Function)
      );

      cancel();
      expect(global.cancelAnimationFrame).toHaveBeenCalledWith(rafId);

      // Subsequent calls after cancel should not execute callback
      vi.runAllTimers();
      expect(callback).not.toHaveBeenCalled();
    });

    test('should handle multiple cancellations safely', () => {
      const callback = vi.fn();
      const { cancel } = rafThrottle(callback);

      cancel();
      cancel(); // Should not throw

      expect(global.cancelAnimationFrame).toHaveBeenCalledTimes(0); // No RAF was scheduled
    });

    test('should reset state after cancellation', () => {
      const callback = vi.fn();
      const { fn: throttled, cancel } = rafThrottle(callback);

      throttled('before-cancel');
      cancel();

      // Should be able to schedule new RAF after cancellation
      throttled('after-cancel');
      expect(global.requestAnimationFrame).toHaveBeenCalledTimes(2);
    });

    // `src/test/setup.ts` mocks rAF as `setTimeout(callback, 16)` — no
    // timestamp. `undefined - lastTime` is NaN, which is never `>= interval`,
    // so with the re-arm below the throttle scheduled a frame every 16 ms for
    // ever and never delivered: 25 frames and 0 calls in 400 ms. Under fake
    // timers that is an infinite loop, which is how this fails when broken.
    test('delivers, and stops, when the frame carries no timestamp', () => {
      vi.mocked(global.requestAnimationFrame).mockImplementation(
        (cb: FrameRequestCallback) => {
          setTimeout(cb as () => void, 16);
          return 1;
        }
      );
      const callback = vi.fn();
      const { fn: throttled } = rafThrottle(callback, 16);

      vi.advanceTimersByTime(100); // the clock is past the first interval
      throttled('only');
      vi.advanceTimersByTime(400);

      expect(callback.mock.calls).toEqual([['only']]);
      // One frame for one call; nothing left armed.
      expect(global.requestAnimationFrame).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    // A 120 Hz display: frames 8 ms apart against the 16 ms interval. The
    // frame that arrives too early used to clear its handle and return, so
    // the last call of a burst sat in `lastArgs` until some LATER call
    // happened to schedule again — for the final event of a gesture, never.
    test('delivers the trailing call when a frame arrives before the interval', () => {
      const frames: FrameRequestCallback[] = [];
      vi.mocked(global.requestAnimationFrame).mockImplementation(
        (cb: FrameRequestCallback) => {
          frames.push(cb);
          return frames.length;
        }
      );
      const tick = (now: number) => {
        const due = frames.splice(0);
        due.forEach(cb => cb(now));
      };
      const callback = vi.fn();
      const { fn: throttled } = rafThrottle(callback, 16);

      throttled('a');
      tick(100); // 100 ms since "last" (0): delivered
      expect(callback.mock.calls).toEqual([['a']]);

      throttled('b');
      tick(108); // only 8 ms later: too early, must re-arm
      expect(callback.mock.calls).toEqual([['a']]);
      expect(frames).toHaveLength(1);

      tick(116); // no further call was made — 'b' still has to arrive
      expect(callback.mock.calls).toEqual([['a'], ['b']]);
      expect(frames).toHaveLength(0);
    });

    test('keeps only the newest arguments while it waits', () => {
      const frames: FrameRequestCallback[] = [];
      vi.mocked(global.requestAnimationFrame).mockImplementation(
        (cb: FrameRequestCallback) => {
          frames.push(cb);
          return frames.length;
        }
      );
      const callback = vi.fn();
      const { fn: throttled } = rafThrottle(callback, 16);

      throttled('a');
      throttled('b');
      throttled('c');
      expect(frames).toHaveLength(1);
      frames.splice(0).forEach(cb => cb(100));
      expect(callback.mock.calls).toEqual([['c']]);
    });
  });

  describe('debounce', () => {
    test('should delay callback execution', () => {
      const callback = vi.fn();
      const debounced = debounce(callback, 100);

      debounced('test');
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledWith('test');
    });

    test('should reset timer on subsequent calls', () => {
      const callback = vi.fn();
      const debounced = debounce(callback, 100);

      debounced('first');
      vi.advanceTimersByTime(50);

      debounced('second');
      vi.advanceTimersByTime(50);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(callback).toHaveBeenCalledWith('second');
      expect(callback).toHaveBeenCalledTimes(1);
    });

    test('should support manual cancellation', () => {
      const callback = vi.fn();
      const debounced = debounce(callback, 100);

      debounced('test');
      debounced.cancel();

      vi.advanceTimersByTime(100);
      expect(callback).not.toHaveBeenCalled();
    });

    test('should work with multiple arguments', () => {
      const callback = vi.fn();
      const debounced = debounce(callback, 100);

      debounced('arg1', 42, { key: 'value' });

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledWith('arg1', 42, { key: 'value' });
    });

    test('should handle cancellation of non-existent timeout', () => {
      const callback = vi.fn();
      const debounced = debounce(callback, 100);

      // Cancel without any pending timeout
      debounced.cancel();

      // Should still work normally after
      debounced('test');
      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledWith('test');
    });
  });

  describe('ProgressiveRenderer', () => {
    test('should call onAnimationStart when starting animation', () => {
      const onStart = vi.fn();
      const onEnd = vi.fn();
      const renderer = new ProgressiveRenderer(onStart, onEnd);

      renderer.startAnimation();
      expect(onStart).toHaveBeenCalledTimes(1);
      expect(renderer.isInProgress).toBe(true);
    });

    test('should not call onAnimationStart multiple times for ongoing animation', () => {
      const onStart = vi.fn();
      const onEnd = vi.fn();
      const renderer = new ProgressiveRenderer(onStart, onEnd);

      renderer.startAnimation();
      renderer.startAnimation();
      renderer.startAnimation();

      expect(onStart).toHaveBeenCalledTimes(1);
    });

    test('should call onAnimationEnd after debounce period', () => {
      const onStart = vi.fn();
      const onEnd = vi.fn();
      const renderer = new ProgressiveRenderer(onStart, onEnd, 50);

      renderer.startAnimation();
      expect(onEnd).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(renderer.isInProgress).toBe(false);
    });

    test('should reset debounce timer on additional startAnimation calls', () => {
      const onStart = vi.fn();
      const onEnd = vi.fn();
      const renderer = new ProgressiveRenderer(onStart, onEnd, 100);

      renderer.startAnimation();
      vi.advanceTimersByTime(50);

      renderer.startAnimation(); // Reset timer
      vi.advanceTimersByTime(50);
      expect(onEnd).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    test('should handle missing callbacks gracefully', () => {
      const renderer = new ProgressiveRenderer();

      // Should not throw
      renderer.startAnimation();
      vi.advanceTimersByTime(100);

      expect(renderer.isInProgress).toBe(false);
    });

    test('should dispose properly and prevent memory leaks', () => {
      const onStart = vi.fn();
      const onEnd = vi.fn();
      const renderer = new ProgressiveRenderer(onStart, onEnd, 100);

      renderer.startAnimation();
      renderer.dispose();

      vi.advanceTimersByTime(100);
      expect(onEnd).not.toHaveBeenCalled();

      // Should not crash after disposal
      renderer.startAnimation();
    });

    test('should use default debounce time', () => {
      const onStart = vi.fn();
      const onEnd = vi.fn();
      const renderer = new ProgressiveRenderer(onStart, onEnd);

      renderer.startAnimation();
      vi.advanceTimersByTime(100); // Default is 100ms

      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    test('should track animation state correctly', () => {
      const renderer = new ProgressiveRenderer();

      expect(renderer.isInProgress).toBe(false);

      renderer.startAnimation();
      expect(renderer.isInProgress).toBe(true);

      vi.advanceTimersByTime(100);
      expect(renderer.isInProgress).toBe(false);
    });
  });
});
