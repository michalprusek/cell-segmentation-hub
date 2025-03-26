
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
  
  // Dynamicky nastavíme poloměr a tloušťku okraje bodu podle zoomu
  const getPointRadius = () => {
    if (zoom > 4) {
      return 5/zoom;
    } else if (zoom > 3) {
      return 5.5/zoom;
    } else if (zoom < 0.5) {
      return 8/zoom;
    } else if (zoom < 0.7) {
      return 7/zoom;
    } else {
      return 6/zoom;
    }
  };
  
  const pointRadius = getPointRadius();
  
  const getStrokeWidth = () => {
    if (zoom > 4) {
      return 1.5/zoom;
    } else if (zoom > 3) {
      return 1.8/zoom;
    } else if (zoom < 0.5) {
      return 3/zoom;
    } else if (zoom < 0.7) {
      return 2.5/zoom;
    } else {
      return 2/zoom;
    }
  };
  
  const strokeWidth = getStrokeWidth();

  return (
    <circle
      cx={hoveredSegment.projectedPoint.x}
      cy={hoveredSegment.projectedPoint.y}
      r={pointRadius}
      fill="#4CAF50"
      stroke="#FFFFFF"
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
      className="animate-pulse"
      style={{ animationDuration: '1s' }}
      filter="url(#point-glow)"
      shapeRendering="geometricPrecision"
    />
  );
};

export default PointAddingVisualizer;
