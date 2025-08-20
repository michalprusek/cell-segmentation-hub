import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  rafSchedule,
  rafThrottle,
  debounce,
  ProgressiveRenderer,
  SpatialIndex,
} from '../performanceUtils';

// Mock requestAnimationFrame and cancelAnimationFrame
const mockRequestAnimationFrame = vi.fn();
const mockCancelAnimationFrame = vi.fn();

Object.defineProperty(global, 'requestAnimationFrame', {
  value: mockRequestAnimationFrame,
  writable: true,
});

Object.defineProperty(global, 'cancelAnimationFrame', {
  value: mockCancelAnimationFrame,
  writable: true,
});

describe('Performance Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Setup RAF to execute immediately for testing
    mockRequestAnimationFrame.mockImplementation(
      (callback: FrameRequestCallback) => {
        const id = Math.random();
        setTimeout(() => callback(performance.now()), 0);
        return id;
      }
    );
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('rafSchedule', () => {
    test('should schedule callback for next frame', async () => {
      const callback = vi.fn();
      const scheduled = rafSchedule(callback);

      scheduled('arg1', 'arg2');

      expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(1);
      expect(callback).not.toHaveBeenCalled();

      // Execute the RAF callback
      vi.runAllTimers();
      await vi.runAllTimersAsync();

      expect(callback).toHaveBeenCalledWith('arg1', 'arg2');
    });

    test('should only schedule once for multiple calls', async () => {
      const callback = vi.fn();
      const scheduled = rafSchedule(callback);

      scheduled('first');
      scheduled('second');
      scheduled('third');

      expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(1);

      vi.runAllTimers();
      await vi.runAllTimersAsync();

      // Should only call with the last arguments
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('third');
    });

    test('should handle callback without arguments', async () => {
      const callback = vi.fn();
      const scheduled = rafSchedule(callback);

      scheduled();

      vi.runAllTimers();
      await vi.runAllTimersAsync();

      expect(callback).toHaveBeenCalledWith();
    });

    test('should allow new scheduling after callback execution', async () => {
      const callback = vi.fn();
      const scheduled = rafSchedule(callback);

      scheduled('first');
      vi.runAllTimers();
      await vi.runAllTimersAsync();

      scheduled('second');
      vi.runAllTimers();
      await vi.runAllTimersAsync();

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenNthCalledWith(1, 'first');
      expect(callback).toHaveBeenNthCalledWith(2, 'second');
    });

    test('should handle complex argument types', async () => {
      const callback = vi.fn();
      const scheduled = rafSchedule(callback);

      const complexArgs = [
        { id: 1, data: [1, 2, 3] },
        new Set([1, 2, 3]),
        null,
        undefined,
        42,
      ];

      scheduled(...complexArgs);

      vi.runAllTimers();
      await vi.runAllTimersAsync();

      expect(callback).toHaveBeenCalledWith(...complexArgs);
    });
  });

  describe('rafThrottle', () => {
    test('should throttle calls based on interval', async () => {
      const callback = vi.fn();
      const { fn: throttled } = rafThrottle(callback, 32); // ~30fps

      // Mock performance.now to simulate time progression for throttling
      let mockTime = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => mockTime);

      throttled('first');
      expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(1);

      // Execute the scheduled callback
      vi.runAllTimers();
      await vi.runAllTimersAsync();

      expect(callback).toHaveBeenCalledWith('first');

      // Simulate time progression within the throttle interval
      mockTime = 16; // Less than 32ms interval

      // Test throttling behavior - additional calls should be throttled
      throttled('second');
      throttled('third');

      // Should still only have the first call
      expect(callback).toHaveBeenCalledTimes(1);

      // Advance time past throttle interval
      mockTime = 40; // More than 32ms interval
      throttled('fourth');

      vi.runAllTimers();
      await vi.runAllTimersAsync();

      expect(callback).toHaveBeenCalledWith('fourth');
      expect(callback).toHaveBeenCalledTimes(2);
    });

    test('should use default 16ms interval', async () => {
      const callback = vi.fn();
      const { fn: throttled } = rafThrottle(callback);

      throttled('test');
      expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(1);

      // Execute the scheduled callback
      vi.runAllTimers();
      await vi.runAllTimersAsync();

      expect(callback).toHaveBeenCalledWith('test');
    });

    test('should cancel scheduled frames', () => {
      const callback = vi.fn();
      const rafId = 123;
      mockRequestAnimationFrame.mockReturnValue(rafId);

      const { fn: throttled, cancel } = rafThrottle(callback);

      throttled('test');
      expect(mockRequestAnimationFrame).toHaveBeenCalledWith(
        expect.any(Function)
      );

      cancel();
      expect(mockCancelAnimationFrame).toHaveBeenCalledWith(rafId);

      // Subsequent calls after cancel should not execute callback
      vi.runAllTimers();
      expect(callback).not.toHaveBeenCalled();
    });

    test('should handle multiple cancellations safely', () => {
      const callback = vi.fn();
      const { cancel } = rafThrottle(callback);

      cancel();
      cancel(); // Should not throw

      expect(mockCancelAnimationFrame).toHaveBeenCalledTimes(0); // No RAF was scheduled
    });

    test('should reset state after cancellation', () => {
      const callback = vi.fn();
      const { fn: throttled, cancel } = rafThrottle(callback);

      throttled('before-cancel');
      cancel();

      // Should be able to schedule new RAF after cancellation
      throttled('after-cancel');
      expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(2);
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

  describe('SpatialIndex', () => {
    let spatialIndex: SpatialIndex;

    beforeEach(() => {
      spatialIndex = new SpatialIndex();
    });

    test('should update points and create sorted arrays', () => {
      const points = [
        { x: 5, y: 3 },
        { x: 1, y: 7 },
        { x: 9, y: 2 },
        { x: 3, y: 8 },
      ];

      spatialIndex.updatePoints(points);

      // Test by calling getVisibleIndices which uses the sorted arrays
      const visible = spatialIndex.getVisibleIndices(0, 0, 10, 10, 0);
      expect(visible).toContain(0);
      expect(visible).toContain(1);
      expect(visible).toContain(2);
      expect(visible).toContain(3);
    });

    test('should return correct visible indices for viewport', () => {
      const points = [
        { x: 0, y: 0 }, // index 0 - should be visible
        { x: 5, y: 5 }, // index 1 - should be visible
        { x: 15, y: 15 }, // index 2 - should not be visible
        { x: 8, y: 3 }, // index 3 - should be visible
        { x: -5, y: 2 }, // index 4 - should not be visible
      ];

      spatialIndex.updatePoints(points);

      const visible = spatialIndex.getVisibleIndices(0, 0, 10, 10, 0);

      expect(visible).toContain(0);
      expect(visible).toContain(1);
      expect(visible).toContain(3);
      expect(visible).not.toContain(2);
      expect(visible).not.toContain(4);
    });

    test('should use buffer to include nearby points', () => {
      const points = [
        { x: 12, y: 5 }, // index 0 - outside viewport but within buffer
        { x: 5, y: 5 }, // index 1 - inside viewport
        { x: 20, y: 5 }, // index 2 - outside viewport and buffer
      ];

      spatialIndex.updatePoints(points);

      const visible = spatialIndex.getVisibleIndices(0, 0, 10, 10, 5);

      expect(visible).toContain(0); // Within buffer
      expect(visible).toContain(1); // Within viewport
      expect(visible).not.toContain(2); // Outside buffer
    });

    test('should handle empty points array', () => {
      spatialIndex.updatePoints([]);

      const visible = spatialIndex.getVisibleIndices(0, 0, 10, 10);
      expect(visible).toEqual([]);
    });

    test('should handle single point', () => {
      spatialIndex.updatePoints([{ x: 5, y: 5 }]);

      const visible = spatialIndex.getVisibleIndices(0, 0, 10, 10);
      expect(visible).toEqual([0]);
    });

    test('should handle points outside viewport', () => {
      const points = [
        { x: -10, y: -10 },
        { x: 20, y: 20 },
        { x: -5, y: 15 },
        { x: 15, y: -5 },
      ];

      spatialIndex.updatePoints(points);

      const visible = spatialIndex.getVisibleIndices(0, 0, 10, 10, 0);
      expect(visible).toEqual([]);
    });

    test('should use default buffer value', () => {
      const points = [
        { x: -30, y: 5 }, // Outside default buffer of 50
        { x: 40, y: 5 }, // Within default buffer of 50
        { x: 5, y: 5 }, // Within viewport
      ];

      spatialIndex.updatePoints(points);

      const visible = spatialIndex.getVisibleIndices(0, 0, 10, 10);

      expect(visible).toContain(1); // Within buffer
      expect(visible).toContain(2); // Within viewport
      expect(visible).not.toContain(0); // Outside buffer
    });

    test('should handle edge cases with viewport boundaries', () => {
      const points = [
        { x: 0, y: 0 }, // Exactly on viewport boundary
        { x: 10, y: 10 }, // Exactly on viewport boundary
        { x: 5, y: 0 }, // On edge
        { x: 0, y: 5 }, // On edge
      ];

      spatialIndex.updatePoints(points);

      const visible = spatialIndex.getVisibleIndices(0, 0, 10, 10, 0);
      expect(visible).toContain(0);
      expect(visible).toContain(1);
      expect(visible).toContain(2);
      expect(visible).toContain(3);
    });

    test('should handle points with same coordinates', () => {
      const points = [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ];

      spatialIndex.updatePoints(points);

      const visible = spatialIndex.getVisibleIndices(0, 0, 10, 10);
      expect(visible).toContain(0);
      expect(visible).toContain(1);
      expect(visible).toContain(2);
      expect(visible).toHaveLength(3);
    });

    test('should maintain correct indices after multiple updates', () => {
      // First update
      spatialIndex.updatePoints([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]);

      let visible = spatialIndex.getVisibleIndices(0, 0, 5, 5);
      expect(visible).toEqual([0, 1]);

      // Second update with different points
      spatialIndex.updatePoints([
        { x: 10, y: 10 }, // Now index 0, but outside viewport
        { x: 3, y: 3 }, // Now index 1, inside viewport
      ]);

      visible = spatialIndex.getVisibleIndices(0, 0, 5, 5);
      expect(visible).toEqual([1]);
      expect(visible).not.toContain(0);
    });

    test('should handle large datasets efficiently', () => {
      // Generate many points
      const points = Array.from({ length: 1000 }, (_, i) => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
      }));

      const startTime = performance.now();
      spatialIndex.updatePoints(points);
      const visible = spatialIndex.getVisibleIndices(25, 25, 50, 50);
      const endTime = performance.now();

      // Should complete within reasonable time (adjust as needed)
      expect(endTime - startTime).toBeLessThan(50);
      expect(Array.isArray(visible)).toBe(true);
    });

    test('should handle negative coordinates correctly', () => {
      const points = [
        { x: -5, y: -5 },
        { x: -2, y: 2 },
        { x: 2, y: -2 },
        { x: 5, y: 5 },
      ];

      spatialIndex.updatePoints(points);

      const visible = spatialIndex.getVisibleIndices(-3, -3, 6, 6);
      expect(visible).toContain(1); // x: -2, y: 2
      expect(visible).toContain(2); // x: 2, y: -2
    });

    test('should handle floating point coordinates', () => {
      const points = [
        { x: 1.5, y: 2.7 },
        { x: 3.14, y: 4.2 },
        { x: 8.9, y: 9.1 },
      ];

      spatialIndex.updatePoints(points);

      const visible = spatialIndex.getVisibleIndices(0, 0, 5, 5);
      expect(visible).toContain(0);
      expect(visible).toContain(1);
      expect(visible).not.toContain(2);
    });
  });

  describe('Integration Tests', () => {
    test('should work with ProgressiveRenderer and rafSchedule together', async () => {
      const onStart = vi.fn();
      const onEnd = vi.fn();
      const renderer = new ProgressiveRenderer(onStart, onEnd, 50);

      const updateCallback = vi.fn(() => {
        renderer.startAnimation();
      });

      const scheduledUpdate = rafSchedule(updateCallback);

      // Trigger updates
      scheduledUpdate();
      scheduledUpdate();
      scheduledUpdate();

      vi.runAllTimers();
      await vi.runAllTimersAsync();

      expect(updateCallback).toHaveBeenCalledTimes(1);
      expect(onStart).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(50);
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    test('should combine rafThrottle with SpatialIndex for optimized viewport updates', () => {
      const spatialIndex = new SpatialIndex();
      const points = Array.from({ length: 100 }, (_, i) => ({
        x: i % 10,
        y: Math.floor(i / 10),
      }));

      spatialIndex.updatePoints(points);

      const viewportUpdate = vi.fn();
      const { fn: throttledViewportUpdate } = rafThrottle(viewportUpdate, 16);

      mockRequestAnimationFrame.mockImplementation(
        (callback: FrameRequestCallback) => {
          // Use setTimeout to properly simulate async RAF behavior
          const id = Math.floor(Math.random() * 1000) + 1;
          setTimeout(() => {
            callback(performance.now());
          }, 16);
          return id;
        }
      );

      throttledViewportUpdate();
      expect(viewportUpdate).toHaveBeenCalled();
    });

    test('should handle complex performance optimization scenario', () => {
      const spatialIndex = new SpatialIndex();
      const renderer = new ProgressiveRenderer(vi.fn(), vi.fn(), 30);

      const points = [
        { x: 2, y: 3 },
        { x: 7, y: 8 },
        { x: 15, y: 12 },
      ];

      spatialIndex.updatePoints(points);

      const optimizedUpdate = rafSchedule((viewport: any) => {
        renderer.startAnimation();
        const visible = spatialIndex.getVisibleIndices(
          viewport.x,
          viewport.y,
          viewport.width,
          viewport.height
        );
        return visible;
      });

      const viewport = { x: 0, y: 0, width: 10, height: 10 };
      const result = optimizedUpdate(viewport);

      expect(mockRequestAnimationFrame).toHaveBeenCalledTimes(1);
      expect(renderer.isInProgress).toBe(true);
      expect(result).toBeDefined();
      expect(typeof optimizedUpdate).toBe('function');
    });
  });
});
