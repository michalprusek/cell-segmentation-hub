/**
 * High-performance vertex rendering layer using OffscreenCanvas and spatial indexing
 * Implements advanced optimizations for smooth vertex interaction
 */

import React, {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { Point, Polygon } from '@/lib/segmentation';
import { VertexDragState } from '@/pages/segmentation/types';
import { SpatialIndex, rafThrottle } from '@/lib/performanceUtils';

interface OptimizedVertexLayerProps {
  polygons: Polygon[];
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null; vertexIndex: number | null };
  vertexDragState: VertexDragState;
  zoom: number;
  offset: { x: number; y: number };
  imageSize: { width: number; height: number };
  containerWidth: number;
  containerHeight: number;
  isZooming?: boolean;
  renderQuality: 'low' | 'medium' | 'high' | 'ultra';
  targetFPS: number;
  onVertexClick?: (
    polygonId: string,
    vertexIndex: number,
    event: MouseEvent
  ) => void;
  onVertexMouseEnter?: (polygonId: string, vertexIndex: number) => void;
  onVertexMouseLeave?: () => void;
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
  onDuplicateVertex?: (polygonId: string, vertexIndex: number) => void;
}

interface VertexRenderData {
  polygonId: string;
  originalIndex: number;
  point: Point;
  polygonType: 'external' | 'internal';
  isSelected: boolean;
  isHovered: boolean;
  isDragging: boolean;
  radius: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
}

/**
 * Advanced vertex visibility and LOD system
 */
class VertexLODManager {
  private static instance: VertexLODManager;

  static getInstance(): VertexLODManager {
    if (!VertexLODManager.instance) {
      VertexLODManager.instance = new VertexLODManager();
    }
    return VertexLODManager.instance;
  }

  shouldRenderVertices(
    zoom: number,
    polygonCount: number,
    isSelected: boolean,
    isHovered: boolean,
    renderQuality: string
  ): boolean {
    // Always render vertices for selected or hovered polygons
    if (isSelected || isHovered) return true;

    // Never render vertices during extreme zoom out
    if (zoom < 0.2) return false;

    // More permissive quality-based thresholds
    const qualityThresholds = {
      low: { minZoom: 0.8, maxPolygons: 100 },
      medium: { minZoom: 0.5, maxPolygons: 300 },
      high: { minZoom: 0.3, maxPolygons: 500 },
      ultra: { minZoom: 0.2, maxPolygons: 1000 },
    };

    const threshold =
      qualityThresholds[renderQuality as keyof typeof qualityThresholds] ||
      qualityThresholds.high;

    // Render based on polygon count and zoom
    return zoom >= threshold.minZoom && polygonCount <= threshold.maxPolygons;
  }

  getVertexDecimationStep(
    zoom: number,
    pointCount: number,
    renderQuality: string
  ): number {
    if (pointCount <= 10) return 1; // No decimation for simple polygons

    const qualityMultiplier =
      {
        low: 3,
        medium: 2,
        high: 1.5,
        ultra: 1,
      }[renderQuality as keyof typeof qualityMultiplier] || 1.5;

    if (zoom < 0.5) {
      return Math.ceil(20 * qualityMultiplier);
    } else if (zoom < 1.0) {
      return Math.ceil(10 * qualityMultiplier);
    } else if (zoom < 2.0) {
      return Math.ceil(5 * qualityMultiplier);
    } else if (zoom < 4.0) {
      return Math.ceil(3 * qualityMultiplier);
    } else {
      return 1; // Full detail at high zoom
    }
  }

  calculateVertexRadius(
    zoom: number,
    isSelected: boolean,
    isHovered: boolean,
    isDragging: boolean
  ): number {
    const baseSize = isSelected ? 1.2 : 1.0;
    const hoverMultiplier = isHovered ? 1.3 : 1.0;
    const dragMultiplier = isDragging ? 1.5 : 1.0;

    let radius: number;

    if (zoom > 4) {
      radius = (6 * baseSize) / zoom;
    } else if (zoom > 2) {
      radius = (5 * baseSize) / zoom;
    } else if (zoom < 0.5) {
      radius = (3 * baseSize) / zoom;
    } else {
      radius = (4 * baseSize) / zoom;
    }

    return Math.max(2, radius * hoverMultiplier * dragMultiplier);
  }
}

/**
 * High-performance Canvas-based vertex renderer
 */
