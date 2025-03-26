
import React from 'react';
import { Point } from '@/lib/segmentation';
import { getStrokeWidth, getColors } from './visualizationUtils';

interface CursorLineConnectorProps {
  tempPoints: Point[];
  hoveredSegment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  };
  selectedVertexIndex: number | null;
  cursorPosition: Point | null;
  zoom: number;
}

/**
 * Komponenta pro zobrazení spojnice od posledního bodu ke kurzoru nebo zvýrazněnému bodu
 */
const CursorLineConnector = ({ 
  tempPoints, 
  hoveredSegment, 
  selectedVertexIndex, 
  cursorPosition, 
  zoom 
}: CursorLineConnectorProps) => {
  // Pokud nemáme dočasné body nebo pozici kurzoru, nezobrazujeme nic
  if (tempPoints.length === 0 || !cursorPosition) {
    return null;
  }

  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();
  const lastPoint = tempPoints[tempPoints.length - 1];
  
  // Target point je buď zvýrazněný vrchol, nebo pozice kurzoru
  const targetPoint = 
    (hoveredSegment.segmentIndex !== null && 
     hoveredSegment.segmentIndex !== selectedVertexIndex && 
     hoveredSegment.projectedPoint)
      ? hoveredSegment.projectedPoint
      : cursorPosition;

  // Určíme, zda se spojujeme s koncovým bodem nebo jen zobrazujeme spojnici ke kurzoru
  const isConnectingToVertex = 
    hoveredSegment.segmentIndex !== null && 
    hoveredSegment.segmentIndex !== selectedVertexIndex;

  // Vykreslíme spojnici
  return (
    <line
      x1={lastPoint.x}
      y1={lastPoint.y}
      x2={targetPoint.x}
      y2={targetPoint.y}
      stroke={isConnectingToVertex ? colors.cursorLine.endpoint : colors.cursorLine.normal}
      strokeWidth={strokeWidth}
      strokeDasharray={isConnectingToVertex ? "" : `${4/zoom},${4/zoom}`}
      style={{ pointerEvents: 'none' }}
    />
  );
};

export default CursorLineConnector;
