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
  // Propagate COMMITS the frame first (2026-09-08): the endpoint writes
  // `frameIndex > from` and would otherwise leave the source frame holding the
  // old geometry. A save that resolves `false` must abort the propagate, so
  // this has to resolve `true` for the positive cases below.
  handleSave: vi.fn().mockResolvedValue(true),
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

/** The server wrote four following frames. Spelled out in full: the client
 *  falls back to `framesUpdated` when `framesChanged` is missing, and a fixture
 *  leaning on that fallback would keep every positive test green while the
 *  handler read the wrong field. `framesUpdated` (5) deliberately differs from
 *  `framesChanged` (4) so the two cannot be confused. */
const PROPAGATED_TO_FOUR = vi.hoisted(() => ({
  trackId: 'track-new',
  framesUpdated: 5,
  framesChanged: 4,
  framesUnchanged: 1,
  framesSkipped: 0,
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
  propagateTrackForward: vi.fn().mockResolvedValue(PROPAGATED_TO_FOUR),
}));

/** `t` echoes the key, so a toast is asserted by key — and, being a spy, by
 *  the params it was asked to interpolate, which the toast itself never sees. */
const mockT = vi.hoisted(() =>
  vi.fn((key: string, _params?: Record<string, unknown>) => key)
);

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
  useLanguage: () => ({ t: mockT }),
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

/** The props the editor handed to the (stubbed) editor hook. Captured for the
 *  production `onSave`: it is what records whether a save fanned out across a
 *  static container, and the hook that would call it is mocked away. */
const capturedEditorProps = vi.hoisted(() => ({ current: null as any }));

