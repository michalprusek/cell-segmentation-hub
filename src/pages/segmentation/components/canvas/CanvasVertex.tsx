import React, { useMemo } from 'react';
import { Point } from '@/lib/segmentation';
import {
  getOptimizedVertexRadius,
  getOptimizedStrokeWidth,
  debugLog,
} from '@/lib/vertexOptimization';

interface CanvasVertexProps {
  point: Point;
  polygonId: string;
  vertexIndex: number;
  isSelected: boolean;
  isHovered: boolean;
  isDragging: boolean;
  dragOffset?: { x: number; y: number };
  zoom: number;
  type?: 'external' | 'internal';
  isStartPoint?: boolean;
  isUndoRedoInProgress?: boolean;
}

const CanvasVertex = React.memo<CanvasVertexProps>(
  ({
    point,
    polygonId,
    vertexIndex,
    isSelected,
    isHovered,
    isDragging,
    dragOffset,
    zoom,
    type = 'external',
    isStartPoint = false,
    isUndoRedoInProgress = false,
  }) => {
    // PERFORMANCE OPTIMIZATION: Use cached vertex calculations
    const finalRadius = useMemo(() => {
      return getOptimizedVertexRadius(zoom, 3, isHovered, isStartPoint);
    }, [zoom, isHovered, isStartPoint]);

    // Simple color scheme
    const fillColor =
      type === 'internal'
        ? isDragging
          ? '#0077cc'
          : isHovered
            ? '#3498db'
            : '#0EA5E9'
        : isDragging
          ? '#c0392b'
          : isHovered
            ? '#e74c3c'
            : '#ea384c';

    const strokeColor = '#ffffff';
    // PERFORMANCE OPTIMIZATION: Use cached stroke calculations
    const strokeWidth = useMemo(() => {
      return getOptimizedStrokeWidth(zoom, isHovered);
    }, [zoom, isHovered]);
    const opacity = isSelected ? 0.95 : 0.7; // Slightly more transparent

    // Add glow effect on hover
    const strokeOpacity = isHovered ? 1.0 : 0.9;

    // Calculate actual position with drag offset
    const actualX = isDragging && dragOffset ? point.x + dragOffset.x : point.x;
    const actualY = isDragging && dragOffset ? point.y + dragOffset.y : point.y;

    // Event handlers to ensure events are captured
    const handleMouseDown = React.useCallback(
      (e: React.MouseEvent) => {
        // DON'T stop propagation - let the event bubble up to useAdvancedInteractions
        // The canvas-level handler needs to receive this event to detect vertex clicks
        // and initiate drag operations via dataset attributes
        // PERFORMANCE FIX: Use optimized debug logging
        debugLog('Vertex mouseDown', { polygonId, vertexIndex });
      },
      [polygonId, vertexIndex]
    );

    return (
      <>
        {/* Glow effect circle - only visible on hover */}
        {isHovered && (
          <circle
            cx={actualX}
            cy={actualY}
            r={finalRadius + 2 / zoom} // Slightly larger for glow
            fill="none"
            stroke="#ffffff"
            strokeWidth={strokeWidth * 0.5}
            opacity={0.3}
            style={{
              pointerEvents: 'none',
              // PERFORMANCE FIX: Replace expensive blur with opacity
              opacity: 0.2,
            }}
          />
        )}

        {/* Main vertex circle */}
        <circle
          cx={actualX}
          cy={actualY}
          r={finalRadius}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          opacity={opacity}
          data-polygon-id={polygonId}
          data-vertex-index={vertexIndex}
          onMouseDown={handleMouseDown}
          style={{
            cursor: isDragging ? 'grabbing' : 'grab',
            transition:
              isDragging || isUndoRedoInProgress
                ? 'none'
                : 'stroke-width 0.15s ease-out, r 0.15s ease-out, opacity 0.15s ease-out',
            pointerEvents: 'all',
            // PERFORMANCE FIX: Replace expensive filter with simpler shadow
            boxShadow: isHovered ? '0 0 3px rgba(255, 255, 255, 0.8)' : 'none',
          }}
        />
      </>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison for optimization
    const sameDragOffset =
      (!prevProps.dragOffset && !nextProps.dragOffset) ||
      (prevProps.dragOffset &&
        nextProps.dragOffset &&
        prevProps.dragOffset.x === nextProps.dragOffset.x &&
        prevProps.dragOffset.y === nextProps.dragOffset.y);

    return (
      prevProps.point.x === nextProps.point.x &&
      prevProps.point.y === nextProps.point.y &&
      prevProps.polygonId === nextProps.polygonId &&
      prevProps.vertexIndex === nextProps.vertexIndex &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isHovered === nextProps.isHovered &&
      prevProps.isDragging === nextProps.isDragging &&
      prevProps.isUndoRedoInProgress === nextProps.isUndoRedoInProgress &&
      prevProps.zoom === nextProps.zoom &&
      prevProps.type === nextProps.type &&
      prevProps.isStartPoint === nextProps.isStartPoint &&
      sameDragOffset
    );
  }
);

CanvasVertex.displayName = 'CanvasVertex';

export default CanvasVertex;
