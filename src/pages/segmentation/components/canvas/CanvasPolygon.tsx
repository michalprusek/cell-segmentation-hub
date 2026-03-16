import React, { useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Polygon, Point } from '@/lib/segmentation';
import PolygonVertices from './PolygonVertices';
import PolygonContextMenu from '../context-menu/PolygonContextMenu';
import { VertexDragState, EditMode } from '@/pages/segmentation/types';
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
  onChangePartClass?: (polygonId: string, partClass: 'head' | 'midpiece' | 'tail') => void;
  onChangeInstanceId?: (polygonId: string, instanceId: string) => void;
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
  onDuplicateVertex?: (polygonId: string, vertexIndex: number) => void;
  onHover?: (polygonId: string | null) => void;
  editMode?: EditMode;
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
    onChangePartClass,
    onChangeInstanceId,
    onDeleteVertex,
    onDuplicateVertex,
    onHover,
    editMode,
  }: CanvasPolygonProps) => {
    const { id, points, type = 'external', parent_id } = polygon;

    // Calculate bounding box for viewport culling (cached)
    const boundingBox = useMemo(() => calculateBoundingBox(points), [points]);

    // Determine if this is a polyline (open path)
    const isPolyline = polygon.geometry === 'polyline';

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

      // Polylines need at least 2 points, polygons need at least 3
      const minPoints = isPolyline ? 2 : 3;
      return filtered.length >= minPoints ? filtered : [];
    }, [points, isPolyline]);

    // Generate SVG path string from valid points (no simplification)
    // Apply drag offset to the dragged vertex
    const pathString = useMemo(() => {
      const minPoints = isPolyline ? 2 : 3;
      if (!validPoints || validPoints.length < minPoints) {
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

      // Polylines: open path (no Z). Polygons: closed path (Z).
      const path = `M${pointsToRender.map(p => `${p.x},${p.y}`).join(' L')}${isPolyline ? '' : ' Z'}`;
      return path;
    }, [validPoints, vertexDragState, id, isPolyline]);

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

    // Determine if polygon is internal based on parent_id or type
    const isInternal = parent_id || type === 'internal';

    // Determine path color based on polygon type, polyline partClass, and selection status
    const getPathColor = () => {
      if (isPolyline) {
        // Part-class-based colors for sperm polylines
        switch (polygon.partClass) {
          case 'head':
            return isSelected ? '#16a34a' : '#22c55e'; // green
          case 'midpiece':
            return isSelected ? '#d97706' : '#f59e0b'; // orange
          case 'tail':
            return isSelected ? '#0891b2' : '#06b6d4'; // cyan
          default:
            return isSelected ? '#9333ea' : '#a855f7'; // purple (unclassified polyline)
        }
      }
      if (isInternal) {
        return isSelected ? '#0b84da' : '#0ea5e9';
      } else {
        return isSelected ? '#e11d48' : '#ef4444';
      }
    };

    const pathColor = getPathColor();

    // Memoized click handlers
    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
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
    const handleChangePartClass = useCallback(
      (partClass: 'head' | 'midpiece' | 'tail') => onChangePartClass?.(id, partClass),
      [onChangePartClass, id]
    );
    const handleChangeInstanceId = useCallback(
      (instanceId: string) => onChangeInstanceId?.(id, instanceId),
      [onChangeInstanceId, id]
    );
    const handleMouseEnter = useCallback(() => onHover?.(id), [onHover, id]);
    const handleMouseLeave = useCallback(() => onHover?.(null), [onHover]);

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
        isPolyline={isPolyline}
        onChangePartClass={isPolyline ? handleChangePartClass : undefined}
        onChangeInstanceId={isPolyline ? handleChangeInstanceId : undefined}
        currentInstanceId={isPolyline ? polygon.instanceId : undefined}
      >
        <g
          data-testid={id}
          className={cn('polygon-group', isInternal ? 'internal' : 'external')}
          tabIndex={0}
          role="button"
          aria-label={`Polygon ${id} - ${type} polygon with ${points.length} vertices`}
          onKeyDown={handleKeyDown}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{ outline: 'none' }}
        >
          {/* Polygon/Polyline path - render even if path is empty for testing */}
          <path
            d={pathString || 'M0,0'}
            className={cn(
              'polygon-path cursor-pointer transition-colors',
              isPolyline ? 'polyline-path' : isInternal ? 'polygon-internal' : 'polygon-external',
              isSelected && 'polygon-selected'
            )}
            fill={
              isPolyline
                ? 'none'
                : isInternal
                  ? 'rgba(14, 165, 233, 0.1)'
                  : 'rgba(239, 68, 68, 0.1)'
            }
            stroke={pathColor}
            strokeWidth={Math.max(
              isPolyline
                ? strokeWidth * (isHovered ? 2.5 : 1.5)
                : strokeWidth * (isHovered ? 1.3 : 1),
              0.5
            )}
            strokeOpacity={pathString ? (isHovered && !isSelected ? 0.85 : 1) : 0}
            strokeLinecap="round"
            strokeLinejoin="round"
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            filter={
              isSelected && !isPolyline
                ? `url(#${type === 'internal' ? 'blue' : 'red'}-glow)`
                : isPolyline && (isSelected || isHovered)
                  ? 'url(#blue-glow)'
                  : ''
            }
            vectorEffect="non-scaling-stroke"
            shapeRendering="geometricPrecision"
            pointerEvents={isPolyline ? 'stroke' : 'all'}
          />

          {/* Polyline endpoint markers (small circles at start and end) */}
          {isPolyline && validPoints.length >= 2 && (
            <>
              <circle
                cx={validPoints[0].x}
                cy={validPoints[0].y}
                r={Math.max(3 / zoom, 1.5)}
                fill={pathColor}
                stroke="white"
                strokeWidth={Math.max(1 / zoom, 0.3)}
                opacity={0.9}
                pointerEvents="none"
              />
              <circle
                cx={validPoints[validPoints.length - 1].x}
                cy={validPoints[validPoints.length - 1].y}
                r={Math.max(3 / zoom, 1.5)}
                fill={pathColor}
                stroke="white"
                strokeWidth={Math.max(1 / zoom, 0.3)}
                opacity={0.9}
                pointerEvents="none"
              />
            </>
          )}

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
              editMode={editMode}
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
      prevProps.polygon.geometry === nextProps.polygon.geometry &&
      prevProps.polygon.partClass === nextProps.polygon.partClass &&
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
      sameDragOffset &&
      prevProps.onChangePartClass === nextProps.onChangePartClass
    );
  }
);

CanvasPolygon.displayName = 'CanvasPolygon';

export default CanvasPolygon;
