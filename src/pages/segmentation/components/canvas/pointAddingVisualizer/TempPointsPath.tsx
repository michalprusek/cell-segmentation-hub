
import React from 'react';
import { Point } from '@/lib/segmentation';
import { getPointRadius, getStrokeWidth, getColors } from './visualizationUtils';

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
  const colors = getColors();

  // Vytvoříme pole všech bodů pro vykreslení cesty (počáteční + dočasné)
  const allPoints = [
    polygonPoints[selectedVertexIndex],
    ...tempPoints
  ];

  return (
    <>
      {/* Vykreslení spojnic mezi body */}
      <path
        d={`M ${allPoints.map(p => `${p.x},${p.y}`).join(' L ')}`}
        fill="none"
        stroke={colors.tempLine.stroke}
        strokeWidth={strokeWidth}
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Vykreslení dočasných bodů */}
      {tempPoints.map((point, i) => (
        <circle
          key={`temp-point-${i}`}
          cx={point.x}
          cy={point.y}
          r={pointRadius}
          fill={colors.tempPoint.fill}
          stroke={colors.tempPoint.stroke}
          strokeWidth={strokeWidth * 0.8}
          style={{ pointerEvents: 'none' }}
        />
      ))}
    </>
  );
};

export default TempPointsPath;