vi.mock('../hooks/useEnhancedSegmentationEditor', () => ({
  useEnhancedSegmentationEditor: (props: any) => {
    capturedEditorProps.current = props;
    return mockEditor;
  },
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
    // Without this a `toast.info` throws inside the handler's try block and
    // surfaces as the FAILURE toast — a wrong test, not a missing one.
    info: vi.fn(),
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
  mockApiClient.propagateTrackForward.mockReset();
  mockApiClient.propagateTrackForward.mockResolvedValue(PROPAGATED_TO_FOUR);
  mockApiClient.updateSegmentationResults.mockResolvedValue({ polygons: [] });
  mockEditor.handleSave.mockReset();
  mockEditor.handleSave.mockResolvedValue(true);
  mockT.mockImplementation((key: string) => key);
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
  // --- commit-before-propagate (2026-09-08) --------------------------------
  //
  // `propagateTrackGeometryForward` writes `frameIndex > fromFrameIndex`, so it
  // never writes the frame the shape was drawn on. Propagating an unsaved edit
  // therefore wrote the new geometry to every LATER frame and left the source
  // frame with the old one; once the frame-switch autosave was removed the same
  // day, scrubbing away discarded the edit and the frame snapped back — which
  // is what "propagate does nothing" looked like from the outside.

  it('SAVES the frame before propagating from it', async () => {
    setPolygons([polyline({ trackId: 'track-3', name: 'MT1' })]);
    renderEditor();

    await clickAndSettle('propagate-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(1);
    });

    expect(mockEditor.handleSave).toHaveBeenCalledTimes(1);
    // ORDER is the claim, not merely that both ran: propagating first and
    // saving second would leave the same inconsistency for the window between.
    const saveOrder = mockEditor.handleSave.mock.invocationCallOrder[0];
    const propOrder =
      mockApiClient.propagateTrackForward.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(propOrder);
  });

  it('does NOT propagate when the save fails, so no frame diverges', async () => {
    mockEditor.handleSave.mockResolvedValueOnce(false);
    setPolygons([polyline({ trackId: 'track-3', name: 'MT1' })]);
    renderEditor();

    await clickAndSettle('propagate-poly-1', () => {
      expect(mockEditor.handleSave).toHaveBeenCalledTimes(1);
    });

    // The source frame could not be persisted; writing the new shape to the
    // later frames anyway is precisely the split-brain this guards against.
    expect(mockApiClient.propagateTrackForward).not.toHaveBeenCalled();
  });

  it('saves ONCE for a bulk propagate, not once per microtubule', async () => {
    setPolygons([
      polyline({ id: 'poly-1', trackId: 'track-1' }),
      polyline({ id: 'poly-2', trackId: 'track-2' }),
    ]);
    renderEditor();

    await clickAndSettle('shift-select-poly-1', () => {});
    await clickAndSettle('shift-select-poly-2', () => {});
    await clickAndSettle('propagate-selected-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(2);
    });

    expect(mockEditor.handleSave).toHaveBeenCalledTimes(1);
  });

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
    // The count is the frames WRITTEN (4), not the frames the microtubule is
    // on (5): the fifth already had this shape.
    expect(mockT).toHaveBeenCalledWith(
      'segmentation.trackOps.propagateSuccess',
      { count: 4 }
    );
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('propagates EVERY Shift-selected microtubule from the same frame index', async () => {
    // Two already-tracked microtubules; the server echoes back the trackId it
    // was handed, so nothing is re-stamped locally.
    mockApiClient.propagateTrackForward.mockImplementation(
      async (
        _videoId: string,
        _fromFrameIndex: number,
        p: { trackId?: string | null }
      ) => ({ ...PROPAGATED_TO_FOUR, trackId: p.trackId ?? 'track-new' })
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

// --- "nothing to change" (2026-10-08) ---------------------------------------
//
// The server used to rewrite every following frame whatever it held, and the
// editor toasted the full count each time, so pressing propagate twice was
// indistinguishable from two real changes. The server now leaves an identical
// frame alone and says how many it WROTE; these pin what the user is told.
//
// Every case asserts the toast METHOD as well as the key: the same sentence in
// a green success toast is the bug.
describe('propagate that changes nothing', () => {
  const NOTHING_CHANGED = {
    trackId: 'track-3',
    framesUpdated: 6,
    framesChanged: 0,
    framesUnchanged: 6,
    framesSkipped: 0,
  };
  const twoFrames = () => {
    mockProjectData.images = [
      COLD_DEEP_LINK_FRAME,
      {
        ...COLD_DEEP_LINK_FRAME,
        id: 'img-2',
        frameIndex: 8,
        segmentationStatus: 'no_segmentation',
      },
    ];
  };
  const toasts = async () => (await import('sonner')).toast;
  const selectBoth = () => {
    fireEvent.click(screen.getByTestId('shift-select-poly-1'));
    fireEvent.click(screen.getByTestId('shift-select-poly-2'));
  };
  const twoTracked = () => {
    const sources = () =>
      [
        polyline({ id: 'poly-1', trackId: 'track-1' }),
        polyline({ id: 'poly-2', trackId: 'track-2' }),
      ] as never[];
    mockEditor.polygons = sources();
    mockEditor.getPolygons.mockImplementation(sources);
  };
  /** Per-track server answers for the bulk loop, echoing the trackId sent. */
  const answerByTrack = (byTrack: Record<string, Record<string, number>>) =>
    mockApiClient.propagateTrackForward.mockImplementation(
      async (_v: string, _f: number, p: { trackId?: string | null }) => ({
        ...NOTHING_CHANGED,
        ...byTrack[p.trackId ?? ''],
        trackId: p.trackId ?? 'track-new',
      })
    );

  it('says "nothing to change" as INFO, and evicts and marks nothing', async () => {
    mockApiClient.propagateTrackForward.mockResolvedValue(NOTHING_CHANGED);
    twoFrames();
    setPolygons([polyline({ trackId: 'track-3' })]);
    const queryClient = makeQueryClient();
    const removeQueries = vi.spyOn(queryClient, 'removeQueries');
    renderEditor(queryClient);

    await clickAndSettle('propagate-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(1);
    });

    const toast = await toasts();
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      'segmentation.trackOps.propagateNoChange'
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    // No row was written: the cached frames are still right and no frame
    // gained a segmentation.
    expect(removeQueries).not.toHaveBeenCalled();
    expect(mockProjectData.updateImages).not.toHaveBeenCalled();
  });

  it('still adopts a trackId the server minted when nothing was written', async () => {
    // The last frame of a video: no following frame, but an untracked source
    // was still given an identity, and a later save must carry it.
    mockApiClient.propagateTrackForward.mockResolvedValue({
      ...NOTHING_CHANGED,
      trackId: 'mt_minted',
      framesUpdated: 0,
      framesUnchanged: 0,
    });
    setPolygons([polyline()]); // no trackId
    renderEditor();

    await clickAndSettle('propagate-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(1);
    });

    expect(mockEditor.updatePolygons).toHaveBeenCalledTimes(1);
    expect((await toasts()).info).toHaveBeenCalledWith(
      'segmentation.trackOps.propagateNoChange'
    );
  });

  it('reports FAILURE, not "nothing to change", when the only frames were unreadable', async () => {
    mockApiClient.propagateTrackForward.mockResolvedValue({
      ...NOTHING_CHANGED,
      framesUpdated: 0,
      framesUnchanged: 0,
      framesSkipped: 2,
    });
    setPolygons([polyline({ trackId: 'track-3' })]);
    renderEditor();

    await clickAndSettle('propagate-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(1);
    });

    const toast = await toasts();
    expect(toast.error).toHaveBeenCalledWith(
      'segmentation.trackOps.propagateFailed'
    );
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('BULK: says "nothing to change" when no selected microtubule changed', async () => {
    answerByTrack({});
    twoFrames();
    twoTracked();
    const queryClient = makeQueryClient();
    const removeQueries = vi.spyOn(queryClient, 'removeQueries');
    renderEditor(queryClient);
    selectBoth();

    await clickAndSettle('propagate-selected-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(2);
    });

    const toast = await toasts();
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      'segmentation.trackOps.propagateSelectedNoChange'
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(removeQueries).not.toHaveBeenCalled();
    expect(mockProjectData.updateImages).not.toHaveBeenCalled();
  });

  it('BULK: counts only the microtubules that CHANGED, and refreshes for them', async () => {
    answerByTrack({ 'track-2': { framesChanged: 3, framesUnchanged: 3 } });
    twoFrames();
    twoTracked();
    renderEditor();
    selectBoth();

    await clickAndSettle('propagate-selected-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(2);
    });

    const toast = await toasts();
    expect(toast.success).toHaveBeenCalledWith(
      'segmentation.trackOps.propagateSelectedSuccess'
    );
    // ONE of the two changed — not "2 propagated".
    expect(mockT).toHaveBeenCalledWith(
      'segmentation.trackOps.propagateSelectedSuccess',
      { count: 1 }
    );
    expect(toast.info).not.toHaveBeenCalled();
    // Something was written, so the following frames are refreshed.
    expect(mockProjectData.updateImages).toHaveBeenCalledTimes(1);
  });

  it('BULK: a request that failed is a WARNING even when nothing else changed', async () => {
    mockApiClient.propagateTrackForward
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValueOnce({ ...NOTHING_CHANGED, trackId: 'track-2' });
    twoTracked();
    renderEditor();
    selectBoth();

    await clickAndSettle('propagate-selected-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(2);
    });

    const toast = await toasts();
    expect(toast.warning).toHaveBeenCalledWith(
      'segmentation.trackOps.propagateSelectedPartial'
    );
    expect(mockT).toHaveBeenCalledWith(
      'segmentation.trackOps.propagateSelectedPartial',
      { done: 1, total: 2 }
    );
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('BULK: a microtubule stopped by unreadable frames counts as failed', async () => {
    answerByTrack({
      'track-1': { framesUnchanged: 0, framesUpdated: 0, framesSkipped: 4 },
    });
    twoTracked();
    renderEditor();
    selectBoth();

    await clickAndSettle('propagate-selected-poly-1', () => {
      expect(mockApiClient.propagateTrackForward).toHaveBeenCalledTimes(2);
    });

    const toast = await toasts();
    expect(toast.warning).toHaveBeenCalledWith(
      'segmentation.trackOps.propagateSelectedPartial'
    );
    expect(toast.info).not.toHaveBeenCalled();
  });

  // --- static container: the SAVE already reached every frame ---------------
  //
  // `commitBeforePropagate` returns before any request when the last save of
  // this frame fanned out. Whether to say anything depends on whether a save
  // ran in THIS gesture: `handleSave` resolves `true` without calling `onSave`
  // on a clean frame, and then no toast has fired at all.

  /** Run the production `onSave` for this frame with a fanned-out response. */
  const saveFansOut = async () => {
    mockApiClient.updateSegmentationResults.mockResolvedValue({
      polygons: [],
      staticShare: { frameIds: ['img-2'] },
    });
    await capturedEditorProps.current.onSave(
      [],
      'img-1',
      { width: 10, height: 10 },
      undefined
    );
  };

  it.each([
    ['propagate-poly-1', 'segmentation.trackOps.propagateNoChange'],
    [
      'propagate-selected-poly-1',
      'segmentation.trackOps.propagateSelectedNoChange',
    ],
  ])(
    'static container, CLEAN frame (%s): says "nothing to change" instead of nothing',
    async (testId, key) => {
      twoFrames();
      setPolygons([polyline({ trackId: 'track-3' })]);
      renderEditor();
      // An EARLIER save of this frame, in this session, fanned out.
      await saveFansOut();
      const toast = await toasts();
      vi.mocked(toast.success).mockClear();

      // Now the gesture: the frame is clean, so `handleSave` runs no save.
      await clickAndSettle(testId, () => {
        expect(mockEditor.handleSave).toHaveBeenCalledTimes(1);
      });

      expect(mockApiClient.propagateTrackForward).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledTimes(1);
      expect(toast.info).toHaveBeenCalledWith(key);
      expect(toast.success).not.toHaveBeenCalled();
    }
  );

  it.each([['propagate-poly-1'], ['propagate-selected-poly-1']])(
    'static container, DIRTY frame (%s): the save\u2019s own toast is the only one',
    async testId => {
      twoFrames();
      setPolygons([polyline({ trackId: 'track-3' })]);
      // A real save runs as part of the gesture, and fans out.
      mockEditor.handleSave.mockImplementation(async () => {
        await saveFansOut();
        return true;
      });
      renderEditor();

      await clickAndSettle(testId, () => {
        expect(mockEditor.handleSave).toHaveBeenCalledTimes(1);
      });

      const toast = await toasts();
      expect(mockApiClient.propagateTrackForward).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith(
        'segmentation.toolbar.sharedAcrossFrames'
      );
      // The save already said how far it reached; "nothing to change" on top
      // of that would contradict it.
      expect(toast.info).not.toHaveBeenCalled();
    }
  );

  it('static container: a SECOND dirty save is still silent (the ref moved again)', async () => {
    // Guards the identity compare: a fan-out earlier in the session must not
    // make a later gesture that DOES save look like one that did not.
    twoFrames();
    setPolygons([polyline({ trackId: 'track-3' })]);
    renderEditor();
    await saveFansOut();
    mockEditor.handleSave.mockImplementation(async () => {
      await saveFansOut();
      return true;
    });

    await clickAndSettle('propagate-poly-1', () => {
      expect(mockEditor.handleSave).toHaveBeenCalledTimes(1);
    });

    expect((await toasts()).info).not.toHaveBeenCalled();
    expect(mockApiClient.propagateTrackForward).not.toHaveBeenCalled();
  });
});
