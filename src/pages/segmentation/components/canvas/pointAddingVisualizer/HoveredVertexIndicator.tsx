
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
 * Komponenta pro zvýraznění vrcholu pod kurzorem
 */
const HoveredVertexIndicator = ({ hoveredSegment, zoom }: HoveredVertexIndicatorProps) => {
  if (hoveredSegment.segmentIndex === null || !hoveredSegment.projectedPoint) {
    return null;
  }

  const pointRadius = getPointRadius(zoom);
  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();

  return (
    <circle
      cx={hoveredSegment.projectedPoint.x}
      cy={hoveredSegment.projectedPoint.y}
      r={pointRadius * 1.3}
      fill={colors.hoverPoint.fill}
      stroke={colors.hoverPoint.stroke}
      strokeWidth={strokeWidth}
      className="animate-pulse"
      style={{ pointerEvents: 'none' }}
    />
  );
};

export default HoveredVertexIndicator;
