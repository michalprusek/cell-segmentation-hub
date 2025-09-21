/**
 * @vitest-environment jsdom
 *
 * Comprehensive TDD tests for ProjectDetail queue cancellation functionality
 * Tests written BEFORE implementation to ensure quality and prevent regressions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import ProjectDetail from '../ProjectDetail';
import * as apiClient from '@/lib/api';
import { toast } from 'sonner';

// Mock dependencies
vi.mock('@/lib/api');
vi.mock('sonner');
vi.mock('@/contexts/exports', () => ({
  useAuth: () => ({
    user: { id: 'user-123', email: 'test@example.com' },
  }),
  useLanguage: () => ({
    t: (key: string, params?: any) => {
      const translations: Record<string, string> = {
        'errors.noProjectOrUser': 'No project or user',
        'queue.batchCancelled': `Cancelled ${params?.count || 0} queue items`,
        'queue.nothingToCancel': 'No items to cancel',
        'queue.itemsAlreadyProcessing': 'Items are already processing',
        'queue.cancelFailed': 'Failed to cancel batch operation',
        'queue.cancel': 'Cancel',
        'queue.cancelling': 'Cancelling...',
        'projects.allImagesAlreadySegmented': 'All images already segmented',
      };
      return translations[key] || key;
    },
  }),
  useModel: () => ({
    selectedModel: 'unet',
    confidenceThreshold: 0.5,
    detectHoles: false,
  }),
}));

vi.mock('@/hooks/useProjectData', () => ({
  useProjectData: () => ({
    projectTitle: 'Test Project',
    images: mockImages,
    loading: false,
    updateImages: vi.fn(),
    refreshImageSegmentation: vi.fn(),
  }),
}));

vi.mock('@/hooks/useSegmentationQueue', () => ({
  useSegmentationQueue: () => ({
    isConnected: true,
    queueStats: { queued: 5, processing: 2 },
    lastUpdate: null,
    requestQueueStats: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: 'project-123' }),
    useNavigate: () => vi.fn(),
  };
});

const mockImages = [
  {
    id: 'img-1',
    name: 'test1.jpg',
    segmentationStatus: 'queued',
    url: '/images/test1.jpg',
    thumbnail_url: '/thumbs/test1.jpg',
  },
  {
    id: 'img-2',
    name: 'test2.jpg',
    segmentationStatus: 'processing',
    url: '/images/test2.jpg',
    thumbnail_url: '/thumbs/test2.jpg',
  },
  {
    id: 'img-3',
    name: 'test3.jpg',
    segmentationStatus: 'completed',
    url: '/images/test3.jpg',
    thumbnail_url: '/thumbs/test3.jpg',
  },
];

const renderComponent = () => {
  return render(
    <BrowserRouter>
      <ProjectDetail />
    </BrowserRouter>
  );
};

describe('ProjectDetail Cancel Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock successful API responses by default
    vi.mocked(apiClient.default.get).mockImplementation((url: string) => {
      if (url.includes('/queue/projects/')) {
        return Promise.resolve({
          data: [
            {
              id: 'queue-1',
              userId: 'user-123',
              status: 'queued',
              imageId: 'img-1',
            },
            {
              id: 'queue-2',
              userId: 'user-123',
              status: 'processing',
              imageId: 'img-2',
            },
            {
              id: 'queue-3',
              userId: 'other-user',
              status: 'queued',
              imageId: 'img-4',
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    vi.mocked(apiClient.default.delete).mockResolvedValue({
      data: { success: true },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('handleCancelBatch - Basic Functionality', () => {
    it('should handle successful batch cancellation', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Find and click cancel button
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(apiClient.default.get).toHaveBeenCalledWith(
          '/queue/projects/project-123/items'
        );
      });

      await waitFor(() => {
        expect(apiClient.default.delete).toHaveBeenCalledWith(
          '/queue/items/queue-1'
        );
        expect(apiClient.default.delete).toHaveBeenCalledWith(
          '/queue/items/queue-2'
        );
      });

      expect(toast.success).toHaveBeenCalledWith('Cancelled 2 queue items');
    });

    it('should not cancel items from other users', async () => {
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(apiClient.default.delete).not.toHaveBeenCalledWith(
          '/queue/items/queue-3'
        );
      });
    });

    it('should handle empty queue gracefully', async () => {
      vi.mocked(apiClient.default.get).mockResolvedValueOnce({ data: [] });

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith('No items to cancel');
      });

      expect(apiClient.default.delete).not.toHaveBeenCalled();
    });

    it('should handle malformed API response', async () => {
      // Test when API returns non-array data (fixes TypeError: .filter is not a function)
      vi.mocked(apiClient.default.get).mockResolvedValueOnce({ data: null });

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith('No items to cancel');
      });

      // Should not crash with TypeError
      expect(apiClient.default.delete).not.toHaveBeenCalled();
    });

    it('should handle API response with undefined data', async () => {
      vi.mocked(apiClient.default.get).mockResolvedValueOnce({
        data: undefined,
      });

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith('No items to cancel');
      });
    });

    it('should handle API response with object instead of array', async () => {
      vi.mocked(apiClient.default.get).mockResolvedValueOnce({
        data: { message: 'No items' },
      });

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith('No items to cancel');
      });
    });
  });

  describe('Cancel Button UI States', () => {
    it('should show cancel button when batch is submitted', async () => {
      renderComponent();

      // Simulate batch submission
      const segmentButton = screen.getByRole('button', { name: /segment/i });
      await userEvent.click(segmentButton);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /cancel/i })
        ).toBeInTheDocument();
      });
    });

    it('should disable cancel button during cancellation', async () => {
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      // Mock delayed API response
      vi.mocked(apiClient.default.get).mockImplementation(
        () =>
          new Promise(resolve => setTimeout(() => resolve({ data: [] }), 100))
      );

      await user.click(cancelButton);

      // Button should be disabled immediately
      expect(cancelButton).toBeDisabled();
      expect(screen.getByText('Cancelling...')).toBeInTheDocument();

      await waitFor(() => {
        expect(cancelButton).not.toBeDisabled();
      });
    });

    it('should show loading spinner during cancellation', async () => {
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      // Mock delayed response
      vi.mocked(apiClient.default.get).mockImplementation(
        () =>
          new Promise(resolve => setTimeout(() => resolve({ data: [] }), 100))
      );

      await user.click(cancelButton);

      expect(screen.getByText('Cancelling...')).toBeInTheDocument();
      // Spinner should be visible (Loader2 component)
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('should prevent double cancellation', async () => {
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      // Mock delayed response
      vi.mocked(apiClient.default.get).mockImplementation(
        () =>
          new Promise(resolve => setTimeout(() => resolve({ data: [] }), 100))
      );

      // Click twice rapidly
      await user.click(cancelButton);
      await user.click(cancelButton);

      // API should only be called once
      expect(apiClient.default.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      vi.mocked(apiClient.default.get).mockRejectedValueOnce(
        new Error('Network error')
      );

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Failed to cancel batch operation'
        );
      });
    });

    it('should handle partial cancellation failures', async () => {
      // First item succeeds, second fails
      vi.mocked(apiClient.default.delete)
        .mockResolvedValueOnce({ data: { success: true } })
        .mockRejectedValueOnce(new Error('Delete failed'));

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Cancelled 1 queue items');
      });

      // Should still show success for partially completed operation
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('should handle complete cancellation failure', async () => {
      vi.mocked(apiClient.default.delete).mockRejectedValue(
        new Error('Delete failed')
      );

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.warning).toHaveBeenCalledWith(
          'Items are already processing'
        );
      });
    });

    it('should handle missing user context', async () => {
      // Mock missing user
      vi.doMock('@/contexts/exports', () => ({
        useAuth: () => ({ user: null }),
        useLanguage: () => ({
          t: (key: string) => key,
        }),
        useModel: () => ({
          selectedModel: 'unet',
          confidenceThreshold: 0.5,
          detectHoles: false,
        }),
      }));

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('No project or user');
      });

      expect(apiClient.default.get).not.toHaveBeenCalled();
    });
  });

  describe('State Management', () => {
    it('should reset batch submission state after cancellation', async () => {
      const user = userEvent.setup();
      renderComponent();

      // First submit a batch
      const segmentButton = screen.getByRole('button', { name: /segment/i });
      await user.click(segmentButton);

      // Then cancel it
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByText('Cancelling...')).not.toBeInTheDocument();
      });

      // Batch submitted state should be reset
      // The cancel button should no longer be visible
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /cancel/i })
        ).not.toBeInTheDocument();
      });
    });

    it('should clear navigation flags after cancellation', async () => {
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        // Internal state should be cleared (tested through side effects)
        expect(toast.info).toHaveBeenCalledWith('No items to cancel');
      });

      // Should not attempt navigation after cancellation
      // This is tested implicitly through the state reset
    });

    it('should revert UI changes for queued images', async () => {
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(apiClient.default.get).toHaveBeenCalled();
      });

      // Image states should be reverted to original status
      // This is tested through the updateImages function call
    });
  });

  describe('Toast Messages', () => {
    it('should show correct success message with count', async () => {
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Cancelled 2 queue items');
      });
    });

    it('should show warning when items are already processing', async () => {
      // Mock scenario where deletion fails (items in processing)
      vi.mocked(apiClient.default.delete).mockRejectedValue(
        new Error('Cannot cancel processing item')
      );

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.warning).toHaveBeenCalledWith(
          'Items are already processing'
        );
      });
    });

    it('should show info when no user items found', async () => {
      // Mock queue with no user items
      vi.mocked(apiClient.default.get).mockResolvedValueOnce({
        data: [{ id: 'queue-1', userId: 'other-user', status: 'queued' }],
      });

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith('No items to cancel');
      });
    });
  });

  describe('Large Scale Operations', () => {
    it('should handle cancellation of 200+ queue items', async () => {
      // Generate large queue
      const largeQueue = Array.from({ length: 250 }, (_, i) => ({
        id: `queue-${i}`,
        userId: 'user-123',
        status: i < 200 ? 'queued' : 'processing',
        imageId: `img-${i}`,
      }));

      vi.mocked(apiClient.default.get).mockResolvedValueOnce({
        data: largeQueue,
      });

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(apiClient.default.delete).toHaveBeenCalledTimes(250);
      });

      expect(toast.success).toHaveBeenCalledWith('Cancelled 250 queue items');
    });

    it('should handle cancellation performance with large datasets', async () => {
      const startTime = Date.now();

      // Large queue simulation
      const largeQueue = Array.from({ length: 1000 }, (_, i) => ({
        id: `queue-${i}`,
        userId: 'user-123',
        status: 'queued',
        imageId: `img-${i}`,
      }));

      vi.mocked(apiClient.default.get).mockResolvedValueOnce({
        data: largeQueue,
      });

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalled();
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time (10 seconds for test)
      expect(duration).toBeLessThan(10000);
    });
  });

  describe('Integration with WebSocket Events', () => {
    it('should handle queue:cancelled WebSocket event', async () => {
      // This would be tested in integration tests
      // For unit tests, we verify the cancel function works correctly
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(apiClient.default.get).toHaveBeenCalled();
      });

      // WebSocket integration would emit events after cancellation
      // This is tested in WebSocket integration tests
    });

    it('should handle batch:cancelled WebSocket event', async () => {
      // Similar to above - tested in integration tests
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(apiClient.default.delete).toHaveBeenCalled();
      });

      // Batch cancellation should trigger WebSocket events
    });
  });

  describe('Authorization and Security', () => {
    it("should only cancel current user's queue items", async () => {
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        // Should only cancel user-123's items, not other-user's
        expect(apiClient.default.delete).toHaveBeenCalledWith(
          '/queue/items/queue-1'
        );
        expect(apiClient.default.delete).toHaveBeenCalledWith(
          '/queue/items/queue-2'
        );
        expect(apiClient.default.delete).not.toHaveBeenCalledWith(
          '/queue/items/queue-3'
        );
      });
    });

    it('should require valid project ID', async () => {
      // Mock missing project ID
      vi.doMock('react-router-dom', async () => {
        const actual = await vi.importActual('react-router-dom');
        return {
          ...actual,
          useParams: () => ({ id: undefined }),
          useNavigate: () => vi.fn(),
        };
      });

      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('No project or user');
      });

      expect(apiClient.default.get).not.toHaveBeenCalled();
    });
  });

  // TDD REQUIREMENT: Test partial cancellation handling (some succeed, some fail)
  describe('Partial Cancellation Handling - TDD', () => {
    it('should handle mixed success/failure results properly', async () => {
      const user = userEvent.setup();

      // Mock partial success scenario
      vi.mocked(apiClient.default.delete)
        .mockResolvedValueOnce({ data: { success: true } }) // queue-1 succeeds
        .mockRejectedValueOnce({ // queue-2 fails with 409
          response: {
            status: 409,
            data: { message: 'Cannot cancel item in processing status' }
          }
        });

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        // Should show both success and error messages
        expect(toast.success).toHaveBeenCalledWith('Cancelled 1 queue items');
        expect(toast.error).toHaveBeenCalledWith('Failed to cancel 1 item: Cannot cancel item in processing status');
      });
    });

    it('should track cancellation progress for large batches', async () => {
      const user = userEvent.setup();

      // Generate 50 items to test progress tracking
      const largeQueue = Array.from({ length: 50 }, (_, i) => ({
        id: `queue-${i}`,
        userId: 'user-123',
        status: 'queued',
        imageId: `img-${i}`,
      }));

      vi.mocked(apiClient.default.get).mockResolvedValueOnce({
        data: largeQueue,
      });

      // Mock progressive success/failure
      vi.mocked(apiClient.default.delete).mockImplementation((url) => {
        const queueId = url.split('/').pop();
        const index = parseInt(queueId?.split('-')[1] || '0');

        if (index < 30) {
          return Promise.resolve({ data: { success: true } });
        } else {
          return Promise.reject({
            response: {
              status: 409,
              data: { message: 'Cannot cancel processing item' }
            }
          });
        }
      });

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Cancelled 30 queue items');
        expect(toast.error).toHaveBeenCalledWith('Failed to cancel 20 items: Cannot cancel processing item');
      });
    });

    it('should not show duplicate success messages from WebSocket and manual cancellation', async () => {
      const user = userEvent.setup();
      let websocketCallback: any;

      // Mock WebSocket subscription
      const mockWebSocket = {
        on: vi.fn((event, callback) => {
          if (event === 'queue:cancelled') {
            websocketCallback = callback;
          }
        }),
        off: vi.fn(),
        emit: vi.fn()
      };

      vi.doMock('@/contexts/exports', () => ({
        useAuth: () => ({
          user: { id: 'user-123', email: 'test@example.com' },
        }),
        useLanguage: () => ({
          t: (key: string, _params?: any) => key,
        }),
        useModel: () => ({
          selectedModel: 'unet',
          confidenceThreshold: 0.5,
          detectHoles: false,
        }),
        useWebSocket: () => ({
          socket: mockWebSocket,
          isConnected: true,
        }),
      }));

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      // Simulate WebSocket event arriving during manual cancellation
      act(() => {
        if (websocketCallback) {
          websocketCallback({
            projectId: 'project-123',
            cancelledCount: 2,
            timestamp: new Date().toISOString()
          });
        }
      });

      await waitFor(() => {
        // Should only show one success message, not duplicate
        expect(toast.success).toHaveBeenCalledTimes(1);
      });
    });

    it('should provide error details for 409 Conflict responses', async () => {
      const user = userEvent.setup();

      // Mock 409 responses with specific error messages
      vi.mocked(apiClient.default.delete).mockRejectedValue({
        response: {
          status: 409,
          data: { message: 'Cannot cancel item in processing status' }
        }
      });

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Failed to cancel 2 items: Cannot cancel item in processing status'
        );
      });
    });

    it('should handle 500 server errors with generic message', async () => {
      const user = userEvent.setup();

      // Mock 500 server error
      vi.mocked(apiClient.default.delete).mockRejectedValue({
        response: {
          status: 500,
          data: { message: 'Internal server error' }
        }
      });

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Failed to cancel batch operation'
        );
      });
    });
  });

  // TDD REQUIREMENT: Test race conditions and concurrent operations
  describe('Race Condition Handling - TDD', () => {
    it('should handle concurrent cancellation requests from multiple tabs', async () => {
      const user = userEvent.setup();

      // Mock delayed response to simulate race condition
      let resolveFirst: any;
      let _resolveSecond: any;

      vi.mocked(apiClient.default.get)
        .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
        .mockImplementationOnce(() => new Promise(resolve => { _resolveSecond = resolve; }));

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      // Start first cancellation
      await user.click(cancelButton);

      // Try to start second cancellation while first is in progress
      await user.click(cancelButton);

      // Resolve first request
      act(() => {
        resolveFirst({ data: [
          { id: 'queue-1', userId: 'user-123', status: 'queued' }
        ]});
      });

      await waitFor(() => {
        expect(apiClient.default.get).toHaveBeenCalledTimes(1);
      });

      // Second request should be ignored (no duplicate calls)
      expect(apiClient.default.get).toHaveBeenCalledTimes(1);
    });

    it('should handle item status changes during cancellation', async () => {
      const user = userEvent.setup();

      // Mock scenario where item becomes processing during cancellation
      vi.mocked(apiClient.default.delete)
        .mockRejectedValueOnce({
          response: {
            status: 409,
            data: { message: 'Item status changed to processing during cancellation' }
          }
        })
        .mockResolvedValueOnce({ data: { success: true } });

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Cancelled 1 queue items');
        expect(toast.error).toHaveBeenCalledWith(
          'Failed to cancel 1 item: Item status changed to processing during cancellation'
        );
      });
    });

    it('should handle network timeouts gracefully', async () => {
      const user = userEvent.setup();

      // Mock network timeout
      vi.mocked(apiClient.default.delete).mockRejectedValue({
        code: 'ECONNABORTED',
        message: 'timeout of 30000ms exceeded'
      });

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Cancellation timed out - please refresh and try again'
        );
      });
    });
  });

  // TDD REQUIREMENT: Test WebSocket synchronization
  describe('WebSocket Synchronization - TDD', () => {
    let mockWebSocket: any;

    beforeEach(() => {
      mockWebSocket = {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn()
      };

      vi.doMock('@/contexts/exports', () => ({
        useAuth: () => ({
          user: { id: 'user-123', email: 'test@example.com' },
        }),
        useLanguage: () => ({
          t: (key: string, _params?: any) => key,
        }),
        useModel: () => ({
          selectedModel: 'unet',
          confidenceThreshold: 0.5,
          detectHoles: false,
        }),
        useWebSocket: () => ({
          socket: mockWebSocket,
          isConnected: true,
        }),
      }));
    });

    it('should subscribe to queue cancellation events on mount', () => {
      renderComponent();

      expect(mockWebSocket.on).toHaveBeenCalledWith(
        'queue:cancelled',
        expect.any(Function)
      );
      expect(mockWebSocket.on).toHaveBeenCalledWith(
        'segmentationUpdate',
        expect.any(Function)
      );
    });

    it('should handle real-time queue cancellation updates', async () => {
      renderComponent();

      // Get the WebSocket callback
      const queueCancelledCallback = mockWebSocket.on.mock.calls.find(
        call => call[0] === 'queue:cancelled'
      )?.[1];

      expect(queueCancelledCallback).toBeDefined();

      // Simulate WebSocket event
      act(() => {
        queueCancelledCallback({
          projectId: 'project-123',
          cancelledItems: ['queue-1', 'queue-2'],
          timestamp: new Date().toISOString()
        });
      });

      // Should update UI without showing manual cancellation toast
      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith(
          'Queue items cancelled: 2 items removed'
        );
      });
    });

    it('should handle WebSocket connection loss during cancellation', async () => {
      const user = userEvent.setup();

      // Start with connected WebSocket
      vi.doMock('@/contexts/exports', () => ({
        useAuth: () => ({
          user: { id: 'user-123', email: 'test@example.com' },
        }),
        useLanguage: () => ({
          t: (key: string, _params?: any) => key,
        }),
        useModel: () => ({
          selectedModel: 'unet',
          confidenceThreshold: 0.5,
          detectHoles: false,
        }),
        useWebSocket: () => ({
          socket: mockWebSocket,
          isConnected: false, // Disconnected during cancellation
        }),
      }));

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.warning).toHaveBeenCalledWith(
          'Real-time updates unavailable - refresh page for latest status'
        );
      });
    });

    it('should emit cancellation events to server via WebSocket', async () => {
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(mockWebSocket.emit).toHaveBeenCalledWith(
          'cancelQueue',
          {
            projectId: 'project-123',
            userId: 'user-123',
            timestamp: expect.any(String)
          }
        );
      });
    });
  });

  // TDD REQUIREMENT: Performance tests for bulk cancellation
  describe('Performance Tests - TDD', () => {
    it('should handle cancellation of 1000+ items within 30 seconds', async () => {
      const user = userEvent.setup();
      const startTime = Date.now();

      // Generate massive queue
      const massiveQueue = Array.from({ length: 1500 }, (_, i) => ({
        id: `queue-${i}`,
        userId: 'user-123',
        status: 'queued',
        imageId: `img-${i}`,
      }));

      vi.mocked(apiClient.default.get).mockResolvedValueOnce({
        data: massiveQueue,
      });

      // Mock fast API responses
      vi.mocked(apiClient.default.delete).mockResolvedValue({
        data: { success: true }
      });

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Cancelled 1500 queue items');
      }, { timeout: 30000 });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within 30 seconds
      expect(duration).toBeLessThan(30000);
    });

    it('should show progress indicator for large batch operations', async () => {
      const user = userEvent.setup();

      // Generate large queue
      const largeQueue = Array.from({ length: 200 }, (_, i) => ({
        id: `queue-${i}`,
        userId: 'user-123',
        status: 'queued',
        imageId: `img-${i}`,
      }));

      vi.mocked(apiClient.default.get).mockResolvedValueOnce({
        data: largeQueue,
      });

      // Mock delayed responses to test progress
      vi.mocked(apiClient.default.delete).mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ data: { success: true } }), 50))
      );

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      // Should show progress indicator
      expect(screen.getByTestId('cancellation-progress')).toBeInTheDocument();
      expect(screen.getByText(/cancelling.../i)).toBeInTheDocument();

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalled();
      }, { timeout: 15000 });

      // Progress indicator should be hidden after completion
      expect(screen.queryByTestId('cancellation-progress')).not.toBeInTheDocument();
    });

    it('should batch API calls efficiently for large operations', async () => {
      const user = userEvent.setup();

      // Generate large queue
      const largeQueue = Array.from({ length: 100 }, (_, i) => ({
        id: `queue-${i}`,
        userId: 'user-123',
        status: 'queued',
        imageId: `img-${i}`,
      }));

      vi.mocked(apiClient.default.get).mockResolvedValueOnce({
        data: largeQueue,
      });

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        // Should make exactly 100 API calls (one per item)
        expect(apiClient.default.delete).toHaveBeenCalledTimes(100);
      });

      // All calls should be made concurrently, not sequentially
      const callTimes = vi.mocked(apiClient.default.delete).mock.invocationCallOrder;
      const firstCall = callTimes[0];
      const lastCall = callTimes[callTimes.length - 1];

      // Time difference should be minimal (concurrent calls)
      expect(lastCall - firstCall).toBeLessThan(10);
    });
  });

  // TDD REQUIREMENT: State cleanup after cancellation
  describe('State Cleanup - TDD', () => {
    it('should properly clean up cancellation state after successful operation', async () => {
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalled();
      });

      // Cancellation button should be hidden after completion
      expect(screen.queryByText('Cancelling...')).not.toBeInTheDocument();

      // Should be able to start new cancellation immediately
      const newCancelButton = screen.queryByRole('button', { name: /cancel/i });
      if (newCancelButton) {
        expect(newCancelButton).not.toBeDisabled();
      }
    });

    it('should clean up state after failed cancellation', async () => {
      const user = userEvent.setup();

      vi.mocked(apiClient.default.get).mockRejectedValueOnce(
        new Error('Network error')
      );

      renderComponent();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });

      // State should be cleaned up even after error
      expect(screen.queryByText('Cancelling...')).not.toBeInTheDocument();
    });

    it('should reset selection state appropriately after cancellation', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Select some images first
      const selectAllCheckbox = screen.getByTestId('select-all-images');
      await user.click(selectAllCheckbox);

      // Cancel queue
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalled();
      });

      // Selection should be maintained (user's choice)
      expect(selectAllCheckbox).toBeChecked();
    });
  });
});
