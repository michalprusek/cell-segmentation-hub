
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
}

const CanvasVertex = ({ 
  point, 
  isSelected, 
  isHovered, 
  isDragging, 
  zoom 
}: CanvasVertexProps) => {
  const getPointRadius = () => {
    // Základní velikost bodu
    let radius = isSelected ? 5 : 4;
    
    // Zvětšit při hoveru
    if (isHovered) {
      radius = 7;
    }
    
    // Přizpůsobit velikost zooma, ale ne příliš
    return radius / (zoom > 1 ? Math.sqrt(zoom) : 1);
  };

  const radius = getPointRadius();
  
  return (
    <g pointerEvents="all">
      {/* Zvýraznění při hoveru */}
      {(isHovered || isDragging) && (
        <circle
          cx={point.x}
          cy={point.y}
          r={radius * 2.5}
          fill={isDragging ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.3)"}
          filter="url(#hover-glow)"
          className={isDragging ? "" : "animate-pulse"}
        />
      )}
      
      {/* Samotný bod */}
      <circle
        cx={point.x}
        cy={point.y}
        r={radius}
        fill={isSelected ? "#FF3B30" : "#FFFFFF"}
        stroke={isSelected ? "#FF3B30" : "#0077FF"}
        strokeWidth={1.5 / zoom}
        className={cn(
          "transition-all duration-150 cursor-pointer",
          isHovered ? "scale-110" : ""
        )}
        style={{ cursor: 'pointer' }}
      />
    </g>
  );
};

export default CanvasVertex;
