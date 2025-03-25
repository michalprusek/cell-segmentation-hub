
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
  // Dynamicky vypočítáme velikost vertexu v závislosti na zoomu
  const getPointRadius = () => {
    // Základní velikost bodu adjustovaná k zoomu
    let baseRadius = isSelected ? 6 : 5;
    
    // Zvětšit při hoveru nebo tažení
    if (isHovered || isDragging) {
      baseRadius = 8;
    }
    
    // Inverzní vztah k zoomu pro konzistentní vizuální velikost
    return baseRadius / zoom;
  };

  const radius = getPointRadius();
  
  return (
    <g pointerEvents="all">
      {/* Zvýraznění při hoveru nebo tažení */}
      {(isHovered || isDragging) && (
        <circle
          cx={point.x}
          cy={point.y}
          r={radius * 2}
          fill={isDragging ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.3)"}
          filter="url(#hover-glow)"
          className={isDragging ? "" : "animate-pulse"}
          style={{ transformOrigin: 'center center', animationDuration: '1.5s' }}
        />
      )}
      
      {/* Neviditelný větší bod pro snazší zachycení myší */}
      <circle
        cx={point.x}
        cy={point.y}
        r={radius * 4}
        fill="transparent"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        pointerEvents="all"
      />
      
      {/* Samotný bod */}
      <circle
        cx={point.x}
        cy={point.y}
        r={radius}
        fill={isSelected ? "#FF3B30" : "#FFFFFF"}
        stroke={isSelected ? "#FF3B30" : "#0077FF"}
        strokeWidth={1.5 / zoom}
        className="transition-all duration-150"
        style={{ 
          cursor: isDragging ? 'grabbing' : 'grab',
          transform: isHovered ? `scale(1.25)` : 'scale(1)',
          transformOrigin: 'center center'
        }}
      />
    </g>
  );
};

export default CanvasVertex;
