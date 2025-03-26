
import React from 'react';
import { TempPointsState } from '@/pages/segmentation/types';
import { Point } from '@/lib/segmentation';

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
  
  // Dynamicky nastavíme tloušťku čáry podle zoomu - OBRÁCENĚ
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
  
  // Helper to create path data string from points
  const createPathData = (points: Point[], includeLastLine: boolean = false) => {
    if (points.length === 0) return '';
    
    let pathData = `M ${points[0].x} ${points[0].y}`;
    
    for (let i = 1; i < points.length; i++) {
      pathData += ` L ${points[i].x} ${points[i].y}`;
    }
    
    // If we should include a line to the cursor and cursor exists
    if (includeLastLine && cursorPosition) {
      pathData += ` L ${cursorPosition.x} ${cursorPosition.y}`;
    }
    
    return pathData;
  };

  return (
    <g shapeRendering="geometricPrecision">
      {/* Temporary points path */}
      <path
        d={createPathData(tempPoints.points, true)}
        fill="none"
        stroke="#3498db"
        strokeWidth={strokeWidth}
        strokeDasharray={isShiftPressed ? `${5/zoom},${3/zoom}` : "none"}
        vectorEffect="non-scaling-stroke"
        shapeRendering="geometricPrecision"
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Display dots for each point */}
      {tempPoints.points.map((point, index) => (
        <circle
          key={`temp-point-${index}`}
          cx={point.x}
          cy={point.y}
          r={index === 0 ? pointRadius * 1.5 : pointRadius}
          fill={index === 0 ? "#FFA500" : "#3498db"}
          stroke={index === 0 ? "#FFFF00" : "#FFFFFF"}
          strokeWidth={strokeWidth * (index === 0 ? 1.5 : 1)}
          vectorEffect="non-scaling-stroke"
          shapeRendering="geometricPrecision"
          style={{ pointerEvents: 'none' }}
          className={index === 0 ? "animate-pulse" : ""}
        />
      ))}
      
      {/* Show the connection line from last point to cursor */}
      {cursorPosition && tempPoints.points.length > 0 && (
        <>
          {/* Visual indicator when close to the starting point */}
          {tempPoints.points.length > 2 && (
            <line
              x1={tempPoints.points[0].x}
              y1={tempPoints.points[0].y}
              x2={cursorPosition.x}
              y2={cursorPosition.y}
              stroke={
                Math.hypot(
                  tempPoints.points[0].x - cursorPosition.x,
                  tempPoints.points[0].y - cursorPosition.y
                ) < 20/zoom ? "#4CAF50" : "transparent"
              }
              strokeWidth={strokeWidth * 1.5}
              strokeDasharray={`${4/zoom},${4/zoom}`}
              vectorEffect="non-scaling-stroke"
              shapeRendering="geometricPrecision"
            />
          )}
        </>
      )}
    </g>
  );
};

export default TemporaryEditPath;
