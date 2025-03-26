
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
  type?: 'external' | 'internal';
}

const CanvasPolygon = ({ 
  id, 
  points, 
  isSelected, 
  hoveredVertex, 
  vertexDragState,
  zoom,
  type = 'external'
}: CanvasPolygonProps) => {
  const pointsString = points.map(p => `${p.x},${p.y}`).join(' ');

  // Dynamicky upravujeme tloušťku čáry podle zoomu pro lepší viditelnost - OBRÁCENĚ
  const getStrokeWidth = () => {
    if (zoom > 4) {
      return isSelected ? 4/zoom : 3/zoom;
    } else if (zoom > 3) {
      return isSelected ? 3/zoom : 2.5/zoom;
    } else if (zoom < 0.5) {
      return isSelected ? 1.5/zoom : 1/zoom;
    } else {
      return isSelected ? 2.5/zoom : 2/zoom;
    }
  };

  const strokeWidth = getStrokeWidth();

  // Colors based on polygon type: red for external, blue for internal (holes)
  const getPolygonColors = () => {
    if (type === 'internal') {
      return {
        fill: isSelected ? "rgba(30, 144, 255, 0.25)" : "rgba(30, 144, 255, 0.20)",
        stroke: isSelected ? "#1E90FF" : "#0EA5E9"
      };
    } else {
      return {
        fill: isSelected ? "rgba(234, 56, 76, 0.25)" : "rgba(234, 56, 76, 0.20)",
        stroke: isSelected ? "#ea384c" : "#e74c3c"
      };
    }
  };
  
  const { fill, stroke } = getPolygonColors();
  
  return (
    <g key={id} shapeRendering="geometricPrecision">
      {/* Polygon s výplní */}
      <polygon 
        points={pointsString}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        className={cn(
          "transition-colors duration-150",
          isSelected ? (type === 'internal' ? "filter-glow-blue" : "filter-glow-red") : ""
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
          type={type}
        />
      ))}
    </g>
  );
};

export default CanvasPolygon;
