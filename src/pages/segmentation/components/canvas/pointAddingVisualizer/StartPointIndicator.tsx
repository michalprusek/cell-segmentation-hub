
import React from 'react';
import { Point } from '@/lib/segmentation';
import { getPointRadius, getStrokeWidth, getColors } from './visualizationUtils';

interface StartPointIndicatorProps {
  selectedVertexIndex: number | null;
  polygonPoints: Point[] | null;
  zoom: number;
}

/**
 * Komponenta pro zobrazení počátečního bodu cesty
 */
const StartPointIndicator = ({ selectedVertexIndex, polygonPoints, zoom }: StartPointIndicatorProps) => {
  if (selectedVertexIndex === null || !polygonPoints || !polygonPoints[selectedVertexIndex]) {
    return null;
  }

  const pointRadius = getPointRadius(zoom);
  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();
  const startPoint = polygonPoints[selectedVertexIndex];

  return (
    <g>
      {/* Pulzující efekt kolem počátečního bodu */}
      <circle
        cx={startPoint.x}
        cy={startPoint.y}
        r={pointRadius * 2}
        fill={colors.startPoint.glowColor}
        className="animate-pulse"
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Větší kruh pro zvýraznění */}
      <circle
        cx={startPoint.x}
        cy={startPoint.y}
        r={pointRadius * 1.5}
        fill={colors.startPoint.fill}
        stroke={colors.startPoint.stroke}
        strokeWidth={strokeWidth * 1.2}
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Menší vnitřní kruh */}
      <circle
        cx={startPoint.x}
        cy={startPoint.y}
        r={pointRadius * 0.8}
        fill={colors.startPoint.innerFill}
        stroke="none"
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

export default StartPointIndicator;
