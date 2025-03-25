
import React from 'react';
import { Point } from '@/lib/segmentation';

interface PointAddingVisualizerProps {
  hoveredSegment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  };
  zoom: number;
}

const PointAddingVisualizer = ({ 
  hoveredSegment, 
  zoom 
}: PointAddingVisualizerProps) => {
  if (!hoveredSegment.projectedPoint) return null;

  return (
    <circle
      cx={hoveredSegment.projectedPoint.x}
      cy={hoveredSegment.projectedPoint.y}
      r={6/zoom}
      fill="#4CAF50"
      stroke="#FFFFFF"
      strokeWidth={1.5/zoom}
      vectorEffect="non-scaling-stroke"
      className="animate-pulse"
      style={{ animationDuration: '1s' }}
    />
  );
};

export default PointAddingVisualizer;
