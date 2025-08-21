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
  isUndoRedoInProgress?: boolean;
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
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
    isUndoRedoInProgress = false,
    onDeleteVertex,
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
          const dragOffset = isDragging
            ? vertexDragState?.dragOffset
            : undefined;

          return (
            <VertexContextMenu
              key={`${polygonId}-vertex-${originalIndex}`}
              polygonId={polygonId}
              vertexIndex={originalIndex}
              onDelete={() => onDeleteVertex?.(polygonId, originalIndex)}
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
                  isUndoRedoInProgress={isUndoRedoInProgress}
                />
              </g>
            </VertexContextMenu>
          );
        })}
      </g>
    );
  },
  (prevProps, nextProps) => {
    // Return true if props are the same (don't re-render)
    // Return false if props are different (need to re-render)

    // Quick checks for basic props that change frequently
    if (
      prevProps.polygonId !== nextProps.polygonId ||
      prevProps.polygonType !== nextProps.polygonType ||
      prevProps.isSelected !== nextProps.isSelected ||
      prevProps.isHovered !== nextProps.isHovered ||
      prevProps.zoom !== nextProps.zoom ||
      prevProps.isUndoRedoInProgress !== nextProps.isUndoRedoInProgress
    ) {
      return false;
    }

    // Compare points array (deep comparison)
    if (prevProps.points !== nextProps.points) {
      if (prevProps.points.length !== nextProps.points.length) {
        return false;
      }
      for (let i = 0; i < prevProps.points.length; i++) {
        const prevPoint = prevProps.points[i];
        const nextPoint = nextProps.points[i];
        if (prevPoint.x !== nextPoint.x || prevPoint.y !== nextPoint.y) {
          return false;
        }
      }
    }

    // Compare viewport bounds
    const prevBounds = prevProps.viewportBounds;
    const nextBounds = nextProps.viewportBounds;
    if (prevBounds !== nextBounds) {
      if (!prevBounds || !nextBounds) {
        return false;
      }
      if (
        prevBounds.x !== nextBounds.x ||
        prevBounds.y !== nextBounds.y ||
        prevBounds.width !== nextBounds.width ||
        prevBounds.height !== nextBounds.height
      ) {
        return false;
      }
    }

    // Compare hovered vertex
    const prevHovered = prevProps.hoveredVertex;
    const nextHovered = nextProps.hoveredVertex;
    if (prevHovered !== nextHovered) {
      if (!prevHovered || !nextHovered) {
        return false;
      }
      if (
        prevHovered.polygonId !== nextHovered.polygonId ||
        prevHovered.vertexIndex !== nextHovered.vertexIndex
      ) {
        return false;
      }
    }

    // Compare vertex drag state
    const prevDrag = prevProps.vertexDragState;
    const nextDrag = nextProps.vertexDragState;
    if (prevDrag !== nextDrag) {
      if (!prevDrag || !nextDrag) {
        return false;
      }
      if (
        prevDrag.isDragging !== nextDrag.isDragging ||
        prevDrag.polygonId !== nextDrag.polygonId ||
        prevDrag.vertexIndex !== nextDrag.vertexIndex
      ) {
        return false;
      }

      // Compare drag offset
      const prevOffset = prevDrag.dragOffset;
      const nextOffset = nextDrag.dragOffset;
      if (prevOffset !== nextOffset) {
        if (!prevOffset || !nextOffset) {
          return false;
        }
        if (prevOffset.x !== nextOffset.x || prevOffset.y !== nextOffset.y) {
          return false;
        }
      }
    }

    // All props are the same
    return true;
  }
);

PolygonVertices.displayName = 'PolygonVertices';

export default PolygonVertices;
