
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
 * Komponenta pro zobrazení zvýrazněného vertexu pod kurzorem
 */
const HoveredVertexIndicator = ({ hoveredSegment, zoom }: HoveredVertexIndicatorProps) => {
  if (hoveredSegment.segmentIndex === null || !hoveredSegment.projectedPoint) {
    return null;
  }

  const pointRadius = getPointRadius(zoom);
  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();
  const point = hoveredSegment.projectedPoint;

  return (
    <g>
      {/* Pulzující efekt kolem bodu */}
      <circle
        cx={point.x}
        cy={point.y}
        r={pointRadius * 2}
        fill={colors.hoverPoint.glowColor}
        className="animate-pulse"
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Samotný bod */}
      <circle
        cx={point.x}
        cy={point.y}
        r={pointRadius * 1.4}
        fill={colors.hoverPoint.fill}
        stroke={colors.hoverPoint.stroke}
        strokeWidth={strokeWidth}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

export default HoveredVertexIndicator;
