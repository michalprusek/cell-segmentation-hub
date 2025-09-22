import React, { useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Polygon, Point } from '@/lib/segmentation';
import PolygonVertices from './PolygonVertices';
import PolygonContextMenu from '../context-menu/PolygonContextMenu';
import { VertexDragState } from '@/pages/segmentation/types';
import { calculateBoundingBox } from '@/lib/polygonGeometry';

interface CanvasPolygonProps {
  polygon: Polygon;
  isSelected: boolean;
  hoveredVertex?: { polygonId: string | null; vertexIndex: number | null };
  vertexDragState?: VertexDragState;
  zoom: number;
  viewportBounds?: { x: number; y: number; width: number; height: number };
  hideVertices?: boolean;
  isHovered?: boolean;
  isUndoRedoInProgress?: boolean;
  onSelectPolygon?: (id: string) => void;
  onDeletePolygon?: (id: string) => void;
  onSlicePolygon?: (id: string) => void;
  onEditPolygon?: (id: string) => void;
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
  onDuplicateVertex?: (polygonId: string, vertexIndex: number) => void;
}

const CanvasPolygon = React.memo(
  ({
    polygon,
    isSelected,
    hoveredVertex,
    vertexDragState,
    zoom,
    viewportBounds,
    hideVertices = false,
    isHovered = false,
    isUndoRedoInProgress = false,
    onSelectPolygon,
    onDeletePolygon,
    onSlicePolygon,
    onEditPolygon,
    onDeleteVertex,
    onDuplicateVertex,
  }: CanvasPolygonProps) => {
    const { id, points, type = 'external' } = polygon;

    // Calculate bounding box for viewport culling (cached)
    const boundingBox = useMemo(() => calculateBoundingBox(points), [points]);

    // Validate points without simplification to preserve full polygon detail
    const validPoints = useMemo(() => {
      if (!points) return [];

      // First filter out invalid points
      const filtered = points.filter(
        p =>
          p &&
          typeof p.x === 'number' &&
          typeof p.y === 'number' &&
          !isNaN(p.x) &&
          !isNaN(p.y)
      );

      // Return filtered points only if we have enough for a valid polygon
      return filtered.length >= 3 ? filtered : [];
    }, [points]);

    // Generate SVG path string from valid points (no simplification)
    // Apply drag offset to the dragged vertex
    const pathString = useMemo(() => {
      if (!validPoints || validPoints.length < 3) {
        return '';
      }

      // If we're dragging a vertex from this polygon, apply the offset
      let pointsToRender = validPoints;
      if (
        vertexDragState?.isDragging &&
        vertexDragState.polygonId === id &&
        vertexDragState.vertexIndex !== null &&
        vertexDragState.dragOffset
      ) {
        pointsToRender = validPoints.map((p, index) => {
          if (index === vertexDragState.vertexIndex) {
            return {
              x: p.x + vertexDragState.dragOffset.x,
              y: p.y + vertexDragState.dragOffset.y,
            };
          }
          return p;
        });
      }

      const path = `M${pointsToRender.map(p => `${p.x},${p.y}`).join(' L')} Z`;
      return path;
    }, [validPoints, vertexDragState, id]);

    // For the path stroke width, we need to adjust based on zoom level
    // When zoomed in, the stroke appears thicker so we need to make it thinner
    const getStrokeWidth = () => {
      if (zoom > 4) {
        return 1.5 / zoom;
      } else if (zoom > 3) {
        return 2 / zoom;
      } else if (zoom < 0.5) {
        // Make lines thinner at low zoom (specifically 40%)
        return 0.8 / zoom;
      } else if (zoom < 0.7) {
        return 1.2 / zoom;
      } else {
        return 2 / zoom;
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

    // Memoized click handlers
    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        // Check if the click target is a vertex element
        const target = e.target as SVGElement;
        const isVertexClick =
          target &&
          (target.dataset.polygonId ||
            target.tagName === 'circle' ||
            target.closest('circle'));

        // Don't handle polygon selection if clicking on a vertex
        if (isVertexClick) {
          console.log('🔘 Ignoring polygon click - vertex detected');
          return;
        }

        e.stopPropagation();
        console.log('🔘 Polygon click:', { id, target: e.target });
        if (onSelectPolygon) {
          onSelectPolygon(id);
        }
      },
      [onSelectPolygon, id]
    );

    const handleDelete = useCallback(
      () => onDeletePolygon?.(id),
      [onDeletePolygon, id]
    );
    const handleSlice = useCallback(
      () => onSlicePolygon?.(id),
      [onSlicePolygon, id]
    );
    const handleEdit = useCallback(
      () => onEditPolygon?.(id),
      [onEditPolygon, id]
    );

    const handleDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onEditPolygon) {
          onEditPolygon(id);
        }
      },
      [onEditPolygon, id]
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && onSelectPolygon) {
          e.stopPropagation();
          onSelectPolygon(id);
        }
      },
      [onSelectPolygon, id]
    );

    return (
      <PolygonContextMenu
        polygonId={id}
        onDelete={handleDelete}
        onSlice={handleSlice}
        onEdit={handleEdit}
      >
        <g
          data-testid={id}
          className={cn(
            'polygon-group',
            type === 'internal' ? 'internal' : 'external'
          )}
          tabIndex={0}
          role="button"
          aria-label={`Polygon ${id} - ${type} polygon with ${points.length} vertices`}
          onKeyDown={handleKeyDown}
          style={{ outline: 'none' }}
        >
          {/* Polygon path - render even if path is empty for testing */}
          <path
            d={pathString || 'M0,0'}
            className={cn(
              'polygon-path cursor-pointer transition-colors',
              type === 'internal' ? 'polygon-internal' : 'polygon-external',
              isSelected && 'polygon-selected'
            )}
            fill={
              type === 'internal'
                ? 'rgba(14, 165, 233, 0.1)'
                : 'rgba(239, 68, 68, 0.1)'
            }
            stroke={pathColor}
            strokeWidth={Math.max(strokeWidth, 0.5)}
            strokeOpacity={pathString ? 1 : 0}
            strokeLinecap="round"
            strokeLinejoin="round"
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            filter={
              isSelected
                ? `url(#${type === 'internal' ? 'blue' : 'red'}-glow)`
                : ''
            }
            vectorEffect="non-scaling-stroke"
            shapeRendering="geometricPrecision"
            pointerEvents="all"
          />

          {/* Render vertices using separate component for performance */}
          {!hideVertices && (
            <PolygonVertices
              key={`vertices-${id}-${points.length}`}
              polygonId={id}
              points={points}
              polygonType={type}
              isSelected={isSelected}
              isHovered={isHovered}
              hoveredVertex={hoveredVertex}
              vertexDragState={vertexDragState}
              zoom={zoom}
              viewportBounds={viewportBounds}
              isUndoRedoInProgress={isUndoRedoInProgress}
              onDeleteVertex={onDeleteVertex}
              onDuplicateVertex={onDuplicateVertex}
            />
          )}
        </g>
      </PolygonContextMenu>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison function for React.memo optimization
    const sameViewport = prevProps.viewportBounds === nextProps.viewportBounds;

    // Check if polygon points content has changed (not just length)
    const samePoints =
      prevProps.polygon.points === nextProps.polygon.points ||
      (prevProps.polygon.points.length === nextProps.polygon.points.length &&
        prevProps.polygon.points.every((point, index) => {
          const nextPoint = nextProps.polygon.points[index];
          return point.x === nextPoint.x && point.y === nextPoint.y;
        }));

    // Check if drag offset changed
    const sameDragOffset =
      (!prevProps.vertexDragState?.dragOffset &&
        !nextProps.vertexDragState?.dragOffset) ||
      (prevProps.vertexDragState?.dragOffset &&
        nextProps.vertexDragState?.dragOffset &&
        prevProps.vertexDragState.dragOffset.x ===
          nextProps.vertexDragState.dragOffset.x &&
        prevProps.vertexDragState.dragOffset.y ===
          nextProps.vertexDragState.dragOffset.y);

    return (
      prevProps.polygon.id === nextProps.polygon.id &&
      samePoints &&
      prevProps.polygon.type === nextProps.polygon.type &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isHovered === nextProps.isHovered &&
      prevProps.isUndoRedoInProgress === nextProps.isUndoRedoInProgress &&
      prevProps.zoom === nextProps.zoom &&
      prevProps.hideVertices === nextProps.hideVertices &&
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

CanvasPolygon.displayName = 'CanvasPolygon';

export default CanvasPolygon;
