/**
 * Regression: per-microtubule propagate on a COLD DEEP-LINK into a frame URL.
 *
 * `/segmentation/:projectId/:imageId` is how a bookmark, a shared link, or
 * "back to frame 1 of my video" opens the editor. In that state
 * `useVideoFrames`' container query (`GET /images/:id/video-frames`) has not
 * resolved, so `video.container` is `null` — while `videoContainerId`
 * (`selectedImage.parentVideoId`) and `selectedImage.frameIndex` are already
 * populated, because they come off the frame row that `useProjectData` had to
 * deliver before the editor rendered anything at all.
 *
 * Both propagate handlers read the container id AND the frame index out of
 * `video.container`, so both guarded out and toasted "propagate failed".
 * `useDeleteTrackScope` was fixed for exactly this (see the comment on its
 * `videoId` prop); the propagate pair was missed.
 *
 * THE FIXTURE IS THE POINT: `mockVideo.container` stays `null` in every
 * positive test while the frame row carries `parentVideoId: 'vid-9'` and
 * `frameIndex: 7`. A fixture where the two agree cannot tell the old code from
 * the new one. `frameIndex: 7` is likewise deliberate — `video.frameIndex`
 * (the slider position) defaults to 0, so a fix that reached for it instead
 * would propagate from the wrong frame and this test would catch it.
 *
 * Mock strategy mirrors SegmentationEditor.orchestration.test.tsx: stub every
 * heavy child + hook so the orchestrator's own logic runs without the
 * canvas/ML import graph.
 */
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── hoisted mock state ───────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn());

const mockParams = vi.hoisted(() => ({
  projectId: 'proj-1',
  imageId: 'img-1',
}));

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

const mockProjectData = vi.hoisted(() => ({
  projectTitle: 'MT Project',
  projectType: 'microtubules' as string,
  images: [] as any[],
  loading: false,
  refreshImageSegmentation: vi.fn(),
  updateImages: vi.fn(),
}));

/** Video stub. `container: null` is the cold-deep-link state under test. */
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
  requestBatchSegmentation: vi
    .fn()
    .mockResolvedValue({ successful: 1, failed: 0, results: [] }),
  getMtTypeLabels: vi.fn().mockResolvedValue([]),
  putMtTypeLabels: vi.fn().mockResolvedValue([]),
  deleteMtTypeLabel: vi.fn().mockResolvedValue([]),
  setTrackType: vi.fn().mockResolvedValue({ framesAffected: 0 }),
  propagateTrackForward: vi
    .fn()
    .mockResolvedValue({ trackId: 'track-new', framesUpdated: 4 }),
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

// Only the two cache accessors are stubbed. `segmentationPolygonsQueryKey` is
// the REAL one: `evictVideoFrameSegmentationCaches` now runs on a cold
// deep-link (it used to bail on the null container), and a missing export
// there throws inside the propagate handler's try block — which reads exactly
// like the bug this file is about.
vi.mock('../hooks/segmentationPolygonCache', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../hooks/segmentationPolygonCache')
  >()),
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

vi.mock('@/lib/rendering/FpsMeter', () => ({
  FpsMeter: () => null,
}));

// ─── child component stubs ────────────────────────────────────────────────────

vi.mock('../components/EditorHeader', () => ({
  default: () => <div data-testid="editor-header" />,
}));

vi.mock('../components/VerticalToolbar', () => ({
  default: () => <div data-testid="vertical-toolbar" />,
}));

