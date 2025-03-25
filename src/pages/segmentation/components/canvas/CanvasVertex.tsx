
import React from 'react';
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
    
    // Inverzní vztah k zoomu pro konzistentní vizuální velikost
    return baseRadius / zoom;
  };

  const radius = getPointRadius();
  
  return (
    <g 
      pointerEvents="all"
      shapeRendering="auto"
      style={{ 
        willChange: 'transform', 
        transformOrigin: 'center center',
      }}
    >
      {/* Zvýraznění při hoveru nebo tažení - semi-transparent circle */}
      {(isHovered || isDragging) && (
        <circle
          cx={point.x}
          cy={point.y}
          r={radius * 2}
          fill={isDragging ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.3)"}
          filter="url(#hover-glow)"
          className={isDragging ? "" : "animate-pulse"}
          style={{ transformOrigin: 'center center', animationDuration: '1.5s' }}
          vectorEffect="non-scaling-stroke"
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
        vectorEffect="non-scaling-stroke"
      />
      
      {/* Samotný bod - zůstává na místě při hoveru */}
      <circle
        cx={point.x}
        cy={point.y}
        r={radius}
        fill={isSelected ? "#FF3B30" : "#FFFFFF"}
        stroke={isSelected ? "#FF3B30" : "#0077FF"}
        strokeWidth={1.5 / zoom}
        style={{ 
          cursor: isDragging ? 'grabbing' : 'grab',
          transformOrigin: 'center center'
        }}
        vectorEffect="non-scaling-stroke"
        filter="url(#point-shadow)"
      />
    </g>
  );
};

export default CanvasVertex;
