
import React from 'react';
import { Point } from '@/lib/segmentation';
import { getPointRadius, getStrokeWidth, getColors } from './visualizationUtils';

interface HoveredVertexIndicatorProps {
  hoveredSegment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  };
  zoom: number;
}

/**
 * Komponenta pro zobrazení zvýrazněného vrcholu pod kurzorem
 */
const HoveredVertexIndicator = ({ hoveredSegment, zoom }: HoveredVertexIndicatorProps) => {
  if (hoveredSegment.segmentIndex === null || !hoveredSegment.projectedPoint) {
    return null;
  }

  const pointRadius = getPointRadius(zoom);
  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();

  return (
    <g>
      {/* Vnější kruh s animací */}
      <circle
        cx={hoveredSegment.projectedPoint.x}
        cy={hoveredSegment.projectedPoint.y}
        r={pointRadius * 1.8}
        fill="none"
        stroke={colors.hoverPoint.stroke}
        strokeWidth={strokeWidth * 0.8}
        opacity={0.5}
        className="animate-ping"
        style={{ 
          pointerEvents: 'none',
          animationDuration: '1.5s'
        }}
      />
      
      {/* Hlavní kruh */}
      <circle
        cx={hoveredSegment.projectedPoint.x}
        cy={hoveredSegment.projectedPoint.y}
        r={pointRadius * 1.5}
        fill={colors.hoverPoint.fill}
        stroke={colors.hoverPoint.stroke}
        strokeWidth={strokeWidth}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

export default HoveredVertexIndicator;
