/**
 * @file useAbortController unit tests (non-React)
 * Tests the core logic of AbortController management without React hooks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe('AbortController Race Condition Fix - Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AbortController coordination logic', () => {
    it('should create and manage multiple controllers', () => {
      const controllers = new Map<string, AbortController>();

      const getController = (key: string) => {
        const existing = controllers.get(key);
        if (existing && !existing.signal.aborted) {
          return existing;
        }

        const controller = new AbortController();
        controllers.set(key, controller);
        return controller;
      };

      // Test basic functionality
      const controller1 = getController('key1');
      const controller2 = getController('key1'); // Should reuse
      const controller3 = getController('key2'); // Should create new

      expect(controller1).toBe(controller2);
      expect(controller1).not.toBe(controller3);
      expect(controller1.signal.aborted).toBe(false);
      expect(controller3.signal.aborted).toBe(false);
    });

    it('should create new controller when existing is aborted', () => {
      const controllers = new Map<string, AbortController>();

      const getController = (key: string) => {
        const existing = controllers.get(key);
        if (existing && !existing.signal.aborted) {
          return existing;
        }

        const controller = new AbortController();
        controllers.set(key, controller);
        return controller;
      };

      const controller1 = getController('key1');
      controller1.abort(); // Abort the first controller

      const controller2 = getController('key1'); // Should create new

      expect(controller1).not.toBe(controller2);
      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(false);
    });

    it('should abort all controllers on coordinated abort', () => {
      const controllers = new Map<string, AbortController>();

      // Create multiple controllers
      const controller1 = new AbortController();
      const controller2 = new AbortController();
      const controller3 = new AbortController();

      controllers.set('main-loading', controller1);
      controllers.set('prefetch', controller2);
      controllers.set('websocket-reload', controller3);

      // Abort all
      controllers.forEach(controller => controller.abort());

      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(true);
      expect(controller3.signal.aborted).toBe(true);
    });
  });

  describe('Race condition scenarios simulation', () => {
    it('should handle rapid image switching without conflicts', () => {
      // Simulate the SegmentationEditor scenario
      const controllers = new Map<string, AbortController>();
      let currentImageId = 'image1';

      const getSignal = (operationKey: string) => {
        const key = `${currentImageId}-${operationKey}`;
        const existing = controllers.get(key);
        if (existing && !existing.signal.aborted) {
          return existing.signal;
        }

        const controller = new AbortController();
        controllers.set(key, controller);
        return controller.signal;
      };

      const abortAllForImage = (imageId: string) => {
        const keysToAbort = Array.from(controllers.keys()).filter(key =>
          key.startsWith(`${imageId}-`)
        );

        keysToAbort.forEach(key => {
          const controller = controllers.get(key);
          if (controller && !controller.signal.aborted) {
            controller.abort();
          }
        });
      };

      // Start operations for image1
      const image1LoadingSignal = getSignal('loading');
      const image1PrefetchSignal = getSignal('prefetch');
      const image1WebSocketSignal = getSignal('websocket');

      expect(image1LoadingSignal.aborted).toBe(false);
      expect(image1PrefetchSignal.aborted).toBe(false);
      expect(image1WebSocketSignal.aborted).toBe(false);

      // Rapidly switch to image2 - should abort all image1 operations
      abortAllForImage('image1');
      currentImageId = 'image2';

      // Check that image1 operations are aborted
      expect(image1LoadingSignal.aborted).toBe(true);
      expect(image1PrefetchSignal.aborted).toBe(true);
      expect(image1WebSocketSignal.aborted).toBe(true);

      // Start new operations for image2
      const image2LoadingSignal = getSignal('loading');
      const image2PrefetchSignal = getSignal('prefetch');

      // New operations should not be aborted
      expect(image2LoadingSignal.aborted).toBe(false);
      expect(image2PrefetchSignal.aborted).toBe(false);

      // Verify they are different signals
      expect(image1LoadingSignal).not.toBe(image2LoadingSignal);
      expect(image1PrefetchSignal).not.toBe(image2PrefetchSignal);
    });

    it('should handle autosave cancellation scenario', () => {
      // Simulate autosave cancellation when rapidly switching images
      let autosaveController: AbortController | null = null;
      let isAutosaveInProgress = false;

      const startAutosave = () => {
        if (autosaveController) {
          autosaveController.abort(); // Cancel previous autosave
        }

        autosaveController = new AbortController();
        isAutosaveInProgress = true;

        return autosaveController.signal;
      };

      const completeAutosave = () => {
        isAutosaveInProgress = false;
      };

      const _cancelAutosave = () => {
        if (autosaveController && !autosaveController.signal.aborted) {
          autosaveController.abort();
          isAutosaveInProgress = false;
        }
      };

      // Start autosave for image1
      const autosave1Signal = startAutosave();
      expect(autosave1Signal.aborted).toBe(false);
      expect(isAutosaveInProgress).toBe(true);

      // Rapidly switch to image2 - should cancel autosave1
      const autosave2Signal = startAutosave();

      // Previous autosave should be cancelled
      expect(autosave1Signal.aborted).toBe(true);
      expect(autosave2Signal.aborted).toBe(false);
      expect(isAutosaveInProgress).toBe(true);

      // Verify they are different signals
      expect(autosave1Signal).not.toBe(autosave2Signal);

      // Complete second autosave normally
      completeAutosave();
      expect(isAutosaveInProgress).toBe(false);
    });

    it('should handle concurrent operation types correctly', () => {
      // Simulate different types of operations that can run concurrently
      const operations = {
        loading: null as AbortController | null,
        saving: null as AbortController | null,
        prefetching: null as AbortController | null,
        reloading: null as AbortController | null,
      };

      const startOperation = (type: keyof typeof operations) => {
        operations[type] = new AbortController();
        return operations[type]!.signal;
      };

      const cancelOperation = (type: keyof typeof operations) => {
        if (operations[type] && !operations[type]!.signal.aborted) {
          operations[type]!.abort();
        }
      };

      const cancelAllOperations = () => {
        Object.keys(operations).forEach(key => {
          cancelOperation(key as keyof typeof operations);
        });
      };

      // Start multiple operations
      const loadingSignal = startOperation('loading');
      const savingSignal = startOperation('saving');
      const prefetchSignal = startOperation('prefetching');
      const reloadSignal = startOperation('reloading');

      // All should be active
      expect(loadingSignal.aborted).toBe(false);
      expect(savingSignal.aborted).toBe(false);
      expect(prefetchSignal.aborted).toBe(false);
      expect(reloadSignal.aborted).toBe(false);

      // Cancel only loading operation
      cancelOperation('loading');

      expect(loadingSignal.aborted).toBe(true);
      expect(savingSignal.aborted).toBe(false);
      expect(prefetchSignal.aborted).toBe(false);
      expect(reloadSignal.aborted).toBe(false);

      // Cancel all remaining operations
      cancelAllOperations();

      expect(loadingSignal.aborted).toBe(true);
      expect(savingSignal.aborted).toBe(true);
      expect(prefetchSignal.aborted).toBe(true);
      expect(reloadSignal.aborted).toBe(true);
    });
  });

  describe('Error handling integration', () => {
    it('should properly integrate with error handling utilities', async () => {
      const { isCancelledError, handleCancelledError } = await import(
        '@/lib/errorUtils'
      );

      // Simulate an API call being cancelled
      const controller = new AbortController();
      const signal = controller.signal;

      // Abort the controller
      controller.abort();

      // Create a cancelled error as Axios would
      const cancelledError = {
        name: 'CanceledError',
        code: 'ERR_CANCELED',
        message: 'canceled',
        isAxiosError: true,
      };

      // Verify our error handling correctly identifies this as cancelled
      expect(isCancelledError(cancelledError)).toBe(true);
      expect(handleCancelledError(cancelledError, 'test operation')).toBe(true);

      // Verify AbortSignal state
      expect(signal.aborted).toBe(true);
    });
  });
});
