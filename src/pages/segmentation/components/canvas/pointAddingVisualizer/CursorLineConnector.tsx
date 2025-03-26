
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
  if (!cursorPosition || !polygonPoints || selectedVertexIndex === null) {
    return null;
  }

  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();
  
  // Máme-li zatím jen počáteční bod (žádné dočasné)
  if (tempPoints.length === 0) {
    const startPoint = polygonPoints[selectedVertexIndex];
    
    // Pokud je kurzor nad potenciálním koncovým bodem
    if (hoveredSegment.segmentIndex !== null && 
        hoveredSegment.segmentIndex !== selectedVertexIndex && 
        hoveredSegment.projectedPoint) {
      return (
        <line
          x1={startPoint.x}
          y1={startPoint.y}
          x2={hoveredSegment.projectedPoint.x}
          y2={hoveredSegment.projectedPoint.y}
          stroke={colors.cursorLine.endpoint}
          strokeWidth={strokeWidth}
          style={{ pointerEvents: 'none' }}
        />
      );
    }
    
    // Jinak spojnice od počátečního bodu ke kurzoru
    return (
      <line
        x1={startPoint.x}
        y1={startPoint.y}
        x2={cursorPosition.x}
        y2={cursorPosition.y}
        stroke={colors.cursorLine.normal}
        strokeWidth={strokeWidth}
        strokeDasharray={colors.cursorLine.dashArray}
        style={{ pointerEvents: 'none' }}
      />
    );
  }
  
  // Máme dočasné body, spojnice od posledního dočasného bodu
  const lastPoint = tempPoints[tempPoints.length - 1];
  
  // Pokud je kurzor nad potenciálním koncovým bodem
  if (hoveredSegment.segmentIndex !== null && 
      hoveredSegment.segmentIndex !== selectedVertexIndex && 
      hoveredSegment.projectedPoint) {
    return (
      <line
        x1={lastPoint.x}
        y1={lastPoint.y}
        x2={hoveredSegment.projectedPoint.x}
        y2={hoveredSegment.projectedPoint.y}
        stroke={colors.cursorLine.endpoint}
        strokeWidth={strokeWidth}
        style={{ pointerEvents: 'none' }}
      />
    );
  }
  
  // Jinak spojnice od posledního bodu ke kurzoru
  return (
    <line
      x1={lastPoint.x}
      y1={lastPoint.y}
      x2={cursorPosition.x}
      y2={cursorPosition.y}
      stroke={colors.cursorLine.normal}
      strokeWidth={strokeWidth}
      strokeDasharray={colors.cursorLine.dashArray}
      style={{ pointerEvents: 'none' }}
    />
  );
};

export default CursorLineConnector;
