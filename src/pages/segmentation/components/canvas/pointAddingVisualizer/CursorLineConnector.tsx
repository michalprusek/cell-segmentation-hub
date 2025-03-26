
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
  polygonPoints: Point[] | null;
  zoom: number;
}

/**
 * Komponenta pro zobrazení spojnice od posledního bodu ke kurzoru nebo k potenciálnímu koncovému bodu
 */
const CursorLineConnector = ({
  tempPoints,
  hoveredSegment,
  selectedVertexIndex,
  cursorPosition,
  polygonPoints,
  zoom
}: CursorLineConnectorProps) => {
  if (!selectedVertexIndex || !polygonPoints || tempPoints.length === 0) {
    return null;
  }
  
  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();
  const lastPoint = tempPoints[tempPoints.length - 1];
  
  // Použijeme projectedPoint (nad kterým je kurzor) nebo pozici kurzoru
  const targetPoint = hoveredSegment.projectedPoint || cursorPosition;
  
  // Log pro debug
  console.log("CursorLineConnector - lastPoint:", lastPoint, "targetPoint:", targetPoint, 
              "hoveredSegment:", hoveredSegment);
  
  // Pokud nemáme validní cílový bod, vrátíme null
  if (!targetPoint) {
    return null;
  }
  
  return (
    <line
      x1={lastPoint.x}
      y1={lastPoint.y}
      x2={targetPoint.x}
      y2={targetPoint.y}
      stroke={colors.line.color}
      strokeWidth={strokeWidth}
      strokeDasharray={`${strokeWidth * 3} ${strokeWidth * 2}`}
      style={{ pointerEvents: 'none' }}
    />
  );
};

export default CursorLineConnector;
