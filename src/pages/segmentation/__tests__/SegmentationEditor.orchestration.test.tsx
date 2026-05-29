/**
 * SegmentationEditor orchestration tests.
 *
 * Strategy: mock EVERY heavy child component and every heavy hook so the
 * component tree rendered by SegmentationEditor is essentially a stub. This
 * lets us execute the orchestration logic (initialPolygons transform, nav
 * context, polylineKind discriminator, visibility filtering, handlersfor
 * toggle/delete/rename, loading/no-image early returns, etc.) without hitting
 * the canvas/ML/editor import graph that causes OOMs.
 *
 * Each describe block has a single render + cleanup cycle. NODE_OPTIONS must
 * be ≥4096 MB when running this file directly.
 */
import React from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── hoisted mock state ───────────────────────────────────────────────────────
// vi.hoisted values are evaluated BEFORE any import so they are safe to
// reference inside vi.mock() factory functions.

const mockNavigate = vi.hoisted(() => vi.fn());

const mockParams = vi.hoisted(() => ({
  projectId: 'proj-1',
  imageId: 'img-1',
}));

/** Mutable editor stub — tests mutate .polygons / .editMode to trigger branches. */
const mockEditor = vi.hoisted(() => ({
  polygons: [] as any[],
  selectedPolygonId: null as string | null,
  editMode: 'view' as string,
  hasUnsavedChanges: false,
  isUndoRedoInProgress: false,
  isSaving: false,
  canUndo: false,
  canRedo: false,
  transform: { zoom: 1, translateX: 0, translateY: 0 },
  hoveredVertex: null,
  vertexDragState: null,
  isZooming: false,
  tempPoints: [],
  cursorPosition: null,
  interactionState: null,
  keyboardState: { isShiftPressed: vi.fn(() => false) },
  canvasRef: { current: null },
  handleSave: vi.fn(),
  handleUndo: vi.fn(),
  handleRedo: vi.fn(),
  handleZoomIn: vi.fn(),
  handleZoomOut: vi.fn(),
  handleResetView: vi.fn(),
  handleMouseDown: vi.fn(),
  handleMouseMove: vi.fn(),
  handleMouseUp: vi.fn(),
  handleCreatePolylineDoubleClick: vi.fn(),
  handleDeletePolygon: vi.fn(),
  handlePolygonSelection: vi.fn(),
  handlePolygonClick: vi.fn(),
  handleDeleteVertex: vi.fn(),
  setSelectedPolygonId: vi.fn(),
  setEditMode: vi.fn(),
  getPolygons: vi.fn(() => [] as any[]),
  updatePolygons: vi.fn(),
}));

/** Mutable projectData stub. */
const mockProjectData = vi.hoisted(() => ({
  projectTitle: 'Test Project',
  projectType: 'spheroid' as string,
  images: [] as any[],
  loading: false,
  refreshImageSegmentation: vi.fn(),
}));

/** Mutable video stub. */
const mockVideo = vi.hoisted(() => ({
  container: null as any,
  frameIndex: 0,
  currentFrame: null as any,
  isPlaying: false,
  toggle: vi.fn(),
  setFrameIndex: vi.fn(),
}));

const mockApiClient = vi.hoisted(() => ({
  getSegmentationResults: vi.fn().mockResolvedValue(null),
  updateSegmentationResults: vi.fn().mockResolvedValue({ polygons: [] }),
  requestBatchSegmentation: vi.fn().mockResolvedValue({
    successful: 1,
    failed: 0,
    results: [],
  }),
}));

// ─── vi.mock declarations ─────────────────────────────────────────────────────

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...(actual as object),
    useParams: () => mockParams,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/contexts/exports', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'test@example.com' } }),
  useLanguage: () => ({ t: (k: string) => k }),
  useModel: () => ({
    selectedModel: 'hrnet',
    confidenceThreshold: 0.5,
    detectHoles: false,
  }),
}));

