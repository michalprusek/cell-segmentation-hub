import React from 'react';
import { SegmentationResult, Polygon } from '@/lib/segmentation';
import CanvasPolygon from './CanvasPolygon';
import { VertexDragState } from '@/pages/segmentation/types';

interface PolygonCollectionProps {
  polygons: Polygon[];
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null };
  vertexDragState: VertexDragState;
  zoom: number;
  onSelectPolygon?: (id: string) => void;
  onDeletePolygon?: (id: string) => void;
  onSlicePolygon?: (id: string) => void;
  onEditPolygon?: (id: string) => void;
  onDuplicatePolygon?: (id: string) => void;
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
  onDuplicateVertex?: (polygonId: string, vertexIndex: number) => void;
}

const PolygonCollection = ({
  polygons,
  selectedPolygonId,
  hoveredVertex,
  vertexDragState,
  zoom,
  onSelectPolygon,
  onDeletePolygon,
  onSlicePolygon,
  onEditPolygon,
  onDuplicatePolygon,
  onDeleteVertex,
  onDuplicateVertex
}: PolygonCollectionProps) => {
  // Ensure internal polygons are rendered on top of external ones
  const sortedPolygons = [...polygons].sort((a, b) => {
    // Selected polygon always on top
    if (a.id === selectedPolygonId) return 1;
    if (b.id === selectedPolygonId) return -1;
    
    // Otherwise, internal polygons on top
    if (a.type === 'internal' && b.type !== 'internal') return 1;
    if (a.type !== 'internal' && b.type === 'internal') return -1;
    
    return 0;
  });

  return (
    <g>
      {sortedPolygons.map(polygon => (
        <CanvasPolygon
          key={polygon.id}
          polygon={polygon}
          isSelected={polygon.id === selectedPolygonId}
          hoveredVertex={hoveredVertex}
          vertexDragState={vertexDragState}
          zoom={zoom}
          onSelectPolygon={onSelectPolygon}
          onDeletePolygon={onDeletePolygon}
          onSlicePolygon={onSlicePolygon}
          onEditPolygon={onEditPolygon}
          onDuplicatePolygon={onDuplicatePolygon}
          onDeleteVertex={onDeleteVertex}
          onDuplicateVertex={onDuplicateVertex}
        />
      ))}
    </g>
  );
};

export default PolygonCollection;