vi.mock('../components/TopToolbar', () => ({
  default: () => <div data-testid="top-toolbar" />,
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

// The ONLY route from a user gesture to the two handlers under test is
// SegmentationEditorLayout -> CanvasPolygon -> PolygonContextMenu. Stub the
// leaf to plain buttons so the orchestrator's callbacks are reachable; the
// layout's real wiring (which callback is handed to which prop) still runs.
vi.mock('../components/canvas/CanvasPolygon', () => ({
  default: ({
    polygon,
    onPropagateTrack,
    onPropagateSelected,
    onSelectPolygon,
  }: {
    polygon: { id: string };
    onPropagateTrack?: (polygonId: string) => void;
    onPropagateSelected?: () => void;
    onSelectPolygon?: (polygonId: string, additive?: boolean) => void;
  }) => (
    <g>
      <text
        data-testid={`propagate-${polygon.id}`}
        onClick={() => onPropagateTrack?.(polygon.id)}
      />
      <text
        data-testid={`shift-select-${polygon.id}`}
        onClick={() => onSelectPolygon?.(polygon.id, true)}
      />
      <text
        data-testid={`propagate-selected-${polygon.id}`}
        onClick={() => onPropagateSelected?.()}
      />
    </g>
  ),
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
  SegmentChannelDialog: () => null,
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

const polyline = (over: Record<string, unknown> = {}) => ({
  id: 'poly-1',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 30, y: 4 },
  ],
  geometry: 'polyline',
  type: 'external',
  class: 'spheroid',
  ...over,
});

const setPolygons = (polys: unknown[]) => {
  mockEditor.polygons = polys as never[];
  mockEditor.getPolygons.mockReturnValue(polys as never[]);
};

/** The frame row a cold deep-link lands on: it knows its container and its
 *  own index, because `useProjectData` had to deliver it before the editor
 *  could render at all. */
const COLD_DEEP_LINK_FRAME = {
  id: 'img-1',
  name: 'frame-0007.png',
  isVideoContainer: false,
  parentVideoId: 'vid-9',
  frameIndex: 7,
  width: 800,
  height: 600,
  segmentationStatus: 'completed',
};

beforeEach(() => {
  mockParams.projectId = 'proj-1';
  mockParams.imageId = 'img-1';

  mockProjectData.projectTitle = 'MT Project';
  mockProjectData.projectType = 'microtubules';
  mockProjectData.images = [COLD_DEEP_LINK_FRAME];
  mockProjectData.loading = false;

  mockEditor.polygons = [];
  mockEditor.editMode = 'view';
  mockEditor.selectedPolygonId = null;
  mockEditor.getPolygons.mockReturnValue([]);

  // The container query has NOT resolved. This is the whole point.
  mockVideo.container = null;
  mockVideo.frameIndex = 0;
  mockVideo.currentFrame = null;
  mockVideo.isPlaying = false;

  vi.clearAllMocks();
  // `clearAllMocks` keeps implementations, but re-assert the ones this file
  // depends on so a `mockResolvedValue` set by one test cannot leak into the
  // next.
  mockEditor.keyboardState.isShiftPressed.mockReturnValue(false);
  mockEditor.getPolygons.mockReturnValue([]);
  mockApiClient.getSegmentationResults.mockResolvedValue(null);
  mockApiClient.propagateTrackForward.mockResolvedValue({
    trackId: 'track-new',
    framesUpdated: 4,
  });
  mockGetCached.mockReturnValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** Fire the context-menu action, then let the handler's promise chain settle.
 *
 *  Deliberately a bounded microtask drain rather than `await act(async () =>
 *  fireEvent.click(...))` or `vi.waitFor(...)`: both of those spin here — the
 *  editor's own pending async work keeps their queue from draining, and the
 *  test dies on the timeout with the API call already correctly made
 *  (measured). `fireEvent` is act-wrapped synchronously by RTL, and the
 *  propagate path touches no React state of its own — `handleUpdatePolygonField`
 *  calls the stubbed `editor.updatePolygons`, the toasts are mocked — so
 *  draining microtasks is both sufficient and warning-free.
 */
const clickAndSettle = async (
  testId: string,
  expectation: () => void
): Promise<void> => {
  fireEvent.click(screen.getByTestId(testId));
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve();
  }
  expectation();
};

describe('propagate on a cold deep-link (video.container still null)', () => {
  it('propagates ONE microtubule using the frame row\u2019s own container id + index', async () => {
    setPolygons([polyline({ trackId: 'track-3', name: 'MT1' })]);
    renderEditor();

    // The fixture really is the discriminating one: the container fetch has
    // produced nothing, so the OLD code had neither an id nor an index.
    expect(mockVideo.container).toBeNull();

    await clickAndSettle('propagate-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(1);
    });

    expect(mockApiClient.propagateTrackForward).toHaveBeenCalledWith(
      'vid-9',
      7,
      expect.objectContaining({
        trackId: 'track-3',
        name: 'MT1',
        geometry: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 30, y: 4 },
        ],
      })
    );
    // The whole handler ran, not just the request: everything after the await
    // (cache eviction, status bump) is inside the same try block, so a throw in
    // any of it lands on the failure toast instead of this one.
    const { toast } = await import('sonner');
    // `t` is stubbed to echo the key, so the interpolated count does not reach
    // the toast here.
    expect(toast.success).toHaveBeenCalledWith(
      'segmentation.trackOps.propagateSuccess'
    );
  });

  it('propagates EVERY Shift-selected microtubule from the same frame index', async () => {
    // Two already-tracked microtubules; the server echoes back the trackId it
    // was handed, so nothing is re-stamped locally.
    mockApiClient.propagateTrackForward.mockImplementation(
      async (
        _videoId: string,
        _fromFrameIndex: number,
        p: { trackId?: string | null }
      ) => ({ trackId: p.trackId ?? 'track-new', framesUpdated: 4 })
    );
    const sources = () =>
      [
        polyline({ id: 'poly-1', trackId: 'track-1' }),
        polyline({ id: 'poly-2', trackId: 'track-2' }),
      ] as never[];
    mockEditor.polygons = sources();
    mockEditor.getPolygons.mockImplementation(sources);
    renderEditor();

    // Build the multi-selection through the real additive-toggle path.
    fireEvent.click(screen.getByTestId('shift-select-poly-1'));
    fireEvent.click(screen.getByTestId('shift-select-poly-2'));

    await clickAndSettle('propagate-selected-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(2);
    });

    const calls = mockApiClient.propagateTrackForward.mock.calls as Array<
      [string, number, { trackId?: string | null }]
    >;
    expect(calls.map(c => [c[0], c[1]])).toEqual([
      ['vid-9', 7],
      ['vid-9', 7],
    ]);
    expect(calls.map(c => c[2].trackId).sort()).toEqual(['track-1', 'track-2']);
  });

  it('bumps the FOLLOWING frames out of the listing, not the container fetch', async () => {
    // The half of the fix that is easy to forget: propagate now succeeds while
    // `video.container` is null, so the follow-up that flips the later frames
    // to `segmented` must have the same fallback. Without it the server write
    // lands, the toast says "propagated", and every one of those frames renders
    // BLANK on a scrub until a full page reload — `useSegmentationLoader` gates
    // its fetch on the in-memory status.
    const frame = (id: string, frameIndex: number, over = {}) => ({
      id,
      name: `frame-${frameIndex}.png`,
      isVideoContainer: false,
      parentVideoId: 'vid-9',
      frameIndex,
      segmentationStatus: 'no_segmentation',
      ...over,
    });
    mockProjectData.images = [
      COLD_DEEP_LINK_FRAME, // vid-9, frameIndex 7 — the one being edited
      frame('img-2', 8),
      frame('img-3', 9),
      frame('img-0', 0), // earlier frame: propagate is forward-only
      frame('other-1', 8, { parentVideoId: 'other-vid' }), // a different video
    ];
    setPolygons([polyline({ trackId: 'track-3' })]);
    renderEditor();

    await clickAndSettle('propagate-poly-1', () => {
      expect(mockProjectData.updateImages).toHaveBeenCalledTimes(1);
    });

    const updater = mockProjectData.updateImages.mock.calls[0][0] as (
      prev: Array<{ id: string; segmentationStatus?: string }>
    ) => Array<{ id: string; segmentationStatus?: string }>;
    const statuses = Object.fromEntries(
      updater(mockProjectData.images).map(img => [
        img.id,
        img.segmentationStatus,
      ])
    );
    expect(statuses).toEqual({
      'img-1': 'completed', // the source frame, untouched
      'img-2': 'segmented',
      'img-3': 'segmented',
      'img-0': 'no_segmentation', // before the source frame
      'other-1': 'no_segmentation', // another container entirely
    });
  });

  it('evicts the listing frames too, so a scrub refetches the new geometry', async () => {
    // The eviction half of the same fallback. `evictVideoFrameSegmentationCaches`
    // is shared with the static-share path, where an explicit `frameIds` list is
    // passed; a track op passes nothing and means "every frame of the
    // container", and that list has to survive a null container the same way
    // the status bump does. Otherwise the propagate lands, the frame loader
    // finds a cached pre-propagate segmentation and paints it — it serves any
    // entry it has, staleness be damned.
    const frame = (id: string, frameIndex: number) => ({
      id,
      name: `frame-${frameIndex}.png`,
      isVideoContainer: false,
      parentVideoId: 'vid-9',
      frameIndex,
      segmentationStatus: 'no_segmentation',
    });
    mockProjectData.images = [
      COLD_DEEP_LINK_FRAME, // vid-9, frameIndex 7
      frame('img-2', 8),
      frame('other-1', 8), // overwritten below to a different container
    ];
    mockProjectData.images[2].parentVideoId = 'other-vid';
    setPolygons([polyline({ trackId: 'track-3' })]);

    const queryClient = makeQueryClient();
    const removeQueries = vi.spyOn(queryClient, 'removeQueries');
    renderEditor(queryClient);

    await clickAndSettle('propagate-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(1);
    });

    const evicted = removeQueries.mock.calls.map(
      c => ((c[0] as { queryKey?: unknown[] })?.queryKey ?? [])[1]
    );
    // Every frame of THIS container — the source frame included, because a
    // propagate can rewrite it too — and nothing from another container.
    expect(evicted.sort()).toEqual(['img-1', 'img-2']);
  });

  it('still refuses, loudly, when the row genuinely has no video container', async () => {
    // Not a deep-link race: a standalone image has no container at all, so
    // there is no later frame to write into. The toast must survive the fix.
    mockProjectData.images = [
      {
        id: 'img-1',
        name: 'standalone.png',
        isVideoContainer: false,
        parentVideoId: null,
        frameIndex: null,
      },
    ];
    setPolygons([polyline({ trackId: 'track-3' })]);
    renderEditor();

    const { toast } = await import('sonner');
    await clickAndSettle('propagate-poly-1', () => {
      expect(toast.error).toHaveBeenCalledWith(
        'segmentation.trackOps.propagateFailed'
      );
    });
    expect(mockApiClient.propagateTrackForward).not.toHaveBeenCalled();
  });

  it('says so when the BULK action has no video either, instead of no-opping', async () => {
    // `PolygonContextMenu` gates "Propagate selected tracks (N)" on
    // `isMicrotubules && multiSelectCount >= 2` with no video gate, so an MT
    // project of standalone images reaches this handler. It used to `return`
    // bare: dialog confirmed, nothing happened, no explanation.
    mockProjectData.images = [
      {
        id: 'img-1',
        name: 'standalone.png',
        isVideoContainer: false,
        parentVideoId: null,
        frameIndex: null,
      },
    ];
    setPolygons([polyline({ trackId: 'track-3' })]);
    renderEditor();

    const { toast } = await import('sonner');
    await clickAndSettle('propagate-selected-poly-1', () => {
      expect(toast.error).toHaveBeenCalledWith(
        'segmentation.trackOps.propagateFailed'
      );
    });
    expect(mockApiClient.propagateTrackForward).not.toHaveBeenCalled();
  });

  it('falls back to the container frame list when the row carries no index', async () => {
    // The fallback branch: a frame row that reached the gallery listing
    // without `frameIndex`. Both sources read the same `Image.frameIndex`
    // column, so this can only ever resolve later \u2014 never differently.
    mockProjectData.images = [{ ...COLD_DEEP_LINK_FRAME, frameIndex: null }];
    mockVideo.container = {
      id: 'vid-9',
      channels: [],
      frameCount: 12,
      frames: [
        { id: 'img-0', frameIndex: 0 },
        { id: 'img-1', frameIndex: 7 },
      ],
    };
    setPolygons([polyline({ trackId: 'track-3' })]);
    renderEditor();

    await clickAndSettle('propagate-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(1);
    });

    expect(mockApiClient.propagateTrackForward).toHaveBeenCalledWith(
      'vid-9',
      7,
      expect.objectContaining({ trackId: 'track-3' })
    );
  });
});
