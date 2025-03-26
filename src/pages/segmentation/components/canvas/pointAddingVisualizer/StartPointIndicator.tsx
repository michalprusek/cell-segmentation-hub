
import React from 'react';
import { Point } from '@/lib/segmentation';
import { getPointRadius, getStrokeWidth, getColors } from './visualizationUtils';

interface StartPointIndicatorProps {
  selectedVertexIndex: number | null;
  polygonPoints: Point[] | null;
  zoom: number;
}

/**
 * Komponenta pro zobrazení počátečního bodu při přidávání nových bodů
 */
const StartPointIndicator = ({ selectedVertexIndex, polygonPoints, zoom }: StartPointIndicatorProps) => {
  if (selectedVertexIndex === null || !polygonPoints) {
    return null;
  }

  const point = polygonPoints[selectedVertexIndex];
  if (!point) {
    console.error("Selected vertex index out of bounds:", selectedVertexIndex, polygonPoints.length);
    return null;
  }
  
  console.log("Rendering StartPointIndicator for vertex:", selectedVertexIndex, "at", point.x, point.y);

  const pointRadius = getPointRadius(zoom) * 1.8; // Výrazně zvětšíme bod pro lepší viditelnost
  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();

  return (
    <g>
      {/* Zvýraznění počátečního bodu - vnější pulzující kruh */}
      <circle
        cx={point.x}
        cy={point.y}
        r={pointRadius * 2}
        fill={colors.startPoint.glowColor}
        className="animate-pulse"
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Střední kruh */}
      <circle
        cx={point.x}
        cy={point.y}
        r={pointRadius * 1.4}
        fill="rgba(255, 165, 0, 0.4)"
        stroke={colors.startPoint.stroke}
        strokeWidth={strokeWidth * 1.5}
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Hlavní bod */}
      <circle
        cx={point.x}
        cy={point.y}
        r={pointRadius}
        fill={colors.startPoint.fill}
        stroke="white"
        strokeWidth={strokeWidth * 1.2}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

export default StartPointIndicator;
