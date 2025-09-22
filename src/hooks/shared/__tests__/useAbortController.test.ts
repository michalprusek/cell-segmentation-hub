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

    // Initially, none should be aborted
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
