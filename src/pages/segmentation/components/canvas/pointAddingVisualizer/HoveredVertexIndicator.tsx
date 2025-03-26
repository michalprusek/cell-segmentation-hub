
import React from 'react';
import { Point } from '@/lib/segmentation';

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

  return (
    <circle
      cx={hoveredSegment.projectedPoint.x}
      cy={hoveredSegment.projectedPoint.y}
      r={8/zoom}
      fill="#FFA500"
      stroke="#FFFFFF"
      strokeWidth={2/zoom}
      className="animate-pulse"
      style={{ pointerEvents: 'none' }}
    />
  );
};

export default HoveredVertexIndicator;
