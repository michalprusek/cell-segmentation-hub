import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce } from '../useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 500));

    expect(result.current).toBe('initial');
  });

  it('should debounce value changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 500 },
      }
    );

    expect(result.current).toBe('initial');

    // Change value
    rerender({ value: 'updated', delay: 500 });

    // Value should not change immediately
    expect(result.current).toBe('initial');

    // Advance time by less than delay
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('initial');

    // Advance time to complete delay
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('updated');
  });

  it('should cancel previous timeout on rapid value changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 500 },
      }
    );

    // First update
    rerender({ value: 'first', delay: 500 });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('initial');

    // Second update before first completes
    rerender({ value: 'second', delay: 500 });

    // Complete the first delay period
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // Should still be initial because timeout was cancelled
    expect(result.current).toBe('initial');

    // Complete the second delay period
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('second');
  });

  it('should handle different delay values', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 1000 },
      }
    );

    rerender({ value: 'updated', delay: 1000 });

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('updated');

    // Change delay
    rerender({ value: 'new value', delay: 100 });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('new value');
  });

  it('should handle zero delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 0 },
      }
    );

    rerender({ value: 'updated', delay: 0 });

    act(() => {
      vi.runAllTimers();
    });

    expect(result.current).toBe('updated');
  });

  it('should handle complex data types', () => {
    const initialObject = { id: 1, name: 'test' };
    const updatedObject = { id: 2, name: 'updated' };

    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: initialObject, delay: 500 },
      }
    );

    expect(result.current).toEqual(initialObject);

    rerender({ value: updatedObject, delay: 500 });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toEqual(updatedObject);
  });

  it('should handle arrays', () => {
    const initialArray = [1, 2, 3];
    const updatedArray = [4, 5, 6];

    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: initialArray, delay: 300 },
      }
    );

    expect(result.current).toEqual(initialArray);

    rerender({ value: updatedArray, delay: 300 });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toEqual(updatedArray);
  });

  it('should handle null and undefined values', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: null as string | null, delay: 500 },
      }
    );

    expect(result.current).toBeNull();

    rerender({ value: 'defined', delay: 500 });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe('defined');

    rerender({ value: undefined as string | undefined, delay: 500 });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBeUndefined();
  });

  it('should clean up timeout on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const { unmount, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 500 },
      }
    );

    rerender({ value: 'updated', delay: 500 });

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('should handle multiple rapid updates correctly', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 0, delay: 200 },
      }
    );

    // Simulate rapid updates
    for (let i = 1; i <= 5; i++) {
      rerender({ value: i, delay: 200 });
      act(() => {
        vi.advanceTimersByTime(50);
      });
    }

    // Should still be initial value
    expect(result.current).toBe(0);

    // Complete the delay from the last update
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Should have the last value
    expect(result.current).toBe(5);
  });

  it('should handle boolean values', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: false, delay: 300 },
      }
    );

    expect(result.current).toBe(false);

    rerender({ value: true, delay: 300 });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(true);
  });

  // Note: Function values are rarely debounced in practice.
  // The hook correctly stores functions, but testing reference equality
  // with functions can be complex due to React's rendering behavior.

  it('should work with real-world search input scenario', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: '', delay: 300 },
      }
    );

    // User types 't'
    rerender({ value: 't', delay: 300 });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // User types 'te'
    rerender({ value: 'te', delay: 300 });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // User types 'tes'
    rerender({ value: 'tes', delay: 300 });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // User types 'test'
    rerender({ value: 'test', delay: 300 });

    // Still should be initial value
    expect(result.current).toBe('');

    // Complete delay after last input
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Now should have the final value
    expect(result.current).toBe('test');
  });

  it('should handle edge case with negative delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: -100 },
      }
    );

    rerender({ value: 'updated', delay: -100 });

    act(() => {
      vi.runAllTimers();
    });

    // Should work like zero delay
    expect(result.current).toBe('updated');
  });

  it('should handle large delay values', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 10000 },
      }
    );

    rerender({ value: 'updated', delay: 10000 });

    act(() => {
      vi.advanceTimersByTime(9999);
    });
    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('updated');
  });
});
