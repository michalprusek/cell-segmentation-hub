import React from 'react';
import { generateSafePolygonKey } from '@/lib/polygonIdUtils';
import { ensureBrowserCompatibleUrl } from '@/lib/tiffUtils';
import { isMicrotubuleProject } from '@/types';
import { resolveMtColor } from '../utils/instanceColors';

import VerticalToolbar from './VerticalToolbar';
import TopToolbar from './TopToolbar';
import PolygonListPanel from './PolygonListPanel';
import SpermInstancePanel from './SpermInstancePanel';
import MicrotubuleInstancePanel from './MicrotubuleInstancePanel';
import ChannelsSection from './sidebar/ChannelsSection';
import { useSidebarWidth } from '../hooks/useSidebarWidth';
import { MIN_PANEL_WIDTH, MAX_PANEL_WIDTH } from '../utils/panelWidth';
import DisplaySection from './sidebar/DisplaySection';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp';

import CanvasContainer from './canvas/CanvasContainer';
import CanvasContent from './canvas/CanvasContent';
import VideoFrameImage from './canvas/VideoFrameImage';
import FrameWindowPrefetcher from './canvas/FrameWindowPrefetcher';
import FrameLoadingGate from './canvas/FrameLoadingGate';
import { SegmentChannelDialog } from '@/components/project/SegmentChannelDialog';
import DeleteTrackScopeDialog, {
  type DeleteTrackScopeDialogProps,
} from './DeleteTrackScopeDialog';
import CanvasPolygon from './canvas/CanvasPolygon';
import CanvasSvgFilters from './canvas/CanvasSvgFilters';
import ModeInstructions from './canvas/ModeInstructions';
import CanvasTemporaryGeometryLayer from './canvas/CanvasTemporaryGeometryLayer';
import { FpsMeter } from '@/lib/rendering/FpsMeter';

import EditorHeader from './EditorHeader';
import StatusBar from './StatusBar';
import EditorLayout from './layout/EditorLayout';

import { VideoModeOverlay } from './VideoModeOverlay';
import { ImageDisplayProvider } from '../contexts/ImageDisplayContext';
// Type-only: the orchestrator owns these hooks; the layout only needs their
// return shapes. `import type` keeps the hook modules out of the layout's
// runtime import graph (relevant to the editor-test OOM import-graph issue).
import type { MTTypeLabel } from '@/lib/api';
import type { useEnhancedSegmentationEditor } from '../hooks/useEnhancedSegmentationEditor';
import type { useVideoFrames } from '../hooks/useVideoFrames';
import type { CanvasBackgroundDeselectHandlers } from '../hooks/useCanvasBackgroundDeselect';
import type { usePolygonRenderProps } from '../hooks/usePolygonRenderProps';
import type { usePolygonHandlers } from '../hooks/usePolygonHandlers';

const EMPTY_HOVERED_VERTEX = { polygonId: null, vertexIndex: null } as const;

type EditorApi = ReturnType<typeof useEnhancedSegmentationEditor>;
type VideoApi = ReturnType<typeof useVideoFrames>;
type RenderProps = ReturnType<typeof usePolygonRenderProps>;
type PolygonHandlers = ReturnType<typeof usePolygonHandlers>;

/**
 * SegmentationEditorLayout — pure presentational render tree for the
 * segmentation editor.
 *
 * Every value/handler/composite-object the JSX touches is supplied by the
 * orchestrator (SegmentationEditor) via the Props interface below. This
 * component holds NO state, effects, refs, or business logic — it is a
 * straight extraction of SegmentationEditor's former `return (...)` block,
 * unchanged except for being parameterised over props.
 *
 * Deliberately NOT wrapped in React.memo: an incomplete comparator is a
 * known recurring bug in this codebase; a plain component cannot have it.
 */
export interface SegmentationEditorLayoutProps {
  // Composite hook objects, threaded through verbatim.
  editor: EditorApi;
  video: VideoApi;

  // Route / context-derived scalars
  user: { id?: string } | null | undefined;
  projectId: string | undefined;
  imageId: string | undefined;
  projectType: React.ComponentProps<typeof VideoModeOverlay>['projectType'];
  project: { name?: string } | null | undefined;
  selectedImage: {
    id: string;
    url?: string;
    name?: string;
    segmentationStatus?: React.ComponentProps<
      typeof EditorHeader
    >['segmentationStatus'];
  };

