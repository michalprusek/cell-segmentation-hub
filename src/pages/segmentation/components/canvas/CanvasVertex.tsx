import React from 'react';
import { Point } from '@/lib/segmentation';
import {
  VERTEX_STROKE_PX,
  dotRadiusStyle,
  screenPx,
  vertexRadiusPx,
} from '../../utils/overlayScale';

interface CanvasVertexProps {
  point: Point;
  polygonId: string;
  vertexIndex: number;
  isSelected: boolean;
  isHovered: boolean;
  isDragging: boolean;
  dragOffset?: { x: number; y: number };
  type?: 'external' | 'internal';
  isStartPoint?: boolean;
  isUndoRedoInProgress?: boolean;
  isInAddPointsMode?: boolean;
  /** MoveShape is armed. A press on a vertex then translates the whole shape
   *  (the vertex branch of `handleMouseDown` is gated to EditVertices), so
   *  `grab` would advertise a per-point drag that this mode does not have. */
  isInMoveShapeMode?: boolean;
}

const CanvasVertex = React.memo<CanvasVertexProps>(
  ({
    point,
    polygonId,
    vertexIndex,
    isSelected,
    isHovered,
    isDragging,
    dragOffset,
    type = 'external',
    isStartPoint = false,
    isUndoRedoInProgress = false,
    isInAddPointsMode = false,
    isInMoveShapeMode = false,
  }) => {
    // Radius in SCREEN pixels for this interaction state. It reaches the DOM
    // as a CSS `r` (class `overlay-dot`) on the overlay's inverse-zoom property, so the handle is
    // the same size at every zoom and this component takes no `zoom` prop —
    // a zoom step re-renders no vertex. (The old `5 / zoom^0.85` attribute
    // grew the dot from 5 px at zoom 1 to 7 px at zoom 10, and was stale for
    // the whole wheel gesture.)
    const radiusPx = vertexRadiusPx(isHovered, isDragging, isStartPoint);

    // Color scheme - unchanged from original
    const fillColor =
      type === 'internal'
        ? isDragging
          ? '#0077cc'
          : isHovered
            ? '#3498db'
            : '#0EA5E9'
        : isDragging
          ? '#c0392b'
          : isHovered
            ? '#e74c3c'
            : '#ea384c';

    const strokeColor = '#ffffff';
    const opacity = isSelected ? 1 : 0.8;

    // Calculate actual position with drag offset
    const actualX = isDragging && dragOffset ? point.x + dragOffset.x : point.x;
    const actualY = isDragging && dragOffset ? point.y + dragOffset.y : point.y;

    // Event handlers to ensure events are captured
    const handleMouseDown = React.useCallback(
      (e: React.MouseEvent) => {
        // Allow Shift+Click to bubble up for mode switching
        if (e.shiftKey) {
          // Don't stop propagation for Shift+Click
          // This allows the parent handler to switch to AddPoints mode
          return;
        }
        // Allow clicks in AddPoints mode to bubble up for sequence completion
        if (isInAddPointsMode) {
          // Don't stop propagation in AddPoints mode
          // This allows clicking on vertices to complete the sequence
          return;
        }
        // CRITICAL FIX: Don't stop propagation for regular clicks either!
        // The event needs to bubble up to the canvas for vertex dragging to work.
        // The canvas handler will check if we clicked on a vertex via dataset attributes
        // and will handle the dragging logic there.
        // Removing stopPropagation() allows proper event delegation.

        // Let the event bubble up with data attributes intact
      },
      [isInAddPointsMode]
    );

    return (
      <circle
        cx={actualX}
        cy={actualY}
        className="overlay-dot"
        fill={fillColor}
        stroke={strokeColor}
        opacity={opacity}
        data-testid={`vertex-${vertexIndex}-${polygonId}`}
        data-polygon-id={polygonId}
        data-vertex-index={vertexIndex}
        onMouseDown={handleMouseDown}
        style={{
          ...dotRadiusStyle(radiusPx),
          strokeWidth: screenPx(VERTEX_STROKE_PX),
          cursor: isInMoveShapeMode ? 'move' : isDragging ? 'grabbing' : 'grab',
          // POSITION IS NEVER TRANSITIONED. `cx`/`cy` are SVG2 geometry
          // properties and therefore animatable, so the old `all 0.15s
          // ease-out` made a vertex GLIDE to its committed position on drop
          // instead of being there. Gating that on `isDragging` cannot help:
          // the drop is precisely the commit where `isDragging` goes back to
          // false and the point moves, so the animation ran on every single
          // release and read as lag on top of whatever the drag itself cost.
          // Naming the properties leaves the hover feedback (colour) eased and
          // the geometry instant; the drag and undo/redo cases keep easing
          // nothing at all.
          //
          // `r` is NOT in the list any more. It now changes on every zoom step
          // (through the custom property), and a transition on it would make
          // every handle take 150 ms to reach its size after each wheel tick —
          // the stale-during-zoom look this file just got rid of.
          transition:
            isDragging || isUndoRedoInProgress
              ? 'none'
              : 'fill 0.15s ease-out, opacity 0.15s ease-out',
          pointerEvents: 'all',
        }}
      />
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison for optimization - unchanged
    const sameDragOffset =
      (!prevProps.dragOffset && !nextProps.dragOffset) ||
      (prevProps.dragOffset &&
        nextProps.dragOffset &&
        prevProps.dragOffset.x === nextProps.dragOffset.x &&
        prevProps.dragOffset.y === nextProps.dragOffset.y);

    return (
      prevProps.point.x === nextProps.point.x &&
      prevProps.point.y === nextProps.point.y &&
      prevProps.polygonId === nextProps.polygonId &&
      prevProps.vertexIndex === nextProps.vertexIndex &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isHovered === nextProps.isHovered &&
      prevProps.isDragging === nextProps.isDragging &&
      prevProps.isUndoRedoInProgress === nextProps.isUndoRedoInProgress &&
      prevProps.type === nextProps.type &&
      prevProps.isStartPoint === nextProps.isStartPoint &&
      prevProps.isInAddPointsMode === nextProps.isInAddPointsMode &&
      prevProps.isInMoveShapeMode === nextProps.isInMoveShapeMode &&
      sameDragOffset
    );
  }
);

CanvasVertex.displayName = 'CanvasVertex';

export default CanvasVertex;
