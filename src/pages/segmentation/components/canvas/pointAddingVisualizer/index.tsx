
import React from 'react';
import { Point } from '@/lib/segmentation';
import HoveredVertexIndicator from './HoveredVertexIndicator';
import StartPointIndicator from './StartPointIndicator';
import PotentialEndpointIndicator from './PotentialEndpointIndicator';
import TempPointsPath from './TempPointsPath';
import CursorLineConnector from './CursorLineConnector';

interface PointAddingVisualizerProps {
  hoveredSegment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  };
  zoom: number;
  tempPoints: Point[];
  selectedVertexIndex: number | null;
  sourcePolygonId: string | null;
  polygonPoints: Point[] | null;
  cursorPosition?: Point | null;
}

/**
 * Komponenta pro vizualizaci režimu přidávání bodů
 */
const PointAddingVisualizer = ({
  hoveredSegment,
  zoom,
  tempPoints,
  selectedVertexIndex,
  sourcePolygonId,
  polygonPoints,
  cursorPosition
}: PointAddingVisualizerProps) => {
  if (!selectedVertexIndex && selectedVertexIndex !== 0) {
    // První fáze - uživatel ještě nevybral počáteční bod
    return (
      <g>
        <HoveredVertexIndicator 
          hoveredSegment={hoveredSegment} 
          zoom={zoom} 
        />
      </g>
    );
  }

  // Druhá fáze - uživatel vybral počáteční bod a přidává nové body
  return (
    <g>
      <StartPointIndicator 
        selectedVertexIndex={selectedVertexIndex} 
        polygonPoints={polygonPoints} 
        zoom={zoom} 
      />
      
      <PotentialEndpointIndicator 
        selectedVertexIndex={selectedVertexIndex} 
        polygonPoints={polygonPoints} 
        hoveredSegment={hoveredSegment} 
        zoom={zoom} 
      />
      
      <TempPointsPath 
        selectedVertexIndex={selectedVertexIndex} 
        polygonPoints={polygonPoints} 
        tempPoints={tempPoints} 
        zoom={zoom} 
      />
      
      <CursorLineConnector 
        tempPoints={tempPoints} 
        hoveredSegment={hoveredSegment} 
        selectedVertexIndex={selectedVertexIndex} 
        cursorPosition={cursorPosition} 
        zoom={zoom} 
      />
    </g>
  );
};

export default PointAddingVisualizer;
