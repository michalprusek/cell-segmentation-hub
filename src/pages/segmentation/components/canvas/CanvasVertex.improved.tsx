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

// Vertex scaling configuration
interface VertexScalingConfig {
  baseRadius: number;
  scalingMode: 'adaptive' | 'constant' | 'logarithmic' | 'linear';
  scalingExponent: number;
  minRadius: number;
  maxRadius: number;
  hoverScale: number;
  dragScale: number;
  startPointScale: number;
  baseStrokeWidth: number;
}

const defaultConfig: VertexScalingConfig = {
  baseRadius: 5,
  scalingMode: 'adaptive',
  scalingExponent: 0.75,
  minRadius: 1.5,
  maxRadius: 8,
  hoverScale: 1.3,
  dragScale: 1.1,
  startPointScale: 1.2,
  baseStrokeWidth: 1.2,
};

/**
 * Calculate vertex radius based on zoom level and interaction state
 */
const calculateVertexRadius = (
  zoom: number,
  config: VertexScalingConfig,
  isHovered: boolean = false,
  isDragging: boolean = false,
  isStartPoint: boolean = false
): number => {
  let baseRadius: number;

  switch (config.scalingMode) {
    case 'constant':
      baseRadius = config.baseRadius;
      break;

    case 'linear':
      baseRadius = config.baseRadius / zoom;
      break;

    case 'logarithmic':
      baseRadius = config.baseRadius / Math.log2(zoom + 1);
      break;

    case 'adaptive':
    default:
      baseRadius = config.baseRadius / Math.pow(zoom, config.scalingExponent);
      break;
  }

  // Apply interaction multipliers
  let radius = baseRadius;
  if (isHovered) radius *= config.hoverScale;
  if (isDragging) radius *= config.dragScale;
  if (isStartPoint) radius *= config.startPointScale;

  // Enforce bounds
  return Math.max(Math.min(radius, config.maxRadius), config.minRadius);
};

/**
 * Calculate stroke width to maintain visual consistency with vertex scaling
 */
const calculateStrokeWidth = (
  zoom: number,
  config: VertexScalingConfig
): number => {
  switch (config.scalingMode) {
    case 'constant':
      // For constant vertex size, scale stroke slightly for visibility
      return Math.max(config.baseStrokeWidth / Math.pow(zoom, 0.5), 0.5);

    case 'adaptive':
    default:
      // Use same scaling approach as radius but less aggressive
      return Math.max(
        config.baseStrokeWidth / Math.pow(zoom, config.scalingExponent * 0.8),
        0.5
      );
  }
};

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
    // Calculate radius with improved scaling formula
    const finalRadius = calculateVertexRadius(
      zoom,
      defaultConfig,
      isHovered,
      isDragging,
      isStartPoint
    );

    // Calculate stroke width for consistent visual proportions
    const strokeWidth = calculateStrokeWidth(zoom, defaultConfig);

    // Color scheme - unchanged from original
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
    const opacity = isSelected ? 1 : 0.8;

    // Calculate actual position with drag offset
    const actualX = isDragging && dragOffset ? point.x + dragOffset.x : point.x;
    const actualY = isDragging && dragOffset ? point.y + dragOffset.y : point.y;

    // Event handlers to ensure events are captured
    const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
      // Stop propagation to prevent polygon selection
      e.stopPropagation();
      // Let the event bubble up with data attributes intact
    }, []);

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
        onMouseDown={handleMouseDown}
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
    // Custom comparison for optimization - unchanged
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

// Export configuration for external customization
export {
  type VertexScalingConfig,
  defaultConfig,
  calculateVertexRadius,
  calculateStrokeWidth,
};
