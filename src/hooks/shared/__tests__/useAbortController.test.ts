/**
 * @file useAbortController hook tests
 * Tests for the shared AbortController hook used to fix race conditions
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  useAbortController,
  useCoordinatedAbortController,
} from '../useAbortController';

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe('useAbortController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('basic functionality', () => {
    it('should create a new controller for default key', () => {
      const { result } = renderHook(() => useAbortController('test'));

      const controller = result.current.getController();

      expect(controller).toBeInstanceOf(AbortController);
      expect(controller.signal.aborted).toBe(false);
    });

    it('should reuse existing controller if not aborted', () => {
      const { result } = renderHook(() => useAbortController('test'));

      const controller1 = result.current.getController('key1');
      const controller2 = result.current.getController('key1');

      expect(controller1).toBe(controller2);
    });

    it('should create new controller if existing one is aborted', () => {
      const { result } = renderHook(() => useAbortController('test'));

      const controller1 = result.current.getController('key1');
      controller1.abort();

      const controller2 = result.current.getController('key1');

      expect(controller1).not.toBe(controller2);
      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(false);
    });
  });

  describe('abort operations', () => {
    it('should abort specific controller', () => {
      const { result } = renderHook(() => useAbortController('test'));

      const controller1 = result.current.getController('key1');
      const controller2 = result.current.getController('key2');

      act(() => {
        result.current.abort('key1');
      });

      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(false);
    });

    it('should abort all controllers', () => {
      const { result } = renderHook(() => useAbortController('test'));

      const controller1 = result.current.getController('key1');
      const controller2 = result.current.getController('key2');

      act(() => {
        result.current.abortAll();
      });

      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(true);
    });

    it('should check if controller is aborted', () => {
      const { result } = renderHook(() => useAbortController('test'));

      const _controller = result.current.getController('key1');

      expect(result.current.isAborted('key1')).toBe(false);

      act(() => {
        result.current.abort('key1');
      });

      expect(result.current.isAborted('key1')).toBe(true);
    });
  });

  describe('signal management', () => {
    it('should return abort signal for controller', () => {
      const { result } = renderHook(() => useAbortController('test'));

      const signal = result.current.getSignal('key1');

      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });

    it('should return aborted signal after abort', () => {
      const { result } = renderHook(() => useAbortController('test'));

      const signal = result.current.getSignal('key1');

      act(() => {
        result.current.abort('key1');
      });

      expect(signal.aborted).toBe(true);
    });
  });

  describe('cleanup on unmount', () => {
    it('should abort all controllers when component unmounts', () => {
      const { result, unmount } = renderHook(() => useAbortController('test'));

      const controller1 = result.current.getController('key1');
      const controller2 = result.current.getController('key2');

      unmount();

      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(true);
    });
  });
});

describe('useCoordinatedAbortController', () => {
  const operationKeys = ['main-loading', 'prefetch', 'websocket-reload'];

  it('should abort all specified operations', () => {
    const { result } = renderHook(() =>
      useCoordinatedAbortController(operationKeys, 'test')
    );

    // Create controllers for all operations
    const controllers = operationKeys.map(key =>
      result.current.getController(key)
    );

    act(() => {
      result.current.abortAllOperations();
    });

    controllers.forEach(controller => {
      expect(controller.signal.aborted).toBe(true);
    });
  });

  it('should get signals for all operations', () => {
    const { result } = renderHook(() =>
      useCoordinatedAbortController(operationKeys, 'test')
    );

    const signals = result.current.getAllSignals();

    expect(Object.keys(signals)).toEqual(operationKeys);
    operationKeys.forEach(key => {
      expect(signals[key]).toBeInstanceOf(AbortSignal);
      expect(signals[key].aborted).toBe(false);
    });
  });

  it('should check if all operations are aborted', () => {
    const { result } = renderHook(() =>
      useCoordinatedAbortController(operationKeys, 'test')
    );

    // Initially, none should be aborted (no controllers created yet)
    expect(result.current.areAllAborted()).toBe(false);

    // Create controllers for all operations before aborting them,
    // so areAllAborted can detect the aborted state.
    act(() => {
      result.current.getAllSignals();
    });

    // Still not aborted (controllers exist but are fresh)
    expect(result.current.areAllAborted()).toBe(false);

    // Abort all operations
    act(() => {
      result.current.abortAllOperations();
    });

    // Now all should be aborted
    expect(result.current.areAllAborted()).toBe(true);
  });

  it('should handle partial abortion correctly', () => {
    const { result } = renderHook(() =>
      useCoordinatedAbortController(operationKeys, 'test')
    );

    // Initialize all controllers first so isAborted reflects the actual signal
    // state rather than "no controller exists" (which isAborted treats as aborted).
    act(() => {
      result.current.getAllSignals();
    });

    // Abort only one operation
    act(() => {
      result.current.abort('main-loading');
    });

    // Not all should be aborted
    expect(result.current.areAllAborted()).toBe(false);

    // Specific one should be aborted
    expect(result.current.isAborted('main-loading')).toBe(true);
    expect(result.current.isAborted('prefetch')).toBe(false);
  });
});

describe('Race condition scenarios', () => {
  it('should handle rapid image switching scenario', () => {
    const { result } = renderHook(() =>
      useCoordinatedAbortController(
        ['main-loading', 'prefetch', 'websocket-reload'],
        'SegmentationEditor'
      )
    );

    // Simulate starting operations for image A
    const imageASignals = result.current.getAllSignals();

    // Simulate rapid switch to image B - abort all operations for image A
    act(() => {
      result.current.abortAllOperations();
    });

    // All signals for image A should be aborted
    Object.values(imageASignals).forEach(signal => {
      expect(signal.aborted).toBe(true);
    });

    // Start new operations for image B
    const imageBSignals = result.current.getAllSignals();

    // New signals should not be aborted
    Object.values(imageBSignals).forEach(signal => {
      expect(signal.aborted).toBe(false);
    });
  });

  it('should handle concurrent operation cancellation', () => {
    const { result } = renderHook(() => useAbortController('test'));

    // Start multiple concurrent operations
    const loadingSignal = result.current.getSignal('loading');
    const savingSignal = result.current.getSignal('saving');
    const prefetchSignal = result.current.getSignal('prefetch');

    // Cancel only loading operation
    act(() => {
      result.current.abort('loading');
    });

    expect(loadingSignal.aborted).toBe(true);
    expect(savingSignal.aborted).toBe(false);
    expect(prefetchSignal.aborted).toBe(false);

    // Cancel all remaining operations
    act(() => {
      result.current.abortAll();
    });

    expect(savingSignal.aborted).toBe(true);
    expect(prefetchSignal.aborted).toBe(true);
  });
});

/**
 * Coverage for the two exports that had NO test at all until 2026-09-04:
 * `resetController` and `areKeysAllAborted`. The global coverage gate hid the
 * gap, and both encode a contract that the obvious implementation gets wrong:
 *
 *  - `abort(key)` deliberately KEEPS the aborted controller in the map (see the
 *    comment in useAbortController.ts) so `isAborted(key)` keeps reporting the
 *    abort. `resetController(key)` is therefore the only way to clear it.
 *  - `areKeysAllAborted([...])` must return FALSE when nothing has started yet.
 *    A bare `keys.every(...)` returns TRUE on an empty map, which would make
 *    `useCoordinatedAbortController().areAllAborted()` claim a not-yet-started
 *    batch was already cancelled.
 */