const OptimizedVertexLayer: React.FC<OptimizedVertexLayerProps> = ({
  polygons,
  selectedPolygonId,
  hoveredVertex,
  vertexDragState,
  zoom,
  offset,
  imageSize,
  containerWidth,
  containerHeight,
  isZooming = false,
  renderQuality,
  targetFPS,
  onVertexClick,
  onVertexMouseEnter,
  onVertexMouseLeave,
  onDeleteVertex,
  onDuplicateVertex,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spatialIndexRef = useRef<SpatialIndex>(new SpatialIndex());
  const lodManager = VertexLODManager.getInstance();
  const [isInitialized, setIsInitialized] = useState(false);

  // Performance tracking
  const frameTimeRef = useRef<number[]>([]);
  const lastRenderTime = useRef(0);

  // Initialize Canvas (removed OffscreenCanvas for better compatibility)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isInitialized) return;

    // Use regular canvas for better compatibility and debugging
    setIsInitialized(true);
  }, [isInitialized]);

  // Calculate viewport bounds for culling
  const viewportBounds = useMemo(() => {
    const buffer = 100; // Extra buffer for smooth scrolling
    return {
      x: -offset.x - buffer,
      y: -offset.y - buffer,
      width: containerWidth / zoom + 2 * buffer,
      height: containerHeight / zoom + 2 * buffer,
    };
  }, [zoom, offset, containerWidth, containerHeight]);

  // Collect all vertices with metadata and apply LOD
  const vertexRenderData = useMemo(() => {
    const vertices: VertexRenderData[] = [];

    for (const polygon of polygons) {
      const isSelected = polygon.id === selectedPolygonId;
      const isPolygonHovered = hoveredVertex.polygonId === polygon.id;

      // Check if vertices should be rendered for this polygon
      if (
        !lodManager.shouldRenderVertices(
          zoom,
          polygons.length,
          isSelected,
          isPolygonHovered,
          renderQuality
        ) ||
        isZooming
      ) {
        continue;
      }

      // Apply decimation based on zoom and quality
      const decimationStep = lodManager.getVertexDecimationStep(
        zoom,
        polygon.points.length,
        renderQuality
      );

      // Generate vertices with decimation
      for (let i = 0; i < polygon.points.length; i += decimationStep) {
        const point = polygon.points[i];

        // Viewport culling
        if (
          point.x < viewportBounds.x ||
          point.x > viewportBounds.x + viewportBounds.width ||
          point.y < viewportBounds.y ||
          point.y > viewportBounds.y + viewportBounds.height
        ) {
          continue;
        }

        const isVertexHovered =
          hoveredVertex.polygonId === polygon.id &&
          hoveredVertex.vertexIndex === i;
        const isDragging =
          vertexDragState.isDragging &&
          vertexDragState.polygonId === polygon.id &&
          vertexDragState.vertexIndex === i;

        const radius = lodManager.calculateVertexRadius(
          zoom,
          isSelected,
          isVertexHovered,
          isDragging
        );

        // Calculate colors
        const colors = getVertexColors(
          polygon.type,
          isSelected,
          isVertexHovered,
          isDragging
        );

        vertices.push({
          polygonId: polygon.id,
          originalIndex: i,
          point,
          polygonType: polygon.type,
          isSelected,
          isHovered: isVertexHovered,
          isDragging,
          radius,
          fillColor: colors.fill,
          strokeColor: colors.stroke,
          strokeWidth: colors.strokeWidth,
          opacity: colors.opacity,
        });
      }
    }

    return vertices;
  }, [
    polygons,
    selectedPolygonId,
    hoveredVertex,
    vertexDragState,
    zoom,
    renderQuality,
    isZooming,
    viewportBounds,
    lodManager,
  ]);

  // Update spatial index
  useEffect(() => {
    spatialIndexRef.current.updatePoints(
      vertexRenderData.map(v => ({ x: v.point.x, y: v.point.y }))
    );
  }, [vertexRenderData]);

  // High-performance drawing function
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isInitialized) return;

    const startTime = performance.now();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set up high-DPI rendering
    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = imageSize.width * devicePixelRatio;
    canvas.height = imageSize.height * devicePixelRatio;
    canvas.style.width = `${imageSize.width}px`;
    canvas.style.height = `${imageSize.height}px`;

    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, imageSize.width, imageSize.height);

    // Optimize rendering context
    if (renderQuality === 'low') {
      ctx.imageSmoothingEnabled = false;
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = renderQuality === 'ultra' ? 'high' : 'medium';
    }

    // Batch rendering by grouping similar vertices
    const vertexGroups = new Map<string, VertexRenderData[]>();

    for (const vertex of vertexRenderData) {
      const groupKey = `${vertex.fillColor}_${vertex.strokeColor}_${vertex.radius.toFixed(1)}`;
      if (!vertexGroups.has(groupKey)) {
        vertexGroups.set(groupKey, []);
      }
      vertexGroups.get(groupKey)!.push(vertex);
    }

    // Render each group with minimal state changes
    for (const [groupKey, groupVertices] of vertexGroups.entries()) {
      if (groupVertices.length === 0) continue;

      const representative = groupVertices[0];

      // Set fill style once for the group
      ctx.fillStyle = representative.fillColor;
      ctx.strokeStyle = representative.strokeColor;
      ctx.lineWidth = representative.strokeWidth;
      ctx.globalAlpha = representative.opacity;

      // Render all vertices in this group
      for (const vertex of groupVertices) {
        ctx.beginPath();
        ctx.arc(vertex.point.x, vertex.point.y, vertex.radius, 0, 2 * Math.PI);
        ctx.fill();

        if (vertex.strokeWidth > 0) {
          ctx.stroke();
        }
      }
    }

    // Performance tracking
    const renderTime = performance.now() - startTime;
    frameTimeRef.current.push(renderTime);
    if (frameTimeRef.current.length > 30) {
      frameTimeRef.current.shift();
    }

    lastRenderTime.current = renderTime;
  }, [vertexRenderData, imageSize, renderQuality, isInitialized]);

  // Throttled draw function based on target FPS
  const throttledDraw = useMemo(() => {
    const frameInterval = 1000 / targetFPS;
    return rafThrottle(draw, frameInterval);
  }, [draw, targetFPS]);

  // Trigger redraws
  useEffect(() => {
    throttledDraw();
  }, [throttledDraw]);

  // Mouse event handling with spatial indexing
  const handleMouseEvent = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) * (imageSize.width / rect.width);
      const y = (event.clientY - rect.top) * (imageSize.height / rect.height);

      // Use spatial index for efficient vertex lookup
      const visibleIndices = spatialIndexRef.current.getVisibleIndices(
        x - 20,
        y - 20,
        40,
        40,
        0 // Small area around mouse
      );

      let foundVertex: VertexRenderData | null = null;
      let minDistance = Infinity;

      // Find closest vertex within click radius
      for (const index of visibleIndices) {
        const vertex = vertexRenderData[index];
        if (!vertex) continue;

        const distance = Math.sqrt(
          Math.pow(x - vertex.point.x, 2) + Math.pow(y - vertex.point.y, 2)
        );

        const clickRadius = vertex.radius + 3; // Small buffer for easier clicking

        if (distance <= clickRadius && distance < minDistance) {
          minDistance = distance;
          foundVertex = vertex;
        }
      }

      if (foundVertex) {
        if (event.type === 'click') {
          onVertexClick?.(
            foundVertex.polygonId,
            foundVertex.originalIndex,
            event.nativeEvent
          );
        } else if (event.type === 'mouseenter' || event.type === 'mousemove') {
          onVertexMouseEnter?.(
            foundVertex.polygonId,
            foundVertex.originalIndex
          );
        }
      } else {
        if (event.type === 'mouseleave' || event.type === 'mousemove') {
          onVertexMouseLeave?.();
        }
      }
    },
    [
      vertexRenderData,
      imageSize,
      onVertexClick,
      onVertexMouseEnter,
      onVertexMouseLeave,
    ]
  );

  // Performance monitoring for development
  const averageRenderTime = useMemo(() => {
    if (frameTimeRef.current.length === 0) return 0;
    return (
      frameTimeRef.current.reduce((sum, time) => sum + time, 0) /
      frameTimeRef.current.length
    );
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: isZooming ? 'none' : 'auto',
          zIndex: 10,
          transformOrigin: '0 0',
        }}
        onClick={handleMouseEvent}
        onMouseMove={handleMouseEvent}
        onMouseLeave={handleMouseEvent}
      />

      {/* Development performance overlay */}
      {process.env.NODE_ENV === 'development' && (
        <div
          style={{
            position: 'absolute',
            bottom: 10,
            right: 10,
            background: 'rgba(0,0,0,0.7)',
            color: 'white',
            padding: '6px',
            borderRadius: '3px',
            fontSize: '10px',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            zIndex: 1001,
          }}
        >
          <div>Vertices: {vertexRenderData.length}</div>
          <div>Polygons: {polygons.length}</div>
          <div>Selected: {selectedPolygonId || 'none'}</div>
          <div>Zoom: {zoom.toFixed(2)}</div>
          <div>Render: {averageRenderTime.toFixed(1)}ms</div>
          <div>Quality: {renderQuality}</div>
          <div>Init: {isInitialized ? 'YES' : 'NO'}</div>
        </div>
      )}
    </>
  );
};

/**
 * Generate vertex colors based on polygon type and state
 */
function getVertexColors(
  polygonType: 'external' | 'internal',
  isSelected: boolean,
  isHovered: boolean,
  isDragging: boolean
) {
  if (polygonType === 'internal') {
    return {
      fill: isDragging
        ? '#0077cc'
        : isHovered
          ? '#3498db'
          : isSelected
            ? '#0EA5E9'
            : 'rgba(14, 165, 233, 0.8)',
      stroke: '#fff',
      strokeWidth: isSelected ? 1.5 : 1.0,
      opacity: isDragging ? 1.0 : isHovered ? 0.9 : 0.8,
    };
  } else {
    return {
      fill: isDragging
        ? '#c0392b'
        : isHovered
          ? '#e74c3c'
          : isSelected
            ? '#ea384c'
            : 'rgba(234, 56, 76, 0.8)',
      stroke: '#fff',
      strokeWidth: isSelected ? 1.5 : 1.0,
      opacity: isDragging ? 1.0 : isHovered ? 0.9 : 0.8,
    };
  }
}

export default React.memo(OptimizedVertexLayer);
