
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
}

const CanvasVertex = ({
  point,
  polygonId,
  vertexIndex,
  isSelected,
  isHovered,
  isDragging,
  zoom,
  type = 'external'
}: CanvasVertexProps) => {
  // Dynamicky měníme poloměr bodu podle úrovně zoomu
  // Při velkém přiblížení (zoom > 3) zmenšíme body
  // Při velkém oddálení (zoom < 0.7) zvětšíme body
  const getAdjustedRadius = () => {
    if (zoom > 3) {
      return 3/zoom;
    } else if (zoom < 0.7) {
      return 5/zoom;
    } else {
      return 4/zoom;
    }
  };

  const radius = getAdjustedRadius();

  // Určení barvy vertexu podle typu polygonu
  const getVertexColor = () => {
    if (type === 'internal') {
      return isDragging ? '#0077cc' : isHovered ? '#3498db' : '#0EA5E9';
    } else {
      return isDragging ? '#c0392b' : isHovered ? '#e74c3c' : '#ea384c';
    }
  };

  const vertexColor = getVertexColor();
  
  return (
    <circle
      cx={point.x}
      cy={point.y}
      r={radius}
      fill={vertexColor}
      stroke="#fff"
      strokeWidth={1.5/zoom}
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
    />
  );
};

export default CanvasVertex;
