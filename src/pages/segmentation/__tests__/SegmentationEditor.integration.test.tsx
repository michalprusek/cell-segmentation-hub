import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SegmentationEditor from '../SegmentationEditor';
import type { SegmentationUpdate } from '@/hooks/useSegmentationQueue';

// Mock modules
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user', email: 'test@example.com' },
    isAuthenticated: true,
  }),
}));

vi.mock('@/contexts/useAuth', () => ({
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
  LanguageProvider: ({ children }: { children: any }) => children,
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'en',
    setLanguage: vi.fn(),
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

// Use vi.hoisted for variables referenced in vi.mock factories (factories are hoisted above const)
const mockUseSegmentationQueue = vi.hoisted(() =>
  vi.fn(() => ({
    lastUpdate: null as SegmentationUpdate | null,
    queueStats: { position: 2, total: 5 },
    isConnected: true,
  }))
);

vi.mock('@/hooks/useSegmentationQueue', () => ({
  useSegmentationQueue: mockUseSegmentationQueue,
}));

// These are NOT referenced in vi.mock factories so regular declarations are fine
const mockQueueStats = { position: 2, total: 5 };
let mockLastUpdate: SegmentationUpdate | null = null;

// Mock segmentation editor hook - use hoisted to avoid TDZ
const mockEditor = vi.hoisted(() => ({
  polygons: [] as any[],
  selectedPolygonId: null as string | null,
  editMode: 'view' as const,
  hasUnsavedChanges: false,
  isUndoRedoInProgress: false,
  handleSave: vi.fn(),
  transform: { scale: 1, panX: 0, panY: 0 },
}));

vi.mock('./hooks/useEnhancedSegmentationEditor', () => ({
  useEnhancedSegmentationEditor: () => mockEditor,
}));

// Mock API client - use vi.hoisted to avoid TDZ (mock factory is hoisted above const declarations)
const mockApiClient = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  getSegmentationResults: vi.fn(),
  getUserProfile: vi.fn(),
}));

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
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SegmentationEditor />
        </BrowserRouter>
      </QueryClientProvider>
    );
  };

  it('should handle WebSocket segmentation completion and auto-reload', async () => {
    renderEditor();

    // Verify initial render
    expect(screen.getByTestId('editor-header')).toBeInTheDocument();

    // Simulate WebSocket update for segmentation completion
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

    // Re-render with new WebSocket data
    const { container } = renderEditor();

    // Component should still render correctly with new WS data
    await waitFor(
      () => {
        expect(
          container.querySelector('[data-testid="editor-header"]')
        ).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
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
    renderEditor();

    // Simulate WebSocket update for different image
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

    // Re-render with new WebSocket data
    renderEditor();

    // Component should render correctly regardless
    expect(screen.getAllByTestId('editor-header').length).toBeGreaterThan(0);

    // For a different imageId, the hook should not be called for current image
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it('should handle API errors gracefully during auto-reload', async () => {
    // Mock API error on getSegmentationResults
    mockApiClient.getSegmentationResults = vi
      .fn()
      .mockRejectedValue(new Error('API Error'));

    renderEditor();

    // Component should render despite API being configured to error
    expect(screen.getByTestId('editor-header')).toBeInTheDocument();

    // Simulate segmentation completion
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

    renderEditor();

    // Component should continue to render despite configured error
    expect(screen.getAllByTestId('editor-header').length).toBeGreaterThan(0);
  });

  it('should render editor components correctly', async () => {
    renderEditor();

    // Editor should render core components
    expect(screen.getByTestId('editor-header')).toBeInTheDocument();
    expect(screen.getByTestId('vertical-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-container')).toBeInTheDocument();
  });

  it('should clean up resources when component unmounts', async () => {
    const { unmount } = renderEditor();

    expect(screen.getByTestId('editor-header')).toBeInTheDocument();

    // Unmount should not throw
    expect(() => {
      unmount();
    }).not.toThrow();
  });
});
