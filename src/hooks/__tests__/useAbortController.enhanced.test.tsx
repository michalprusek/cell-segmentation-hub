/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

import { cancelTestUtils } from '@/test-utils/cancelTestHelpers';

/**
 * Enhanced AbortController Hook (TDD - to be implemented)
 * Integrates with operation manager for multi-operation abort scenarios
 */
interface UseAbortControllerOptions {
  onAbort?: (reason?: any) => void;
  timeout?: number;
  operationId?: string;
  operationType?: 'upload' | 'segmentation' | 'export';
}

interface UseAbortControllerReturn {
  signal: AbortSignal;
  abort: (reason?: any) => void;
  isAborted: boolean;
  createChildController: () => AbortController;
  combine: (signals: AbortSignal[]) => AbortSignal;
  withTimeout: (ms: number) => AbortSignal;
  reset: () => void;
}

const useAbortController = (
  options: UseAbortControllerOptions = {}
): UseAbortControllerReturn => {
  const { onAbort, timeout, operationId: _operationId, operationType: _operationType } = options;

  const [controller, setController] = React.useState(
    () => new AbortController()
  );
  const [isAborted, setIsAborted] = React.useState(false);
  const childControllersRef = React.useRef<Set<AbortController>>(new Set());
  const timeoutRef = React.useRef<NodeJS.Timeout>();

  // Setup timeout if specified
  React.useEffect(() => {
    if (timeout && timeout > 0) {
      timeoutRef.current = setTimeout(() => {
        abort('Timeout');
      }, timeout);

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    }
  }, [timeout, abort]);

  // Setup abort listener
  React.useEffect(() => {
    const handleAbort = () => {
      setIsAborted(true);
      onAbort?.(controller.signal.reason);

      // Abort all child controllers
      childControllersRef.current.forEach(childController => {
        if (!childController.signal.aborted) {
          childController.abort(controller.signal.reason);
        }
      });
    };

    controller.signal.addEventListener('abort', handleAbort);

    return () => {
      controller.signal.removeEventListener('abort', handleAbort);
    };
  }, [controller, onAbort]);

  const abort = React.useCallback(
    (reason?: any) => {
      if (!controller.signal.aborted) {
        controller.abort(reason);

        // Clear timeout if exists
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = undefined;
        }
      }
    },
    [controller]
  );

  const createChildController = React.useCallback(() => {
    const childController = new AbortController();

    // If parent is already aborted, abort child immediately
    if (controller.signal.aborted) {
      childController.abort(controller.signal.reason);
    } else {
      // Add to tracking set
      childControllersRef.current.add(childController);

      // Clean up when child is aborted
      const cleanup = () => {
        childControllersRef.current.delete(childController);
      };

      childController.signal.addEventListener('abort', cleanup, { once: true });
    }

    return childController;
  }, [controller]);

  const combine = React.useCallback(
    (signals: AbortSignal[]): AbortSignal => {
      const combinedController = new AbortController();

      const abortCombined = (reason?: any) => {
        if (!combinedController.signal.aborted) {
          combinedController.abort(reason);
        }
      };

      // Add current signal to the list
      const allSignals = [controller.signal, ...signals];

      // Listen to all signals
      allSignals.forEach(signal => {
        if (signal.aborted) {
          abortCombined(signal.reason);
        } else {
          signal.addEventListener('abort', () => abortCombined(signal.reason), {
            once: true,
          });
        }
      });

      return combinedController.signal;
    },
    [controller]
  );

  const withTimeout = React.useCallback(
    (ms: number): AbortSignal => {
      const timeoutController = new AbortController();

      // If parent is already aborted, abort immediately
      if (controller.signal.aborted) {
        timeoutController.abort(controller.signal.reason);
        return timeoutController.signal;
      }

      // Setup timeout
      const timeoutId = setTimeout(() => {
        timeoutController.abort('Timeout after ' + ms + 'ms');
      }, ms);

      // Listen to parent abort
      const parentAbortHandler = () => {
        clearTimeout(timeoutId);
        timeoutController.abort(controller.signal.reason);
      };

      controller.signal.addEventListener('abort', parentAbortHandler, {
        once: true,
      });

      // Cleanup on timeout controller abort
      timeoutController.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeoutId);
          controller.signal.removeEventListener('abort', parentAbortHandler);
        },
        { once: true }
      );

      return timeoutController.signal;
    },
    [controller]
  );

  const reset = React.useCallback(() => {
    // Abort current controller if not already aborted
    if (!controller.signal.aborted) {
      controller.abort('Reset');
    }

    // Clear timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }

    // Clear child controllers
    childControllersRef.current.clear();

    // Create new controller
    const newController = new AbortController();
    setController(newController);
    setIsAborted(false);
  }, [controller]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (!controller.signal.aborted) {
        controller.abort('Component unmounted');
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Cleanup all child controllers
      childControllersRef.current.forEach(childController => {
        if (!childController.signal.aborted) {
          childController.abort('Parent component unmounted');
        }
      });
    };
  }, [controller]);

  return {
    signal: controller.signal,
    abort,
    isAborted,
    createChildController,
    combine,
    withTimeout,
    reset,
  };
};

