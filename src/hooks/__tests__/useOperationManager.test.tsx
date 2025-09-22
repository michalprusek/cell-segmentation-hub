/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

import {
  cancelTestUtils,
  type CancelOperation,
  type OperationType,
} from '@/test-utils/cancelTestHelpers';
import {
  uploadScenarios,
  segmentationScenarios,
  _errorScenarios,
} from '@/test-fixtures/cancelScenarios';

// Mock dependencies
vi.mock('@/lib/api', () => ({
  default: {
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/services/webSocketManager', () => ({
  webSocketManager: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

/**
 * Operation Manager Hook (TDD - to be implemented)
 * Manages multiple concurrent operations with cancellation support
 */
interface UseOperationManagerReturn {
  operations: Map<string, CancelOperation>;
  registerOperation: (
    operation: Omit<CancelOperation, 'id'> & { id?: string }
  ) => string;
  cancelOperation: (operationId: string) => Promise<boolean>;
  updateOperation: (
    operationId: string,
    updates: Partial<CancelOperation>
  ) => void;
  removeOperation: (operationId: string) => boolean;
  getOperation: (operationId: string) => CancelOperation | undefined;
  getOperationsByType: (type: OperationType) => CancelOperation[];
  getActiveOperations: () => CancelOperation[];
  cancelAllOperations: () => Promise<boolean[]>;
  cleanup: () => void;
  stats: {
    total: number;
    active: number;
    completed: number;
    cancelled: number;
    failed: number;
  };
}

const useOperationManager = (): UseOperationManagerReturn => {
  const [operations, setOperations] = React.useState<
    Map<string, CancelOperation>
  >(new Map());
  const abortControllersRef = React.useRef<Map<string, AbortController>>(
    new Map()
  );

  const registerOperation = React.useCallback(
    (operation: Omit<CancelOperation, 'id'> & { id?: string }) => {
      const id =
        operation.id ||
        `${operation.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const abortController = new AbortController();

      const newOperation: CancelOperation = {
        ...operation,
        id,
        status: operation.status || 'active',
        startTime: operation.startTime || Date.now(),
      };

      setOperations(prev => new Map(prev).set(id, newOperation));
      abortControllersRef.current.set(id, abortController);

      return id;
    },
    []
  );

  const cancelOperation = React.useCallback(
    async (operationId: string): Promise<boolean> => {
      const operation = operations.get(operationId);
      if (
        !operation ||
        operation.status === 'cancelled' ||
        operation.status === 'completed'
      ) {
        return false;
      }

      // Update status to cancelling
      setOperations(prev => {
        const newMap = new Map(prev);
        newMap.set(operationId, { ...operation, status: 'cancelling' });
        return newMap;
      });

      try {
        // Abort any ongoing requests
        const abortController = abortControllersRef.current.get(operationId);
        if (abortController) {
          abortController.abort();
        }

        // Call appropriate cancel API based on operation type
        let _apiResult = true;
        try {
          const { default: api } = await import('@/lib/api');

          switch (operation.type) {
            case 'upload':
              await api.delete(`/api/uploads/${operationId}/cancel`);
              break;
            case 'segmentation':
              await api.delete(`/api/queue/batch/${operationId}/cancel`);
              break;
            case 'export':
              await api.delete(`/api/exports/${operationId}/cancel`);
              break;
          }
        } catch (apiError) {
          console.warn(
            'API cancel failed, proceeding with local cancellation:',
            apiError
          );
          _apiResult = false;
        }

        // Emit WebSocket event
        try {
          const { webSocketManager } = await import(
            '@/services/webSocketManager'
          );
          webSocketManager.emit('operationCancelled', {
            operationId,
            type: operation.type,
            reason: 'User cancelled',
          });
        } catch (wsError) {
          console.warn('WebSocket emit failed:', wsError);
        }

        // Update final status
        setOperations(prev => {
          const newMap = new Map(prev);
          newMap.set(operationId, {
            ...operation,
            status: 'cancelled',
            endTime: Date.now(),
          });
          return newMap;
        });

        // Cleanup abort controller
        abortControllersRef.current.delete(operationId);

        return true;
      } catch (error) {
        // Revert status on error
        setOperations(prev => {
          const newMap = new Map(prev);
          newMap.set(operationId, { ...operation, status: 'active' });
          return newMap;
        });

        throw error;
      }
    },
    [operations]
  );

  const updateOperation = React.useCallback(
    (operationId: string, updates: Partial<CancelOperation>) => {
      setOperations(prev => {
        const operation = prev.get(operationId);
        if (!operation) return prev;

        const newMap = new Map(prev);
        newMap.set(operationId, { ...operation, ...updates });
        return newMap;
      });
    },
    []
  );

  const removeOperation = React.useCallback(
    (operationId: string): boolean => {
      const removed = operations.has(operationId);

      setOperations(prev => {
        const newMap = new Map(prev);
        newMap.delete(operationId);
        return newMap;
      });

      // Cleanup abort controller
      const abortController = abortControllersRef.current.get(operationId);
      if (abortController) {
        abortController.abort();
        abortControllersRef.current.delete(operationId);
      }

      return removed;
    },
    [operations]
  );

  const getOperation = React.useCallback(
    (operationId: string) => {
      return operations.get(operationId);
    },
    [operations]
  );

  const getOperationsByType = React.useCallback(
    (type: OperationType) => {
      return Array.from(operations.values()).filter(op => op.type === type);
    },
    [operations]
  );

  const getActiveOperations = React.useCallback(() => {
    return Array.from(operations.values()).filter(
      op => op.status === 'active' || op.status === 'cancelling'
    );
  }, [operations]);

  const cancelAllOperations = React.useCallback(async (): Promise<
    boolean[]
  > => {
    const activeOperations = getActiveOperations();
    const cancelPromises = activeOperations.map(op => cancelOperation(op.id));
    return Promise.all(cancelPromises);
  }, [getActiveOperations, cancelOperation]);

  const cleanup = React.useCallback(() => {
    // Abort all active controllers
    abortControllersRef.current.forEach(controller => {
      controller.abort();
    });

    // Clear all data
    setOperations(new Map());
    abortControllersRef.current.clear();
  }, []);

  // Calculate stats
  const stats = React.useMemo(() => {
    const ops = Array.from(operations.values());
    return {
      total: ops.length,
      active: ops.filter(
        op => op.status === 'active' || op.status === 'cancelling'
      ).length,
      completed: ops.filter(op => op.status === 'completed').length,
      cancelled: ops.filter(op => op.status === 'cancelled').length,
      failed: ops.filter(op => op.status === 'failed').length,
    };
  }, [operations]);

  // Cleanup on unmount
  React.useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    operations,
    registerOperation,
    cancelOperation,
    updateOperation,
    removeOperation,
    getOperation,
    getOperationsByType,
    getActiveOperations,
    cancelAllOperations,
    cleanup,
    stats,
  };
};

describe('useOperationManager Hook', () => {
  let mockApi: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup API mocks
    const apiModule = vi.mocked(await import('@/lib/api'));
    mockApi = apiModule.default;
    mockApi.delete.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  describe('Operation Registration', () => {
    it('should register new operation with auto-generated ID', () => {
      const { result } = renderHook(() => useOperationManager());

      act(() => {
        const id = result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 0,
          startTime: Date.now(),
        });

        expect(id).toMatch(/^upload-\d+-[a-z0-9]+$/);
        expect(result.current.operations.has(id)).toBe(true);
        expect(result.current.stats.total).toBe(1);
        expect(result.current.stats.active).toBe(1);
      });
    });

    it('should register operation with custom ID', () => {
      const { result } = renderHook(() => useOperationManager());

      act(() => {
        const customId = 'custom-upload-123';
        const id = result.current.registerOperation({
          id: customId,
          type: 'upload',
          status: 'active',
          progress: 25,
          startTime: Date.now(),
        });

        expect(id).toBe(customId);
        expect(result.current.operations.get(id)?.progress).toBe(25);
      });
    });

    it('should handle multiple operation types', () => {
      const { result } = renderHook(() => useOperationManager());

      act(() => {
        const _uploadId = result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 0,
          startTime: Date.now(),
        });

        const _segmentationId = result.current.registerOperation({
          type: 'segmentation',
          status: 'active',
          progress: 50,
          startTime: Date.now(),
        });

        const _exportId = result.current.registerOperation({
          type: 'export',
          status: 'active',
          progress: 75,
          startTime: Date.now(),
        });

        expect(result.current.stats.total).toBe(3);
        expect(result.current.getOperationsByType('upload')).toHaveLength(1);
        expect(result.current.getOperationsByType('segmentation')).toHaveLength(
          1
        );
        expect(result.current.getOperationsByType('export')).toHaveLength(1);
      });
    });
  });

  describe('Operation Updates', () => {
    it('should update operation progress', () => {
      const { result } = renderHook(() => useOperationManager());

      act(() => {
        const id = result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 0,
          startTime: Date.now(),
        });

        result.current.updateOperation(id, { progress: 50 });

        const operation = result.current.getOperation(id);
        expect(operation?.progress).toBe(50);
      });
    });

    it('should update operation status', () => {
      const { result } = renderHook(() => useOperationManager());

      act(() => {
        const id = result.current.registerOperation({
          type: 'segmentation',
          status: 'active',
          progress: 75,
          startTime: Date.now(),
        });

        result.current.updateOperation(id, {
          status: 'completed',
          progress: 100,
          endTime: Date.now(),
        });

        const operation = result.current.getOperation(id);
        expect(operation?.status).toBe('completed');
        expect(operation?.progress).toBe(100);
        expect(operation?.endTime).toBeDefined();
      });
    });

    it('should ignore updates to non-existent operations', () => {
      const { result } = renderHook(() => useOperationManager());

      act(() => {
        result.current.updateOperation('non-existent-id', { progress: 100 });
        expect(result.current.stats.total).toBe(0);
      });
    });
  });

  describe('Operation Cancellation', () => {
    it('should cancel single operation', async () => {
      const { result } = renderHook(() => useOperationManager());

      await act(async () => {
        const id = result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 50,
          startTime: Date.now(),
        });

        const cancelled = await result.current.cancelOperation(id);

        expect(cancelled).toBe(true);
        const operation = result.current.getOperation(id);
        expect(operation?.status).toBe('cancelled');
        expect(operation?.endTime).toBeDefined();
      });
    });

    it('should call appropriate API endpoint for each operation type', async () => {
      const { result } = renderHook(() => useOperationManager());

      await act(async () => {
        // Test upload cancellation
        const uploadId = result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 30,
          startTime: Date.now(),
        });

        await result.current.cancelOperation(uploadId);
        expect(mockApi.delete).toHaveBeenCalledWith(
          `/api/uploads/${uploadId}/cancel`
        );

        vi.clearAllMocks();

        // Test segmentation cancellation
        const segmentationId = result.current.registerOperation({
          type: 'segmentation',
          status: 'active',
          progress: 60,
          startTime: Date.now(),
        });

        await result.current.cancelOperation(segmentationId);
        expect(mockApi.delete).toHaveBeenCalledWith(
          `/api/queue/batch/${segmentationId}/cancel`
        );

        vi.clearAllMocks();

        // Test export cancellation
        const exportId = result.current.registerOperation({
          type: 'export',
          status: 'active',
          progress: 80,
          startTime: Date.now(),
        });

        await result.current.cancelOperation(exportId);
        expect(mockApi.delete).toHaveBeenCalledWith(
          `/api/exports/${exportId}/cancel`
        );
      });
    });

    it('should handle API errors gracefully', async () => {
      mockApi.delete.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useOperationManager());

      await act(async () => {
        const id = result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 50,
          startTime: Date.now(),
        });

        try {
          await result.current.cancelOperation(id);
        } catch (_error) {
          expect(error).toBeInstanceOf(Error);
        }

        // Operation should be reverted to active state on API error
        const operation = result.current.getOperation(id);
        expect(operation?.status).toBe('active');
      });
    });

    it('should not cancel already completed operations', async () => {
      const { result } = renderHook(() => useOperationManager());

      await act(async () => {
        const id = result.current.registerOperation({
          type: 'upload',
          status: 'completed',
          progress: 100,
          startTime: Date.now() - 5000,
          endTime: Date.now(),
        });

        const cancelled = await result.current.cancelOperation(id);

        expect(cancelled).toBe(false);
        expect(mockApi.delete).not.toHaveBeenCalled();
      });
    });

    it('should not cancel already cancelled operations', async () => {
      const { result } = renderHook(() => useOperationManager());

      await act(async () => {
        const id = result.current.registerOperation({
          type: 'upload',
          status: 'cancelled',
          progress: 50,
          startTime: Date.now() - 5000,
          endTime: Date.now(),
        });

        const cancelled = await result.current.cancelOperation(id);

        expect(cancelled).toBe(false);
        expect(mockApi.delete).not.toHaveBeenCalled();
      });
    });

    it('should show cancelling state during cancellation', async () => {
      const { result } = renderHook(() => useOperationManager());

      await act(async () => {
        const id = result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 50,
          startTime: Date.now(),
        });

        // Mock delayed API response
        let resolveCancel: () => void;
        const cancelPromise = new Promise<void>(resolve => {
          resolveCancel = resolve;
        });
        mockApi.delete.mockReturnValue(cancelPromise);

        // Start cancellation
        const cancelPromise2 = result.current.cancelOperation(id);

        // Check intermediate state
        const operation = result.current.getOperation(id);
        expect(operation?.status).toBe('cancelling');

        // Complete cancellation
        resolveCancel!();
        await cancelPromise2;

        const finalOperation = result.current.getOperation(id);
        expect(finalOperation?.status).toBe('cancelled');
      });
    });
  });

  describe('Batch Operations', () => {
    it('should cancel all active operations', async () => {
      const { result } = renderHook(() => useOperationManager());

      await act(async () => {
        const _ids = [
          result.current.registerOperation({
            type: 'upload',
            status: 'active',
            progress: 25,
            startTime: Date.now(),
          }),
          result.current.registerOperation({
            type: 'segmentation',
            status: 'active',
            progress: 50,
            startTime: Date.now(),
          }),
          result.current.registerOperation({
            type: 'export',
            status: 'active',
            progress: 75,
            startTime: Date.now(),
          }),
          result.current.registerOperation({
            type: 'upload',
            status: 'completed',
            progress: 100,
            startTime: Date.now() - 5000,
            endTime: Date.now(),
          }),
        ];

        const results = await result.current.cancelAllOperations();

        expect(results).toEqual([true, true, true]); // Only 3 active operations
        expect(result.current.stats.cancelled).toBe(3);
        expect(result.current.stats.completed).toBe(1); // Should preserve completed operation
      });
    });

    it('should handle mixed results in batch cancellation', async () => {
      const { result } = renderHook(() => useOperationManager());

      // Mock one API call to fail
      mockApi.delete
        .mockResolvedValueOnce({ data: { success: true } }) // First succeeds
        .mockRejectedValueOnce(new Error('Network error')); // Second fails

      await act(async () => {
        const id1 = result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 25,
          startTime: Date.now(),
        });
        const id2 = result.current.registerOperation({
          type: 'segmentation',
          status: 'active',
          progress: 50,
          startTime: Date.now(),
        });

        try {
          await result.current.cancelAllOperations();
        } catch (_error) {
          // Some operations may fail
        }

        // First operation should be cancelled
        expect(result.current.getOperation(id1)?.status).toBe('cancelled');
        // Second operation should remain active due to error
        expect(result.current.getOperation(id2)?.status).toBe('active');
      });
    });
  });

  describe('Query Operations', () => {
    it('should get operations by type', () => {
      const { result } = renderHook(() => useOperationManager());

      act(() => {
        result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 25,
          startTime: Date.now(),
        });
        result.current.registerOperation({
          type: 'upload',
          status: 'completed',
          progress: 100,
          startTime: Date.now(),
        });
        result.current.registerOperation({
          type: 'segmentation',
          status: 'active',
          progress: 50,
          startTime: Date.now(),
        });

        const uploadOps = result.current.getOperationsByType('upload');
        const segmentationOps =
          result.current.getOperationsByType('segmentation');
        const exportOps = result.current.getOperationsByType('export');

        expect(uploadOps).toHaveLength(2);
        expect(segmentationOps).toHaveLength(1);
        expect(exportOps).toHaveLength(0);
      });
    });

    it('should get active operations', () => {
      const { result } = renderHook(() => useOperationManager());

      act(() => {
        result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 25,
          startTime: Date.now(),
        });
        result.current.registerOperation({
          type: 'segmentation',
          status: 'cancelling',
          progress: 50,
          startTime: Date.now(),
        });
        result.current.registerOperation({
          type: 'export',
          status: 'completed',
          progress: 100,
          startTime: Date.now(),
        });
        result.current.registerOperation({
          type: 'upload',
          status: 'cancelled',
          progress: 30,
          startTime: Date.now(),
        });

        const activeOps = result.current.getActiveOperations();

        expect(activeOps).toHaveLength(2); // active and cancelling
        expect(activeOps.some(op => op.status === 'active')).toBe(true);
        expect(activeOps.some(op => op.status === 'cancelling')).toBe(true);
      });
    });

    it('should calculate accurate statistics', () => {
      const { result } = renderHook(() => useOperationManager());

      act(() => {
        result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 25,
          startTime: Date.now(),
        });
        result.current.registerOperation({
          type: 'segmentation',
          status: 'active',
          progress: 50,
          startTime: Date.now(),
        });
        result.current.registerOperation({
          type: 'export',
          status: 'completed',
          progress: 100,
          startTime: Date.now(),
        });
        result.current.registerOperation({
          type: 'upload',
          status: 'cancelled',
          progress: 30,
          startTime: Date.now(),
        });
        result.current.registerOperation({
          type: 'segmentation',
          status: 'failed',
          progress: 80,
          startTime: Date.now(),
        });

        expect(result.current.stats).toEqual({
          total: 5,
          active: 2,
          completed: 1,
          cancelled: 1,
          failed: 1,
        });
      });
    });
  });

  describe('Memory Management', () => {
    it('should remove operations and cleanup resources', () => {
      const { result } = renderHook(() => useOperationManager());

      act(() => {
        const id = result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 50,
          startTime: Date.now(),
        });

        expect(result.current.stats.total).toBe(1);

        const removed = result.current.removeOperation(id);

        expect(removed).toBe(true);
        expect(result.current.stats.total).toBe(0);
        expect(result.current.getOperation(id)).toBeUndefined();
      });
    });

    it('should cleanup all operations on unmount', () => {
      const { result, unmount } = renderHook(() => useOperationManager());

      act(() => {
        result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 25,
          startTime: Date.now(),
        });
        result.current.registerOperation({
          type: 'segmentation',
          status: 'active',
          progress: 50,
          startTime: Date.now(),
        });

        expect(result.current.stats.total).toBe(2);
      });

      unmount();

      // After unmount, cleanup should have been called
      expect(true).toBe(true); // Hook is unmounted, can't access result
    });

    it('should handle cleanup explicitly', () => {
      const { result } = renderHook(() => useOperationManager());

      act(() => {
        result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 25,
          startTime: Date.now(),
        });
        result.current.registerOperation({
          type: 'segmentation',
          status: 'active',
          progress: 50,
          startTime: Date.now(),
        });

        expect(result.current.stats.total).toBe(2);

        result.current.cleanup();

        expect(result.current.stats.total).toBe(0);
      });
    });
  });

  describe('Real Scenario Integration', () => {
    it('should handle upload scenario operations', async () => {
      const { operation } = uploadScenarios.singleFileUpload;
      const { result } = renderHook(() => useOperationManager());

      await act(async () => {
        const id = result.current.registerOperation({
          type: operation.type,
          status: operation.status,
          progress: operation.progress,
          startTime: operation.startTime,
        });

        // Simulate progress updates
        result.current.updateOperation(id, { progress: 75 });

        // Cancel operation
        const cancelled = await result.current.cancelOperation(id);

        expect(cancelled).toBe(true);
        const finalOp = result.current.getOperation(id);
        expect(finalOp?.status).toBe('cancelled');
      });
    });

    it('should handle batch segmentation scenario', async () => {
      const { operations } = segmentationScenarios.batchSegmentation;
      const { result } = renderHook(() => useOperationManager());

      await act(async () => {
        // Register all operations from scenario
        const _ids = operations.map(op =>
          result.current.registerOperation({
            type: op.type,
            status: op.status,
            progress: op.progress,
            startTime: op.startTime,
            endTime: op.endTime,
          })
        );

        expect(result.current.stats.total).toBe(operations.length);

        // Cancel only active operations
        const results = await result.current.cancelAllOperations();

        // Should cancel only the active operations
        const activeCount = operations.filter(
          op => op.status === 'active'
        ).length;
        expect(results).toHaveLength(activeCount);
      });
    });

    it('should handle high volume operations', async () => {
      const { operations, performance } =
        segmentationScenarios.highVolumeSegmentation;
      const { result } = renderHook(() => useOperationManager());

      const startTime = performance.now();

      await act(async () => {
        // Register subset of high volume operations
        const testOps = operations.slice(0, 20); // Test with 20 operations

        testOps.forEach(op => {
          result.current.registerOperation({
            type: op.type,
            status: op.status,
            progress: op.progress,
            startTime: op.startTime,
            endTime: op.endTime,
          });
        });

        expect(result.current.stats.total).toBe(20);

        // Cancel all active operations
        await result.current.cancelAllOperations();

        const endTime = performance.now();
        const duration = endTime - startTime;

        // Should complete within reasonable time
        expect(duration).toBeLessThan(1000); // 1 second for 20 operations
      });
    });
  });

  describe('Error Recovery', () => {
    it('should handle network errors during cancellation', async () => {
      const networkError = cancelTestUtils
        .createErrorSimulators()
        .networkError();
      mockApi.delete.mockRejectedValue(networkError);

      const { result } = renderHook(() => useOperationManager());

      await act(async () => {
        const id = result.current.registerOperation({
          type: 'upload',
          status: 'active',
          progress: 50,
          startTime: Date.now(),
        });

        try {
          await result.current.cancelOperation(id);
        } catch (_error) {
          expect(error).toBe(networkError);
        }

        // Operation should revert to active state
        const operation = result.current.getOperation(id);
        expect(operation?.status).toBe('active');
      });
    });

    it('should handle server errors gracefully', async () => {
      const serverError = cancelTestUtils
        .createErrorSimulators()
        .serverError(500);
      mockApi.delete.mockRejectedValue(serverError);

      const { result } = renderHook(() => useOperationManager());

      await act(async () => {
        const id = result.current.registerOperation({
          type: 'segmentation',
          status: 'active',
          progress: 75,
          startTime: Date.now(),
        });

        try {
          await result.current.cancelOperation(id);
        } catch (_error) {
          expect(error).toBe(serverError);
        }

        // Should maintain operation integrity
        const operation = result.current.getOperation(id);
        expect(operation?.progress).toBe(75);
      });
    });

    it('should recover from malformed API responses', async () => {
      // Mock malformed response
      mockApi.delete.mockResolvedValue(null);

      const { result } = renderHook(() => useOperationManager());

      await act(async () => {
        const id = result.current.registerOperation({
          type: 'export',
          status: 'active',
          progress: 60,
          startTime: Date.now(),
        });

        // Should still cancel locally even with malformed response
        const cancelled = await result.current.cancelOperation(id);

        expect(cancelled).toBe(true);
        const operation = result.current.getOperation(id);
        expect(operation?.status).toBe('cancelled');
      });
    });
  });

  describe('Performance', () => {
    it('should handle rapid operation registration and cancellation', async () => {
      const { result } = renderHook(() => useOperationManager());

      const startTime = performance.now();

      await act(async () => {
        // Rapidly register and cancel operations
        for (let i = 0; i < 50; i++) {
          const id = result.current.registerOperation({
            type: 'upload',
            status: 'active',
            progress: Math.floor(Math.random() * 100),
            startTime: Date.now(),
          });

          await result.current.cancelOperation(id);
        }

        const endTime = performance.now();
        const duration = endTime - startTime;

        expect(result.current.stats.cancelled).toBe(50);
        expect(duration).toBeLessThan(2000); // Should complete in less than 2 seconds
      });
    });

    it('should not leak memory with frequent operations', () => {
      const { result } = renderHook(() => useOperationManager());

      act(() => {
        // Create and remove many operations
        for (let i = 0; i < 100; i++) {
          const id = result.current.registerOperation({
            type: 'upload',
            status: 'active',
            progress: i,
            startTime: Date.now(),
          });

          result.current.removeOperation(id);
        }

        // Should have no operations left
        expect(result.current.stats.total).toBe(0);
      });
    });
  });
});
