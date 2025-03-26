
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

  const pointRadius = getPointRadius(zoom) * 1.3; // Větší radius pro zvýraznění
  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();
  const point = hoveredSegment.projectedPoint;

  console.log("Rendering HoveredVertexIndicator at:", point.x, point.y);

  return (
    <g>
      {/* Pulzující efekt kolem bodu */}
      <circle
        cx={point.x}
        cy={point.y}
        r={pointRadius * 2.5}
        fill={colors.hoverPoint.glowColor}
        className="animate-pulse"
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Střední kruh */}
      <circle
        cx={point.x}
        cy={point.y}
        r={pointRadius * 1.8}
        fill="rgba(255, 193, 7, 0.4)"
        stroke={colors.hoverPoint.stroke}
        strokeWidth={strokeWidth * 1.5}
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Samotný bod */}
      <circle
        cx={point.x}
        cy={point.y}
        r={pointRadius}
        fill={colors.hoverPoint.fill}
        stroke="white"
        strokeWidth={strokeWidth}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

export default HoveredVertexIndicator;
