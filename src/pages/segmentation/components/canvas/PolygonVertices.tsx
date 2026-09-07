import React from 'react';
import { Point } from '@/lib/segmentation';
import CanvasVertex from './CanvasVertex';
import VertexContextMenu from '../context-menu/VertexContextMenu';
import { VertexDragState, EditMode } from '@/pages/segmentation/types';

interface PolygonVerticesProps {
  polygonId: string;
  points: Point[];
  polygonType: 'external' | 'internal';
  isSelected: boolean;
  /** Shift+click multi-selection: show the same vertex dots as a single
   *  selection so the user can see every point of each selected microtubule. */
  isMultiSelected?: boolean;
  isHovered: boolean;
  hoveredVertex: { polygonId: string | null; vertexIndex: number | null };
  vertexDragState: VertexDragState;
  zoom: number;
  viewportBounds?: { x: number; y: number; width: number; height: number };
  isUndoRedoInProgress?: boolean;
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
  editMode?: EditMode;
  /** True while the wheel is actively zooming. Comparator-only —
   *  not read at render time; suppresses zoom-driven re-renders. */
  isZooming?: boolean;
}

interface VertexWithMenuProps {
  polygonId: string;
  vertexIndex: number;
  point: Point;
  polygonType: 'external' | 'internal';
  isSelected: boolean;
  isHovered: boolean;
  isDragging: boolean;
  dragOffset?: { x: number; y: number };
  zoom: number;
  isStartPoint: boolean;
  isUndoRedoInProgress: boolean;
  isInAddPointsMode: boolean;
  isInMoveShapeMode: boolean;
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
}

/**
 * One vertex plus its right-click menu, behind a memo boundary.
 *
 * This boundary is the whole point of the component. `PolygonVertices`
 * re-renders on every frame of a drag (the drag offset changes), and it used
 * to build a `<VertexContextMenu>` element per vertex inline, each with a
 * freshly-allocated `onDelete` arrow. Every one of those re-rendered a full
 * Radix `<ContextMenu>` tree — provider + `ContextMenuTrigger asChild` +
 * `ContextMenuContent` — so a 4000-point microtubule polyline paid 4000 menu
 * re-renders per pointer move to move ONE point. That, not the geometry, is
 * what made dragging feel like it skipped.
 *
 * The boundary has to sit ABOVE the element creation: memoizing
 * `VertexContextMenu` itself achieves nothing, because its `children` is a
 * fresh React element on every render of whoever builds it, so the comparison
 * can never bail out. Here every prop is a primitive, a value-stable object
 * (`point` is the polygon's own point object; `dragOffset` is `undefined`
 * except on the vertex actually being dragged) or an identity-stable callback
 * (`onDeleteVertex` is a `useCallback(..., [])` in `usePolygonHandlers`), so
 * the DEFAULT shallow comparison is both sufficient and complete by
 * construction — no hand-written comparator to forget a prop in, which is a
 * recurring bug in this file's neighbourhood.
 */
const VertexWithMenu = React.memo(function VertexWithMenu({
  polygonId,
  vertexIndex,
  point,
  polygonType,
  isSelected,
  isHovered,
  isDragging,
  dragOffset,
  zoom,
  isStartPoint,
  isUndoRedoInProgress,
  isInAddPointsMode,
  isInMoveShapeMode,
  onDeleteVertex,
}: VertexWithMenuProps) {
  const handleDelete = React.useCallback(
    () => onDeleteVertex?.(polygonId, vertexIndex),
    [onDeleteVertex, polygonId, vertexIndex]
  );

  return (
    <VertexContextMenu
      polygonId={polygonId}
      vertexIndex={vertexIndex}
      onDelete={handleDelete}
    >
      <g>
        <CanvasVertex
          point={point}
          polygonId={polygonId}
          vertexIndex={vertexIndex}
          isSelected={isSelected}
          isHovered={isHovered}
          isDragging={isDragging}
          dragOffset={dragOffset}
          zoom={zoom}
          type={polygonType}
          isStartPoint={isStartPoint}
          isUndoRedoInProgress={isUndoRedoInProgress}
          isInAddPointsMode={isInAddPointsMode}
          isInMoveShapeMode={isInMoveShapeMode}
        />
      </g>
    </VertexContextMenu>
  );
});

const PolygonVertices = React.memo(
  ({
    polygonId,
    points,
    polygonType,
    isSelected,
    isMultiSelected = false,
    isHovered: _isHovered,
    hoveredVertex,
    vertexDragState,
    zoom,
    viewportBounds,
    isUndoRedoInProgress = false,
    onDeleteVertex,
    editMode,
  }: PolygonVerticesProps) => {
    // Show vertices for the single-selected polygon (to enable dragging) and
    // for every Shift+click multi-selected microtubule (so all selected MTs
    // display their individual points, like a single selection).
    const shouldShowVertices = isSelected || isMultiSelected;

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

      // Drop non-finite vertices. CanvasPolygon filters these out of the PATH
      // (validPoints) but hands us the RAW points, so without this a NaN or
      // ±Infinity coordinate reached the DOM as <circle cx="NaN"> — an invalid
      // SVG attribute, so the browser drops the handle and the vertex becomes
      // ungrabbable. Filtering here rather than upstream keeps `originalIndex`
      // aligned with the polygon's real points array, which is what
      // onDeleteVertex / onDuplicateVertex index into.
      verticesWithIndices = verticesWithIndices.filter(
        ({ point }) =>
          point && Number.isFinite(point.x) && Number.isFinite(point.y)
      );

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
          // A whole-shape translate carries every vertex with the outline;
          // without this the dots stay behind and the preview reads as if the
          // drag were not working.
          const onThisShape =
            vertexDragState?.isDragging &&
            vertexDragState?.polygonId === polygonId;
          const translating =
            onThisShape && vertexDragState?.mode === 'translate';
          const isDragging =
            (onThisShape && vertexDragState?.vertexIndex === originalIndex) ||
            !!translating;
          const dragOffset = isDragging
            ? vertexDragState?.dragOffset
            : undefined;

          return (
            <VertexWithMenu
              key={`${polygonId}-vertex-${originalIndex}`}
              polygonId={polygonId}
              vertexIndex={originalIndex}
              point={point}
              polygonType={polygonType}
              isSelected={isSelected || isMultiSelected}
              isHovered={isVertexHovered}
              isDragging={isDragging}
              dragOffset={dragOffset}
              zoom={zoom}
              isStartPoint={originalIndex === 0}
              isUndoRedoInProgress={isUndoRedoInProgress}
              isInAddPointsMode={editMode === EditMode.AddPoints}
              isInMoveShapeMode={editMode === EditMode.MoveShape}
              onDeleteVertex={onDeleteVertex}
            />
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
      prevProps.isMultiSelected !== nextProps.isMultiSelected ||
      prevProps.isHovered !== nextProps.isHovered ||
      prevProps.isUndoRedoInProgress !== nextProps.isUndoRedoInProgress ||
      // onDeleteVertex backs the per-vertex context menu and editMode gates
      // which vertex interactions are live; omitting them kept stale closures
      // (the documented memo-comparator footgun). onDeleteVertex is now
      // identity-stable so this comparison is effectively free.
      prevProps.onDeleteVertex !== nextProps.onDeleteVertex ||
      prevProps.editMode !== nextProps.editMode
    ) {
      return false;
    }
    // Skip zoom-only re-render while the wheel is active (see CanvasPolygon).
    if (prevProps.zoom !== nextProps.zoom && !nextProps.isZooming) {
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
