import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Point } from '@/lib/segmentation';

interface CanvasVertexProps {
  point: Point;
  polygonId: string;
  vertexIndex: number;
  isSelected: boolean;
  isHovered: boolean;
  isDragging: boolean;
  zoom: number;
  type?: 'external' | 'internal';
  isStartPoint?: boolean;
}

const CanvasVertex = React.memo(({
  point,
  polygonId,
  vertexIndex,
  isSelected,
  isHovered,
  isDragging,
  zoom,
  type = 'external',
  isStartPoint = false
}: CanvasVertexProps) => {
  // Memoized radius calculation for performance
  const radius = useMemo(() => {
    // Base radius is smaller for non-selected polygons
    const baseSize = isSelected ? 1.0 : 0.7;
    
    let calculatedRadius;
    
    if (zoom > 4) {
      // At extreme zoom (zoom > 4) enlarge points
      calculatedRadius = 7 * baseSize / zoom;
    } else if (zoom > 3) {
      // At high zoom (zoom > 3) enlarge points
      calculatedRadius = 6 * baseSize / zoom;
    } else if (zoom < 0.5) {
      // When zoomed out a lot (zoom < 0.5) significantly reduce vertex size
      calculatedRadius = 2.5 * baseSize / zoom;
    } else if (zoom < 0.7) {
      // When slightly zoomed out (zoom < 0.7) reduce vertex size
      calculatedRadius = 3 * baseSize / zoom;
    } else {
      // Default size for normal zoom
      calculatedRadius = 4 * baseSize / zoom;
    }
    
    // Adjust for start point
    return isStartPoint ? calculatedRadius * 1.2 : calculatedRadius;
  }, [zoom, isSelected, isStartPoint]);

  // Memoized vertex color calculation
  const vertexColor = useMemo(() => {
    if (type === 'internal') {
      return isDragging ? '#0077cc' : isHovered ? '#3498db' : (isSelected ? '#0EA5E9' : 'rgba(14, 165, 233, 0.7)');
    } else {
      return isDragging ? '#c0392b' : isHovered ? '#e74c3c' : (isSelected ? '#ea384c' : 'rgba(234, 56, 76, 0.7)');
    }
  }, [type, isDragging, isHovered, isSelected]);
  
  // Memoized stroke width calculation
  const strokeWidth = useMemo(() => {
    const baseWidth = isSelected ? 1.5 : 1.0;
    return baseWidth / zoom;
  }, [isSelected, zoom]);
  
  // Memoized class names
  const classNames = useMemo(() => {
    return cn(
      "polygon-vertex transition-colors duration-150",
      isDragging ? "cursor-grabbing" : "cursor-grab",
      isHovered && "z-10",
      isSelected && (type === 'internal' ? "filter-glow-blue" : "filter-glow-red")
    );
  }, [isDragging, isHovered, isSelected, type]);
  
  return (
    <circle
      cx={point.x}
      cy={point.y}
      r={radius}
      fill={vertexColor}
      stroke="#fff"
      strokeWidth={strokeWidth}
      className={classNames}
      filter={isSelected || isHovered ? "url(#point-shadow)" : ""}
      data-polygon-id={polygonId}
      data-vertex-index={vertexIndex}
      vectorEffect="non-scaling-stroke"
      shapeRendering="optimizeSpeed"
      pointerEvents="visible"
    />
  );
}, (prevProps, nextProps) => {
  // Custom comparison for optimal performance
  return (
    prevProps.point.x === nextProps.point.x &&
    prevProps.point.y === nextProps.point.y &&
    prevProps.polygonId === nextProps.polygonId &&
    prevProps.vertexIndex === nextProps.vertexIndex &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isHovered === nextProps.isHovered &&
    prevProps.isDragging === nextProps.isDragging &&
    prevProps.zoom === nextProps.zoom &&
    prevProps.type === nextProps.type &&
    prevProps.isStartPoint === nextProps.isStartPoint
  );
});

CanvasVertex.displayName = 'CanvasVertex';

export default CanvasVertex;