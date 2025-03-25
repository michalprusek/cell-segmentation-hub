
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
          stroke="#FF0000"
          strokeWidth={2/zoom}
          strokeDasharray={`${6/zoom},${3/zoom}`}
          vectorEffect="non-scaling-stroke"
        />
      )}
      
      {/* Slicing start point */}
      <circle
        cx={sliceStartPoint.x}
        cy={sliceStartPoint.y}
        r={6/zoom}
        fill="#FF0000"
        stroke="#FFFFFF"
        strokeWidth={1.5/zoom}
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
};

export default SlicingModeVisualizer;
