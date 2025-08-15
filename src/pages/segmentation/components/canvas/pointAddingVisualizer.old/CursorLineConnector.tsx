
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
 * Komponenta pro zobrazení spojnice od posledního bodu ke kurzoru nebo potenciálnímu koncovému bodu
 */
const CursorLineConnector = ({ 
  tempPoints, 
  hoveredSegment, 
  selectedVertexIndex, 
  cursorPosition, 
  polygonPoints,
  zoom 
}: CursorLineConnectorProps) => {
  if (selectedVertexIndex === null || !polygonPoints) {
    return null;
  }

  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();
  
  // Startovní bod spojnice - buď poslední dočasný bod nebo počáteční bod
  const startPoint = tempPoints.length > 0
    ? tempPoints[tempPoints.length - 1]
    : polygonPoints[selectedVertexIndex];
  
  // Koncový bod spojnice - buď bod pod kurzorem, nebo aktuální pozice kurzoru
  const isHoveringEndpoint = hoveredSegment.segmentIndex !== null && 
                          hoveredSegment.segmentIndex !== selectedVertexIndex && 
                          hoveredSegment.projectedPoint;
  
  const endPoint = isHoveringEndpoint
    ? hoveredSegment.projectedPoint!
    : (cursorPosition || startPoint);
  
  // Styl čáry podle toho, zda míříme na koncový bod
  const lineColor = isHoveringEndpoint ? colors.line.hoveredColor : colors.line.color;
  const dashArray = isHoveringEndpoint ? "" : `${4/zoom},${4/zoom}`;

  return (
    <line
      x1={startPoint.x}
      y1={startPoint.y}
      x2={endPoint.x}
      y2={endPoint.y}
      stroke={lineColor}
      strokeWidth={strokeWidth}
      strokeDasharray={dashArray}
      style={{ pointerEvents: 'none' }}
    />
  );
};

export default CursorLineConnector;
