import React from 'react';
import { Point } from '@/lib/segmentation';
import CanvasVertex from './CanvasVertex';
import VertexContextMenu from '../context-menu/VertexContextMenu';
import { VertexDragState } from '@/pages/segmentation/types';
import {
  shouldRenderVertices,
  getDecimatedVertices,
} from '@/lib/polygonOptimization';

interface PolygonVerticesProps {
  polygonId: string;
  points: Point[];
  polygonType: 'external' | 'internal';
  isSelected: boolean;
  isHovered: boolean;
  hoveredVertex: { polygonId: string | null; vertexIndex: number | null };
  vertexDragState: VertexDragState;
  zoom: number;
  viewportBounds?: { x: number; y: number; width: number; height: number };
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
  onDuplicateVertex?: (polygonId: string, vertexIndex: number) => void;
}

const PolygonVertices = React.memo(
  ({
    polygonId,
    points,
    polygonType,
    isSelected,
    isHovered,
    hoveredVertex,
    vertexDragState,
    zoom,
    viewportBounds,
    onDeleteVertex,
    onDuplicateVertex,
  }: PolygonVerticesProps) => {
    // Always show vertices for selected polygons to enable dragging
    const shouldShowVertices = isSelected;

    // Get all vertices without decimation or approximation
    const visibleVertices = React.useMemo(() => {
      if (!shouldShowVertices || points.length === 0) {
        return [];
      }

      // NO DECIMATION - Use all points directly
      // Map all points with their original indices
      let verticesWithIndices = points.map((point, index) => ({
        point,
        originalIndex: index,
      }));

      // Apply viewport culling if bounds are provided (keep this for performance)
      if (viewportBounds) {
        const buffer = 100; // Increased buffer for better visibility
        verticesWithIndices = verticesWithIndices.filter(({ point }) => {
          return (
            point.x >= viewportBounds.x - buffer &&
            point.x <= viewportBounds.x + viewportBounds.width + buffer &&
            point.y >= viewportBounds.y - buffer &&
            point.y <= viewportBounds.y + viewportBounds.height + buffer
          );
        });
      }

      return verticesWithIndices;
    }, [shouldShowVertices, points, viewportBounds]);

    if (
      !shouldShowVertices ||
      points.length === 0 ||
      visibleVertices.length === 0
    ) {
      return null;
    }

    return (
      <g className="polygon-vertices">
        {visibleVertices.map(({ point, originalIndex }) => {
          const isVertexHovered =
            hoveredVertex?.polygonId === polygonId &&
            hoveredVertex?.vertexIndex === originalIndex;
          const isDragging =
            vertexDragState?.isDragging &&
            vertexDragState?.polygonId === polygonId &&
            vertexDragState?.vertexIndex === originalIndex;
          const dragOffset = isDragging ? vertexDragState?.dragOffset : undefined;

          return (
            <VertexContextMenu
              key={`${polygonId}-vertex-${originalIndex}`}
              polygonId={polygonId}
              vertexIndex={originalIndex}
              onDelete={() => onDeleteVertex?.(polygonId, originalIndex)}
              onDuplicate={() => onDuplicateVertex?.(polygonId, originalIndex)}
            >
              <g>
                <CanvasVertex
                  point={point}
                  polygonId={polygonId}
                  vertexIndex={originalIndex}
                  isSelected={isSelected}
                  isHovered={isVertexHovered}
                  isDragging={isDragging}
                  dragOffset={dragOffset}
                  zoom={zoom}
                  type={polygonType}
                  isStartPoint={originalIndex === 0}
                />
              </g>
            </VertexContextMenu>
          );
        })}
      </g>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison for performance
    const shouldShowPrev = shouldRenderVertices(
      prevProps.zoom,
      prevProps.isSelected,
      prevProps.isHovered
    );
    const shouldShowNext = shouldRenderVertices(
      nextProps.zoom,
      nextProps.isSelected,
      nextProps.isHovered
    );

    // If visibility changed, re-render
    if (shouldShowPrev !== shouldShowNext) {
      return false;
    }

    // If not visible, skip detailed comparison
    if (!shouldShowNext) {
      return true;
    }

    // Compare viewport bounds
    const sameViewport =
      (!prevProps.viewportBounds && !nextProps.viewportBounds) ||
      (prevProps.viewportBounds &&
        nextProps.viewportBounds &&
        prevProps.viewportBounds.x === nextProps.viewportBounds.x &&
        prevProps.viewportBounds.y === nextProps.viewportBounds.y &&
        prevProps.viewportBounds.width === nextProps.viewportBounds.width &&
        prevProps.viewportBounds.height === nextProps.viewportBounds.height);

    // Check if drag offset changed
    const sameDragOffset = 
      (!prevProps.vertexDragState?.dragOffset && !nextProps.vertexDragState?.dragOffset) ||
      (prevProps.vertexDragState?.dragOffset && 
       nextProps.vertexDragState?.dragOffset &&
       prevProps.vertexDragState.dragOffset.x === nextProps.vertexDragState.dragOffset.x &&
       prevProps.vertexDragState.dragOffset.y === nextProps.vertexDragState.dragOffset.y);

    return (
      prevProps.polygonId === nextProps.polygonId &&
      prevProps.points.length === nextProps.points.length &&
      prevProps.polygonType === nextProps.polygonType &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isHovered === nextProps.isHovered &&
      prevProps.zoom === nextProps.zoom &&
      sameViewport &&
      prevProps.hoveredVertex?.polygonId ===
        nextProps.hoveredVertex?.polygonId &&
      prevProps.hoveredVertex?.vertexIndex ===
        nextProps.hoveredVertex?.vertexIndex &&
      prevProps.vertexDragState?.isDragging ===
        nextProps.vertexDragState?.isDragging &&
      prevProps.vertexDragState?.polygonId ===
        nextProps.vertexDragState?.polygonId &&
      prevProps.vertexDragState?.vertexIndex ===
        nextProps.vertexDragState?.vertexIndex &&
      sameDragOffset
    );
  }
);

PolygonVertices.displayName = 'PolygonVertices';

export default PolygonVertices;
