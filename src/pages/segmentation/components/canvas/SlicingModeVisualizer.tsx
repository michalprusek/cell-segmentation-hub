
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
  
  // Dynamicky nastavíme tloušťku čáry a poloměr bodu podle zoomu - OBRÁCENĚ
  const getStrokeWidth = () => {
    if (zoom > 4) {
      return 4/zoom;
    } else if (zoom > 3) {
      return 3/zoom;
    } else if (zoom < 0.5) {
      return 1.5/zoom;
    } else if (zoom < 0.7) {
      return 2/zoom;
    } else {
      return 2.5/zoom;
    }
  };
  
  const strokeWidth = getStrokeWidth();
  
  const getPointRadius = () => {
    if (zoom > 4) {
      return 8/zoom;
    } else if (zoom > 3) {
      return 7/zoom;
    } else if (zoom < 0.5) {
      return 5/zoom;
    } else if (zoom < 0.7) {
      return 5.5/zoom;
    } else {
      return 6/zoom;
    }
  };
  
  const pointRadius = getPointRadius();

  return (
    <g shapeRendering="geometricPrecision">
      {/* Slicing indicator line */}
      {cursorPosition && (
        <line
          x1={sliceStartPoint.x}
          y1={sliceStartPoint.y}
          x2={cursorPosition.x}
          y2={cursorPosition.y}
          stroke="#FF3B30"
          strokeWidth={strokeWidth}
          strokeDasharray={`${8/zoom},${4/zoom}`}
          vectorEffect="non-scaling-stroke"
          filter="url(#line-glow)"
          shapeRendering="geometricPrecision"
        />
      )}
      
      {/* Slicing start point */}
      <circle
        cx={sliceStartPoint.x}
        cy={sliceStartPoint.y}
        r={pointRadius}
        fill="#FF3B30"
        stroke="#FFFFFF"
        strokeWidth={strokeWidth * 0.8}
        vectorEffect="non-scaling-stroke"
        filter="url(#point-glow)"
        shapeRendering="geometricPrecision"
      />
    </g>
  );
};

export default SlicingModeVisualizer;
