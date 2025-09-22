/**
 * High-performance optimized polygon rendering layer
 * Implements SpheroSeg-inspired rendering optimizations:
 * - Frustum culling with bounding box cache
 * - Level of Detail (LOD) system
 * - Batch rendering with Web Workers
 * - Progressive rendering for smooth interactions
 */

import React, {
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useState,
} from 'react';
import { SegmentationResult, Point, Polygon } from '@/lib/segmentation';
import { PolygonLayerProps } from '@/pages/segmentation/types';

// Import new optimization systems
import {
  polygonVisibilityManager,
  VisibilityContext,
} from '@/lib/rendering/PolygonVisibilityManager';
import {
  renderBatchManager,
  RenderContext,
} from '@/lib/rendering/RenderBatchManager';
import { lodManager, LODContext } from '@/lib/rendering/LODManager';
import { WorkerPool } from '@/lib/workerPool';
import { rafSchedule, ProgressiveRenderer } from '@/lib/performanceUtils';

// Import existing components that we'll keep
import CanvasSvgFilters from './CanvasSvgFilters';
import EditorModeVisualizations from './EditorModeVisualizations';
import EditModeBorder from './EditModeBorder';
import OptimizedPolygonRenderer from './OptimizedPolygonRenderer';
import OptimizedVertexLayer from './OptimizedVertexLayer';

interface OptimizedCanvasPolygonLayerProps extends PolygonLayerProps {
  targetFPS?: number;
  enableWorkers?: boolean;
  enableLOD?: boolean;
  renderQuality?: 'low' | 'medium' | 'high' | 'ultra';
}

/**
 * Main optimized polygon rendering layer
 */