describe('resetController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops a LIVE controller from the map without aborting its signal', () => {
    // The in-flight request keyed to the old controller must NOT be cancelled by
    // a reset — that is what distinguishes resetController from abort.
    const { result } = renderHook(() => useAbortController('reset'));

    const live = result.current.getController('load');
    expect(live.signal.aborted).toBe(false);

    act(() => {
      result.current.resetController('load');
    });

    expect(live.signal.aborted).toBe(false);
    expect(result.current.getController('load')).not.toBe(live);
  });

  it('only resets the key it is given', () => {
    const { result } = renderHook(() => useAbortController('reset'));

    const load = result.current.getController('load');
    const prefetch = result.current.getController('prefetch');

    act(() => {
      result.current.resetController('load');
    });

    expect(result.current.getController('load')).not.toBe(load);
    expect(result.current.getController('prefetch')).toBe(prefetch);
  });
});

describe('areKeysAllAborted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when NOTHING has started yet', () => {
    // The regression this guards: `keys.every(...)` alone is vacuously true on
    // an empty map, so a batch that had not begun would report "all cancelled".
    const { result } = renderHook(() => useAbortController('coord'));

    expect(result.current.areKeysAllAborted(['a', 'b'])).toBe(false);
  });

  it('returns false while at least one key is still live', () => {
    const { result } = renderHook(() => useAbortController('coord'));

    result.current.getController('a');
    result.current.getController('b');
    act(() => {
      result.current.abort('a');
    });

    expect(result.current.areKeysAllAborted(['a', 'b'])).toBe(false);
  });

  it('returns true once every key with a controller is aborted', () => {
    const { result } = renderHook(() => useAbortController('coord'));

    result.current.getController('a');
    result.current.getController('b');
    act(() => {
      result.current.abort('a');
      result.current.abort('b');
    });

    expect(result.current.areKeysAllAborted(['a', 'b'])).toBe(true);
  });

  it('treats a key that was never created as NOT aborted', () => {
    // 'b' has no controller: the batch is partially started, so it is not done.
    const { result } = renderHook(() => useAbortController('coord'));

    result.current.getController('a');
    act(() => {
      result.current.abort('a');
    });

    expect(result.current.areKeysAllAborted(['a', 'b'])).toBe(false);
  });

  it('goes back to false after the aborted key is reset', () => {
    const { result } = renderHook(() => useAbortController('coord'));

    result.current.getController('a');
    act(() => {
      result.current.abort('a');
    });
    expect(result.current.areKeysAllAborted(['a'])).toBe(true);

    act(() => {
      result.current.resetController('a');
    });
    expect(result.current.areKeysAllAborted(['a'])).toBe(false);
  });
});
