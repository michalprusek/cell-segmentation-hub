import { render, screen, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import SegmentationEditor from '../SegmentationEditor';
import type { SegmentationUpdate } from '@/hooks/useSegmentationQueue';

// Mock modules
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user', email: 'test@example.com' },
    isAuthenticated: true,
  }),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'en',
  }),
}));

vi.mock('@/hooks/useProjectData', () => ({
  useProjectData: () => ({
    project: { id: 'test-project', name: 'Test Project' },
    images: [
      {
        id: 'test-image-1',
        filename: 'test.jpg',
        segmentationStatus: 'queued',
        thumbnailUrl: '/test-thumb.jpg',
        imageUrl: '/test-image.jpg',
      },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useImageFilter', () => ({
  sortImagesBySettings: vi.fn(images => images),
}));

// Mock WebSocket queue hook
const mockQueueStats = { position: 2, total: 5 };
let mockLastUpdate: SegmentationUpdate | null = null;
const mockUseSegmentationQueue = vi.fn(() => ({
  lastUpdate: mockLastUpdate,
  queueStats: mockQueueStats,
  isConnected: true,
}));

vi.mock('@/hooks/useSegmentationQueue', () => ({
  useSegmentationQueue: mockUseSegmentationQueue,
}));

// Mock segmentation editor hook
const mockEditor = {
  polygons: [],
  selectedPolygonId: null,
  editMode: 'view' as const,
  hasUnsavedChanges: false,
  isUndoRedoInProgress: false,
  handleSave: vi.fn(),
  transform: { scale: 1, panX: 0, panY: 0 },
};

vi.mock('./hooks/useEnhancedSegmentationEditor', () => ({
  useEnhancedSegmentationEditor: () => mockEditor,
}));

// Mock API client
const mockApiClient = {
  get: vi.fn(),
  post: vi.fn(),
};

vi.mock('@/lib/api', () => ({
  default: mockApiClient,
}));

// Mock debounce hook
vi.mock('@/hooks/useDebounce', () => ({
  default: (value: any) => value, // No debouncing in tests
}));

// Mock components to focus on integration behavior
vi.mock('../components/EditorHeader', () => ({
  default: ({ segmentationStatus }: any) => (
    <div data-testid="editor-header">Status: {segmentationStatus}</div>
  ),
}));

vi.mock('../components/VerticalToolbar', () => ({
  default: () => <div data-testid="vertical-toolbar" />,
}));

vi.mock('../components/canvas/CanvasContainer', () => ({
  default: () => <div data-testid="canvas-container" />,
}));

vi.mock('../components/PolygonListPanel', () => ({
  default: () => <div data-testid="polygon-panel" />,
}));

vi.mock('../components/StatusBar', () => ({
  default: () => <div data-testid="status-bar" />,
}));

vi.mock('../components/KeyboardShortcutsHelp', () => ({
  default: () => <div data-testid="keyboard-help" />,
}));

// Mock react-router params
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ projectId: 'test-project', imageId: 'test-image-1' }),
    useNavigate: () => vi.fn(),
  };
});