vi.mock('@/hooks/useProjectData', () => ({
  useProjectData: () => mockProjectData,
}));

vi.mock('@/hooks/useImageFilter', () => ({
  sortImagesBySettings: vi.fn((imgs: any[]) => imgs),
}));

vi.mock('@/hooks/useSegmentationQueue', () => ({
  useSegmentationQueue: () => ({
    lastUpdate: null,
    queueStats: null,
    isConnected: true,
  }),
}));

vi.mock('@/hooks/useDebounce', () => ({
  default: (v: any) => v,
}));

vi.mock('@/hooks/shared/useAbortController', () => ({
  useAbortController: () => ({
    signal: { aborted: false },
    abort: vi.fn(),
    reset: vi.fn(),
  }),
  useCoordinatedAbortController: () => ({
    getSignal: vi.fn(() => ({ aborted: false })),
    abortAllOperations: vi.fn(),
    abortAll: vi.fn(),
  }),
}));

vi.mock('../hooks/useEnhancedSegmentationEditor', () => ({
  useEnhancedSegmentationEditor: () => mockEditor,
}));

vi.mock('../hooks/useSegmentationReload', () => ({
  useSegmentationReload: () => ({
    isReloading: false,
    reloadSegmentation: vi.fn(),
    cleanupReloadOperations: vi.fn(),
  }),
}));

vi.mock('../hooks/useVideoFrames', () => ({
  useVideoFrames: () => mockVideo,
}));

const mockGetCached = vi.hoisted(() => vi.fn(() => undefined as any));
const mockSetCached = vi.hoisted(() => vi.fn());

vi.mock('../hooks/segmentationPolygonCache', () => ({
  getCachedSegmentationPolygons: mockGetCached,
  setCachedSegmentationPolygons: mockSetCached,
}));

vi.mock('@/lib/api', () => ({
  default: mockApiClient,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/rendering/PolygonVisibilityManager', () => ({
  polygonVisibilityManager: {
    getVisiblePolygons: vi.fn((polys: any[]) => ({
      visiblePolygons: polys,
    })),
  },
}));

vi.mock('@/lib/rendering/FpsMeter', () => ({
  FpsMeter: () => null,
}));

// ─── child component stubs ────────────────────────────────────────────────────

vi.mock('../components/EditorHeader', () => ({
  default: ({ currentImageIndex, totalImages, imageName }: any) => (
    <div
      data-testid="editor-header"
      data-index={currentImageIndex}
      data-total={totalImages}
      data-name={imageName}
    />
  ),
}));

vi.mock('../components/VerticalToolbar', () => ({
  default: () => <div data-testid="vertical-toolbar" />,
}));

vi.mock('../components/TopToolbar', () => ({
  default: ({ onResegment, isResegmenting }: any) => (
    <div data-testid="top-toolbar">
      <button
        data-testid="resegment-btn"
        disabled={isResegmenting}
        onClick={onResegment}
      >
        resegment
      </button>
    </div>
  ),
}));

vi.mock('../components/PolygonListPanel', () => ({
  default: () => <div data-testid="polygon-panel" />,
}));

vi.mock('../components/SpermInstancePanel', () => ({
  default: () => <div data-testid="sperm-panel" />,
}));

vi.mock('../components/MicrotubuleInstancePanel', () => ({
  default: () => <div data-testid="mt-panel" />,
}));

vi.mock('../components/StatusBar', () => ({
  default: () => <div data-testid="status-bar" />,
}));

vi.mock('../components/KeyboardShortcutsHelp', () => ({
  default: () => <div data-testid="keyboard-help" />,
}));

vi.mock('../components/canvas/CanvasContainer', () => ({
  default: React.forwardRef(({ children }: any, _ref: any) => (
    <div data-testid="canvas-container">{children}</div>
  )),
}));

vi.mock('../components/canvas/CanvasContent', () => ({
  default: ({ children }: any) => (
    <div data-testid="canvas-content">{children}</div>
  ),
}));

