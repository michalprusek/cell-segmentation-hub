
import React from 'react';
import { Point } from '@/lib/segmentation';
import { TempPointsState } from '@/pages/segmentation/types';

interface TemporaryEditPathProps {
  tempPoints: TempPointsState;
  cursorPosition: Point | null;
  zoom: number;
  isShiftPressed?: boolean;
}

const TemporaryEditPath = ({ 
  tempPoints, 
  cursorPosition, 
  zoom, 
  isShiftPressed 
}: TemporaryEditPathProps) => {
  if (tempPoints.points.length === 0) return null;

  return (
    <>
      {/* Points already added */}
      <polyline
        points={tempPoints.points.map(p => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke="#FF3B30"
        strokeWidth={2/zoom}
        strokeDasharray={`${4/zoom},${4/zoom}`}
        vectorEffect="non-scaling-stroke"
      />
      
      {/* Line from last point to cursor */}
      {cursorPosition && tempPoints.points.length > 0 && (
        <line
          x1={tempPoints.points[tempPoints.points.length - 1].x}
          y1={tempPoints.points[tempPoints.points.length - 1].y}
          x2={cursorPosition.x}
          y2={cursorPosition.y}
          stroke="#FF3B30"
          strokeWidth={1.5/zoom}
          strokeDasharray={isShiftPressed ? `${2/zoom},${2/zoom}` : `${4/zoom},${4/zoom}`}
          vectorEffect="non-scaling-stroke"
        />
      )}
      
      {/* Vertices for the points */}
      {tempPoints.points.map((point, index) => (
        <circle
          key={`temp-point-${index}`}
          cx={point.x}
          cy={point.y}
          r={5/zoom}
          fill={index === 0 ? "#FF3B30" : "#FFFFFF"}
          stroke="#FF3B30"
          strokeWidth={1.5/zoom}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      
      {/* Optionally show the closing line from the last point to the first point */}
      {tempPoints.points.length > 2 && (
        <line
          x1={tempPoints.points[tempPoints.points.length - 1].x}
          y1={tempPoints.points[tempPoints.points.length - 1].y}
          x2={tempPoints.points[0].x}
          y2={tempPoints.points[0].y}
          stroke="#FF3B30"
          strokeWidth={1/zoom}
          strokeDasharray={`${8/zoom},${4/zoom}`}
          strokeOpacity={0.6}
          vectorEffect="non-scaling-stroke"
        />
      )}
      
      {/* Shift key indicator for auto-point addition */}
      {isShiftPressed && cursorPosition && (
        <circle
          cx={cursorPosition.x}
          cy={cursorPosition.y}
          r={7/zoom}
          fill="rgba(255, 59, 48, 0.3)"
          stroke="#FF3B30"
          strokeWidth={1.5/zoom}
          strokeDasharray={`${2/zoom},${2/zoom}`}
          vectorEffect="non-scaling-stroke"
          className="animate-pulse"
        />
      )}
    </>
  );
};

export default TemporaryEditPath;
