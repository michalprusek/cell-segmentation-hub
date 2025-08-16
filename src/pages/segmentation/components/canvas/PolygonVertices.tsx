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
    // Determine if vertices should be rendered based on zoom and selection
    const shouldShowVertices = shouldRenderVertices(
      zoom,
      isSelected,
      isHovered
    );

    // Get decimated and viewport-culled vertices for better performance
    const visibleVertices = React.useMemo(() => {
      if (!shouldShowVertices || points.length === 0) {
        return [];
      }

      const decimated = getDecimatedVertices(points, zoom);

      // Return array with original indices for proper event handling
      let verticesWithIndices = decimated
        .map(point => {
          const originalIndex = points.findIndex(
            p => p.x === point.x && p.y === point.y
          );
          return { point, originalIndex };
        })
        .filter(item => item.originalIndex !== -1);

      // Apply viewport culling if bounds are provided
      if (viewportBounds) {
        const buffer = 50; // Buffer in pixels for smooth scrolling
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
    }, [shouldShowVertices, points, zoom, viewportBounds]);

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
        nextProps.vertexDragState?.vertexIndex
    );
  }
);

PolygonVertices.displayName = 'PolygonVertices';

export default PolygonVertices;
