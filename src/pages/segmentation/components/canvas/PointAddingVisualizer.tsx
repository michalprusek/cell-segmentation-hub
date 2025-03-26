
import React from 'react';
import { Point } from '@/lib/segmentation';

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
}

/**
 * Komponenta pro vizualizaci režimu přidávání bodů do polygonu
 */
const PointAddingVisualizer = ({
  hoveredSegment,
  zoom,
  tempPoints,
  selectedVertexIndex,
  sourcePolygonId,
  polygonPoints
}: PointAddingVisualizerProps) => {
  if (!polygonPoints && !selectedVertexIndex) return null;
  
  // Velikost bodů podle zoomu
  const pointSize = Math.max(3 / zoom, 1);
  const strokeWidth = Math.max(1.5 / zoom, 0.5);

  return (
    <g>
      {/* Vykreslení bodů polygonu (žluté body) */}
      {polygonPoints && selectedVertexIndex !== null && polygonPoints.map((point, index) => {
        // Přeskočíme vybraný vrchol (ten bude oranžový)
        if (index === selectedVertexIndex) return null;
        
        return (
          <circle
            key={`vertex-${index}`}
            cx={point.x}
            cy={point.y}
            r={pointSize * 2}
            fill="yellow"
            stroke="black"
            strokeWidth={strokeWidth}
            opacity={0.8}
          />
        );
      })}
      
      {/* Vykreslení počátečního bodu (oranžový) */}
      {selectedVertexIndex !== null && polygonPoints && polygonPoints[selectedVertexIndex] && (
        <circle
          cx={polygonPoints[selectedVertexIndex].x}
          cy={polygonPoints[selectedVertexIndex].y}
          r={pointSize * 3}
          fill="orange"
          stroke="black"
          strokeWidth={strokeWidth}
          opacity={0.8}
        />
      )}
      
      {/* Zvýraznění bodu pod kurzorem (zelený) */}
      {hoveredSegment.polygonId === sourcePolygonId && 
       hoveredSegment.segmentIndex !== null && 
       hoveredSegment.segmentIndex !== selectedVertexIndex && 
       hoveredSegment.projectedPoint && (
        <circle
          cx={hoveredSegment.projectedPoint.x}
          cy={hoveredSegment.projectedPoint.y}
          r={pointSize * 3}
          fill="green"
          stroke="black"
          strokeWidth={strokeWidth}
          opacity={0.8}
        />
      )}
      
      {/* Vykreslení dočasných bodů (modré) */}
      {tempPoints.map((point, index) => (
        <circle
          key={`temp-point-${index}`}
          cx={point.x}
          cy={point.y}
          r={pointSize * 2}
          fill="blue"
          stroke="black"
          strokeWidth={strokeWidth}
          opacity={0.8}
        />
      ))}
      
      {/* Spojnice mezi body */}
      {selectedVertexIndex !== null && polygonPoints && polygonPoints[selectedVertexIndex] && (
        <g>
          {/* Čára od počátečního bodu k prvnímu dočasnému bodu */}
          {tempPoints.length > 0 && (
            <line
              x1={polygonPoints[selectedVertexIndex].x}
              y1={polygonPoints[selectedVertexIndex].y}
              x2={tempPoints[0].x}
              y2={tempPoints[0].y}
              stroke="blue"
              strokeWidth={strokeWidth}
              strokeDasharray={`${4/zoom} ${4/zoom}`}
            />
          )}
          
          {/* Čáry mezi dočasnými body */}
          {tempPoints.map((point, index) => {
            if (index === tempPoints.length - 1) return null;
            return (
              <line
                key={`temp-line-${index}`}
                x1={point.x}
                y1={point.y}
                x2={tempPoints[index + 1].x}
                y2={tempPoints[index + 1].y}
                stroke="blue"
                strokeWidth={strokeWidth}
              />
            );
          })}
          
          {/* Čára od posledního dočasného bodu ke kurzoru */}
          {tempPoints.length > 0 && hoveredSegment.projectedPoint && (
            <line
              x1={tempPoints[tempPoints.length - 1].x}
              y1={tempPoints[tempPoints.length - 1].y}
              x2={hoveredSegment.projectedPoint.x}
              y2={hoveredSegment.projectedPoint.y}
              stroke="blue"
              strokeWidth={strokeWidth}
              strokeDasharray={`${4/zoom} ${4/zoom}`}
            />
          )}
          
          {/* Čára od počátečního bodu ke kurzoru, když ještě nemáme žádné dočasné body */}
          {tempPoints.length === 0 && hoveredSegment.projectedPoint && (
            <line
              x1={polygonPoints[selectedVertexIndex].x}
              y1={polygonPoints[selectedVertexIndex].y}
              x2={hoveredSegment.projectedPoint.x}
              y2={hoveredSegment.projectedPoint.y}
              stroke="blue"
              strokeWidth={strokeWidth}
              strokeDasharray={`${4/zoom} ${4/zoom}`}
            />
          )}
        </g>
      )}
    </g>
  );
};

export default PointAddingVisualizer;