describe('useAbortController Enhanced Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Basic Functionality', () => {
    it('should create AbortController with signal', () => {
      const { result } = renderHook(() => useAbortController());

      expect(result.current.signal).toBeInstanceOf(AbortSignal);
      expect(result.current.isAborted).toBe(false);
      expect(result.current.signal.aborted).toBe(false);
    });

    it('should abort controller when abort is called', () => {
      const onAbort = vi.fn();
      const { result } = renderHook(() => useAbortController({ onAbort }));

      act(() => {
        result.current.abort('Test reason');
      });

      expect(result.current.isAborted).toBe(true);
      expect(result.current.signal.aborted).toBe(true);
      expect(result.current.signal.reason).toBe('Test reason');
      expect(onAbort).toHaveBeenCalledWith('Test reason');
    });

    it('should handle abort without reason', () => {
      const { result } = renderHook(() => useAbortController());

      act(() => {
        result.current.abort();
      });

      expect(result.current.isAborted).toBe(true);
      expect(result.current.signal.aborted).toBe(true);
    });

    it('should not abort twice', () => {
      const onAbort = vi.fn();
      const { result } = renderHook(() => useAbortController({ onAbort }));

      act(() => {
        result.current.abort('First');
        result.current.abort('Second');
      });

      expect(onAbort).toHaveBeenCalledTimes(1);
      expect(onAbort).toHaveBeenCalledWith('First');
    });
  });

  describe('Timeout Functionality', () => {
    it('should abort after timeout', () => {
      const onAbort = vi.fn();
      const { result } = renderHook(() =>
        useAbortController({
          timeout: 1000,
          onAbort,
        })
      );

      expect(result.current.isAborted).toBe(false);

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.isAborted).toBe(true);
      expect(result.current.signal.reason).toBe('Timeout');
      expect(onAbort).toHaveBeenCalledWith('Timeout');
    });

    it('should clear timeout on manual abort', () => {
      const { result } = renderHook(() =>
        useAbortController({ timeout: 1000 })
      );

      act(() => {
        result.current.abort('Manual abort');
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.signal.reason).toBe('Manual abort');
    });

    it('should clear timeout on unmount', () => {
      const { result, unmount } = renderHook(() =>
        useAbortController({ timeout: 1000 })
      );

      expect(result.current.isAborted).toBe(false);

      unmount();

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Should be aborted due to unmount, not timeout
      expect(result.current.signal.reason).toBe('Component unmounted');
    });
  });

  describe('Child Controller Management', () => {
    it('should create child controllers', () => {
      const { result } = renderHook(() => useAbortController());

      act(() => {
        const child1 = result.current.createChildController();
        const child2 = result.current.createChildController();

        expect(child1).toBeInstanceOf(AbortController);
        expect(child2).toBeInstanceOf(AbortController);
        expect(child1).not.toBe(child2);
        expect(child1.signal.aborted).toBe(false);
        expect(child2.signal.aborted).toBe(false);
      });
    });

    it('should abort child controllers when parent is aborted', () => {
      const { result } = renderHook(() => useAbortController());

      let child1: AbortController;
      let child2: AbortController;

      act(() => {
        child1 = result.current.createChildController();
        child2 = result.current.createChildController();

        expect(child1.signal.aborted).toBe(false);
        expect(child2.signal.aborted).toBe(false);

        result.current.abort('Parent aborted');
      });

      expect(child1!.signal.aborted).toBe(true);
      expect(child2!.signal.aborted).toBe(true);
      expect(child1!.signal.reason).toBe('Parent aborted');
      expect(child2!.signal.reason).toBe('Parent aborted');
    });

    it('should immediately abort child controllers if parent is already aborted', () => {
      const { result } = renderHook(() => useAbortController());

      act(() => {
        result.current.abort('Already aborted');
      });

      act(() => {
        const child = result.current.createChildController();
        expect(child.signal.aborted).toBe(true);
        expect(child.signal.reason).toBe('Already aborted');
      });
    });

    it('should clean up child controllers when they are aborted individually', () => {
      const { result } = renderHook(() => useAbortController());

      let child: AbortController;

      act(() => {
        child = result.current.createChildController();
        child.abort('Individual abort');
      });

      // Child should be cleaned up from tracking
      expect(child!.signal.aborted).toBe(true);

      act(() => {
        result.current.abort('Parent abort');
      });

      // Parent should still abort normally
      expect(result.current.isAborted).toBe(true);
    });
  });

  describe('Signal Combination', () => {
    it('should combine multiple signals', () => {
      const { result } = renderHook(() => useAbortController());

      const external1 = new AbortController();
      const external2 = new AbortController();

      let combinedSignal: AbortSignal;

      act(() => {
        combinedSignal = result.current.combine([
          external1.signal,
          external2.signal,
        ]);
      });

      expect(combinedSignal!.aborted).toBe(false);

      act(() => {
        external1.abort('External 1 aborted');
      });

      expect(combinedSignal!.aborted).toBe(true);
      expect(combinedSignal!.reason).toBe('External 1 aborted');
    });

    it('should abort combined signal if parent is aborted', () => {
      const { result } = renderHook(() => useAbortController());

      const external = new AbortController();

      let combinedSignal: AbortSignal;

      act(() => {
        combinedSignal = result.current.combine([external.signal]);
      });

      act(() => {
        result.current.abort('Parent aborted');
      });

      expect(combinedSignal!.aborted).toBe(true);
      expect(combinedSignal!.reason).toBe('Parent aborted');
    });

    it('should immediately abort if any signal is already aborted', () => {
      const { result } = renderHook(() => useAbortController());

      const alreadyAborted = new AbortController();
      alreadyAborted.abort('Already aborted');

      let combinedSignal: AbortSignal;

      act(() => {
        combinedSignal = result.current.combine([alreadyAborted.signal]);
      });

      expect(combinedSignal!.aborted).toBe(true);
      expect(combinedSignal!.reason).toBe('Already aborted');
    });
  });

  describe('Timeout Signals', () => {
    it('should create timeout signal', () => {
      const { result } = renderHook(() => useAbortController());

      let timeoutSignal: AbortSignal;

      act(() => {
        timeoutSignal = result.current.withTimeout(500);
      });

      expect(timeoutSignal!.aborted).toBe(false);

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(timeoutSignal!.aborted).toBe(true);
      expect(timeoutSignal!.reason).toBe('Timeout after 500ms');
    });

    it('should abort timeout signal when parent is aborted', () => {
      const { result } = renderHook(() => useAbortController());

      let timeoutSignal: AbortSignal;

      act(() => {
        timeoutSignal = result.current.withTimeout(1000);
      });

      act(() => {
        result.current.abort('Parent aborted');
      });

      expect(timeoutSignal!.aborted).toBe(true);
      expect(timeoutSignal!.reason).toBe('Parent aborted');

      // Advancing time should not trigger timeout
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(timeoutSignal!.reason).toBe('Parent aborted'); // Still parent reason
    });

    it('should immediately abort timeout signal if parent is already aborted', () => {
      const { result } = renderHook(() => useAbortController());

      act(() => {
        result.current.abort('Already aborted');
      });

      let timeoutSignal: AbortSignal;

      act(() => {
        timeoutSignal = result.current.withTimeout(1000);
      });

      expect(timeoutSignal!.aborted).toBe(true);
      expect(timeoutSignal!.reason).toBe('Already aborted');
    });
  });

  describe('Reset Functionality', () => {
    it('should reset controller to new instance', () => {
      const { result } = renderHook(() => useAbortController());

      const originalSignal = result.current.signal;

      act(() => {
        result.current.abort('Initial abort');
      });

      expect(result.current.isAborted).toBe(true);

      act(() => {
        result.current.reset();
      });

      expect(result.current.isAborted).toBe(false);
      expect(result.current.signal).not.toBe(originalSignal);
      expect(result.current.signal.aborted).toBe(false);
    });

    it('should abort previous controller on reset', () => {
      const { result } = renderHook(() => useAbortController());

      const originalSignal = result.current.signal;

      act(() => {
        result.current.reset();
      });

      expect(originalSignal.aborted).toBe(true);
      expect(originalSignal.reason).toBe('Reset');
    });

    it('should clear timeout on reset', () => {
      const { result } = renderHook(() =>
        useAbortController({ timeout: 1000 })
      );

      act(() => {
        result.current.reset();
        vi.advanceTimersByTime(1000);
      });

      // New controller should not be aborted by old timeout
      expect(result.current.isAborted).toBe(false);
    });

    it('should clear child controllers on reset', () => {
      const { result } = renderHook(() => useAbortController());

      let child: AbortController;

      act(() => {
        child = result.current.createChildController();
        result.current.reset();
      });

      // Old child should be aborted
      expect(child!.signal.aborted).toBe(true);

      // New child should not be affected by old abort
      act(() => {
        const newChild = result.current.createChildController();
        expect(newChild.signal.aborted).toBe(false);
      });
    });
  });

  describe('Integration with Operation Manager', () => {
    it('should work with operation manager for upload operations', () => {
      const operationManager = cancelTestUtils.createMockOperationManager();
      const onAbort = vi.fn();

      const { result } = renderHook(() =>
        useAbortController({
          operationId: 'upload-123',
          operationType: 'upload',
          onAbort,
        })
      );

      act(() => {
        // Register operation
        operationManager.registerOperation({
          id: 'upload-123',
          type: 'upload',
          status: 'active',
          progress: 50,
          startTime: Date.now(),
        });

        // Abort controller
        result.current.abort('User cancelled');
      });

      expect(onAbort).toHaveBeenCalledWith('User cancelled');
    });

    it('should handle multiple concurrent operations', () => {
      const { result: result1 } = renderHook(() =>
        useAbortController({
          operationId: 'op-1',
          operationType: 'upload',
        })
      );

      const { result: result2 } = renderHook(() =>
        useAbortController({
          operationId: 'op-2',
          operationType: 'segmentation',
        })
      );

      // Both should be independent
      act(() => {
        result1.current.abort('First operation cancelled');
      });

      expect(result1.current.isAborted).toBe(true);
      expect(result2.current.isAborted).toBe(false);

      act(() => {
        result2.current.abort('Second operation cancelled');
      });

      expect(result2.current.isAborted).toBe(true);
    });
  });

  describe('Memory Management', () => {
    it('should cleanup on unmount', () => {
      const { result, unmount } = renderHook(() => useAbortController());

      const signal = result.current.signal;
      let child: AbortController;

      act(() => {
        child = result.current.createChildController();
      });

      unmount();

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe('Component unmounted');
      expect(child!.signal.aborted).toBe(true);
      expect(child!.signal.reason).toBe('Parent component unmounted');
    });

    it('should not leak memory with frequent resets', () => {
      const { result } = renderHook(() => useAbortController());

      // Perform many resets
      act(() => {
        for (let i = 0; i < 100; i++) {
          result.current.createChildController();
          result.current.reset();
        }
      });

      // Should maintain clean state
      expect(result.current.isAborted).toBe(false);
      expect(result.current.signal.aborted).toBe(false);
    });

    it('should handle rapid abort and reset cycles', () => {
      const { result } = renderHook(() => useAbortController());

      act(() => {
        for (let i = 0; i < 50; i++) {
          result.current.abort(`Abort ${i}`);
          result.current.reset();
        }
      });

      expect(result.current.isAborted).toBe(false);
      expect(result.current.signal.aborted).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in onAbort callback', () => {
      const onAbort = vi.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });

      const { result } = renderHook(() => useAbortController({ onAbort }));

      act(() => {
        // Should not throw even if callback throws
        result.current.abort('Test');
      });

      expect(result.current.isAborted).toBe(true);
      expect(onAbort).toHaveBeenCalled();
    });

    it('should handle invalid timeout values', () => {
      const { result } = renderHook(() => useAbortController({ timeout: -1 }));

      // Should not set timeout for invalid values
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.isAborted).toBe(false);
    });

    it('should handle zero timeout', () => {
      const { result } = renderHook(() => useAbortController({ timeout: 0 }));

      // Should not set timeout for zero
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.isAborted).toBe(false);
    });
  });

  describe('Performance', () => {
    it('should handle many child controllers efficiently', () => {
      const { result } = renderHook(() => useAbortController());

      const startTime = performance.now();

      act(() => {
        // Create many child controllers
        const children = [];
        for (let i = 0; i < 1000; i++) {
          children.push(result.current.createChildController());
        }

        // Abort parent (should abort all children)
        result.current.abort('Parent aborted');

        // Verify all children are aborted
        children.forEach(child => {
          expect(child.signal.aborted).toBe(true);
        });
      });

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete quickly even with many children
      expect(duration).toBeLessThan(100); // 100ms threshold
    });

    it('should handle frequent signal combinations efficiently', () => {
      const { result } = renderHook(() => useAbortController());

      const startTime = performance.now();

      act(() => {
        const signals = [];
        for (let i = 0; i < 100; i++) {
          const controller = new AbortController();
          signals.push(controller.signal);
        }

        // Combine all signals
        const _combined = result.current.combine(signals);

        // Abort one to trigger combined
        signals[0].dispatchEvent(new Event('abort'));
      });

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(50); // 50ms threshold
    });
  });
});
