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
import {
  render,
  screen,
  act,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
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
  handleCanvasDoubleClick: vi.fn(),
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
  // Used by `markFramesSegmented` — a server-side write that gave sibling
  // frames a segmentation has to lift their in-memory status too.
  updateImages: vi.fn(),
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
  // Microtubule type-label palette (useMtTypeLabels loads it on mount for MT
  // projects). Resolve empty so the hook's effect doesn't throw.
  getMtTypeLabels: vi.fn().mockResolvedValue([]),
  putMtTypeLabels: vi.fn().mockResolvedValue([]),
  deleteMtTypeLabel: vi.fn().mockResolvedValue([]),
  setTrackType: vi.fn().mockResolvedValue({ framesAffected: 0 }),
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

/**
 * The props the editor handed to `useEnhancedSegmentationEditor` on the last
 * render. The hook is stubbed, but these props are the real thing — captured
 * so a test can invoke the production `onSave` body instead of a mock that
 * behaves nothing like it. `onSave` is the whole save path and is not
 * otherwise reachable, since the hook that would call it is mocked away.
 */
const capturedEditorProps = vi.hoisted(() => ({ current: null as any }));

vi.mock('../hooks/useEnhancedSegmentationEditor', () => ({
  useEnhancedSegmentationEditor: (props: any) => {
    capturedEditorProps.current = props;
    return mockEditor;
  },
}));

/** Stable across renders so assertions can count calls. */
const mockReloadSegmentation = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useSegmentationReload', () => ({
  useSegmentationReload: () => ({
    isReloading: false,
    reloadSegmentation: mockReloadSegmentation,
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
  // The real key, not a stand-in: the eviction assertions below compare the
  // key the editor removes against the one the loader would look up.
  segmentationPolygonsQueryKey: (imageId: string) => [
    'segmentation-results',
    imageId,
  ],
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
  default: ({ projectType }: { projectType?: string | null }) => (
    <div data-testid="vertical-toolbar" data-project-type={projectType ?? ''} />
  ),
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
  default: ({ projectType }: { projectType?: string | null }) => (
    <div data-testid="keyboard-help" data-project-type={projectType ?? ''} />
  ),
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

// Stubbed to a button rather than null so the microtubule type-label callback
// is reachable. `onChangeMtType` is the ONLY route from the orchestrator to a
// user gesture (SegmentationEditorLayout -> CanvasPolygon -> PolygonContextMenu),
// and with a null stub a full revert of the untracked-label fix passes the
// whole suite. The layout's real `polylineKind === 'microtubule'` gate still
// runs — this only replaces the leaf.
vi.mock('../components/canvas/CanvasPolygon', () => ({
  default: ({
    polygon,
    onChangeMtType,
  }: {
    polygon: { id: string };
    onChangeMtType?: (id: string, mtType: string | null) => void;
  }) =>
    onChangeMtType ? (
      <button
        data-testid={`mt-type-${polygon.id}`}
        onClick={() => onChangeMtType(polygon.id, 'mt_type_brain')}
      />
    ) : null,
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

// ─── onSave wiring ────────────────────────────────────────────────────────────

/**
 * `useEnhancedSegmentationEditor.handleSave` infers "persisted" from "the
 * `onSave` promise did not reject", and the editor's leave prompt navigates
 * away on that answer. So the contract lives HERE, in the callback the editor
 * actually passes down — a helper test with a rejecting mock proves nothing if
 * production `onSave` swallows its errors, which it used to.
 */
describe('SegmentationEditor onSave contract', () => {
  const callOnSave = () =>
    capturedEditorProps.current.onSave(
      [],
      'img-1',
      { width: 100, height: 100 },
      undefined
    );

  it('rejects when the API call fails, rather than resolving', async () => {
    renderEditor();
    await waitFor(() => expect(capturedEditorProps.current).not.toBeNull());

    mockApiClient.updateSegmentationResults.mockRejectedValueOnce(
      new Error('500 from server')
    );

    await expect(callOnSave()).rejects.toThrow('500 from server');
  });

  it('rejects rather than silently no-op when the project id is missing', async () => {
    mockParams.projectId = undefined as any;
    renderEditor();
    await waitFor(() => expect(capturedEditorProps.current).not.toBeNull());

    await expect(callOnSave()).rejects.toThrow(/project id/i);
    expect(mockApiClient.updateSegmentationResults).not.toHaveBeenCalled();
  });

  it('resolves on a successful save', async () => {
    renderEditor();
    await waitFor(() => expect(capturedEditorProps.current).not.toBeNull());

    mockApiClient.updateSegmentationResults.mockResolvedValueOnce({
      polygons: [],
    });

    await expect(callOnSave()).resolves.toBeUndefined();
    expect(mockApiClient.updateSegmentationResults).toHaveBeenCalledTimes(1);
  });
});

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
  mockEditor.hasUnsavedChanges = false;
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

  it('shows SpermInstancePanel when the project type is sperm', () => {
    mockProjectData.projectType = 'sperm';
    mockEditor.polygons = [
      {
        id: 'p1',
        geometry: 'polyline',
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

  it('shows MicrotubuleInstancePanel when the project type is microtubules', () => {
    mockProjectData.projectType = 'microtubules';
    mockEditor.polygons = [
      {
        id: 'p1',
        geometry: 'polyline',
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

  it('keys the panel on project type, NOT per-polygon class/partClass', () => {
    // A polyline stamped microtubule-ish in a SPERM project is still sperm —
    // the project type is the single source of truth, so one mis-stamped
    // polyline can no longer flip the whole sidebar.
    mockProjectData.projectType = 'sperm';
    mockEditor.polygons = [
      {
        id: 'p1',
        geometry: 'polyline',
        class: 'microtubule',
        partClass: 'head',
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

describe('the annotation-geometry gate reaches the rail', () => {
  // The gate's own unit tests render VerticalToolbar with the prop directly.
  // That leaves the SEAM untested: dropping `projectType={projectType}` in
  // SegmentationEditorLayout turns the whole feature into a no-op and was
  // measured to pass all 5 025 frontend tests. These assert the wiring.
  beforeEach(() => {
    // Without an image the editor renders the "no preview" placeholder and
    // never reaches the rail at all.
    mockProjectData.images = [
      { id: 'img-1', name: 'x.jpg', segmentationStatus: 'completed' },
    ];
    mockParams.imageId = 'img-1';
  });

  it.each(['spheroid', 'sperm', 'microtubules', 'wound'])(
    'hands %s down to the toolbar',
    type => {
      mockProjectData.projectType = type;
      renderEditor();

      expect(
        screen.getByTestId('vertical-toolbar').getAttribute('data-project-type')
      ).toBe(type);
      // Same seam, second consumer: the shortcuts sheet must list only the
      // create key that works, and it can only know from this prop.
      expect(
        screen.getByTestId('keyboard-help').getAttribute('data-project-type')
      ).toBe(type);
    }
  );
});

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
      fireEvent.click(btn);
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
      fireEvent.click(btn);
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
      fireEvent.click(btn);
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

  it('uses "spheroid_disintegration" for spheroid_invasive project', async () => {
    mockProjectData.projectType = 'spheroid_invasive';
    renderEditor();

    const btn = screen.getByTestId('resegment-btn');
    await act(async () => {
      fireEvent.click(btn);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockApiClient.requestBatchSegmentation).toHaveBeenCalledWith(
      ['img-1'],
      'spheroid_disintegration',
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

// ─── microtubule type labels ─────────────────────────────────────────────────
//
// The two halves of the fix — an untracked polyline must be a valid target, and
// the label must be stamped into editor state rather than fetched back by an
// abortable reload — live in handleChangeMtType, not in the pure helpers. Both
// were reverted here to check: with CanvasPolygon stubbed to null, a full revert
// of either passed the entire suite. These tests are the ones that fail.

describe('microtubule type labels', () => {
  const polyline = (over: Record<string, unknown> = {}) => ({
    id: 'poly-1',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    geometry: 'polyline',
    type: 'external',
    class: 'spheroid',
    ...over,
  });

  beforeEach(() => {
    mockProjectData.projectType = 'microtubules';
    mockProjectData.images = [{ id: 'img-1', name: 'f.tif' }];
    mockVideo.container = { id: 'vid-1', channels: [] };
  });

  const setPolygons = (polys: unknown[]) => {
    mockEditor.polygons = polys as never[];
    mockEditor.getPolygons.mockReturnValue(polys as never[]);
  };

  it('types an UNTRACKED polyline without any cross-frame write', async () => {
    setPolygons([polyline()]);
    renderEditor();
    const btn = await screen.findByTestId('mt-type-poly-1');

    await act(async () => {
      fireEvent.click(btn);
    });

    const { toast } = await import('sonner');
    // The whole bug: this used to abort with "no track yet" before doing
    // anything, because the polyline has no trackId.
    expect(mockApiClient.setTrackType).not.toHaveBeenCalled();
    expect(mockEditor.updatePolygons).toHaveBeenCalledTimes(1);
    const [stamped] = mockEditor.updatePolygons.mock.calls[0] as [
      Array<{ id: string; mtType?: string }>,
    ];
    expect(stamped.find(p => p.id === 'poly-1')?.mtType).toBe('mt_type_brain');
    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('puts the stamp in the undo history on BOTH paths', async () => {
    // Not a style choice. The image-switch autosave saves
    // `history[historyIndex]`, NOT `polygons` (useEnhancedSegmentationEditor
    // ~line 293), while the manual save uses `polygons`. A stamp kept out of
    // history therefore survives Save but is wiped by the very next frame
    // scrub, which autosaves the pre-stamp snapshot over a row the backend had
    // just labelled. Passing no second argument takes the default, which is
    // what puts it in history.
    setPolygons([polyline()]);
    renderEditor();
    const untracked = await screen.findByTestId('mt-type-poly-1');
    await act(async () => {
      fireEvent.click(untracked);
    });
    expect(mockEditor.updatePolygons.mock.calls[0][1]).toBeUndefined();

    mockEditor.updatePolygons.mockClear();
    setPolygons([polyline({ trackId: 'track-9' })]);
    mockApiClient.setTrackType.mockResolvedValue({ framesAffected: 7 });
    cleanup();
    renderEditor();
    const tracked = await screen.findByTestId('mt-type-poly-1');
    await act(async () => {
      fireEvent.click(tracked);
    });
    expect(mockEditor.updatePolygons.mock.calls[0][1]).toBeUndefined();
  });

  it('writes across frames for a TRACKED polyline and stamps this frame too', async () => {
    setPolygons([polyline({ trackId: 'track-9' })]);
    mockApiClient.setTrackType.mockResolvedValue({ framesAffected: 7 });
    renderEditor();

    const target = await screen.findByTestId('mt-type-poly-1');
    await act(async () => {
      fireEvent.click(target);
    });

    expect(mockApiClient.setTrackType).toHaveBeenCalledWith(
      'vid-1',
      ['track-9'],
      'mt_type_brain'
    );
    expect(mockEditor.updatePolygons).toHaveBeenCalledTimes(1);
  });

  it('does not dirty the frame when the label is already the one asked for', async () => {
    setPolygons([polyline({ mtType: 'mt_type_brain' })]);
    renderEditor();

    const target = await screen.findByTestId('mt-type-poly-1');
    await act(async () => {
      fireEvent.click(target);
    });

    const { toast } = await import('sonner');
    // No write, no undo entry — but the user still gets a success, because the
    // MT does carry the label they asked for.
    expect(mockEditor.updatePolygons).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports failure when the polygon is no longer on the frame', async () => {
    // The context menu holds the id it was opened with; a resegment or a
    // background reload can replace the frame's polygons underneath it.
    setPolygons([polyline()]);
    renderEditor();
    const btn = await screen.findByTestId('mt-type-poly-1');
    setPolygons([polyline({ id: 'poly-fresh' })]);

    await act(async () => {
      fireEvent.click(btn);
    });

    const { toast } = await import('sonner');
    expect(mockApiClient.setTrackType).not.toHaveBeenCalled();
    expect(mockEditor.updatePolygons).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('surfaces a failed cross-frame write and stamps nothing', async () => {
    setPolygons([polyline({ trackId: 'track-9' })]);
    mockApiClient.setTrackType.mockRejectedValue(new Error('boom'));
    renderEditor();

    const target = await screen.findByTestId('mt-type-poly-1');
    await act(async () => {
      fireEvent.click(target);
    });

    const { toast } = await import('sonner');
    expect(mockEditor.updatePolygons).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('refuses a tracked target when the container is not resolved yet', async () => {
    setPolygons([polyline({ trackId: 'track-9' })]);
    mockVideo.container = null;
    renderEditor();

    const target = await screen.findByTestId('mt-type-poly-1');
    await act(async () => {
      fireEvent.click(target);
    });

    const { toast } = await import('sonner');
    // Stamping only this frame and calling it success would leave the rest of
    // the track quietly unlabelled.
    expect(mockApiClient.setTrackType).not.toHaveBeenCalled();
    expect(mockEditor.updatePolygons).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

// ─── static-channel share on save ────────────────────────────────────────────

/**
 * A container whose segmentation channel is one picture stamped onto every
 * frame (`ChannelMeta.staticSource`) has ONE annotation, not N. The server now
 * copies a manual save onto the sibling frames and reports WHICH ones it wrote;
 * the editor has to act on that, because its frame loader paints any cache
 * entry it finds regardless of staleness — without an eviction a scrub would
 * keep showing the pre-save geometry until a full page reload.
 */
describe('static-channel share on save', () => {
  const FRAMES = [
    { id: 'img-1', frameIndex: 0 },
    { id: 'f2', frameIndex: 1 },
    { id: 'f3', frameIndex: 2 },
  ];

  const renderWithFrames = () => {
    mockProjectData.images = [
      { id: 'img-1', name: 'frame 0', segmentationStatus: 'segmented' },
      { id: 'f2', name: 'frame 1', segmentationStatus: 'no_segmentation' },
      { id: 'f3', name: 'frame 2', segmentationStatus: 'no_segmentation' },
    ];
    mockVideo.container = { id: 'vid-1', frames: FRAMES, channels: [] };
    mockVideo.currentFrame = FRAMES[0];
    const queryClient = makeQueryClient();
    const removeQueries = vi.spyOn(queryClient, 'removeQueries');
    renderEditor(queryClient);
    return removeQueries;
  };

  /** `frameIds` is what the SERVER says it wrote — never the anchor itself. */
  const respondWith = (frameIds?: string[]) =>
    mockApiClient.updateSegmentationResults.mockResolvedValue({
      polygons: [],
      ...(frameIds ? { staticShare: { frameIds } } : {}),
    });

  const save = (targetImageId: string) =>
    act(async () => {
      await capturedEditorProps.current.onSave(
        [],
        targetImageId,
        { width: 10, height: 10 },
        undefined
      );
    });

  const evictedFrames = (removeQueries: ReturnType<typeof vi.spyOn>) =>
    removeQueries.mock.calls.map((c: any) => (c[0]?.queryKey ?? [])[1]);

  it('evicts exactly the frames the server wrote, and says how far the save reached', async () => {
    respondWith(['f2', 'f3']);
    const removeQueries = renderWithFrames();

    await save('img-1');

    // Exactly those, and NOT the whole container: a static channel can cover a
    // subset, and a frame with no recorded alignment shift is left alone. The
    // saved frame is absent because the response already carries its polygons.
    expect(evictedFrames(removeQueries)).toEqual(['f2', 'f3']);
    // The frames that had no segmentation now have one; without this the
    // loader's `hasSegmentation` gate never lets the refetch happen.
    expect(mockProjectData.updateImages).toHaveBeenCalledTimes(1);
    // The displayed frame IS the saved frame — a re-read would be wasted.
    expect(mockReloadSegmentation).not.toHaveBeenCalled();

    const { toast } = await import('sonner');
    expect(toast.success).toHaveBeenCalledWith(
      'segmentation.toolbar.sharedAcrossFrames'
    );
  });

  it('leaves a frame the server did NOT write alone', async () => {
    // Same save, partial coverage: only f3 was rewritten. Marking f2 segmented
    // would send the loader after a segmentation row that does not exist.
    respondWith(['f3']);
    const removeQueries = renderWithFrames();

    await save('img-1');

    expect(evictedFrames(removeQueries)).toEqual(['f3']);
    const marked = (mockProjectData.updateImages.mock.calls[0][0] as any)(
      mockProjectData.images
    );
    expect(marked.map((i: any) => i.segmentationStatus)).toEqual([
      'segmented',
      'no_segmentation',
      'segmented',
    ]);
  });

  it('does none of it when the response carries no staticShare', async () => {
    // Identical fixture, one field removed — the ordinary single-frame save.
    respondWith();
    const removeQueries = renderWithFrames();

    await save('img-1');

    expect(removeQueries).not.toHaveBeenCalled();
    expect(mockProjectData.updateImages).not.toHaveBeenCalled();
    const { toast } = await import('sonner');
    expect(toast.success).toHaveBeenCalledWith('toast.dataSaved');
  });

  it('re-reads the DISPLAYED frame after a frame-switch autosave, silently', async () => {
    // Switching frames autosaves the previous one while the editor is already
    // showing the new one. Evicting its cache is not enough: its fetch resolved
    // long before the ~2 s projection did, so the canvas is holding pre-share
    // geometry that nothing would replace until the user scrubbed away and
    // back. Autosave stays silent, so no toast.
    respondWith(['img-1', 'f3']);
    renderWithFrames();

    await save('f2');

    expect(mockReloadSegmentation).toHaveBeenCalledTimes(1);
    const { toast } = await import('sonner');
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('does not re-read a displayed frame the share did not touch', async () => {
    // The autosave went to f2 and the server rewrote only f3; the frame on
    // screen (img-1) is unchanged, so its canvas is not stale.
    respondWith(['f3']);
    renderWithFrames();

    await save('f2');

    expect(mockReloadSegmentation).not.toHaveBeenCalled();
  });

  it('warns instead of re-reading over work in progress', async () => {
    // Same autosave, except the user has already started editing the frame they
    // scrubbed to. Repainting from the server would throw that away and there
    // is no undo past a reload — but staying silent is what let the original
    // bug through, and their next save will broadcast what this canvas shows.
    mockEditor.hasUnsavedChanges = true;
    respondWith(['img-1', 'f3']);
    renderWithFrames();

    await save('f2');

    expect(mockReloadSegmentation).not.toHaveBeenCalled();
    const { toast } = await import('sonner');
    expect(toast.warning).toHaveBeenCalledWith(
      'segmentation.toolbar.sharedElsewhereReload'
    );
  });
});

describe('arming the neurite assignment tool', () => {
  // A mode whose effect is invisible is indistinguishable from a mode that did
  // nothing. The default class colouring paints every neurite the same cyan and
  // shows NO assignment, so a user could click a neurite and two somas, have
  // the data written correctly, and see the canvas not move. Found on
  // production 2026-09-08 after the mode shipped.
  //
  // Asserts the SETTER call rather than a later `getItem`: the shared
  // localStorage mock is reset between tests by the global `beforeEach`, so a
  // read-back tests the harness, not the editor.
  const setItemCalls = () =>
    ((localStorage.setItem as unknown as { mock: { calls: string[][] } }).mock
      ?.calls ?? []) as string[][];

  beforeEach(() => {
    mockEditor.editMode = 'view';
    mockProjectData.projectType = 'spheroid';
    // The editor needs an image to mount past its loading gate; the global
    // beforeEach clears the list.
    mockProjectData.images = [
      { id: 'img-1', name: 'frame.png', segmentationStatus: 'completed' },
    ];
  });

  it('switches the canvas to the by-cell colouring', () => {
    mockProjectData.projectType = 'neurite';
    mockEditor.editMode = 'assign-neurite';
    renderEditor();
    expect(setItemCalls()).toContainEqual(['neuriteColorMode', 'assignment']);
  });

  it('leaves the colouring alone in every other mode', () => {
    // Otherwise arming any tool at all would hijack a view setting the user
    // chose deliberately.
    mockProjectData.projectType = 'neurite';
    mockEditor.editMode = 'edit-vertices';
    renderEditor();
    expect(setItemCalls()).not.toContainEqual([
      'neuriteColorMode',
      'assignment',
    ]);
  });

  it('leaves it alone on a project type that has no somas', () => {
    // The mode is unreachable there, but a stale editMode from a previous
    // project must not recolour a microtubule canvas.
    mockProjectData.projectType = 'microtubules';
    mockEditor.editMode = 'assign-neurite';
    renderEditor();
    expect(setItemCalls()).not.toContainEqual([
      'neuriteColorMode',
      'assignment',
    ]);
  });
});
