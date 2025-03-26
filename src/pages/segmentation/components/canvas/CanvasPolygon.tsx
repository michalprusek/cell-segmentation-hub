
import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Polygon, Point } from '@/lib/segmentation';
import CanvasVertex from './CanvasVertex';
import PolygonContextMenu from '../context-menu/PolygonContextMenu';
import VertexContextMenu from '../context-menu/VertexContextMenu';

interface CanvasPolygonProps {
  polygon: Polygon;
  isSelected: boolean;
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null };
  vertexDragState: {
    isDragging: boolean;
    polygonId: string | null;
    vertexIndex: number | null;
  };
  zoom: number;
  onSelectPolygon?: (id: string) => void;
  onDeletePolygon?: (id: string) => void;
  onSlicePolygon?: (id: string) => void;
  onEditPolygon?: (id: string) => void;
  onDuplicatePolygon?: (id: string) => void;
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
  onDuplicateVertex?: (polygonId: string, vertexIndex: number) => void;
}

const CanvasPolygon = ({
  polygon,
  isSelected,
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
}: CanvasPolygonProps) => {
  const { id, points, type = 'external' } = polygon;
  
  // Simplified string path for the polygon
  const pathString = useMemo(() => {
    if (!points || points.length < 3) return '';
    return `M${points.map(p => `${p.x},${p.y}`).join(' L')} Z`;
  }, [points]);
  
  // For the path stroke width, we need to adjust based on zoom level
  // When zoomed in, the stroke appears thicker so we need to make it thinner
  const getStrokeWidth = () => {
    if (zoom > 4) {
      return 1.5/zoom;
    } else if (zoom > 3) {
      return 2/zoom;
    } else if (zoom < 0.5) {
      // Make lines thinner at low zoom (specifically 40%)
      return 2/zoom; 
    } else if (zoom < 0.7) {
      return 2.2/zoom;
    } else {
      return 2/zoom;
    }
  };
  
  const strokeWidth = getStrokeWidth();
  
  // Determine path color based on polygon type and selection status
  const getPathColor = () => {
    if (type === 'internal') {
      return isSelected ? '#0b84da' : '#0ea5e9';
    } else {
      return isSelected ? '#e11d48' : '#ef4444';
    }
  };
  
  const pathColor = getPathColor();
  
  // Handle polygon click
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelectPolygon) {
      onSelectPolygon(id);
    }
  };

  return (
    <PolygonContextMenu
      polygonId={id}
      onDelete={() => onDeletePolygon?.(id)}
      onSlice={() => onSlicePolygon?.(id)}
      onEdit={() => onEditPolygon?.(id)}
      onDuplicate={onDuplicatePolygon ? () => onDuplicatePolygon(id) : undefined}
    >
      <g>
        {/* Polygon path */}
        <path
          d={pathString}
          fill={type === 'internal' ? "rgba(14, 165, 233, 0.15)" : "rgba(239, 68, 68, 0.15)"}
          stroke={pathColor}
          strokeWidth={strokeWidth}
          className={cn(
            "cursor-pointer transition-colors",
            isSelected ? "filter-glow" : ""
          )}
          onClick={handleClick}
          filter={isSelected ? `url(#${type === 'internal' ? 'blue' : 'red'}-glow)` : ""}
          vectorEffect="non-scaling-stroke"
          shapeRendering="geometricPrecision"
          style={{ imageRendering: "crisp-edges" }}
        />
        
        {/* Render vertices for all polygons, not just selected ones */}
        {points.map((point, index) => {
          const isHovered = hoveredVertex.polygonId === id && hoveredVertex.vertexIndex === index;
          const isDragging = vertexDragState.isDragging && 
                            vertexDragState.polygonId === id && 
                            vertexDragState.vertexIndex === index;
          const isStartPoint = index === 0 && isSelected; // Only highlight start point when selected
          
          return (
            <VertexContextMenu
              key={`${id}-vertex-${index}`}
              polygonId={id}
              vertexIndex={index}
              onDelete={() => onDeleteVertex?.(id, index)}
              onDuplicate={() => onDuplicateVertex?.(id, index)}
            >
              <g>
                <CanvasVertex
                  point={point}
                  polygonId={id}
                  vertexIndex={index}
                  isSelected={isSelected}
                  isHovered={isHovered}
                  isDragging={isDragging}
                  zoom={zoom}
                  type={type}
                  isStartPoint={isStartPoint}
                />
              </g>
            </VertexContextMenu>
          );
        })}
      </g>
    </PolygonContextMenu>
  );
};

export default CanvasPolygon;
