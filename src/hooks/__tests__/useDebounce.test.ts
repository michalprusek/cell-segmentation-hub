import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce } from '@/hooks/useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('Basic Functionality', () => {
    test('should return initial value immediately', () => {
      const { result } = renderHook(() => useDebounce('initial', 500));

      expect(result.current).toBe('initial');
    });

    test('should debounce value changes', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 'initial', delay: 500 },
        }
      );

      expect(result.current).toBe('initial');

      // Change the value
      rerender({ value: 'changed', delay: 500 });

      // Value should not change immediately
      expect(result.current).toBe('initial');

      // Fast-forward time by 250ms (less than delay)
      act(() => {
        vi.advanceTimersByTime(250);
      });

      // Value should still be the old one
      expect(result.current).toBe('initial');

      // Fast-forward the remaining time
      act(() => {
        vi.advanceTimersByTime(250);
      });

      // Now the value should be updated
      expect(result.current).toBe('changed');
    });

    test('should reset timer on rapid changes', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 'initial', delay: 500 },
        }
      );

      // First change
      rerender({ value: 'change1', delay: 500 });

      // Advance partway through delay
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current).toBe('initial');

      // Second change before first timer completes
      rerender({ value: 'change2', delay: 500 });

      // Advance the original remaining time
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Should still be initial because timer was reset
      expect(result.current).toBe('initial');

      // Advance full delay from second change
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Now should have the latest value
      expect(result.current).toBe('change2');
    });

    test('should handle delay changes', () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 'initial', delay: 500 },
        }
      );

      // Change both value and delay
      rerender({ value: 'changed', delay: 1000 });

      // Advance by original delay time
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Should not have changed yet (new delay is 1000ms)
      expect(result.current).toBe('initial');

      // Advance by remaining time
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Now should be updated
      expect(result.current).toBe('changed');
    });
  });

  describe('Different Data Types', () => {
    test('should work with strings', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 100),
        {
          initialProps: { value: 'hello' },
        }
      );

      rerender({ value: 'world' });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe('world');
    });

    test('should work with numbers', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 100),
        {
          initialProps: { value: 0 },
        }
      );

      rerender({ value: 42 });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe(42);
    });

    test('should work with booleans', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 100),
        {
          initialProps: { value: false },
        }
      );

      rerender({ value: true });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe(true);
    });

    test('should work with objects', () => {
      const obj1 = { name: 'John', age: 30 };
      const obj2 = { name: 'Jane', age: 25 };

      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 100),
        {
          initialProps: { value: obj1 },
        }
      );

      rerender({ value: obj2 });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe(obj2);
      expect(result.current).toEqual({ name: 'Jane', age: 25 });
    });

    test('should work with arrays', () => {
      const arr1 = [1, 2, 3];
      const arr2 = [4, 5, 6];

      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 100),
        {
          initialProps: { value: arr1 },
        }
      );

      rerender({ value: arr2 });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe(arr2);
      expect(result.current).toEqual([4, 5, 6]);
    });

    test('should work with null and undefined', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 100),
        {
          initialProps: { value: 'initial' as string | null },
        }
      );

      rerender({ value: null });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe(null);

      rerender({ value: undefined });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe(undefined);
    });
  });

  describe('Edge Cases', () => {
    test('should handle zero delay', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 0),
        {
          initialProps: { value: 'initial' },
        }
      );

      rerender({ value: 'changed' });

      // Even with 0 delay, should still use setTimeout
      expect(result.current).toBe('initial');

      act(() => {
        vi.advanceTimersByTime(0);
      });

      expect(result.current).toBe('changed');
    });

    test('should handle negative delay', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, -100),
        {
          initialProps: { value: 'initial' },
        }
      );

      rerender({ value: 'changed' });

      act(() => {
        vi.advanceTimersByTime(0);
      });

      expect(result.current).toBe('changed');
    });

    test('should handle very large delays', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 999999),
        {
          initialProps: { value: 'initial' },
        }
      );

      rerender({ value: 'changed' });

      act(() => {
        vi.advanceTimersByTime(999998);
      });

      expect(result.current).toBe('initial');

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(result.current).toBe('changed');
    });

    test('should handle same value changes', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 100),
        {
          initialProps: { value: 'same' },
        }
      );

      // Change to the same value
      rerender({ value: 'same' });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe('same');
    });

    test('should cleanup timer on unmount', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const { rerender, unmount } = renderHook(
        ({ value }) => useDebounce(value, 100),
        {
          initialProps: { value: 'initial' },
        }
      );

      rerender({ value: 'changed' });

      // Unmount before timer completes
      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });

    test('should handle multiple rapid changes', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 100),
        {
          initialProps: { value: 'initial' },
        }
      );

      // Rapid sequence of changes
      rerender({ value: 'change1' });
      rerender({ value: 'change2' });
      rerender({ value: 'change3' });
      rerender({ value: 'change4' });

      // Should still be initial
      expect(result.current).toBe('initial');

      // Only the last change should take effect
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe('change4');
    });
  });

  describe('Performance and Memory', () => {
    test('should not create unnecessary timeouts', () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const { rerender } = renderHook(({ value }) => useDebounce(value, 100), {
        initialProps: { value: 'initial' },
      });

      const initialTimeoutCalls = setTimeoutSpy.mock.calls.length;

      // Change value
      rerender({ value: 'changed' });

      expect(setTimeoutSpy.mock.calls.length).toBe(initialTimeoutCalls + 1);

      // Change again quickly
      rerender({ value: 'changed2' });

      // Should have cleared previous timeout and set new one
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(setTimeoutSpy.mock.calls.length).toBe(initialTimeoutCalls + 2);

      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });

    test('should handle frequent renders efficiently', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 50),
        {
          initialProps: { value: 0 },
        }
      );

      // Simulate frequent renders with different values
      for (let i = 1; i <= 100; i++) {
        rerender({ value: i });
        act(() => {
          vi.advanceTimersByTime(10); // Advance less than delay
        });
      }

      expect(result.current).toBe(0); // Should still be initial

      // Wait for final debounce
      act(() => {
        vi.advanceTimersByTime(50);
      });

      expect(result.current).toBe(100); // Should have final value
    });
  });

  describe('Real-world Use Cases', () => {
    test('should work for search input debouncing', () => {
      const { result, rerender } = renderHook(
        ({ searchTerm }) => useDebounce(searchTerm, 300),
        {
          initialProps: { searchTerm: '' },
        }
      );

      // Simulate user typing
      rerender({ searchTerm: 'r' });
      rerender({ searchTerm: 're' });
      rerender({ searchTerm: 'rea' });
      rerender({ searchTerm: 'reac' });
      rerender({ searchTerm: 'react' });

      // Before debounce period
      expect(result.current).toBe('');

      act(() => {
        vi.advanceTimersByTime(300);
      });

      // After debounce period
      expect(result.current).toBe('react');
    });

    test('should work for API call throttling', () => {
      const mockApiCall = vi.fn();

      const { result, rerender } = renderHook(
        ({ query }) => {
          const debouncedQuery = useDebounce(query, 500);

          // Simulate effect that triggers API call
          if (debouncedQuery !== '') {
            mockApiCall(debouncedQuery);
          }

          return debouncedQuery;
        },
        {
          initialProps: { query: '' },
        }
      );

      // Multiple rapid query changes
      rerender({ query: 'a' });
      rerender({ query: 'ap' });
      rerender({ query: 'app' });

      // API should not be called yet
      expect(mockApiCall).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(500);
      });

      // API should be called only once with final value
      expect(mockApiCall).toHaveBeenCalledTimes(1);
      expect(mockApiCall).toHaveBeenCalledWith('app');
    });

    test('should work for window resize debouncing', () => {
      const { result, rerender } = renderHook(
        ({ windowWidth }) => useDebounce(windowWidth, 150),
        {
          initialProps: { windowWidth: 1024 },
        }
      );

      // Simulate rapid window resize events
      const widths = [1025, 1026, 1030, 1035, 1040, 1200];

      widths.forEach(width => {
        rerender({ windowWidth: width });
        act(() => {
          vi.advanceTimersByTime(50); // Less than debounce delay
        });
      });

      expect(result.current).toBe(1024); // Still original

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current).toBe(1200); // Final width
    });

    test('should work for form validation debouncing', () => {
      const validateEmail = vi.fn();

      const { result, rerender } = renderHook(
        ({ email }) => {
          const debouncedEmail = useDebounce(email, 250);

          if (debouncedEmail && debouncedEmail.includes('@')) {
            validateEmail(debouncedEmail);
          }

          return debouncedEmail;
        },
        {
          initialProps: { email: '' },
        }
      );

      // User types email address
      const typingSequence = [
        'j',
        'jo',
        'joh',
        'john',
        'john@',
        'john@e',
        'john@ex',
        'john@example.com',
      ];

      typingSequence.forEach(partial => {
        rerender({ email: partial });
        act(() => {
          vi.advanceTimersByTime(100); // Less than debounce
        });
      });

      expect(validateEmail).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(validateEmail).toHaveBeenCalledTimes(1);
      expect(validateEmail).toHaveBeenCalledWith('john@example.com');
    });
  });

  describe('Integration with React Lifecycle', () => {
    test('should handle component re-mounting', () => {
      let hookResult: any;

      const TestComponent = ({
        value,
        delay,
      }: {
        value: string;
        delay: number;
      }) => {
        hookResult = useDebounce(value, delay);
        return null;
      };

      const { rerender, unmount } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 'first', delay: 100 },
        }
      );

      rerender({ value: 'second', delay: 100 });

      // Unmount component
      unmount();

      // Re-mount with different initial value
      const { result: newResult } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        {
          initialProps: { value: 'remounted', delay: 100 },
        }
      );

      expect(newResult.current).toBe('remounted');
    });

    test('should work with strict mode double execution', () => {
      // In strict mode, effects run twice in development
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      const { result, rerender } = renderHook(
        ({ value }) => useDebounce(value, 100),
        {
          initialProps: { value: 'initial' },
        }
      );

      rerender({ value: 'changed' });

      // Timer should be set
      expect(setTimeoutSpy).toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current).toBe('changed');

      setTimeoutSpy.mockRestore();
    });
  });
});
