import React from 'react';
import { Point } from '@/lib/segmentation';

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
    // Simple radius calculation
    const baseRadius = 4;
    const radius = baseRadius / zoom;
    const hoverScale = isHovered ? 1.3 : 1;
    const startPointScale = isStartPoint ? 1.1 : 1;
    const finalRadius = radius * hoverScale * startPointScale;

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
    const strokeWidth = 1.5 / zoom;
    const opacity = isSelected ? 1 : 0.8;

    // Calculate actual position with drag offset
    const actualX = isDragging && dragOffset ? point.x + dragOffset.x : point.x;
    const actualY = isDragging && dragOffset ? point.y + dragOffset.y : point.y;

    return (
      <circle
        cx={actualX}
        cy={actualY}
        r={finalRadius}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        opacity={opacity}
        data-polygon-id={polygonId}
        data-vertex-index={vertexIndex}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          transition:
            isDragging || isUndoRedoInProgress ? 'none' : 'all 0.15s ease-out',
          pointerEvents: 'all',
        }}
      />
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
