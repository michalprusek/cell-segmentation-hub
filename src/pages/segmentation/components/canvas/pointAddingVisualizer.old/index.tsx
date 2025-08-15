
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
  // Kontrola, zda máme všechny potřebné údaje
  const hasSelectedVertex = selectedVertexIndex !== null;
  const hasPolygonPoints = polygonPoints !== null;

  if (!hasSelectedVertex) {
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
      {/* Zvýraznění počátečního bodu */}
      <StartPointIndicator 
        selectedVertexIndex={selectedVertexIndex} 
        polygonPoints={polygonPoints} 
        zoom={zoom} 
      />
      
      {/* Zvýraznění potenciálních koncových bodů */}
      <PotentialEndpointIndicator 
        selectedVertexIndex={selectedVertexIndex} 
        polygonPoints={polygonPoints} 
        hoveredSegment={hoveredSegment} 
        zoom={zoom} 
      />
      
      {/* Dočasné body a spojnice mezi nimi */}
      <TempPointsPath 
        selectedVertexIndex={selectedVertexIndex} 
        polygonPoints={polygonPoints} 
        tempPoints={tempPoints} 
        zoom={zoom} 
      />
      
      {/* Spojnice od posledního bodu ke kurzoru nebo potenciálnímu koncovému bodu */}
      <CursorLineConnector 
        tempPoints={tempPoints} 
        hoveredSegment={hoveredSegment} 
        selectedVertexIndex={selectedVertexIndex} 
        cursorPosition={cursorPosition} 
        polygonPoints={polygonPoints}
        zoom={zoom} 
      />
    </g>
  );
};

export default PointAddingVisualizer;
