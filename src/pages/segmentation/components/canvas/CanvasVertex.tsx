
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
  // Adjust radius based on zoom level for consistent visual appearance
  const baseRadius = 4;
  const radius = baseRadius / zoom;

  // Determine vertex color based on polygon type
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
        "cursor-grab transition-all duration-100",
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
