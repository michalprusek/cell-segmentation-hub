
import React from 'react';
import { Point } from '@/lib/segmentation';
import { getPointRadius, getStrokeWidth, getColors, createPathFromPoints } from './visualizationUtils';

interface TempPointsPathProps {
  selectedVertexIndex: number | null;
  polygonPoints: Point[] | null;
  tempPoints: Point[];
  zoom: number;
}

/**
 * Komponenta pro zobrazení dočasných bodů a spojnic mezi nimi
 */
const TempPointsPath = ({ selectedVertexIndex, polygonPoints, tempPoints, zoom }: TempPointsPathProps) => {
  if (
    selectedVertexIndex === null || 
    !polygonPoints || 
    !polygonPoints[selectedVertexIndex] || 
    tempPoints.length === 0
  ) {
    return null;
  }

  const pointRadius = getPointRadius(zoom);
  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();
  const startPoint = polygonPoints[selectedVertexIndex];

  return (
    <g>
      {/* Spojnice od výchozího bodu k prvnímu dočasnému bodu */}
      <line
        x1={startPoint.x}
        y1={startPoint.y}
        x2={tempPoints[0].x}
        y2={tempPoints[0].y}
        stroke={colors.line.color}
        strokeWidth={strokeWidth}
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Spojnice mezi dočasnými body */}
      {tempPoints.slice(1).map((point, i) => (
        <line
          key={`temp-line-${i}`}
          x1={tempPoints[i].x}
          y1={tempPoints[i].y}
          x2={point.x}
          y2={point.y}
          stroke={colors.line.color}
          strokeWidth={strokeWidth}
          style={{ pointerEvents: 'none' }}
        />
      ))}
      
      {/* Dočasné body */}
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
    </g>
  );
};

export default TempPointsPath;
