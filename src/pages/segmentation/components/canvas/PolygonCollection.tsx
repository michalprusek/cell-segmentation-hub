
import React from 'react';
import { Polygon } from '@/lib/segmentation';
import CanvasPolygon from './CanvasPolygon';

interface PolygonCollectionProps {
  polygons: Polygon[];
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null };
  vertexDragState: { isDragging: boolean, polygonId: string | null, vertexIndex: number | null };
  zoom: number;
}

/**
 * Komponenta vykreslující kolekci polygonů
 */
const PolygonCollection = ({ 
  polygons, 
  selectedPolygonId, 
  hoveredVertex, 
  vertexDragState,
  zoom 
}: PolygonCollectionProps) => {
  return (
    <>
      {polygons.map(polygon => (
        <CanvasPolygon 
          key={polygon.id}
          id={polygon.id}
          points={polygon.points}
          isSelected={selectedPolygonId === polygon.id}
          hoveredVertex={hoveredVertex}
          vertexDragState={vertexDragState}
          zoom={zoom}
          type={polygon.type || 'external'}
        />
      ))}
    </>
  );
};

export default PolygonCollection;