  // Header / nav
  currentImageIndex: number;
  navContext: { index: number; total: number };
  navigateToImage: React.ComponentProps<typeof EditorHeader>['onNavigate'];
  lastUpdate: React.ComponentProps<typeof EditorHeader>['lastUpdate'];
  queueStats: React.ComponentProps<typeof EditorHeader>['queueStats'];
  isWebSocketConnected: boolean;
  isVideoMode: boolean;
  videoContainerId: string | null;

  // Image / canvas geometry
  imageDimensions: { width: number; height: number } | null;
  canvasWidth: number;
  canvasHeight: number;
  loadedFrameKey: React.ComponentProps<
    typeof FrameLoadingGate
  >['loadedFrameKey'];
  /** Press/release pair for the SVG background: clears the selection on a real
   *  click and ignores the release that ends a pan. Built in the orchestrator
   *  (it needs `handleCanvasSelect` and the edit mode); this component only
   *  spreads it, staying free of state and refs. */
  canvasBackground: CanvasBackgroundDeselectHandlers;
  handleImageLoad: React.ComponentProps<typeof VideoFrameImage>['onLoad'];

  // Loading flags
  projectLoading: boolean;
  isReloading: boolean;

  // Render-derivation pipeline (from usePolygonRenderProps)
  hasPolylines: RenderProps['hasPolylines'];
  polylineKind: RenderProps['polylineKind'];
  availableInstanceIds: RenderProps['availableInstanceIds'];
  legacyModes: RenderProps['legacyModes'];
  visiblePolygons: RenderProps['visiblePolygons'];
  frameHiddenIds: RenderProps['frameHiddenIds'];

  // Polygon handlers (from usePolygonHandlers + local panel handlers)
  setHoveredPolygonId: PolygonHandlers['setHoveredPolygonId'];
  hoveredPolygonId: PolygonHandlers['hoveredPolygonId'];
  handleTogglePolygonVisibility: PolygonHandlers['handleTogglePolygonVisibility'];
  handleDeletePolygonFromPanel: PolygonHandlers['handleDeletePolygonFromPanel'];
  handleSelectPolygon: PolygonHandlers['handleSelectPolygon'];
  /** Canvas right-click delete: removes the whole MT track (all frames) when
   *  the polyline has a trackId, else a single-frame delete. */
  handleDeletePolygonOrTrack: (polygonId: string) => void;
  /** Canvas right-click delete, "this frame only" branch: removes a tracked MT
   *  from the current frame and leaves the rest of the track alone. */
  handleDeletePolygonFromFrame: (polygonId: string) => void;
  /** Shared three-way delete confirmation, driven by every scope-less delete
   *  gesture (Delete key, delete-mode click, sidebar trash). */
  deleteScopeDialog: Omit<DeleteTrackScopeDialogProps, 'frameCount'>;
  /** Canvas right-click: propagate this MT into all following frames. */
  handlePropagateTrack: (polygonId: string) => void;
  /** Canvas click: Shift+click multi-selects; plain click single-selects. */
  handleCanvasSelect: (polygonId: string | null, additive?: boolean) => void;
  /** Propagate all Shift-selected microtubules to the following frames. */
  handlePropagateSelected: () => void;
  /** Bulk delete of the multi-selection — whole track / current frame. */
  handleDeleteSelected: () => void;
  handleDeleteSelectedFromFrame: () => void;
  /** Whether anything in the multi-selection carries a `trackId`. */
  selectedHasTrack: boolean;
  /** Current Shift+click multi-selection (per-frame polygon ids). */
  selectedPolygonIds: Set<string>;
  /** Sidebar checkbox toggle — mirrors Shift+click on the canvas. */
  handleToggleSelectedInList: (id: string) => void;
  /** Sidebar "select all" — pass the listed current-frame polygon ids. */
  handleSelectAllInList: (ids: string[]) => void;
  /** Clear both selection sets (and the persisted cross-frame trackId).
   *  Driven by the sidebar's "deselect all" AND, via `canvasBackground`, by a
   *  click on empty canvas. */
  handleClearSelectionInList: () => void;
  handleSlicePolygonFromContextMenu: PolygonHandlers['handleSlicePolygonFromContextMenu'];
  handleEditPolygonFromContextMenu: PolygonHandlers['handleEditPolygonFromContextMenu'];
  handleDeleteVertexFromContextMenu: PolygonHandlers['handleDeleteVertexFromContextMenu'];
  handleRenamePolygon: PolygonHandlers['handleRenamePolygon'];
  handleChangeInstanceId: PolygonHandlers['handleChangeInstanceId'];
  handleChangePartClass: PolygonHandlers['handleChangePartClass'];

