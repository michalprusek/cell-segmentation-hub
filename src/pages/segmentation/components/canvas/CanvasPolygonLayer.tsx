
import React from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import CanvasSvgFilters from './CanvasSvgFilters';
import CanvasPolygon from './CanvasPolygon';

interface CanvasPolygonLayerProps {
  segmentation: SegmentationResult;
  imageSize: { width: number, height: number };
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null };
  vertexDragState: React.MutableRefObject<{
    isDragging: boolean;
    polygonId: string | null;
    vertexIndex: number | null;
  }>;
  zoom: number;
}

const CanvasPolygonLayer = ({ 
  segmentation, 
  imageSize, 
  selectedPolygonId, 
  hoveredVertex, 
  vertexDragState,
  zoom 
}: CanvasPolygonLayerProps) => {
  if (!segmentation || imageSize.width <= 0) return null;
  
  return (
    <svg 
      width={imageSize.width}
      height={imageSize.height}
      className="absolute top-0 left-0"
      style={{ maxWidth: "none" }}
    >
      <CanvasSvgFilters />
      
      {segmentation.polygons.map(polygon => (
        <CanvasPolygon 
          key={polygon.id}
          id={polygon.id}
          points={polygon.points}
          isSelected={selectedPolygonId === polygon.id}
          hoveredVertex={hoveredVertex}
          vertexDragState={vertexDragState.current}
          zoom={zoom}
        />
      ))}
    </svg>
  );
};

export default CanvasPolygonLayer;
