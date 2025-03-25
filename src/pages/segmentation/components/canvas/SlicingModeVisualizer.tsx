
import React from 'react';
import { Point } from '@/lib/segmentation';

interface SlicingModeVisualizerProps {
  sliceStartPoint: Point | null;
  cursorPosition: Point | null;
  zoom: number;
}

const SlicingModeVisualizer = ({ 
  sliceStartPoint, 
  cursorPosition, 
  zoom 
}: SlicingModeVisualizerProps) => {
  if (!sliceStartPoint) return null;

  return (
    <>
      {/* Slicing indicator line */}
      {cursorPosition && (
        <line
          x1={sliceStartPoint.x}
          y1={sliceStartPoint.y}
          x2={cursorPosition.x}
          y2={cursorPosition.y}
          stroke="#FF3B30"
          strokeWidth={2.5/zoom}
          strokeDasharray={`${8/zoom},${4/zoom}`}
          vectorEffect="non-scaling-stroke"
          filter="url(#line-glow)"
        />
      )}
      
      {/* Slicing start point */}
      <circle
        cx={sliceStartPoint.x}
        cy={sliceStartPoint.y}
        r={6/zoom}
        fill="#FF3B30"
        stroke="#FFFFFF"
        strokeWidth={2/zoom}
        vectorEffect="non-scaling-stroke"
        filter="url(#point-glow)"
      />
    </>
  );
};

export default SlicingModeVisualizer;
