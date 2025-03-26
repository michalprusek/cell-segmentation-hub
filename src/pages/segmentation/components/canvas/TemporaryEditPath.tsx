
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

  // Dynamicky nastavíme poloměr bodů podle úrovně zoomu - OBRÁCENĚ
  const getPointRadius = () => {
    if (zoom > 4) {
      // Při velkém přiblížení větší body
      return 7/zoom;
    } else if (zoom > 3) {
      return 6/zoom;
    } else if (zoom < 0.5) {
      // Při velkém oddálení menší body
      return 2.5/zoom;
    } else if (zoom < 0.7) {
      return 3/zoom;
    } else {
      return 5/zoom;
    }
  };

  const pointRadius = getPointRadius();
  
  // Dynamicky nastavíme tloušťku čar podle úrovně zoomu
  const getStrokeWidth = () => {
    if (zoom > 4) {
      return 3/zoom;
    } else if (zoom > 3) {
      return 2.5/zoom;
    } else if (zoom < 0.5) {
      return 1/zoom;
    } else if (zoom < 0.7) {
      return 1.5/zoom;
    } else {
      return 2/zoom;
    }
  };
  
  const strokeWidth = getStrokeWidth();
  const lineStrokeWidth = strokeWidth * 0.75;

  return (
    <>
      {/* Body, které již byly přidány */}
      <polyline
        points={tempPoints.points.map(p => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke="#FF3B30"
        strokeWidth={strokeWidth}
        strokeDasharray={`${4/zoom},${4/zoom}`}
        vectorEffect="non-scaling-stroke"
        shapeRendering="geometricPrecision"
      />
      
      {/* Spojnice od posledního bodu ke kurzoru */}
      {cursorPosition && tempPoints.points.length > 0 && (
        <line
          x1={tempPoints.points[tempPoints.points.length - 1].x}
          y1={tempPoints.points[tempPoints.points.length - 1].y}
          x2={cursorPosition.x}
          y2={cursorPosition.y}
          stroke="#FF3B30"
          strokeWidth={lineStrokeWidth}
          strokeDasharray={isShiftPressed ? `${2/zoom},${2/zoom}` : `${4/zoom},${4/zoom}`}
          vectorEffect="non-scaling-stroke"
          shapeRendering="geometricPrecision"
        />
      )}
      
      {/* Vertexy pro body */}
      {tempPoints.points.map((point, index) => (
        <circle
          key={`temp-point-${index}`}
          cx={point.x}
          cy={point.y}
          r={pointRadius}
          fill={index === 0 ? "#FF3B30" : "#FFFFFF"}
          stroke="#FF3B30"
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
          shapeRendering="geometricPrecision"
        />
      ))}
      
      {/* Odstraňujeme spojnici od posledního bodu k prvnímu bodu */}
      
      {/* Shift key indikátor pro auto-přidávání bodů */}
      {isShiftPressed && cursorPosition && (
        <circle
          cx={cursorPosition.x}
          cy={cursorPosition.y}
          r={7/zoom}
          fill="rgba(255, 59, 48, 0.3)"
          stroke="#FF3B30"
          strokeWidth={strokeWidth}
          strokeDasharray={`${2/zoom},${2/zoom}`}
          vectorEffect="non-scaling-stroke"
          className="animate-pulse"
          shapeRendering="geometricPrecision"
        />
      )}
    </>
  );
};

export default TemporaryEditPath;
