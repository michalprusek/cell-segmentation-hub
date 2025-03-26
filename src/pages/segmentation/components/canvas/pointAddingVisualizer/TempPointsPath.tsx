
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

  // Počáteční bod
  const startPoint = polygonPoints[selectedVertexIndex];

  return (
    <>
      {/* Spojnice od počátečního bodu k prvnímu dočasnému bodu */}
      {tempPoints.length > 0 && (
        <line
          x1={startPoint.x}
          y1={startPoint.y}
          x2={tempPoints[0].x}
          y2={tempPoints[0].y}
          stroke={colors.tempLine.stroke}
          strokeWidth={strokeWidth}
          style={{ pointerEvents: 'none' }}
        />
      )}
      
      {/* Spojnice mezi dočasnými body */}
      {tempPoints.length > 1 && tempPoints.map((point, i) => {
        if (i === 0) return null;
        
        return (
          <line
            key={`temp-line-${i}`}
            x1={tempPoints[i-1].x}
            y1={tempPoints[i-1].y}
            x2={point.x}
            y2={point.y}
            stroke={colors.tempLine.stroke}
            strokeWidth={strokeWidth}
            style={{ pointerEvents: 'none' }}
          />
        );
      })}
      
      {/* Dočasné body s pulzujícím efektem */}
      {tempPoints.map((point, i) => (
        <g key={`temp-point-${i}`}>
          {/* Slabá záře kolem bodu */}
          <circle
            cx={point.x}
            cy={point.y}
            r={pointRadius * 1.5}
            fill={colors.tempPoint.glowColor}
            style={{ 
              pointerEvents: 'none',
              animation: 'pulse 2s infinite'
            }}
          />
          
          {/* Samotný bod */}
          <circle
            cx={point.x}
            cy={point.y}
            r={pointRadius}
            fill={colors.tempPoint.fill}
            stroke={colors.tempPoint.stroke}
            strokeWidth={strokeWidth * 0.8}
            style={{ pointerEvents: 'none' }}
          />
        </g>
      ))}
    </>
  );
};

export default TempPointsPath;