vi.mock('../components/canvas/VideoFrameImage', () => ({
  default: () => <div data-testid="video-frame-image" />,
}));

vi.mock('../components/canvas/FrameWindowPrefetcher', () => ({
  default: () => null,
}));

vi.mock('../components/canvas/FrameLoadingGate', () => ({
  default: () => null,
}));

vi.mock('../components/canvas/CanvasPolygon', () => ({
  default: () => null,
}));

vi.mock('../components/canvas/CanvasSvgFilters', () => ({
  default: () => null,
}));

vi.mock('../components/canvas/ModeInstructions', () => ({
  default: () => null,
}));

vi.mock('../components/canvas/CanvasTemporaryGeometryLayer', () => ({
  default: () => null,
}));

vi.mock('../components/sidebar/ChannelsSection', () => ({
  default: () => null,
}));

vi.mock('../components/sidebar/DisplaySection', () => ({
  default: () => null,
}));

vi.mock('../components/SegmentationErrorBoundary', () => ({
  default: ({ children }: any) => <>{children}</>,
}));

vi.mock('../components/VideoModeOverlay', () => ({
  VideoModeOverlay: () => null,
}));

vi.mock('../contexts/ImageDisplayContext', () => ({
  ImageDisplayProvider: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/project/SegmentChannelDialog', () => ({
  SegmentChannelDialog: ({ open, onCancel, onConfirm }: any) =>
    open ? (
      <div data-testid="channel-dialog">
        <button data-testid="channel-cancel" onClick={onCancel}>
          cancel
        </button>
        <button data-testid="channel-confirm" onClick={() => onConfirm('ch1')}>
          confirm
        </button>
      </div>
    ) : null,
}));

vi.mock('../components/layout/EditorLayout', () => ({
  default: ({ children }: any) => (
    <div data-testid="editor-layout">{children}</div>
  ),
}));

vi.mock('@/lib/tiffUtils', () => ({
  ensureBrowserCompatibleUrl: vi.fn((_id: any, url: any) => url),
}));

// ─── import under test ────────────────────────────────────────────────────────
// vi.mock() calls above are hoisted before all imports, so this static import
// correctly receives the mocked module graph.
import SegmentationEditorDefault from '../SegmentationEditor';

// ─── helpers ──────────────────────────────────────────────────────────────────

const makeQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderEditor = (queryClient = makeQueryClient()) =>
  render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SegmentationEditorDefault />
      </BrowserRouter>
    </QueryClientProvider>
  );

// ─── suite setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset mutable stubs to clean defaults.
  mockParams.projectId = 'proj-1';
  mockParams.imageId = 'img-1';

  mockProjectData.projectTitle = 'Test Project';
  mockProjectData.projectType = 'spheroid';
  mockProjectData.images = [];
  mockProjectData.loading = false;

  mockEditor.polygons = [];
  mockEditor.editMode = 'view';
  mockEditor.selectedPolygonId = null;
  mockEditor.getPolygons.mockReturnValue([]);

  mockVideo.container = null;
  mockVideo.frameIndex = 0;
  mockVideo.currentFrame = null;
  mockVideo.isPlaying = false;

  vi.clearAllMocks();
  // Re-apply stateful defaults after clearAllMocks.
  mockEditor.keyboardState.isShiftPressed.mockReturnValue(false);
  mockEditor.getPolygons.mockReturnValue([]);
  mockApiClient.getSegmentationResults.mockResolvedValue(null);
  mockApiClient.requestBatchSegmentation.mockResolvedValue({
    successful: 1,
    failed: 0,
    results: [],
  });
  // Cache returns undefined by default (cache miss — triggers API fetch)
  mockGetCached.mockReturnValue(undefined);
});

