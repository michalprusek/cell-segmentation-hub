
import React from 'react';
import { Point } from '@/lib/segmentation';
import { getPointRadius, getStrokeWidth } from './visualizationUtils';

interface TempPointsPathProps {
  selectedVertexIndex: number | null;
  polygonPoints: Point[] | null;
  tempPoints: Point[];
  zoom: number;
}

/**
 * Komponenta pro zobrazení dočasných bodů a spojnic
 */
const TempPointsPath = ({ 
  selectedVertexIndex, 
  polygonPoints, 
  tempPoints, 
  zoom 
}: TempPointsPathProps) => {
  if (tempPoints.length === 0 || selectedVertexIndex === null || !polygonPoints) {
    return null;
  }

  const pointRadius = getPointRadius(zoom);
  const strokeWidth = getStrokeWidth(zoom);

  return (
    <>
      {/* Spojnice od výchozího bodu k prvnímu dočasnému bodu */}
      {polygonPoints[selectedVertexIndex] && tempPoints[0] && (
        <line
          x1={polygonPoints[selectedVertexIndex].x}
          y1={polygonPoints[selectedVertexIndex].y}
          x2={tempPoints[0].x}
          y2={tempPoints[0].y}
          stroke="#3498db"
          strokeWidth={strokeWidth}
          style={{ pointerEvents: 'none' }}
        />
      )}
      
      {/* Spojnice mezi dočasnými body */}
      {tempPoints.map((point, i) => {
        if (i === 0) return null;
        
        return (
          <line
            key={`temp-line-${i}`}
            x1={tempPoints[i-1].x}
            y1={tempPoints[i-1].y}
            x2={point.x}
            y2={point.y}
            stroke="#3498db"
            strokeWidth={strokeWidth}
            style={{ pointerEvents: 'none' }}
          />
        );
      })}
      
      {/* Dočasné body */}
      {tempPoints.map((point, i) => (
        <circle
          key={`temp-point-${i}`}
          cx={point.x}
          cy={point.y}
          r={pointRadius}
          fill="#3498db"
          stroke="#FFFFFF"
          strokeWidth={strokeWidth}
          style={{ pointerEvents: 'none' }}
        />
      ))}
    </>
  );
};

export default TempPointsPath;
