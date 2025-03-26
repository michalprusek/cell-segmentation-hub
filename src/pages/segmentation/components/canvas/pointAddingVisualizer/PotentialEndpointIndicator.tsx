
import React from 'react';
import { Point } from '@/lib/segmentation';
import { getPointRadius, getStrokeWidth, getColors } from './visualizationUtils';

interface PotentialEndpointIndicatorProps {
  selectedVertexIndex: number | null;
  polygonPoints: Point[] | null;
  hoveredSegment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  };
  zoom: number;
}

/**
 * Komponenta pro zobrazení potenciálních koncových bodů při přidávání nových bodů
 */
const PotentialEndpointIndicator = ({
  selectedVertexIndex,
  polygonPoints,
  hoveredSegment,
  zoom
}: PotentialEndpointIndicatorProps) => {
  // Pokud nemáme dostatek dat nebo pokud je kurzor nad již vybraným vrcholem, nic nekreslíme
  if (
    selectedVertexIndex === null || 
    !polygonPoints ||
    (hoveredSegment.segmentIndex === selectedVertexIndex)
  ) {
    return null;
  }

  const pointRadius = getPointRadius(zoom) * 1.3; // Mírně zvětšíme bod
  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();
  
  // Funkce pro zjištění, zda je bod potenciálním koncovým bodem
  const isPotentialEndpoint = (index: number) => {
    return index !== selectedVertexIndex;
  };

  return (
    <g>
      {/* Potenciální koncové body */}
      {polygonPoints.map((point, index) => (
        isPotentialEndpoint(index) && (
          <circle
            key={`endpoint-${index}`}
            cx={point.x}
            cy={point.y}
            r={pointRadius}
            fill={colors.endPoint.fill}
            stroke={colors.endPoint.stroke}
            strokeWidth={strokeWidth}
            style={{ pointerEvents: 'none' }}
            className={index === hoveredSegment.segmentIndex ? "animate-pulse" : ""}
          />
        )
      ))}
      
      {/* Zvýraznění bodu nad kterým je kurzor */}
      {hoveredSegment.segmentIndex !== null && 
       hoveredSegment.segmentIndex !== selectedVertexIndex && 
       hoveredSegment.projectedPoint && (
        <circle
          cx={hoveredSegment.projectedPoint.x}
          cy={hoveredSegment.projectedPoint.y}
          r={pointRadius * 1.5}
          fill="transparent"
          stroke={colors.hoverPoint.stroke}
          strokeWidth={strokeWidth * 1.5}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  );
};

export default PotentialEndpointIndicator;