  // Microtubule type-label palette + canvas colour mode (MT projects only).
  mtTypeLabels: MTTypeLabel[];
  mtLabelById: Map<string, MTTypeLabel>;
  mtColorById: Map<string, string>;
  mtColorMode: 'instance' | 'semantic';
  onSetMtColorMode: (mode: 'instance' | 'semantic') => void;
  onChangeMtType: (polygonId: string, mtType: string | null) => void;
  onCreateMtLabel: (name: string, color: string) => Promise<MTTypeLabel | null>;
  onRenameMtLabel: (id: string, name: string, color: string) => Promise<void>;
  onDeleteMtLabel: (id: string) => Promise<void>;

  // Sperm instance-panel state
  activePartClass: React.ComponentProps<
    typeof SpermInstancePanel
  >['activePartClass'];
  setActivePartClass: React.ComponentProps<
    typeof SpermInstancePanel
  >['onPartClassChange'];
  activeInstanceId: React.ComponentProps<
    typeof SpermInstancePanel
  >['activeInstanceId'];
  setActiveInstanceId: React.ComponentProps<
    typeof SpermInstancePanel
  >['onInstanceIdChange'];

  // Status-bar counters
  visiblePolygonsCount: number;
  hiddenPolygonsCount: number;

  // Resegment chain
  isResegmenting: boolean;
  showResegmentChannelDialog: boolean;
  setShowResegmentChannelDialog: (open: boolean) => void;
  runResegment: (channel: string) => void | Promise<void>;
  handleResegmentCurrentFrame: React.ComponentProps<
    typeof TopToolbar
  >['onResegment'];

  // i18n
  t: (key: string, options?: Record<string, unknown>) => string;
}

