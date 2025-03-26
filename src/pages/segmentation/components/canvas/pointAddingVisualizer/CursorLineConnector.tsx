
import React from 'react';
import { Point } from '@/lib/segmentation';
import { getStrokeWidth } from './visualizationUtils';

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
  if (tempPoints.length === 0 || !cursorPosition) {
    return null;
  }

  const strokeWidth = getStrokeWidth(zoom);
  const lastPoint = tempPoints[tempPoints.length - 1];
  
  // Target point je buď zvýrazněný vrchol, nebo pozice kurzoru
  const targetPoint = 
    (hoveredSegment.segmentIndex !== null && 
     hoveredSegment.segmentIndex !== selectedVertexIndex && 
     hoveredSegment.projectedPoint)
      ? hoveredSegment.projectedPoint
      : cursorPosition;

  const isConnectingToVertex = 
    hoveredSegment.segmentIndex !== null && 
    hoveredSegment.segmentIndex !== selectedVertexIndex;

  return (
    <line
      x1={lastPoint.x}
      y1={lastPoint.y}
      x2={targetPoint.x}
      y2={targetPoint.y}
      stroke={isConnectingToVertex ? "#4CAF50" : "#3498db"}
      strokeWidth={strokeWidth}
      strokeDasharray={isConnectingToVertex ? "" : `${4/zoom},${4/zoom}`}
      style={{ pointerEvents: 'none' }}
    />
  );
};

export default CursorLineConnector;
