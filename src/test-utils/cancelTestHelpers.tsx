/**
 * Test utilities and helpers for universal cancel functionality
 * Following TDD principles for upload, segmentation, and export operations
 */

import { vi } from 'vitest';
import { render, RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Types for cancel operations
export type OperationType = 'upload' | 'segmentation' | 'export';
export type OperationStatus =
  | 'idle'
  | 'active'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed';

export interface CancelOperation {
  id: string;
  type: OperationType;
  status: OperationStatus;
  progress?: number;
  error?: string;
  startTime: number;
  endTime?: number;
}

export interface MockAbortController {
  signal: AbortSignal;
  abort: ReturnType<typeof vi.fn>;
  aborted: boolean;
}

export interface MockOperationManager {
  operations: Map<string, CancelOperation>;
  registerOperation: ReturnType<typeof vi.fn>;
  cancelOperation: ReturnType<typeof vi.fn>;
  updateOperation: ReturnType<typeof vi.fn>;
  removeOperation: ReturnType<typeof vi.fn>;
  getOperation: ReturnType<typeof vi.fn>;
  getAllOperations: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
}

/**
 * Creates a mock AbortController for testing cancellation
 */
export const createMockAbortController = (): MockAbortController => {
  const listeners: Array<() => void> = [];
  let aborted = false;

  const signal = {
    aborted: false,
    addEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'abort') {
        listeners.push(listener);
      }
    }),
    removeEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'abort') {
        const index = listeners.indexOf(listener);
        if (index > -1) listeners.splice(index, 1);
      }
    }),
    dispatchEvent: vi.fn(),
    onabort: null,
    reason: undefined,
    throwIfAborted: vi.fn(() => {
      if (aborted) {
        throw new DOMException('Operation was aborted', 'AbortError');
      }
    }),
  } as unknown as AbortSignal;

  const abort = vi.fn((reason?: any) => {
    if (aborted) return;
    aborted = true;
    (signal as any).aborted = true;
    (signal as any).reason = reason;
    listeners.forEach(listener => listener());
  });

  return { signal, abort, aborted };
};

/**
 * Creates a mock operation manager for testing
 */
export const createMockOperationManager = (): MockOperationManager => {
  const operations = new Map<string, CancelOperation>();

  return {
    operations,
    registerOperation: vi.fn((operation: CancelOperation) => {
      operations.set(operation.id, operation);
      return operation.id;
    }),
    cancelOperation: vi.fn(async (id: string): Promise<boolean> => {
      const operation = operations.get(id);
      if (!operation) return false;

      operations.set(id, {
        ...operation,
        status: 'cancelling',
      });

      // Simulate async cancellation
      await new Promise(resolve => setTimeout(resolve, 100));

      operations.set(id, {
        ...operation,
        status: 'cancelled',
        endTime: Date.now(),
      });

      return true;
    }),
    updateOperation: vi.fn((id: string, updates: Partial<CancelOperation>) => {
      const operation = operations.get(id);
      if (operation) {
        operations.set(id, { ...operation, ...updates });
      }
    }),
    removeOperation: vi.fn((id: string) => {
      return operations.delete(id);
    }),
    getOperation: vi.fn((id: string) => {
      return operations.get(id);
    }),
    getAllOperations: vi.fn(() => {
      return Array.from(operations.values());
    }),
    cleanup: vi.fn(() => {
      operations.clear();
    }),
  };
};

/**
 * Factory for creating test operations
 */
