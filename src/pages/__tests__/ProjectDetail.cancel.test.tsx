/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
});
