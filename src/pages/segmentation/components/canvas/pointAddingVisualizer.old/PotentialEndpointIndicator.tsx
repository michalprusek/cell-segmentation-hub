
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
 * Komponenta pro zobrazení potenciálních koncových bodů
 */
const PotentialEndpointIndicator = ({ 
  selectedVertexIndex, 
  polygonPoints, 
  hoveredSegment, 
  zoom 
}: PotentialEndpointIndicatorProps) => {
  if (selectedVertexIndex === null || !polygonPoints) {
    return null;
  }

  const pointRadius = getPointRadius(zoom);
  const strokeWidth = getStrokeWidth(zoom);
  const colors = getColors();

  return (
    <>
      {polygonPoints.map((point, index) => {
        // Nezobrazujeme počáteční bod znovu
        if (index === selectedVertexIndex) return null;
        
        // Zvýraznění bodu pod kurzorem
        const isHovered = hoveredSegment.segmentIndex === index;
        
        // Použijeme různé styly podle toho, zda je bod pod kurzorem nebo ne
        const fillColor = isHovered ? colors.hoverPoint.fill : colors.potentialEndpoint.fill;
        const strokeColor = isHovered ? colors.hoverPoint.stroke : colors.potentialEndpoint.stroke;
        
        return (
          <g key={`potential-endpoint-${index}`}>
            {/* Pulzující efekt pro bod pod kurzorem */}
            {isHovered && (
              <circle
                cx={point.x}
                cy={point.y}
                r={pointRadius * 1.8}
                fill={colors.hoverPoint.glowColor}
                className="animate-pulse"
                style={{ pointerEvents: 'none' }}
              />
            )}
            
            {/* Samotný bod */}
            <circle
              cx={point.x}
              cy={point.y}
              r={pointRadius * (isHovered ? 1.4 : 1.1)}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth * (isHovered ? 1.2 : 0.8)}
              style={{ pointerEvents: 'none' }}
            />
          </g>
        );
      })}
    </>
  );
};

export default PotentialEndpointIndicator;
