
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

  // Adjust stroke width based on zoom level for consistent visual appearance
  const strokeWidth = isSelected ? 2.5/zoom : 2/zoom;

  // Vylepšení barev pro lepší viditelnost v light i dark mode
  const polygonFill = isSelected ? "rgba(255, 59, 48, 0.25)" : "rgba(0, 122, 255, 0.20)";
  const polygonStroke = isSelected ? "#FF3B30" : "#007AFF";
  
  return (
    <g key={id} shapeRendering="geometricPrecision">
      {/* Polygon s výplní */}
      <polygon 
        points={pointsString}
        fill={polygonFill}
        stroke={polygonStroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        className={cn(
          "transition-colors duration-150",
          isSelected ? "filter-glow-red" : ""
        )}
        pointerEvents="all"
        shapeRendering="geometricPrecision"
        vectorEffect="non-scaling-stroke"
        filter={isSelected ? "url(#point-shadow)" : ""}
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
