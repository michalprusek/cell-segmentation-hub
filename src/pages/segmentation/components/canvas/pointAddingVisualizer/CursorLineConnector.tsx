
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
 * Komponenta pro zobrazení spojnice od posledního bodu ke kurzoru nebo cílovému bodu
 */
const CursorLineConnector = ({
  tempPoints,
  hoveredSegment,
  selectedVertexIndex,
  cursorPosition,
  polygonPoints,
  zoom
}: CursorLineConnectorProps) => {
  // Pokud nemáme polygonPoints nebo selectedVertexIndex, nemůžeme nic vykreslit
  if (!polygonPoints || selectedVertexIndex === null) return null;
  
  const colors = getColors();
  const strokeWidth = getStrokeWidth(zoom);
  
  // Určíme výchozí bod pro spojnici
  let fromPoint: Point;
  if (tempPoints.length > 0) {
    // Pokud máme temp body, spojnice začne od posledního z nich
    fromPoint = tempPoints[tempPoints.length - 1];
  } else {
    // Jinak začne od vybraného bodu polygonu
    fromPoint = polygonPoints[selectedVertexIndex];
  }
  
  // Určíme cílový bod pro spojnici
  let toPoint: Point | null = null;
  let isEndpoint = false;
  
  if (hoveredSegment.segmentIndex !== null && 
      hoveredSegment.segmentIndex !== selectedVertexIndex && 
      hoveredSegment.projectedPoint) {
    // Pokud jsme nad potenciálním koncovým bodem, spojnice bude končit v něm
    toPoint = hoveredSegment.projectedPoint;
    isEndpoint = true;
  } else if (cursorPosition) {
    // Jinak končí v pozici kurzoru
    toPoint = cursorPosition;
  }
  
  // Pokud nemáme cílový bod, nic nevykreslíme
  if (!toPoint) return null;

  return (
    <line
      x1={fromPoint.x}
      y1={fromPoint.y}
      x2={toPoint.x}
      y2={toPoint.y}
      stroke={isEndpoint ? colors.cursorLine.endpoint : colors.cursorLine.normal}
      strokeWidth={strokeWidth}
      strokeDasharray={!isEndpoint ? colors.cursorLine.dashArray : ""}
      style={{ 
        pointerEvents: 'none',
        transition: 'stroke 0.2s ease'
      }}
    />
  );
};

export default CursorLineConnector;