describe('SegmentationEditor WebSocket Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLastUpdate = null;

    // Mock successful segmentation API response
    mockApiClient.get.mockResolvedValue({
      data: {
        polygons: [
          {
            id: 'polygon-1',
            points: [
              [10, 10],
              [20, 10],
              [20, 20],
              [10, 20],
            ],
            label: 'Cell 1',
          },
        ],
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderEditor = () => {
    return render(
      <BrowserRouter>
        <SegmentationEditor />
      </BrowserRouter>
    );
  };

  it('should handle WebSocket segmentation completion and auto-reload', async () => {
    vi.useFakeTimers();

    renderEditor();

    // Verify initial render
    expect(screen.getByTestId('editor-header')).toBeInTheDocument();

    // Simulate WebSocket update for segmentation completion
    act(() => {
      mockLastUpdate = {
        imageId: 'test-image-1',
        status: 'segmented',
        timestamp: Date.now(),
        polygonCount: 1,
      };
      mockUseSegmentationQueue.mockReturnValue({
        lastUpdate: mockLastUpdate,
        queueStats: mockQueueStats,
        isConnected: true,
      });
    });

    // Re-render with new WebSocket data
    renderEditor();

    // Fast-forward past the 500ms delay
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Wait for API call to complete
    await waitFor(() => {
      expect(mockApiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/segmentation/test-image-1')
      );
    });
  });

  it('should handle WebSocket failed segmentation', async () => {
    renderEditor();

    // Simulate WebSocket update for failed segmentation
    act(() => {
      mockLastUpdate = {
        imageId: 'test-image-1',
        status: 'failed',
        timestamp: Date.now(),
        polygonCount: 0,
      };
      mockUseSegmentationQueue.mockReturnValue({
        lastUpdate: mockLastUpdate,
        queueStats: mockQueueStats,
        isConnected: true,
      });
    });

    // Re-render with new WebSocket data
    renderEditor();

    // Should not trigger API call for failed segmentation
    await waitFor(() => {
      expect(mockApiClient.get).not.toHaveBeenCalled();
    });
  });

  it('should ignore WebSocket updates for different images', async () => {
    vi.useFakeTimers();

    renderEditor();

    // Simulate WebSocket update for different image
    act(() => {
      mockLastUpdate = {
        imageId: 'different-image',
        status: 'segmented',
        timestamp: Date.now(),
        polygonCount: 1,
      };
      mockUseSegmentationQueue.mockReturnValue({
        lastUpdate: mockLastUpdate,
        queueStats: mockQueueStats,
        isConnected: true,
      });
    });

    // Re-render with new WebSocket data
    renderEditor();

    // Fast-forward timers
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Should not trigger API call for different image
    await waitFor(() => {
      expect(mockApiClient.get).not.toHaveBeenCalled();
    });
  });

  it('should handle API errors gracefully during auto-reload', async () => {
    vi.useFakeTimers();

    // Mock API error
    mockApiClient.get.mockRejectedValue(new Error('API Error'));

    renderEditor();

    // Simulate segmentation completion
    act(() => {
      mockLastUpdate = {
        imageId: 'test-image-1',
        status: 'segmented',
        timestamp: Date.now(),
        polygonCount: 1,
      };
      mockUseSegmentationQueue.mockReturnValue({
        lastUpdate: mockLastUpdate,
        queueStats: mockQueueStats,
        isConnected: true,
      });
    });

    renderEditor();

    // Fast-forward past delay
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Wait for API call and error handling
    await waitFor(() => {
      expect(mockApiClient.get).toHaveBeenCalled();
    });

    // Component should continue to render despite error
    expect(screen.getByTestId('editor-header')).toBeInTheDocument();
  });

  it('should show loading state during auto-reload', async () => {
    vi.useFakeTimers();

    // Mock slow API response
    let resolveApi: (value: any) => void;
    const apiPromise = new Promise(resolve => {
      resolveApi = resolve;
    });
    mockApiClient.get.mockReturnValue(apiPromise);

    renderEditor();

    // Simulate segmentation completion
    act(() => {
      mockLastUpdate = {
        imageId: 'test-image-1',
        status: 'segmented',
        timestamp: Date.now(),
        polygonCount: 1,
      };
      mockUseSegmentationQueue.mockReturnValue({
        lastUpdate: mockLastUpdate,
        queueStats: mockQueueStats,
        isConnected: true,
      });
    });

    renderEditor();

    // Fast-forward to trigger API call
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Should show loading state
    await waitFor(() => {
      expect(
        screen.getByText('segmentationEditor.reloadingSegmentation')
      ).toBeInTheDocument();
    });

    // Resolve API call
    act(() => {
      resolveApi!({
        data: {
          polygons: [],
        },
      });
    });

    // Loading state should disappear
    await waitFor(() => {
      expect(
        screen.queryByText('segmentationEditor.reloadingSegmentation')
      ).not.toBeInTheDocument();
    });
  });

  it('should clean up timeouts when component unmounts', async () => {
    vi.useFakeTimers();

    const { unmount } = renderEditor();

    // Start a reload operation
    act(() => {
      mockLastUpdate = {
        imageId: 'test-image-1',
        status: 'segmented',
        timestamp: Date.now(),
        polygonCount: 1,
      };
      mockUseSegmentationQueue.mockReturnValue({
        lastUpdate: mockLastUpdate,
        queueStats: mockQueueStats,
        isConnected: true,
      });
    });

    // Unmount before timeout completes
    act(() => {
      unmount();
    });

    // Fast-forward timers
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // API should not be called after unmount
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });
});