const SegmentationEditorLayout: React.FC<SegmentationEditorLayoutProps> = ({
  editor,
  video,
  user,
  projectId,
  imageId,
  projectType,
  project,
  selectedImage,
  currentImageIndex,
  navContext,
  navigateToImage,
  lastUpdate,
  queueStats,
  isWebSocketConnected,
  isVideoMode,
  videoContainerId,
  imageDimensions,
  canvasWidth,
  canvasHeight,
  loadedFrameKey,
  canvasBackground,
  handleImageLoad,
  projectLoading,
  isReloading,
  hasPolylines,
  polylineKind,
  availableInstanceIds,
  legacyModes,
  visiblePolygons,
  frameHiddenIds,
  setHoveredPolygonId,
  hoveredPolygonId,
  handleTogglePolygonVisibility,
  handleDeletePolygonFromPanel,
  handleDeletePolygonFromFrame,
  deleteScopeDialog,
  handleSelectPolygon,
  handleDeletePolygonOrTrack,
  handlePropagateTrack,
  handleCanvasSelect,
  handlePropagateSelected,
  handleDeleteSelected,
  handleDeleteSelectedFromFrame,
  selectedHasTrack,
  selectedPolygonIds,
  handleToggleSelectedInList,
  handleSelectAllInList,
  handleClearSelectionInList,
  handleSlicePolygonFromContextMenu,
  handleEditPolygonFromContextMenu,
  handleDeleteVertexFromContextMenu,
  handleRenamePolygon,
  handleChangeInstanceId,
  handleChangePartClass,
  mtTypeLabels,
  mtLabelById,
  mtColorById,
  mtColorMode,
  onSetMtColorMode,
  onChangeMtType,
  onCreateMtLabel,
  onRenameMtLabel,
  onDeleteMtLabel,
  activePartClass,
  setActivePartClass,
  activeInstanceId,
  setActiveInstanceId,
  visiblePolygonsCount,
  hiddenPolygonsCount,
  isResegmenting,
  showResegmentChannelDialog,
  setShowResegmentChannelDialog,
  runResegment,
  handleResegmentCurrentFrame,
  t,
}) => {
  // Width of the right-hand panel. View-local: nothing in the segmentation
  // domain cares, and threading it from the orchestrator would only add props.
  const sidebar = useSidebarWidth();

  return (
    <ImageDisplayProvider userId={user?.id}>
      {/* Headless sliding-window prefetcher: warms the FrameImageCache
          for the per-channel PNGs around `video.frameIndex` and seeds
          the React Query cache with polygon JSON for the same window.
          Lives inside the provider so it can consume `visibleChannels`
          + `channel` from useImageDisplay. Disabled outside video
          mode — standalone images don't have an upcoming-frame
          concept. */}
      {isVideoMode && video.container && (
        <FrameWindowPrefetcher
          frames={video.container.frames}
          currentIndex={video.frameIndex}
          enabled={isVideoMode}
          registerBufferProbe={video.registerBufferProbe}
        />
      )}
      <EditorLayout>
        {/* Header */}
        <EditorHeader
          projectId={projectId || ''}
          projectTitle={project?.name || t('projects.noProjects')}
          imageName={
            selectedImage.name ? selectedImage.name.normalize('NFC') : ''
          }
          currentImageIndex={currentImageIndex !== -1 ? currentImageIndex : 0}
          totalImages={navContext.total}
          onNavigate={navigateToImage}
          hasUnsavedChanges={editor.hasUnsavedChanges}
          onSave={editor.handleSave}
          imageId={imageId}
          segmentationStatus={selectedImage?.segmentationStatus}
          lastUpdate={lastUpdate}
          queueStats={queueStats}
          isWebSocketConnected={isWebSocketConnected}
          videoFrameCount={
            isVideoMode ? video.container?.frameCount : undefined
          }
          videoFrameIndex={isVideoMode ? video.frameIndex : undefined}
          onVideoFrameChange={isVideoMode ? video.setFrameIndex : undefined}
          videoIsPlaying={isVideoMode ? video.isPlaying : undefined}
          videoIsBuffering={isVideoMode ? video.isBuffering : undefined}
          onVideoToggle={isVideoMode ? video.toggle : undefined}
        />

        {videoContainerId && (
          <VideoModeOverlay
            videoContainerId={videoContainerId}
            projectType={projectType}
            // The editor's single useVideoFrames instance, so the keyboard
            // controls drive the same (buffer-gated) playback the header does.
            frameIndex={video.frameIndex}
            step={video.step}
            toggle={video.toggle}
            channels={video.container?.channels ?? null}
          />
        )}

        {/* Main Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Vertical Toolbar */}
          <VerticalToolbar
            editMode={editor.editMode}
            selectedPolygonId={editor.selectedPolygonId}
            setEditMode={editor.setEditMode}
            disabled={projectLoading}
            onZoomIn={editor.handleZoomIn}
            onZoomOut={editor.handleZoomOut}
            onResetView={editor.handleResetView}
            hasExistingPolygons={editor.getPolygons().length > 0}
            projectType={projectType}
          />

          {/* Center: Canvas and Top Toolbar */}
          <div className="flex-1 flex flex-col">
            {/* Top Toolbar — Resegment lives here (next to Undo/Redo)
                per PR #195. The button is disabled with a spinner
                while the batch runs; once the batch returns,
                `handleResegmentCurrentFrame` calls `reloadSegmentation`
                so the new polyline drops into the canvas without a
                full reload. */}
            <TopToolbar
              canUndo={editor.canUndo}
              canRedo={editor.canRedo}
              hasUnsavedChanges={editor.hasUnsavedChanges}
              handleUndo={editor.handleUndo}
              handleRedo={editor.handleRedo}
              handleSave={editor.handleSave}
              onResegment={handleResegmentCurrentFrame}
              isResegmenting={isResegmenting}
              disabled={projectLoading}
              isSaving={editor.isSaving}
            />

            {/* Canvas Area */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
              <div className="flex-1 lg:flex-1 p-2 min-h-0 h-[calc(100vh-300px)] lg:h-auto overflow-hidden">
                <CanvasContainer
                  ref={editor.canvasRef}
                  editMode={editor.editMode}
                  onMouseDown={editor.handleMouseDown}
                  onMouseMove={editor.handleMouseMove}
                  onMouseUp={editor.handleMouseUp}
                  onDoubleClick={editor.handleCanvasDoubleClick}
                  loading={projectLoading}
                  // Legacy compatibility props
                  slicingMode={legacyModes.slicingMode}
                  pointAddingMode={legacyModes.pointAddingMode}
                  deleteMode={legacyModes.deleteMode}
                >
                  <CanvasContent transform={editor.transform}>
                    {/* Base Image — video mode binds src to the play
                        head (useVideoFrames.currentFrame.id) and the
                        active channel (useImageDisplay.channel), so
                        scrubbing / Play / channel-switch actually
                        swap the canvas image. The sliding-window
                        prefetch (FrameWindowPrefetcher above) keeps
                        the cache warm symmetrically around the
                        current index for both scrub and playback.
                        Standalone images keep the static URL. */}
                    {selectedImage && (
                      <VideoFrameImage
                        isVideoMode={isVideoMode}
                        currentFrameId={video.currentFrame?.id ?? null}
                        containerId={videoContainerId}
                        fallbackSrc={ensureBrowserCompatibleUrl(
                          selectedImage.id,
                          selectedImage.url,
                          selectedImage.name
                        )}
                        width={imageDimensions?.width || canvasWidth}
                        height={imageDimensions?.height || canvasHeight}
                        alt={t('common.image')}
                        onLoad={handleImageLoad}
                      />
                    )}

                    {/* SVG Overlay for polygon rendering - uses same dimensions as image */}
                    <svg
                      width={imageDimensions?.width || canvasWidth}
                      height={imageDimensions?.height || canvasHeight}
                      viewBox={`0 0 ${imageDimensions?.width || canvasWidth} ${imageDimensions?.height || canvasHeight}`}
                      className="absolute top-0 left-0"
                      style={{
                        width: imageDimensions?.width || canvasWidth,
                        height: imageDimensions?.height || canvasHeight,
                        maxWidth: 'none',
                        pointerEvents: 'auto',
                        zIndex: 10,
                      }}
                      // Clearing the selection on an empty-canvas click, with
                      // the press remembered so the release that ends a PAN is
                      // not mistaken for one. Both halves have to be on the
                      // same element for that to work.
                      onMouseDown={canvasBackground.onMouseDown}
                      onClick={canvasBackground.onClick}
                      data-transform={JSON.stringify(editor.transform)}
                      data-image-dims={JSON.stringify(imageDimensions)}
                      data-polygon-count={editor.polygons.length}
                    >
                      {/* SVG Filters for glow effects */}
                      <CanvasSvgFilters />

                      {/* Render all polygons */}
                      {visiblePolygons.map(polygon => (
                        <CanvasPolygon
                          key={generateSafePolygonKey(
                            polygon,
                            editor.isUndoRedoInProgress
                          )}
                          polygon={polygon}
                          isSelected={polygon.id === editor.selectedPolygonId}
                          hoveredVertex={
                            editor.hoveredVertex || EMPTY_HOVERED_VERTEX
                          }
                          vertexDragState={editor.vertexDragState}
                          zoom={editor.transform.zoom}
                          isZooming={editor.isZooming}
                          isUndoRedoInProgress={editor.isUndoRedoInProgress}
                          isHovered={polygon.id === hoveredPolygonId}
                          editMode={editor.editMode}
                          onSelectPolygon={handleCanvasSelect}
                          isMultiSelected={selectedPolygonIds.has(polygon.id)}
                          multiSelectCount={selectedPolygonIds.size}
                          onPropagateSelected={handlePropagateSelected}
                          onDeleteSelected={handleDeleteSelected}
                          // Same video-only gate as the single delete below.
                          onDeleteSelectedFromFrame={
                            videoContainerId
                              ? handleDeleteSelectedFromFrame
                              : undefined
                          }
                          selectedHasTrack={selectedHasTrack}
                          onDeletePolygon={handleDeletePolygonOrTrack}
                          // Only offered on a video: without a container there
                          // is no "other frame" to keep the track on, and the
                          // menu falls back to its plain delete confirm.
                          onDeletePolygonFromFrame={
                            videoContainerId
                              ? handleDeletePolygonFromFrame
                              : undefined
                          }
                          onPropagateTrack={handlePropagateTrack}
                          videoFrameCount={video.container?.frameCount}
                          onSlicePolygon={handleSlicePolygonFromContextMenu}
                          onEditPolygon={handleEditPolygonFromContextMenu}
                          // Sperm-specific context-menu actions
                          // (head/midpiece/tail re-classify + "Assign to
                          // instance N") are only meaningful in a sperm
                          // project. Without this gate, MT users see the
                          // same sperm menu and accidentally re-label or
                          // merge MTs under a sperm-style instanceId.
                          onChangePartClass={
                            polylineKind === 'sperm'
                              ? handleChangePartClass
                              : undefined
                          }
                          onChangeInstanceId={
                            polylineKind === 'sperm'
                              ? handleChangeInstanceId
                              : undefined
                          }
                          availableInstanceIds={
                            polylineKind === 'sperm'
                              ? availableInstanceIds
                              : undefined
                          }
                          // Microtubule type-label context-menu items + canvas
                          // colour mode. Gated to MT polylines (mirrors the
                          // sperm gating above). `semanticColor` is the resolved
                          // by-label colour; CanvasPolygon uses it only when
                          // colorMode === 'semantic'.
                          colorMode={
                            isMicrotubuleProject(projectType)
                              ? mtColorMode
                              : 'instance'
                          }
                          semanticColor={
                            // Only resolve the by-label colour when it will be
                            // used (semantic mode); in the default instance mode
                            // CanvasPolygon ignores it, so skip the Map lookup.
                            isMicrotubuleProject(projectType) &&
                            mtColorMode === 'semantic'
                              ? resolveMtColor(polygon.mtType, mtColorById, {
                                  // Multi-selection darkens the label colour
                                  // exactly like a single selection — this is
                                  // the semantic-mode half of the parity
                                  // CanvasPolygon's `isEffectivelySelected`
                                  // enforces for every other colour branch.
                                  // Without it a Shift+selected MT in
                                  // colour-by-label mode kept the idle colour.
                                  selected:
                                    polygon.id === editor.selectedPolygonId ||
                                    selectedPolygonIds.has(polygon.id),
                                })
                              : undefined
                          }
                          {...(() => {
                            // The type palette serves two project types. On a
                            // microtubule project it labels a tubulin class,
                            // and only polylines carry one — hence the
                            // `polylineKind` gate. On a MICROCAPSULE project it
                            // labels relevance, the capsules are closed
                            // polygons, and the label decides what the export
                            // measures, so the gate is the project itself.
                            const typed =
                              polylineKind === 'microtubule' ||
                              projectType === 'microcapsule';
                            return {
                              mtTypeLabels: typed ? mtTypeLabels : undefined,
                              onChangeMtType: typed
                                ? onChangeMtType
                                : undefined,
                              onCreateMtLabel: typed
                                ? onCreateMtLabel
                                : undefined,
                            };
                          })()}
                          currentMtType={polygon.mtType}
                          onDeleteVertex={handleDeleteVertexFromContextMenu}
                          onHover={setHoveredPolygonId}
                          // Drives sperm-vs-microtubule context-menu
                          // gating inside PolygonContextMenu — sperm
                          // items appear only on sperm projects, the
                          // kymograph item only on microtubule projects.
                          projectType={projectType}
                        />
                      ))}

                      {/* Vertices are now rendered inside CanvasPolygon component */}

                      {/* Temporary geometry (preview lines, temp points, etc.) */}
                      <CanvasTemporaryGeometryLayer
                        transform={editor.transform}
                        editMode={editor.editMode}
                        tempPoints={editor.tempPoints}
                        cursorPosition={editor.cursorPosition}
                        interactionState={editor.interactionState}
                        selectedPolygonId={editor.selectedPolygonId}
                        polygons={editor.polygons}
                        hoveredJoinTarget={editor.hoveredJoinTarget}
                      />
                    </svg>

                    {/* Skeleton-first loading overlay: hides the canvas
                        while the new frame's image hasn't decoded yet.
                        Sits *inside* CanvasContent so the pan/zoom
                        transform aligns the overlay with the image
                        area, not the surrounding viewport chrome. */}
                    <FrameLoadingGate
                      imageId={imageId ?? null}
                      loadedFrameKey={loadedFrameKey}
                      isVideoMode={isVideoMode}
                      width={imageDimensions?.width || canvasWidth}
                      height={imageDimensions?.height || canvasHeight}
                      label={t('segmentationEditor.loadingFrame')}
                    />
                  </CanvasContent>

                  {/* Mode Instructions Overlay */}
                  <ModeInstructions
                    editMode={editor.editMode}
                    interactionState={editor.interactionState}
                    selectedPolygonId={editor.selectedPolygonId}
                    tempPoints={editor.tempPoints}
                    isShiftPressed={editor.keyboardState.isShiftPressed()}
                    projectType={projectType}
                  />
                </CanvasContainer>
              </div>

              {/* Drag handle for the right panel. Only on `lg` and up, where the
                  panel is a column beside the canvas; below that it is stacked
                  full-width and there is nothing to resize. */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t('segmentation.resizeSidebar', {
                  defaultValue: 'Resize panel',
                })}
                aria-valuenow={sidebar.width}
                aria-valuemin={MIN_PANEL_WIDTH}
                aria-valuemax={MAX_PANEL_WIDTH}
                tabIndex={0}
                onPointerDown={sidebar.onResizeStart}
                onPointerMove={sidebar.onResizeMove}
                onPointerUp={sidebar.onResizeEnd}
                onPointerCancel={sidebar.onResizeEnd}
                onKeyDown={sidebar.onResizeKey}
                title={t('segmentation.resizeSidebar', {
                  defaultValue: 'Resize panel',
                })}
                className="hidden lg:block w-1 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-violet-400/60 focus-visible:bg-violet-500 focus-visible:outline-none transition-colors"
              />

              {/* Right: Channels + Display (video only) + Polygon List + Sperm Instance Panel */}
              <div
                className="flex flex-col w-full lg:w-[var(--sidebar-w)] h-64 lg:h-full overflow-y-auto lg:flex-shrink-0"
                style={{ ['--sidebar-w' as string]: `${sidebar.width}px` }}
                data-sidebar-width={sidebar.width}
              >
                {isVideoMode && video.container ? (
                  <>
                    <ChannelsSection
                      channels={video.container.channels}
                      containerId={videoContainerId}
                    />
                    <DisplaySection />
                  </>
                ) : (
                  // Standalone images get the same panel minus the channel
                  // list. Brightness/Contrast always apply here (CSS filter on
                  // the <img>), and Min/Max appear once CanvasImage reports a
                  // decoded 16-bit range — the reserve those extra bits buy is
                  // worth nothing without a control that spends it.
                  <DisplaySection />
                )}
                {/* Microtubule projects use the purpose-built Microtubule
                    Instances panel below (trackId order, per-instance colour,
                    length, delete) — the generic Polygon List would just
                    duplicate it, so it's hidden for MT projects. */}
                {!isMicrotubuleProject(projectType) && (
                  <PolygonListPanel
                    loading={projectLoading}
                    polygons={editor.polygons}
                    selectedPolygonId={editor.selectedPolygonId}
                    onSelectPolygon={handleSelectPolygon}
                    hiddenPolygonIds={frameHiddenIds}
                    onTogglePolygonVisibility={handleTogglePolygonVisibility}
                    onRenamePolygon={handleRenamePolygon}
                    onDeletePolygon={handleDeletePolygonFromPanel}
                    selectedPolygonIds={selectedPolygonIds}
                    onToggleSelected={handleToggleSelectedInList}
                    onSelectAll={handleSelectAllInList}
                    onClearSelection={handleClearSelectionInList}
                  />
                )}
                {hasPolylines && polylineKind === 'sperm' && (
                  <SpermInstancePanel
                    polygons={editor.polygons}
                    selectedPolygonId={editor.selectedPolygonId}
                    onSelectPolygon={handleSelectPolygon}
                    activePartClass={activePartClass}
                    onPartClassChange={setActivePartClass}
                    activeInstanceId={activeInstanceId}
                    onInstanceIdChange={setActiveInstanceId}
                  />
                )}
                {hasPolylines && polylineKind === 'microtubule' && (
                  <MicrotubuleInstancePanel
                    polygons={editor.polygons}
                    selectedPolygonId={editor.selectedPolygonId}
                    onSelectPolygon={handleSelectPolygon}
                    hiddenPolygonIds={frameHiddenIds}
                    onToggleVisibility={handleTogglePolygonVisibility}
                    selectedPolygonIds={selectedPolygonIds}
                    onToggleSelected={handleToggleSelectedInList}
                    onSelectAll={handleSelectAllInList}
                    onClearSelection={handleClearSelectionInList}
                    onDeletePolygon={handleDeletePolygonFromPanel}
                    onRenamePolygon={handleRenamePolygon}
                    mtTypeLabels={mtTypeLabels}
                    mtLabelById={mtLabelById}
                    colorMode={mtColorMode}
                    onSetColorMode={onSetMtColorMode}
                    onCreateLabel={onCreateMtLabel}
                    onRenameLabel={onRenameMtLabel}
                    onDeleteLabel={onDeleteMtLabel}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: Status Bar with Keyboard Shortcuts inline */}
        <div className="relative flex items-stretch bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
          {/* Keyboard Shortcuts Button — sits in the footer's flex flow
              so it can't visually overlap the polygon counters next to
              it (the previous absolute-positioning hid the leftmost
              "polygons" label behind the button). */}
          <div className="flex items-center pl-2 pr-1 flex-shrink-0">
            <KeyboardShortcutsHelp />
          </div>

          {/* Loading indicator overlay — spans the full footer */}
          {isReloading && (
            <div className="absolute inset-0 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm z-20 flex items-center justify-center">
              <div className="flex items-center gap-2 bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-lg dark:bg-gray-900">
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t('segmentationEditor.reloadingSegmentation')}
                </span>
              </div>
            </div>
          )}

          {/* Status Bar — fills the remaining footer width */}
          <StatusBar
            polygons={editor.polygons}
            editMode={editor.editMode}
            selectedPolygonId={editor.selectedPolygonId}
            visiblePolygonsCount={visiblePolygonsCount}
            hiddenPolygonsCount={hiddenPolygonsCount}
            hasUnsavedChanges={editor.hasUnsavedChanges}
            isSaving={editor.isSaving}
          />
        </div>
      </EditorLayout>
      {/* Opt-in dev overlay: append ?perf=1 to the URL or set
          localStorage.segPerfOverlay='1'. Renders null in production
          by default — no bundle cost beyond the module itself. */}
      <FpsMeter />

      {/* Channel picker for resegment on multi-channel video frames.
          Opens when the user clicks Resegment on a video whose
          container exposes more than one channel. The picker forwards
          the chosen channel to `runResegment` which threads it through
          apiClient → /segmentation/batch → segmentationService. */}
      <SegmentChannelDialog
        open={showResegmentChannelDialog}
        channels={video.container?.channels?.map(c => c.name) ?? []}
        defaultChannel={
          // Prefer the channel currently picked as the segmentation
          // source (so the user's first click typically just confirms);
          // fall back to the first channel in the container.
          video.container?.channels?.find(c => c.isSegmentationSource)?.name ??
          video.container?.channels?.[0]?.name ??
          ''
        }
        onConfirm={channel => {
          setShowResegmentChannelDialog(false);
          void runResegment(channel);
        }}
        onCancel={() => setShowResegmentChannelDialog(false)}
      />

      {/* "This frame only / all frames / cancel" for a tracked microtubule.
          Driven by the delete gestures that carry no scope of their own —
          the Delete key, a click in delete mode, the sidebar trash. The canvas
          context menu asks the same question from its own instance, next to
          the item the user clicked. */}
      <DeleteTrackScopeDialog
        {...deleteScopeDialog}
        frameCount={video.container?.frameCount}
      />
    </ImageDisplayProvider>
  );
};

export default SegmentationEditorLayout;