export const createTestOperation = (
  type: OperationType,
  overrides: Partial<CancelOperation> = {}
): CancelOperation => ({
  id: `test-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  type,
  status: 'idle',
  progress: 0,
  startTime: Date.now(),
  ...overrides,
});

/**
 * Creates a batch of test operations
 */
export const createTestOperationBatch = (
  count: number,
  type: OperationType,
  baseOverrides: Partial<CancelOperation> = {}
): CancelOperation[] => {
  return Array.from({ length: count }, (_, index) =>
    createTestOperation(type, {
      ...baseOverrides,
      id: `batch-${type}-${index + 1}`,
    })
  );
};

/**
 * Mock WebSocket events for cancel operations
 */
export const createCancelWebSocketEvents = () => {
  return {
    uploadCancelled: vi.fn((_data: { uploadId: string; reason?: string }) => {}),
    segmentationCancelled: vi.fn(
      (_data: { batchId: string; imageIds: string[]; reason?: string }) => {}
    ),
    exportCancelled: vi.fn((_data: { exportId: string; reason?: string }) => {}),
    operationCancelled: vi.fn(
      (_data: {
        operationId: string;
        type: OperationType;
        reason?: string;
      }) => {}
    ),
  };
};

/**
 * Mock API responses for cancel operations
 */
export const createMockCancelApiResponses = () => {
  return {
    upload: {
      success: {
        status: 200,
        data: { success: true, message: 'Upload cancelled successfully' },
      },
      notFound: {
        status: 404,
        data: { error: 'Upload not found' },
      },
      alreadyCompleted: {
        status: 400,
        data: { error: 'Upload already completed' },
      },
    },
    segmentation: {
      success: {
        status: 200,
        data: {
          success: true,
          message: 'Batch segmentation cancelled successfully',
          cancelledJobs: 5,
          completedJobs: 3,
        },
      },
      partialSuccess: {
        status: 200,
        data: {
          success: true,
          message: 'Batch partially cancelled',
          cancelledJobs: 3,
          completedJobs: 5,
          warning: 'Some jobs were already completed',
        },
      },
      notFound: {
        status: 404,
        data: { error: 'Batch not found' },
      },
    },
    export: {
      success: {
        status: 200,
        data: { success: true, message: 'Export cancelled successfully' },
      },
      notFound: {
        status: 404,
        data: { error: 'Export job not found' },
      },
    },
  };
};

/**
 * Helper to wait for operation cancellation
 */
export const waitForCancellation = async (
  operationId: string,
  mockManager: MockOperationManager,
  timeout = 5000
): Promise<CancelOperation | null> => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const operation = mockManager.getOperation(operationId);
    if (
      operation &&
      (operation.status === 'cancelled' || operation.status === 'failed')
    ) {
      return operation;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  throw new Error(
    `Operation ${operationId} did not cancel within ${timeout}ms`
  );
};

/**
 * Helper to simulate operation progress before cancellation
 */
export const simulateOperationProgress = async (
  operationId: string,
  mockManager: MockOperationManager,
  progressSteps: number[] = [10, 25, 50, 75]
): Promise<void> => {
  for (const progress of progressSteps) {
    mockManager.updateOperation(operationId, {
      status: 'active',
      progress,
    });
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};

/**
 * Performance testing helper for cancel operations
 */
export const measureCancelPerformance = async (
  cancelOperation: () => Promise<void>,
  iterations = 10
): Promise<{
  averageTime: number;
  minTime: number;
  maxTime: number;
  medianTime: number;
}> => {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await cancelOperation();
    const end = performance.now();
    times.push(end - start);
  }

  times.sort((a, b) => a - b);

  return {
    averageTime: times.reduce((sum, time) => sum + time, 0) / times.length,
    minTime: Math.min(...times),
    maxTime: Math.max(...times),
    medianTime: times[Math.floor(times.length / 2)],
  };
};

/**
 * Memory leak detection helper
 */
export const createMemoryLeakDetector = () => {
  const initialMemory = performance.memory
    ? performance.memory.usedJSHeapSize
    : 0;
  const operations: CancelOperation[] = [];
  const listeners: Array<() => void> = [];

  return {
    addOperation: (operation: CancelOperation) => {
      operations.push(operation);
    },
    addListener: (listener: () => void) => {
      listeners.push(listener);
    },
    cleanup: () => {
      operations.length = 0;
      listeners.forEach(listener => {
        try {
          listener();
        } catch (_error) {
          // Ignore cleanup errors
        }
      });
      listeners.length = 0;
    },
    checkMemoryLeak: (): boolean => {
      if (!performance.memory) return false;

      const currentMemory = performance.memory.usedJSHeapSize;
      const memoryIncrease = currentMemory - initialMemory;

      // Consider it a leak if memory increased by more than 10MB
      return memoryIncrease > 10 * 1024 * 1024;
    },
  };
};

/**
 * Stress testing helper for rapid cancel operations
 */
export const createStressTestScenarios = () => {
  return {
    rapidCancelRestart: async (
      createOperation: () => CancelOperation,
      cancelOperation: (id: string) => Promise<void>,
      cycles = 10
    ) => {
      const operations: CancelOperation[] = [];

      for (let i = 0; i < cycles; i++) {
        const operation = createOperation();
        operations.push(operation);

        // Start and immediately cancel
        await cancelOperation(operation.id);

        // Small delay to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      return operations;
    },

    concurrentCancellations: async (
      operations: CancelOperation[],
      cancelOperation: (id: string) => Promise<void>
    ) => {
      const startTime = performance.now();

      const promises = operations.map(op => cancelOperation(op.id));
      await Promise.all(promises);

      const endTime = performance.now();

      return {
        totalTime: endTime - startTime,
        operationsCount: operations.length,
        averageTimePerOperation: (endTime - startTime) / operations.length,
      };
    },

    highFrequencyCancellation: async (
      createAndCancelOperation: () => Promise<void>,
      frequency = 100, // operations per second
      duration = 5000 // 5 seconds
    ) => {
      const interval = 1000 / frequency;
      const endTime = Date.now() + duration;
      const results: number[] = [];

      while (Date.now() < endTime) {
        const start = performance.now();
        await createAndCancelOperation();
        const operationTime = performance.now() - start;
        results.push(operationTime);

        const remainingTime = interval - operationTime;
        if (remainingTime > 0) {
          await new Promise(resolve => setTimeout(resolve, remainingTime));
        }
      }

      return {
        operationsCompleted: results.length,
        averageOperationTime:
          results.reduce((sum, time) => sum + time, 0) / results.length,
        maxOperationTime: Math.max(...results),
        minOperationTime: Math.min(...results),
      };
    },
  };
};

/**
 * Error simulation helpers
 */
export const createErrorSimulators = () => {
  return {
    networkError: () => {
      const error = new Error('Network error');
      (error as any).code = 'NETWORK_ERROR';
      return error;
    },

    timeoutError: () => {
      const error = new Error('Timeout error');
      (error as any).code = 'TIMEOUT_ERROR';
      return error;
    },

    serverError: (status = 500) => {
      const error = new Error('Server error');
      (error as any).status = status;
      (error as any).code = 'SERVER_ERROR';
      return error;
    },

    abortError: () => {
      return new DOMException('Operation was aborted', 'AbortError');
    },

    validationError: (field: string) => {
      const error = new Error(`Validation error: ${field} is required`);
      (error as any).code = 'VALIDATION_ERROR';
      (error as any).field = field;
      return error;
    },
  };
};

/**
 * Custom render function with cancel operation providers
 */
export const renderWithCancelProviders = (
  ui: React.ReactElement,
  options: {
    initialOperations?: CancelOperation[];
    mockAbortController?: MockAbortController;
    mockOperationManager?: MockOperationManager;
  } & Omit<RenderOptions, 'wrapper'> = {}
) => {
  const {
    initialOperations = [],
    mockAbortController = createMockAbortController(),
    mockOperationManager = createMockOperationManager(),
    ...renderOptions
  } = options;

  // Initialize operations
  initialOperations.forEach(op => {
    mockOperationManager.registerOperation(op);
  });

  const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
    return <div data-testid="cancel-providers">{children}</div>;
  };

  const utils = render(ui, { wrapper: AllTheProviders, ...renderOptions });

  return {
    ...utils,
    mockAbortController,
    mockOperationManager,
    user: userEvent.setup(),
  };
};

/**
 * Test data factories for different operation types
 */
export const createTestDataFactories = () => {
  return {
    uploadOperation: (overrides: Partial<CancelOperation> = {}) =>
      createTestOperation('upload', {
        progress: 45,
        ...overrides,
      }),

    segmentationOperation: (overrides: Partial<CancelOperation> = {}) =>
      createTestOperation('segmentation', {
        progress: 75,
        ...overrides,
      }),

    exportOperation: (overrides: Partial<CancelOperation> = {}) =>
      createTestOperation('export', {
        progress: 30,
        ...overrides,
      }),

    batchOperations: (count: number, type: OperationType) =>
      createTestOperationBatch(count, type),

    mixedOperations: (count: number) => {
      const types: OperationType[] = ['upload', 'segmentation', 'export'];
      return Array.from({ length: count }, (_, index) => {
        const type = types[index % types.length];
        return createTestOperation(type, {
          id: `mixed-${type}-${index}`,
          progress: Math.floor(Math.random() * 100),
        });
      });
    },
  };
};

/**
 * Assertion helpers for cancel functionality
 */
export const createCancelAssertions = () => {
  return {
    assertOperationCancelled: (operation: CancelOperation | null) => {
      expect(operation).toBeTruthy();
      expect(operation!.status).toBe('cancelled');
      expect(operation!.endTime).toBeTruthy();
    },

    assertOperationCancelling: (operation: CancelOperation | null) => {
      expect(operation).toBeTruthy();
      expect(operation!.status).toBe('cancelling');
    },

    assertOperationCompleted: (operation: CancelOperation | null) => {
      expect(operation).toBeTruthy();
      expect(operation!.status).toBe('completed');
      expect(operation!.endTime).toBeTruthy();
    },

    assertCancelButtonVisible: (container: HTMLElement) => {
      const cancelButton = container.querySelector(
        '[data-testid="cancel-button"]'
      );
      expect(cancelButton).toBeInTheDocument();
      expect(cancelButton).toBeVisible();
    },

    assertCancelButtonHidden: (container: HTMLElement) => {
      const cancelButton = container.querySelector(
        '[data-testid="cancel-button"]'
      );
      expect(cancelButton).not.toBeInTheDocument();
    },

    assertProgressUpdated: (
      operation: CancelOperation,
      expectedProgress: number
    ) => {
      expect(operation.progress).toBe(expectedProgress);
    },

    assertNoMemoryLeaks: async (
      detector: ReturnType<typeof createMemoryLeakDetector>
    ) => {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(detector.checkMemoryLeak()).toBe(false);
    },
  };
};

/**
 * Export all utilities for easy importing
 */
export const cancelTestUtils = {
  createMockAbortController,
  createMockOperationManager,
  createTestOperation,
  createTestOperationBatch,
  createCancelWebSocketEvents,
  createMockCancelApiResponses,
  waitForCancellation,
  simulateOperationProgress,
  measureCancelPerformance,
  createMemoryLeakDetector,
  createStressTestScenarios,
  createErrorSimulators,
  renderWithCancelProviders,
  createTestDataFactories,
  createCancelAssertions,
};

export default cancelTestUtils;