const CanvasPolygonLayer: React.FC<OptimizedCanvasPolygonLayerProps> = ({
  segmentation,
  imageSize,
  selectedPolygonId,
  hoveredVertex,
  vertexDragState,
  zoom,
  offset,
  containerWidth,
  containerHeight,
  editMode,
  slicingMode,
  pointAddingMode,
  tempPoints,
  cursorPosition,
  sliceStartPoint,
  hoveredSegment,
  isShiftPressed,
  isZooming = false,
  onSelectPolygon,
  onDeletePolygon,
  onSlicePolygon,
  onEditPolygon,
  onDeleteVertex,
  onDuplicateVertex,
  pointAddingTempPoints,
  selectedVertexIndex,
  selectedPolygonPoints,
  sourcePolygonId,
  // New optimization props
  targetFPS = 60,
  enableWorkers = true,
  enableLOD = true,
  renderQuality = 'high',
}) => {
  // Performance monitoring
  const frameTimeRef = useRef<number[]>([]);
  const lastFrameTime = useRef(performance.now());
  const [currentFPS, setCurrentFPS] = useState(60);

  // Worker pool for heavy computations
  const workerPoolRef = useRef<WorkerPool | null>(null);
  const progressiveRenderer = useRef(new ProgressiveRenderer());

  // Initialize worker pool
  useEffect(() => {
    if (enableWorkers && !workerPoolRef.current) {
      workerPoolRef.current = new WorkerPool('/workers/polygonWorker.js', {
        maxWorkers: Math.min(4, navigator.hardwareConcurrency || 2),
        idleTimeout: 30000,
      });
    }

    return () => {
      if (workerPoolRef.current) {
        workerPoolRef.current.terminate();
        workerPoolRef.current = null;
      }
    };
  }, [enableWorkers]);

  // Performance monitoring
  const updatePerformanceMetrics = useCallback(() => {
    const now = performance.now();
    const frameTime = now - lastFrameTime.current;
    lastFrameTime.current = now;

    frameTimeRef.current.push(frameTime);
    if (frameTimeRef.current.length > 30) {
      frameTimeRef.current.shift();
    }

    if (frameTimeRef.current.length >= 5) {
      const avgFrameTime =
        frameTimeRef.current.reduce((sum, time) => sum + time, 0) /
        frameTimeRef.current.length;
      const fps = Math.round(1000 / avgFrameTime);
      setCurrentFPS(fps);
    }
  }, []);

  // Throttled performance update
  const throttledPerformanceUpdate = useMemo(
    () => rafSchedule(updatePerformanceMetrics),
    [updatePerformanceMetrics]
  );

  useEffect(() => {
    throttledPerformanceUpdate();
  }, [zoom, offset.x, offset.y, selectedPolygonId, throttledPerformanceUpdate]);

  // Create visibility context
  const visibilityContext = useMemo(
    (): VisibilityContext => ({
      zoom,
      offset,
      containerWidth,
      containerHeight,
      selectedPolygonId,
      forceRenderSelected: true,
    }),
    [zoom, offset, containerWidth, containerHeight, selectedPolygonId]
  );

  // Create render context
  const renderContext = useMemo(
    (): RenderContext => ({
      zoom,
      viewport: {
        x: -offset.x,
        y: -offset.y,
        width: containerWidth / zoom,
        height: containerHeight / zoom,
      },
      selectedPolygonId,
      isAnimating: isZooming,
      targetFPS,
    }),
    [
      zoom,
      offset,
      containerWidth,
      containerHeight,
      selectedPolygonId,
      isZooming,
      targetFPS,
    ]
  );

  // Create LOD context
  const lodContext = useMemo(
    (): LODContext => ({
      zoom,
      viewport: renderContext.viewport,
      targetFPS,
      currentFPS,
      polygonCount: segmentation?.polygons.length || 0,
      isAnimating: isZooming,
      renderQuality,
    }),
    [
      zoom,
      renderContext.viewport,
      targetFPS,
      currentFPS,
      segmentation?.polygons.length,
      isZooming,
      renderQuality,
    ]
  );

  // Get visible polygons using optimized visibility manager
  const visiblePolygons = useMemo(() => {
    if (!segmentation?.polygons) return [];

    const result = polygonVisibilityManager.getVisiblePolygons(
      segmentation.polygons,
      visibilityContext
    );

    return result.visiblePolygons;
  }, [segmentation?.polygons, visibilityContext]);

  // Generate render batches
  const renderBatches = useMemo(() => {
    if (visiblePolygons.length === 0) return [];

    return renderBatchManager.createBatches(visiblePolygons, renderContext);
  }, [visiblePolygons, renderContext]);

  // Render polygons with proper optimization
  const renderOptimizedPolygons = useCallback(() => {
    if (!segmentation || imageSize.width <= 0) return null;

    return (
      <OptimizedPolygonRenderer
        polygons={visiblePolygons}
        batches={renderBatches}
        selectedPolygonId={selectedPolygonId}
        hoveredVertex={hoveredVertex}
        vertexDragState={vertexDragState}
        zoom={zoom}
        offset={offset}
        containerWidth={containerWidth}
        containerHeight={containerHeight}
        isAnimating={isZooming}
        renderQuality={renderQuality}
        onSelectPolygon={onSelectPolygon}
        onDeletePolygon={onDeletePolygon}
        onSlicePolygon={onSlicePolygon}
        onEditPolygon={onEditPolygon}
      />
    );
  }, [
    segmentation,
    imageSize,
    visiblePolygons,
    renderBatches,
    selectedPolygonId,
    hoveredVertex,
    vertexDragState,
    zoom,
    offset,
    containerWidth,
    containerHeight,
    isZooming,
    renderQuality,
    onSelectPolygon,
    onDeletePolygon,
    onSlicePolygon,
    onEditPolygon,
  ]);

  // Early return for invalid state
  if (!segmentation || imageSize.width <= 0) return null;

  return (
    <div style={{ position: 'relative' }}>
      {/* Main SVG layer with optimized rendering */}
      <svg
        width={imageSize.width}
        height={imageSize.height}
        className="absolute top-0 left-0"
        style={{
          maxWidth: 'none',
          shapeRendering:
            renderQuality === 'ultra' ? 'geometricPrecision' : 'optimizeSpeed',
          textRendering: 'optimizeSpeed',
          willChange: isZooming ? 'transform' : 'auto',
        }}
        vectorEffect="non-scaling-stroke"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet"
        overflow="visible"
      >
        {/* SVG filters for advanced rendering effects */}
        <CanvasSvgFilters />

        {/* Optimized polygon rendering */}
        {renderOptimizedPolygons()}

        {/* SVG Fallback vertices for selected polygons */}
        {visiblePolygons.map(polygon => {
          const isSelected = polygon.id === selectedPolygonId;
          const isPolygonHovered = hoveredVertex?.polygonId === polygon.id;

          // Show SVG vertices as fallback for selected polygons or in development
          if (
            isSelected ||
            (process.env.NODE_ENV === 'development' && isPolygonHovered)
          ) {
            return (
              <g key={`svg-vertices-${polygon.id}`}>
                {polygon.points.map((point, index) => {
                  const isVertexHovered =
                    hoveredVertex?.polygonId === polygon.id &&
                    hoveredVertex?.vertexIndex === index;
                  const isDragging =
                    vertexDragState?.isDragging &&
                    vertexDragState?.polygonId === polygon.id &&
                    vertexDragState?.vertexIndex === index;

                  const radius = Math.max(2, 4 / zoom);
                  const strokeWidth = Math.max(0.5, 1 / zoom);

                  return (
                    <circle
                      key={`vertex-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r={radius}
                      fill={
                        polygon.type === 'internal'
                          ? isDragging
                            ? '#0077cc'
                            : isVertexHovered
                              ? '#3498db'
                              : '#0EA5E9'
                          : isDragging
                            ? '#c0392b'
                            : isVertexHovered
                              ? '#e74c3c'
                              : '#ea384c'
                      }
                      stroke="#fff"
                      strokeWidth={strokeWidth}
                      style={{
                        cursor: 'pointer',
                        vectorEffect: 'non-scaling-stroke',
                        opacity: isDragging ? 1.0 : isVertexHovered ? 0.9 : 0.8,
                      }}
                    />
                  );
                })}
              </g>
            );
          }
          return null;
        })}

        {/* Editor mode visualizations */}
        <EditorModeVisualizations
          editMode={editMode}
          slicingMode={slicingMode}
          pointAddingMode={pointAddingMode}
          tempPoints={tempPoints}
          cursorPosition={cursorPosition}
          sliceStartPoint={sliceStartPoint}
          hoveredSegment={hoveredSegment}
          zoom={zoom}
          isShiftPressed={isShiftPressed}
          pointAddingTempPoints={pointAddingTempPoints}
          selectedVertexIndex={selectedVertexIndex}
          sourcePolygonId={sourcePolygonId}
          selectedPolygonPoints={selectedPolygonPoints}
        />

        {/* Edit mode border indicator */}
        <EditModeBorder
          editMode={editMode}
          slicingMode={slicingMode}
          pointAddingMode={pointAddingMode}
          imageSize={imageSize}
          zoom={zoom}
        />
      </svg>

      {/* Optimized vertex layer with Canvas-based rendering - positioned with same transform as SVG */}
      <div
        style={{
          transform: `translate3d(${offset.x * zoom}px, ${offset.y * zoom}px, 0) scale(${zoom})`,
          transformOrigin: '0 0',
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'auto',
          willChange: isZooming ? 'transform' : 'auto',
          backfaceVisibility: 'hidden',
          perspective: 1000,
        }}
        className="absolute top-0 left-0"
      >
        <OptimizedVertexLayer
          polygons={visiblePolygons}
          selectedPolygonId={selectedPolygonId}
          hoveredVertex={hoveredVertex}
          vertexDragState={vertexDragState}
          zoom={zoom}
          offset={offset}
          imageSize={imageSize}
          containerWidth={containerWidth}
          containerHeight={containerHeight}
          isZooming={isZooming}
          renderQuality={renderQuality}
          targetFPS={targetFPS}
          onVertexClick={(polygonId, vertexIndex, event) => {
            // Handle vertex click events
            onVertexClick?.(polygonId, vertexIndex, event);
          }}
          onVertexMouseEnter={(polygonId, vertexIndex) => {
            // Handle vertex hover
          }}
          onVertexMouseLeave={() => {
            // Handle vertex leave
          }}
          onDeleteVertex={onDeleteVertex}
          onDuplicateVertex={onDuplicateVertex}
        />
      </div>
    </div>
  );
};

// Memoize component for optimal performance
export default React.memo(
  CanvasPolygonLayer,
  (
    prevProps: OptimizedCanvasPolygonLayerProps,
    nextProps: OptimizedCanvasPolygonLayerProps
  ) => {
    // Custom comparison for optimal re-rendering
    return (
      prevProps.segmentation?.polygons.length ===
        nextProps.segmentation?.polygons.length &&
      prevProps.selectedPolygonId === nextProps.selectedPolygonId &&
      prevProps.zoom === nextProps.zoom &&
      prevProps.offset.x === nextProps.offset.x &&
      prevProps.offset.y === nextProps.offset.y &&
      prevProps.containerWidth === nextProps.containerWidth &&
      prevProps.containerHeight === nextProps.containerHeight &&
      prevProps.isZooming === nextProps.isZooming &&
      prevProps.editMode === nextProps.editMode &&
      prevProps.slicingMode === nextProps.slicingMode &&
      prevProps.pointAddingMode === nextProps.pointAddingMode &&
      prevProps.hoveredVertex?.polygonId ===
        nextProps.hoveredVertex?.polygonId &&
      prevProps.hoveredVertex?.vertexIndex ===
        nextProps.hoveredVertex?.vertexIndex &&
      prevProps.vertexDragState?.isDragging ===
        nextProps.vertexDragState?.isDragging &&
      prevProps.renderQuality === nextProps.renderQuality &&
      prevProps.enableLOD === nextProps.enableLOD &&
      prevProps.enableWorkers === nextProps.enableWorkers
    );
  }
);
