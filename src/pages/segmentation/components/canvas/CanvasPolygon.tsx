
import React from 'react';
import { cn } from '@/lib/utils';
import { Point } from '@/lib/segmentation';
import CanvasVertex from './CanvasVertex';

interface CanvasPolygonProps {
  id: string;
  points: Point[];
  isSelected: boolean;
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null };
  vertexDragState: { isDragging: boolean, polygonId: string | null, vertexIndex: number | null };
  zoom: number;
}

const CanvasPolygon = ({ 
  id, 
  points, 
  isSelected, 
  hoveredVertex, 
  vertexDragState,
  zoom 
}: CanvasPolygonProps) => {
  const pointsString = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <g key={id}>
      {/* Polygon s výplní */}
      <polygon 
        points={pointsString}
        fill={isSelected ? "rgba(255, 59, 48, 0.2)" : "rgba(0, 191, 255, 0.2)"}
        stroke={isSelected ? "#FF3B30" : "#00BFFF"}
        strokeWidth={isSelected ? 2/zoom : 1.5/zoom}
        strokeLinejoin="round"
        className={cn(
          "transition-colors duration-150",
          isSelected ? "filter-glow-red" : ""
        )}
        pointerEvents="all"
      />
      
      {/* Body (vertexy) */}
      {points.map((point, index) => (
        <CanvasVertex 
          key={`vertex-${index}`}
          point={point}
          polygonId={id}
          vertexIndex={index}
          isSelected={isSelected}
          isHovered={hoveredVertex.polygonId === id && hoveredVertex.vertexIndex === index}
          isDragging={vertexDragState.isDragging && 
                     vertexDragState.polygonId === id && 
                     vertexDragState.vertexIndex === index}
          zoom={zoom}
        />
      ))}
    </g>
  );
};

export default CanvasPolygon;
