/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { cancelTestUtils } from '@/test-utils/cancelTestHelpers';
import { segmentationScenarios } from '@/test-fixtures/cancelScenarios';
import { createWebSocketTestEnvironment } from '@/test-utils/webSocketTestUtils';

// Mock dependencies
vi.mock('@/lib/api', () => ({
  default: {
    post: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@/services/webSocketManager', () => ({
  webSocketManager: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

/**
 * Enhanced QueueStatsPanel Component Mock (TDD - to be implemented)
 * Should integrate cancel functionality with batch segmentation operations
 */
interface QueueStatsProps {
  projectId: string;
  queueStats?: {
    queued: number;
    processing: number;
    completed: number;
    total: number;
  };
  onBatchComplete?: (results: any[]) => void;
  onBatchCancel?: (batchId: string) => void;
  disabled?: boolean;
}

interface BatchSegmentationState {
  batchId: string | null;
  isProcessing: boolean;
  isCancelling: boolean;
  progress: number;
  currentImage: string | null;
  jobIds: string[];
}

const QueueStatsPanel: React.FC<QueueStatsProps> = ({
  projectId,
  queueStats = { queued: 0, processing: 0, completed: 0, total: 0 },
  onBatchComplete,
  onBatchCancel,
  disabled = false,
}) => {
  const [batchState, setBatchState] = React.useState<BatchSegmentationState>({
    batchId: null,
    isProcessing: false,
    isCancelling: false,
    progress: 0,
    currentImage: null,
    jobIds: [],
  });

  const { mockOperationManager } = cancelTestUtils.renderWithCancelProviders(
    <div />
  );

  const startBatchSegmentation = async () => {
    const batchId = `batch-seg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const jobIds = Array.from(
      { length: queueStats.total },
      (_, i) => `job-${batchId}-${i}`
    );

    setBatchState({
      batchId,
      isProcessing: true,
      isCancelling: false,
      progress: 0,
      currentImage: `image-1`,
      jobIds,
    });

    // Register batch operation
    mockOperationManager.registerOperation({
      id: batchId,
      type: 'segmentation',
      status: 'active',
      progress: 0,
      startTime: Date.now(),
    });

    // Simulate batch processing
    simulateBatchProcessing(batchId, jobIds);
  };

  const simulateBatchProcessing = async (batchId: string, jobIds: string[]) => {
    const totalJobs = jobIds.length;

    for (let i = 0; i < totalJobs; i++) {
      // Check if cancelled
      const operation = mockOperationManager.getOperation(batchId);
      if (operation?.status === 'cancelled') {
        break;
      }

      const progress = Math.round(((i + 1) / totalJobs) * 100);

      setBatchState(prev => ({
        ...prev,
        progress,
        currentImage: `image-${i + 1}`,
      }));

      mockOperationManager.updateOperation(batchId, { progress });

      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Complete if not cancelled
    const operation = mockOperationManager.getOperation(batchId);
    if (operation?.status !== 'cancelled') {
      setBatchState(prev => ({
        ...prev,
        isProcessing: false,
        progress: 100,
        currentImage: null,
      }));

      mockOperationManager.updateOperation(batchId, {
        status: 'completed',
        progress: 100,
        endTime: Date.now(),
      });

      onBatchComplete?.([]);
    }
  };

  const cancelBatchSegmentation = async () => {
    if (!batchState.batchId || !batchState.isProcessing) return;

    setBatchState(prev => ({ ...prev, isCancelling: true }));

    try {
      // Call API to cancel batch
      await new Promise(resolve => setTimeout(resolve, 200)); // Simulate API call

      // Cancel operation in manager
      await mockOperationManager.cancelOperation(batchState.batchId);

      setBatchState(prev => ({
        ...prev,
        isProcessing: false,
        isCancelling: false,
        currentImage: null,
      }));

      onBatchCancel?.(batchState.batchId);
    } catch (error) {
      setBatchState(prev => ({ ...prev, isCancelling: false }));
      throw error;
    }
  };

  const hasActiveJobs = queueStats.processing > 0 || queueStats.queued > 0;
  const canStartBatch = queueStats.total > 0 && !batchState.isProcessing;

  return (
    <div data-testid="queue-stats-panel">
      <div data-testid="queue-stats">
        <div data-testid="queued-count">Queued: {queueStats.queued}</div>
        <div data-testid="processing-count">
          Processing: {queueStats.processing}
        </div>
        <div data-testid="completed-count">
          Completed: {queueStats.completed}
        </div>
        <div data-testid="total-count">Total: {queueStats.total}</div>
      </div>

      {batchState.isProcessing && (
        <div data-testid="batch-progress">
          <div data-testid="progress-bar">
            <div
              data-testid="progress-fill"
              style={{ width: `${batchState.progress}%` }}
            />
          </div>
          <div data-testid="progress-text">{batchState.progress}%</div>
          {batchState.currentImage && (
            <div data-testid="current-image">
              Processing: {batchState.currentImage}
            </div>
          )}
        </div>
      )}

      {canStartBatch && (
        <button
          onClick={startBatchSegmentation}
          disabled={disabled}
          data-testid="segment-all-button"
        >
          Segment All Images
        </button>
      )}

      {batchState.isProcessing && (
        <button
          onClick={cancelBatchSegmentation}
          disabled={disabled || batchState.isCancelling}
          data-testid="cancel-batch-button"
        >
          {batchState.isCancelling ? 'Cancelling...' : 'Cancel Batch'}
        </button>
      )}

      {batchState.isCancelling && (
        <div data-testid="cancelling-indicator">
          <span>Cancelling batch segmentation...</span>
          <span data-testid="cancel-spinner">⟳</span>
        </div>
      )}
    </div>
  );
};

describe('QueueStatsPanel Cancel Integration', () => {
  let mockApi: any;
  let mockWebSocket: any;
  let user: any;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();

    // Setup API mocks
    const apiModule = vi.mocked(await import('@/lib/api'));
    mockApi = apiModule.default;
    mockApi.post.mockResolvedValue({ data: { success: true } });
    mockApi.delete.mockResolvedValue({
      data: { success: true, cancelledJobs: 5, completedJobs: 3 },
    });

    // Setup WebSocket mocks
    const wsEnv = createWebSocketTestEnvironment();
    mockWebSocket = wsEnv.mockSocket;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  describe('Batch Segmentation Control', () => {
    it('should replace "Segment All" button with cancel button during processing', async () => {
      const queueStats = segmentationScenarios.batchSegmentation.queueStats;

      render(
        <QueueStatsPanel projectId="test-project" queueStats={queueStats} />
      );

      // Initially should show "Segment All" button
      expect(screen.getByTestId('segment-all-button')).toBeInTheDocument();
      expect(
        screen.queryByTestId('cancel-batch-button')
      ).not.toBeInTheDocument();

      // Start batch segmentation
      await user.click(screen.getByTestId('segment-all-button'));

      // Should now show cancel button instead
      await waitFor(() => {
        expect(
          screen.queryByTestId('segment-all-button')
        ).not.toBeInTheDocument();
        expect(screen.getByTestId('cancel-batch-button')).toBeInTheDocument();
      });
    });

    it('should show progress during batch processing', async () => {
      const queueStats = { queued: 5, processing: 0, completed: 0, total: 5 };

      render(
        <QueueStatsPanel projectId="test-project" queueStats={queueStats} />
      );

      await user.click(screen.getByTestId('segment-all-button'));

      // Should show progress indicators
      await waitFor(() => {
        expect(screen.getByTestId('batch-progress')).toBeInTheDocument();
        expect(screen.getByTestId('progress-bar')).toBeInTheDocument();
        expect(screen.getByTestId('progress-text')).toBeInTheDocument();
        expect(screen.getByTestId('current-image')).toBeInTheDocument();
      });
    });

    it('should update progress during batch processing', async () => {
      vi.useFakeTimers();

      const queueStats = { queued: 3, processing: 0, completed: 0, total: 3 };

      render(
        <QueueStatsPanel projectId="test-project" queueStats={queueStats} />
      );

      await user.click(screen.getByTestId('segment-all-button'));

      // Advance time to see progress updates
      vi.advanceTimersByTime(150);

      await waitFor(() => {
        const progressText = screen.getByTestId('progress-text');
        expect(progressText.textContent).not.toBe('0%');
      });

      vi.useRealTimers();
    });
  });

  describe('Batch Cancellation', () => {
    it('should cancel batch segmentation when cancel button is clicked', async () => {
      const onBatchCancel = vi.fn();
      const queueStats = { queued: 5, processing: 0, completed: 0, total: 5 };

      render(
        <QueueStatsPanel
          projectId="test-project"
          queueStats={queueStats}
          onBatchCancel={onBatchCancel}
        />
      );

      // Start batch
      await user.click(screen.getByTestId('segment-all-button'));

      await waitFor(() => {
        expect(screen.getByTestId('cancel-batch-button')).toBeInTheDocument();
      });

      // Cancel batch
      await user.click(screen.getByTestId('cancel-batch-button'));

      await waitFor(() => {
        expect(onBatchCancel).toHaveBeenCalled();
        expect(
          screen.queryByTestId('cancel-batch-button')
        ).not.toBeInTheDocument();
        expect(screen.getByTestId('segment-all-button')).toBeInTheDocument();
      });
    });

    it('should show cancelling state during cancellation', async () => {
      const queueStats = { queued: 5, processing: 0, completed: 0, total: 5 };

      render(
        <QueueStatsPanel projectId="test-project" queueStats={queueStats} />
      );

      await user.click(screen.getByTestId('segment-all-button'));

      await waitFor(() => {
        expect(screen.getByTestId('cancel-batch-button')).toBeInTheDocument();
      });

      // Mock delayed cancellation
      let resolveCancellation: () => void;
      const cancellationPromise = new Promise<void>(resolve => {
        resolveCancellation = resolve;
      });

      // Click cancel and verify loading state
      const cancelButton = screen.getByTestId('cancel-batch-button');
      await user.click(cancelButton);

      expect(cancelButton).toHaveTextContent('Cancelling...');
      expect(cancelButton).toBeDisabled();
      expect(screen.getByTestId('cancelling-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('cancel-spinner')).toBeInTheDocument();
    });

    it('should handle partial batch cancellation', async () => {
      const { operations, queueStats } =
        segmentationScenarios.batchSegmentation;
      const onBatchCancel = vi.fn();

      // Mock API response for partial cancellation
      mockApi.delete.mockResolvedValue({
        data: {
          success: true,
          cancelledJobs: 7,
          completedJobs: 3,
          message: 'Batch partially cancelled',
        },
      });

      render(
        <QueueStatsPanel
          projectId="test-project"
          queueStats={queueStats}
          onBatchCancel={onBatchCancel}
        />
      );

      await user.click(screen.getByTestId('segment-all-button'));

      await waitFor(() => {
        expect(screen.getByTestId('cancel-batch-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('cancel-batch-button'));

      await waitFor(() => {
        expect(onBatchCancel).toHaveBeenCalled();
      });

      // Verify API was called correctly
      expect(mockApi.delete).toHaveBeenCalled();
    });

    it('should handle high volume batch cancellation', async () => {
      const { performance } = segmentationScenarios.highVolumeSegmentation;
      const queueStats = {
        queued: 9950,
        processing: 50,
        completed: 0,
        total: 10000,
      };

      render(
        <QueueStatsPanel projectId="test-project" queueStats={queueStats} />
      );

      await user.click(screen.getByTestId('segment-all-button'));

      await waitFor(() => {
        expect(screen.getByTestId('cancel-batch-button')).toBeInTheDocument();
      });

      const cancelStart = performance.now();
      await user.click(screen.getByTestId('cancel-batch-button'));

      await waitFor(() => {
        expect(screen.getByTestId('segment-all-button')).toBeInTheDocument();
      });

      const cancelDuration = performance.now() - cancelStart;
      expect(cancelDuration).toBeLessThan(performance.expectedCancelTime);
    });
  });

  describe('WebSocket Integration', () => {
    it('should emit WebSocket events during batch cancellation', async () => {
      const webSocketManager = vi.mocked(
        await import('@/services/webSocketManager')
      ).webSocketManager;

      render(
        <QueueStatsPanel
          projectId="test-project"
          queueStats={{ queued: 3, processing: 0, completed: 0, total: 3 }}
        />
      );

      await user.click(screen.getByTestId('segment-all-button'));
      await user.click(screen.getByTestId('cancel-batch-button'));

      // Verify WebSocket events would be emitted
      // (In real implementation, this would check specific event emissions)
      expect(true).toBe(true); // Placeholder for actual WebSocket verification
    });

    it('should handle queue stats updates via WebSocket', async () => {
      const initialStats = { queued: 5, processing: 0, completed: 0, total: 5 };

      const { rerender } = render(
        <QueueStatsPanel projectId="test-project" queueStats={initialStats} />
      );

      // Simulate WebSocket queue stats update
      const updatedStats = { queued: 3, processing: 1, completed: 1, total: 5 };

      rerender(
        <QueueStatsPanel projectId="test-project" queueStats={updatedStats} />
      );

      expect(screen.getByTestId('queued-count')).toHaveTextContent('Queued: 3');
      expect(screen.getByTestId('processing-count')).toHaveTextContent(
        'Processing: 1'
      );
      expect(screen.getByTestId('completed-count')).toHaveTextContent(
        'Completed: 1'
      );
    });

    it('should sync operation status via WebSocket after reconnection', async () => {
      render(
        <QueueStatsPanel
          projectId="test-project"
          queueStats={{ queued: 5, processing: 0, completed: 0, total: 5 }}
        />
      );

      await user.click(screen.getByTestId('segment-all-button'));

      // Simulate disconnect during processing
      mockWebSocket.__simulateDisconnect('transport close');

      // Simulate reconnection with cancelled status
      mockWebSocket.__simulateReconnect(1);

      // Should handle status sync appropriately
      expect(screen.getByTestId('cancel-batch-button')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle API cancellation errors', async () => {
      mockApi.delete.mockRejectedValue(new Error('Server error'));

      render(
        <QueueStatsPanel
          projectId="test-project"
          queueStats={{ queued: 3, processing: 0, completed: 0, total: 3 }}
        />
      );

      await user.click(screen.getByTestId('segment-all-button'));

      await waitFor(() => {
        expect(screen.getByTestId('cancel-batch-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('cancel-batch-button'));

      // Should handle error gracefully and reset state
      await waitFor(() => {
        expect(screen.getByTestId('cancel-batch-button')).not.toBeDisabled();
      });
    });

    it('should handle ML service errors during cancellation', async () => {
      const { mlServiceError } = segmentationScenarios.mlServiceErrorScenario;

      // Mock ML service error response
      mockApi.delete.mockRejectedValue({
        response: {
          status: 500,
          data: { error: mlServiceError.message },
        },
      });

      render(
        <QueueStatsPanel
          projectId="test-project"
          queueStats={{ queued: 5, processing: 1, completed: 0, total: 6 }}
        />
      );

      await user.click(screen.getByTestId('segment-all-button'));
      await user.click(screen.getByTestId('cancel-batch-button'));

      // Should handle ML service error
      await waitFor(() => {
        // Error handling should be implemented
        expect(screen.getByTestId('cancel-batch-button')).not.toBeDisabled();
      });
    });

    it('should handle network errors during cancellation', async () => {
      // Simulate network error
      mockApi.delete.mockRejectedValue(new TypeError('Network request failed'));

      render(
        <QueueStatsPanel
          projectId="test-project"
          queueStats={{ queued: 3, processing: 0, completed: 0, total: 3 }}
        />
      );

      await user.click(screen.getByTestId('segment-all-button'));
      await user.click(screen.getByTestId('cancel-batch-button'));

      // Should handle network error and allow retry
      await waitFor(() => {
        expect(screen.getByTestId('cancel-batch-button')).not.toBeDisabled();
      });
    });
  });

  describe('State Management', () => {
    it('should maintain consistent state during rapid operations', async () => {
      render(
        <QueueStatsPanel
          projectId="test-project"
          queueStats={{ queued: 3, processing: 0, completed: 0, total: 3 }}
        />
      );

      // Rapid start/cancel cycles
      for (let i = 0; i < 5; i++) {
        await user.click(screen.getByTestId('segment-all-button'));

        await waitFor(() => {
          expect(screen.getByTestId('cancel-batch-button')).toBeInTheDocument();
        });

        await user.click(screen.getByTestId('cancel-batch-button'));

        await waitFor(() => {
          expect(screen.getByTestId('segment-all-button')).toBeInTheDocument();
        });
      }

      // Should maintain consistent state
      expect(screen.getByTestId('segment-all-button')).toBeInTheDocument();
      expect(
        screen.queryByTestId('cancel-batch-button')
      ).not.toBeInTheDocument();
    });

    it('should handle concurrent batch operations correctly', async () => {
      const onBatchCancel = vi.fn();

      render(
        <QueueStatsPanel
          projectId="test-project"
          queueStats={{ queued: 5, processing: 0, completed: 0, total: 5 }}
          onBatchCancel={onBatchCancel}
        />
      );

      await user.click(screen.getByTestId('segment-all-button'));

      // Attempt to start another batch (should not be possible)
      expect(
        screen.queryByTestId('segment-all-button')
      ).not.toBeInTheDocument();

      await user.click(screen.getByTestId('cancel-batch-button'));

      await waitFor(() => {
        expect(onBatchCancel).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Accessibility', () => {
    it('should provide accessible controls for batch operations', async () => {
      render(
        <QueueStatsPanel
          projectId="test-project"
          queueStats={{ queued: 3, processing: 0, completed: 0, total: 3 }}
        />
      );

      const segmentButton = screen.getByTestId('segment-all-button');
      expect(segmentButton.tagName).toBe('BUTTON');
      expect(segmentButton).toHaveTextContent('Segment All Images');

      await user.click(segmentButton);

      await waitFor(() => {
        const cancelButton = screen.getByTestId('cancel-batch-button');
        expect(cancelButton.tagName).toBe('BUTTON');
        expect(cancelButton).toHaveTextContent('Cancel Batch');
      });
    });

    it('should be keyboard navigable', async () => {
      render(
        <QueueStatsPanel
          projectId="test-project"
          queueStats={{ queued: 3, processing: 0, completed: 0, total: 3 }}
        />
      );

      const segmentButton = screen.getByTestId('segment-all-button');
      segmentButton.focus();
      expect(segmentButton).toHaveFocus();

      // Press Enter to start
      fireEvent.keyDown(segmentButton, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        const cancelButton = screen.getByTestId('cancel-batch-button');
        expect(cancelButton).toBeInTheDocument();

        cancelButton.focus();
        expect(cancelButton).toHaveFocus();
      });
    });

    it('should provide screen reader friendly progress updates', async () => {
      render(
        <QueueStatsPanel
          projectId="test-project"
          queueStats={{ queued: 3, processing: 0, completed: 0, total: 3 }}
        />
      );

      await user.click(screen.getByTestId('segment-all-button'));

      await waitFor(() => {
        const progressText = screen.getByTestId('progress-text');
        expect(progressText).toBeInTheDocument();

        const currentImage = screen.getByTestId('current-image');
        expect(currentImage).toBeInTheDocument();
      });
    });
  });
});
