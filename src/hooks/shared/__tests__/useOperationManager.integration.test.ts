/**
 * @file Operation Manager Integration Tests
 * Tests for the universal operation manager across upload, segmentation, and export operations
 */

import { renderHook, act, waitFor as _waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOperationManager, OperationType as _OperationType } from '../useOperationManager';

// Mock WebSocket context
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

vi.mock('@/contexts/useWebSocket', () => ({
  useWebSocket: () => ({ socket: mockSocket }),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useOperationManager Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Operation Lifecycle Management', () => {
    it('should manage complete upload operation lifecycle', async () => {
      const { result } = renderHook(() => useOperationManager());

      const uploadId = 'upload_123';

      // Start upload operation
      act(() => {
        result.current.startOperation(uploadId, 'upload');
      });

      expect(result.current.isOperationActive('upload')).toBe(true);
      expect(result.current.getActiveOperation('upload')).toMatchObject({
        id: uploadId,
        type: 'upload',
        status: 'active',
        progress: 0,
      });

      // Update progress
      act(() => {
        result.current.updateOperationProgress(
          uploadId,
          50,
          'Uploading files...'
        );
      });

      expect(result.current.getOperationProgress(uploadId)).toBe(50);
      expect(result.current.getActiveOperation('upload')?.message).toBe(
        'Uploading files...'
      );

      // Complete operation
      act(() => {
        result.current.completeOperation(uploadId, true, 'Upload completed');
      });

      expect(result.current.isOperationActive('upload')).toBe(false);
      expect(result.current.getActiveOperation('upload')?.status).toBe(
        'completed'
      );
    });

    it('should handle operation cancellation workflow', async () => {
      const { result } = renderHook(() => useOperationManager());

      const segmentationId = 'segmentation_456';

      // Start segmentation
      act(() => {
        result.current.startOperation(segmentationId, 'segmentation');
      });

      expect(result.current.isOperationActive('segmentation')).toBe(true);

      // Cancel operation
      await act(async () => {
        await result.current.cancelOperation(segmentationId);
      });

      expect(result.current.isOperationCancelling(segmentationId)).toBe(true);
      expect(mockSocket.emit).toHaveBeenCalledWith('operation:cancel', {
        operationId: segmentationId,
        operationType: 'segmentation',
      });
    });

    it('should handle multiple concurrent operations', () => {
      const { result } = renderHook(() => useOperationManager());

      const uploadId = 'upload_123';
      const exportId = 'export_456';

      // Start multiple operations
      act(() => {
        result.current.startOperation(uploadId, 'upload');
        result.current.startOperation(exportId, 'export');
      });

      expect(result.current.isOperationActive('upload')).toBe(true);
      expect(result.current.isOperationActive('export')).toBe(true);
      expect(result.current.activeOperations.size).toBe(2);

      // Update progress for both
      act(() => {
        result.current.updateOperationProgress(uploadId, 30);
        result.current.updateOperationProgress(exportId, 60);
      });

      expect(result.current.getOperationProgress(uploadId)).toBe(30);
      expect(result.current.getOperationProgress(exportId)).toBe(60);
    });
  });

  describe('WebSocket Integration', () => {
    it('should listen for WebSocket cancel events', () => {
      renderHook(() => useOperationManager());

      expect(mockSocket.on).toHaveBeenCalledWith(
        'operation:cancelled',
        expect.any(Function)
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        'operation:progress',
        expect.any(Function)
      );
    });

    it('should handle WebSocket cancel events', () => {
      const { result } = renderHook(() => useOperationManager());

      const operationId = 'test_operation';

      // Start operation
      act(() => {
        result.current.startOperation(operationId, 'upload');
      });

      // Simulate WebSocket cancel event
      const cancelHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'operation:cancelled'
      )?.[1];

      act(() => {
        cancelHandler?.({
          operationId,
          operationType: 'upload',
          message: 'Cancelled by server',
        });
      });

      expect(result.current.getActiveOperation('upload')?.status).toBe(
        'failed'
      );
    });

    it('should handle WebSocket progress events', () => {
      const { result } = renderHook(() => useOperationManager());

      const operationId = 'test_operation';

      // Start operation
      act(() => {
        result.current.startOperation(operationId, 'segmentation');
      });

      // Simulate WebSocket progress event
      const progressHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'operation:progress'
      )?.[1];

      act(() => {
        progressHandler?.({
          operationId,
          progress: 75,
          message: 'Processing images...',
        });
      });

      expect(result.current.getOperationProgress(operationId)).toBe(75);
      expect(result.current.getActiveOperation('segmentation')?.message).toBe(
        'Processing images...'
      );
    });

    it('should clean up WebSocket listeners on unmount', () => {
      const { unmount } = renderHook(() => useOperationManager());

      unmount();

      expect(mockSocket.off).toHaveBeenCalledWith(
        'operation:cancelled',
        expect.any(Function)
      );
      expect(mockSocket.off).toHaveBeenCalledWith(
        'operation:progress',
        expect.any(Function)
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle cancel operation failures gracefully', async () => {
      const { result } = renderHook(() => useOperationManager());

      const operationId = 'test_operation';

      // Start operation
      act(() => {
        result.current.startOperation(operationId, 'upload');
      });

      // Mock socket emit to throw error
      mockSocket.emit.mockImplementation(() => {
        throw new Error('WebSocket error');
      });

      // Cancel operation should handle error
      await act(async () => {
        await expect(
          result.current.cancelOperation(operationId)
        ).rejects.toThrow('WebSocket error');
      });

      // Operation should return to active state on cancel failure
      expect(result.current.getActiveOperation('upload')?.status).toBe(
        'active'
      );
    });

    it('should handle invalid operation IDs gracefully', () => {
      const { result } = renderHook(() => useOperationManager());

      // Try to cancel non-existent operation
      act(() => {
        result.current.cancelOperation('nonexistent');
      });

      // Should not throw or cause issues
      expect(result.current.activeOperations.size).toBe(0);
    });

    it('should validate operation types', () => {
      const { result } = renderHook(() => useOperationManager());

      const operationId = 'test_operation';

      // Start operation with valid type
      act(() => {
        result.current.startOperation(operationId, 'upload');
      });

      expect(result.current.isOperationActive('upload')).toBe(true);
      expect(result.current.isOperationActive('segmentation')).toBe(false);
      expect(result.current.isOperationActive('export')).toBe(false);
    });
  });

  describe('Progress Management', () => {
    it('should clamp progress values to valid range', () => {
      const { result } = renderHook(() => useOperationManager());

      const operationId = 'test_operation';

      act(() => {
        result.current.startOperation(operationId, 'upload');
      });

      // Test negative progress
      act(() => {
        result.current.updateOperationProgress(operationId, -10);
      });
      expect(result.current.getOperationProgress(operationId)).toBe(0);

      // Test progress over 100
      act(() => {
        result.current.updateOperationProgress(operationId, 150);
      });
      expect(result.current.getOperationProgress(operationId)).toBe(100);

      // Test normal progress
      act(() => {
        result.current.updateOperationProgress(operationId, 50);
      });
      expect(result.current.getOperationProgress(operationId)).toBe(50);
    });

    it('should handle progress updates for non-existent operations', () => {
      const { result } = renderHook(() => useOperationManager());

      // Should not throw when updating progress for non-existent operation
      act(() => {
        result.current.updateOperationProgress('nonexistent', 50);
      });

      expect(result.current.getOperationProgress('nonexistent')).toBe(0);
    });
  });

  describe('Cleanup and Memory Management', () => {
    it('should clean up completed operations', () => {
      const { result } = renderHook(() => useOperationManager());

      const uploadId = 'upload_123';
      const segmentationId = 'segmentation_456';

      // Start operations
      act(() => {
        result.current.startOperation(uploadId, 'upload');
        result.current.startOperation(segmentationId, 'segmentation');
      });

      // Complete one operation
      act(() => {
        result.current.completeOperation(uploadId, true);
      });

      expect(result.current.activeOperations.size).toBe(2);

      // Clear completed operations
      act(() => {
        result.current.clearCompletedOperations();
      });

      expect(result.current.activeOperations.size).toBe(1);
      expect(result.current.isOperationActive('segmentation')).toBe(true);
      expect(result.current.isOperationActive('upload')).toBe(false);
    });

    it('should clean up on unmount', () => {
      const { result, unmount } = renderHook(() => useOperationManager());

      // Start some operations
      act(() => {
        result.current.startOperation('upload_123', 'upload');
        result.current.startOperation('export_456', 'export');
      });

      expect(result.current.activeOperations.size).toBe(2);

      // Unmount should clean up
      unmount();

      // Can't test the cleanup directly, but WebSocket listeners should be removed
      expect(mockSocket.off).toHaveBeenCalled();
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle rapid operation start/cancel cycles', async () => {
      const { result } = renderHook(() => useOperationManager());

      const operationId = 'rapid_test';

      // Rapid start/cancel cycle
      for (let i = 0; i < 5; i++) {
        act(() => {
          result.current.startOperation(`${operationId}_${i}`, 'upload');
        });

        await act(async () => {
          await result.current.cancelOperation(`${operationId}_${i}`);
        });
      }

      // Should handle all operations correctly
      expect(mockSocket.emit).toHaveBeenCalledTimes(5);
    });

    it('should handle concurrent operations of different types', () => {
      const { result } = renderHook(() => useOperationManager());

      // Start different operation types
      act(() => {
        result.current.startOperation('upload_1', 'upload');
        result.current.startOperation('segment_1', 'segmentation');
        result.current.startOperation('export_1', 'export');
      });

      expect(result.current.isOperationActive('upload')).toBe(true);
      expect(result.current.isOperationActive('segmentation')).toBe(true);
      expect(result.current.isOperationActive('export')).toBe(true);

      // Each operation type should have its own active operation
      expect(result.current.getActiveOperation('upload')?.id).toBe('upload_1');
      expect(result.current.getActiveOperation('segmentation')?.id).toBe(
        'segment_1'
      );
      expect(result.current.getActiveOperation('export')?.id).toBe('export_1');
    });
  });
});
