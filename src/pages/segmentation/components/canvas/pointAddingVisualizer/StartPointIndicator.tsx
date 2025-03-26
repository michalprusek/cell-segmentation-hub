
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

  return (
    <circle
      cx={polygonPoints[selectedVertexIndex].x}
      cy={polygonPoints[selectedVertexIndex].y}
      r={pointRadius * 1.3}
      fill={colors.startPoint.fill}
      stroke={colors.startPoint.stroke}
      strokeWidth={strokeWidth * 1.2}
      style={{ pointerEvents: 'none' }}
    />
  );
};

export default StartPointIndicator;