afterEach(() => {
  // Restore real timers BEFORE cleanup so any pending timers (e.g.
  // startResegmentPoll's setTimeout loop) are cleared when the component
  // unmounts, preventing timer accumulation that causes OOM.
  vi.useRealTimers();
  cleanup();
});

// ─── Loading / early return branches ─────────────────────────────────────────

describe('Early return branches', () => {
  it('shows loading spinner when projectLoading=true and no images', async () => {
    mockProjectData.loading = true;
    mockProjectData.images = [];
    renderEditor();
    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('shows no-preview message when selectedImage is missing', () => {
    mockProjectData.loading = false;
    mockProjectData.images = [{ id: 'other-img', name: 'other.jpg' }];
    // mockParams.imageId = 'img-1' but images only has 'other-img'
    renderEditor();
    expect(screen.getByText('common.no_preview')).toBeInTheDocument();
  });

  it('renders full editor when selectedImage is found', () => {
    mockProjectData.images = [
      {
        id: 'img-1',
        name: 'frame.jpg',
        segmentationStatus: 'completed',
        width: 800,
        height: 600,
      },
    ];
    renderEditor();
    expect(screen.getByTestId('editor-header')).toBeInTheDocument();
    expect(screen.getByTestId('vertical-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-container')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });
});

// ─── navContext — standalone images ──────────────────────────────────────────

describe('navContext — standalone images', () => {
  const images = [
    { id: 'img-0', name: 'a.jpg', segmentationStatus: 'completed' },
    { id: 'img-1', name: 'b.jpg', segmentationStatus: 'completed' },
    { id: 'img-2', name: 'c.jpg', segmentationStatus: 'completed' },
  ];

  beforeEach(() => {
    mockProjectData.images = images;
  });

  it('passes correct index and total to EditorHeader (middle image)', () => {
    mockParams.imageId = 'img-1';
    renderEditor();
    const hdr = screen.getByTestId('editor-header');
    expect(hdr.getAttribute('data-index')).toBe('1');
    expect(hdr.getAttribute('data-total')).toBe('3');
  });

  it('passes correct index for first image', () => {
    mockParams.imageId = 'img-0';
    renderEditor();
    const hdr = screen.getByTestId('editor-header');
    expect(hdr.getAttribute('data-index')).toBe('0');
    expect(hdr.getAttribute('data-total')).toBe('3');
  });
});

// ─── navContext — video frame siblings ───────────────────────────────────────

describe('navContext — video frame children', () => {
  it('scopes index/total to sibling frames only', () => {
    mockProjectData.images = [
      {
        id: 'frame-0',
        name: 'f0.png',
        parentVideoId: 'vid-1',
        frameIndex: 0,
        segmentationStatus: 'completed',
      },
      {
        id: 'frame-1',
        name: 'f1.png',
        parentVideoId: 'vid-1',
        frameIndex: 1,
        segmentationStatus: 'completed',
      },
      {
        id: 'frame-2',
        name: 'f2.png',
        parentVideoId: 'vid-1',
        frameIndex: 2,
        segmentationStatus: 'completed',
      },
      // Unrelated standalone image — must NOT count in sibling total
      {
        id: 'standalone',
        name: 's.png',
        segmentationStatus: 'completed',
      },
    ];
    mockParams.imageId = 'frame-1';
    renderEditor();
    const hdr = screen.getByTestId('editor-header');
    expect(hdr.getAttribute('data-index')).toBe('1');
    expect(hdr.getAttribute('data-total')).toBe('3');
  });
});

// ─── polylineKind discriminator ───────────────────────────────────────────────

describe('polylineKind discriminator — sidebar panel selection', () => {
  const base = {
    id: 'img-1',
    name: 'x.jpg',
    segmentationStatus: 'completed',
  };

  beforeEach(() => {
    mockProjectData.images = [base];
    mockParams.imageId = 'img-1';
  });

  it('shows SpermInstancePanel when a polyline has class=sperm', () => {
    mockEditor.polygons = [
      {
        id: 'p1',
        geometry: 'polyline',
        class: 'sperm',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ];
    renderEditor();
    expect(screen.getByTestId('sperm-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('mt-panel')).not.toBeInTheDocument();
  });

  it('shows MicrotubuleInstancePanel when a polyline has class=microtubule', () => {
    mockEditor.polygons = [
      {
        id: 'p1',
        geometry: 'polyline',
        class: 'microtubule',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ];
    renderEditor();
    expect(screen.getByTestId('mt-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('sperm-panel')).not.toBeInTheDocument();
  });

  it('shows SpermInstancePanel when polyline has partClass (legacy)', () => {
    mockEditor.polygons = [
      {
        id: 'p1',
        geometry: 'polyline',
        partClass: 'head',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ];
    renderEditor();
    expect(screen.getByTestId('sperm-panel')).toBeInTheDocument();
  });

  it('shows no instance panel when there are no polylines', () => {
    mockEditor.polygons = [
      {
        id: 'p1',
        geometry: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      },
    ];
    renderEditor();
    expect(screen.queryByTestId('sperm-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mt-panel')).not.toBeInTheDocument();
  });

  it('shows no instance panel when polygon list is empty', () => {
    mockEditor.polygons = [];
    renderEditor();
    expect(screen.queryByTestId('sperm-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mt-panel')).not.toBeInTheDocument();
  });
});

// ─── effectiveResegmentModel ──────────────────────────────────────────────────

describe('effectiveResegmentModel — project-type gating', () => {
  const base = {
    id: 'img-1',
    name: 'x.jpg',
    segmentationStatus: 'completed',
  };

  beforeEach(() => {
    mockProjectData.images = [base];
    mockParams.imageId = 'img-1';
    // Freeze timers so the resegment poll loop (setTimeout inside
    // startResegmentPoll) never fires during the test, preventing OOM
    // from accumulated timer callbacks.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses "microtubule" model for microtubules project', async () => {
    mockProjectData.projectType = 'microtubules';
    renderEditor();

    const btn = screen.getByTestId('resegment-btn');
    await act(async () => {
      btn.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockApiClient.requestBatchSegmentation).toHaveBeenCalledWith(
      ['img-1'],
      'microtubule',
      expect.anything(),
      expect.anything(),
      undefined
    );
  });

  it('uses "sperm" model for sperm project', async () => {
    mockProjectData.projectType = 'sperm';
    renderEditor();

    const btn = screen.getByTestId('resegment-btn');
    await act(async () => {
      btn.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockApiClient.requestBatchSegmentation).toHaveBeenCalledWith(
      ['img-1'],
      'sperm',
      expect.anything(),
      expect.anything(),
      undefined
    );
  });

  it('uses "wound" model for wound project', async () => {
    mockProjectData.projectType = 'wound';
    renderEditor();

    const btn = screen.getByTestId('resegment-btn');
    await act(async () => {
      btn.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockApiClient.requestBatchSegmentation).toHaveBeenCalledWith(
      ['img-1'],
      'wound',
      expect.anything(),
      expect.anything(),
      undefined
    );
  });

  it('uses "unet_attention_aspp" for spheroid_invasive project', async () => {
    mockProjectData.projectType = 'spheroid_invasive';
    renderEditor();

    const btn = screen.getByTestId('resegment-btn');
    await act(async () => {
      btn.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockApiClient.requestBatchSegmentation).toHaveBeenCalledWith(
      ['img-1'],
      'unet_attention_aspp',
      expect.anything(),
      expect.anything(),
      undefined
    );
  });
});

// ─── Resegment — multi-channel dialog ────────────────────────────────────────

describe('Resegment — multi-channel video opens picker', () => {
  const base = {
    id: 'img-1',
    name: 'x.jpg',
    segmentationStatus: 'completed',
    parentVideoId: 'vid-1',
  };

  beforeEach(() => {
    mockProjectData.images = [base];
    mockParams.imageId = 'img-1';
    mockVideo.container = {
      frameCount: 3,
      frames: [{ id: 'img-1' }, { id: 'img-2' }, { id: 'img-3' }],
      channels: [
        { name: 'DAPI', isSegmentationSource: false },
        { name: 'GFP', isSegmentationSource: true },
      ],
    };
    // Freeze timers: resegment poll's setTimeout must not fire during tests
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens SegmentChannelDialog when there are >1 channels', async () => {
    renderEditor();
    // Dialog should be closed initially.
    expect(screen.queryByTestId('channel-dialog')).not.toBeInTheDocument();

    await act(async () => {
      screen.getByTestId('resegment-btn').click();
    });

    expect(screen.getByTestId('channel-dialog')).toBeInTheDocument();
  });

  it('closes dialog and calls runResegment on confirm', async () => {
    renderEditor();

    await act(async () => {
      screen.getByTestId('resegment-btn').click();
    });

    expect(screen.getByTestId('channel-dialog')).toBeInTheDocument();

    await act(async () => {
      screen.getByTestId('channel-confirm').click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('channel-dialog')).not.toBeInTheDocument();
    expect(mockApiClient.requestBatchSegmentation).toHaveBeenCalledWith(
      ['img-1'],
      expect.any(String),
      expect.anything(),
      expect.anything(),
      'ch1'
    );
  });

  it('closes dialog on cancel without calling API', async () => {
    renderEditor();

    await act(async () => {
      screen.getByTestId('resegment-btn').click();
    });

    await act(async () => {
      screen.getByTestId('channel-cancel').click();
    });

    expect(screen.queryByTestId('channel-dialog')).not.toBeInTheDocument();
    expect(mockApiClient.requestBatchSegmentation).not.toHaveBeenCalled();
  });
});

// ─── Resegment — 0-success failure handling ───────────────────────────────────

describe('Resegment — 0-success batch response', () => {
  const base = {
    id: 'img-1',
    name: 'x.jpg',
    segmentationStatus: 'completed',
  };

  beforeEach(() => {
    mockProjectData.images = [base];
    mockParams.imageId = 'img-1';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows error toast when batch returns 0 successful', async () => {
    mockApiClient.requestBatchSegmentation.mockResolvedValue({
      successful: 0,
      failed: 1,
      results: [{ success: false, error: 'model OOM' }],
    });

    const { toast } = await import('sonner');

    renderEditor();
    await act(async () => {
      screen.getByTestId('resegment-btn').click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(toast.error).toHaveBeenCalled();
  });
});

// ─── component unmount cleanup ────────────────────────────────────────────────

describe('Component cleanup on unmount', () => {
  it('does not throw when unmounting', () => {
    mockProjectData.images = [
      { id: 'img-1', name: 'x.jpg', segmentationStatus: 'completed' },
    ];
    const { unmount } = renderEditor();
    expect(() => unmount()).not.toThrow();
  });
});

// ─── image name normalization ─────────────────────────────────────────────────

describe('Image name normalization', () => {
  it('passes NFC-normalized name to EditorHeader', () => {
    // Compose "é" as a precomposed single codepoint vs decomposed.
    const decomposed = 'café.jpg'; // e + combining acute
    mockProjectData.images = [
      {
        id: 'img-1',
        name: decomposed,
        segmentationStatus: 'completed',
      },
    ];
    renderEditor();
    const hdr = screen.getByTestId('editor-header');
    // NFC normalizes "e + combining acute" → precomposed "é"
    expect(hdr.getAttribute('data-name')).toBe('café.jpg');
  });

  it('passes empty string when image name is falsy', () => {
    mockProjectData.images = [
      {
        id: 'img-1',
        name: '',
        segmentationStatus: 'completed',
      },
    ];
    renderEditor();
    const hdr = screen.getByTestId('editor-header');
    expect(hdr.getAttribute('data-name')).toBe('');
  });
});
