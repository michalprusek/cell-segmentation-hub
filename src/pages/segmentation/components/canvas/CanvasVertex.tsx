
import React from 'react';
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

const CanvasVertex = ({
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
  // Dynamicky měníme velikost bodů podle úrovně zoomu - OBRÁCENĚ
  const getAdjustedRadius = () => {
    // Base radius is smaller for non-selected polygons
    const baseSize = isSelected ? 1.0 : 0.7;
    
    if (zoom > 4) {
      // Při extrémním přiblížení (zoom > 4) ZVĚTŠÍME body
      return 7 * baseSize / zoom;
    } else if (zoom > 3) {
      // Při velkém přiblížení (zoom > 3) zvětšíme body
      return 6 * baseSize / zoom;
    } else if (zoom < 0.5) {
      // Při velkém oddálení (zoom < 0.5) ZMENŠÍME body výrazně
      return 2.5 * baseSize / zoom;
    } else if (zoom < 0.7) {
      // Při mírném oddálení (zoom < 0.7) zmenšíme body
      return 3 * baseSize / zoom;
    } else {
      // Normální velikost pro běžný zoom
      return 4 * baseSize / zoom;
    }
  };

  let radius = getAdjustedRadius();
  
  // Increase size for start point to make it more noticeable
  if (isStartPoint) {
    radius *= 1.5;
  }

  // Určení barvy vertexu podle typu polygonu
  const getVertexColor = () => {
    if (isStartPoint) {
      return '#FFA500'; // Orange for start point
    } else if (type === 'internal') {
      return isDragging ? '#0077cc' : isHovered ? '#3498db' : (isSelected ? '#0EA5E9' : 'rgba(14, 165, 233, 0.7)');
    } else {
      return isDragging ? '#c0392b' : isHovered ? '#e74c3c' : (isSelected ? '#ea384c' : 'rgba(234, 56, 76, 0.7)');
    }
  };

  const vertexColor = getVertexColor();
  
  // Also adjust stroke width based on selection state and zoom
  const getStrokeWidth = () => {
    const baseWidth = isSelected ? 1.5 : 1.0;
    return baseWidth / zoom;
  };
  
  const strokeWidth = getStrokeWidth();
  
  return (
    <circle
      cx={point.x}
      cy={point.y}
      r={radius}
      fill={vertexColor}
      stroke={isStartPoint ? "#FFFF00" : "#fff"}
      strokeWidth={isStartPoint ? strokeWidth * 1.5 : strokeWidth}
      className={cn(
        "transition-colors duration-150",
        isDragging ? "cursor-grabbing" : "cursor-grab",
        isHovered ? "z-10" : "",
        isSelected ? (type === 'internal' ? "filter-glow-blue" : "filter-glow-red") : ""
      )}
      filter={isSelected || isHovered ? "url(#point-shadow)" : ""}
      data-polygon-id={polygonId}
      data-vertex-index={vertexIndex}
      vectorEffect="non-scaling-stroke"
      shapeRendering="geometricPrecision"
      style={{ imageRendering: "crisp-edges" }}
    />
  );
};

export default CanvasVertex;
