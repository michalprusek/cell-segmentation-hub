import React, { type MouseEvent as ReactMouseEvent } from 'react';
import type { Point } from '../../types';

interface SegmenterVertexPointProps {
  point: Point;
  zoom: number;
  isDragging: boolean;
  onMouseDown: (e: ReactMouseEvent) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}

/**
 * A single draggable polygon vertex. Adapted from
 * `@/pages/segmentation/components/canvas/CanvasVertex.tsx`'s adaptive
 * zoom-scaling formula, trimmed of the internal/external-type distinction
 * and undo/redo transition flags this editor doesn't have.
 */
const SegmenterVertexPoint = React.memo(
  ({
    point,
    zoom,
    isDragging,
    onMouseDown,
    onContextMenu,
  }: SegmenterVertexPointProps) => {
    const radius = Math.max(5 / Math.pow(Math.max(zoom, 0.01), 0.85), 2);
    const strokeWidth = Math.max(1.2 / zoom, 0.3);

    return (
      <circle
        cx={point.x}
        cy={point.y}
        r={radius}
        fill={isDragging ? '#c0392b' : '#ea384c'}
        stroke="#ffffff"
        strokeWidth={strokeWidth}
        onMouseDown={onMouseDown}
        onContextMenu={onContextMenu}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          pointerEvents: 'all',
        }}
        data-testid="segmenter-vertex"
      />
    );
  },
  (prev, next) =>
    prev.point.x === next.point.x &&
    prev.point.y === next.point.y &&
    prev.zoom === next.zoom &&
    prev.isDragging === next.isDragging &&
    prev.onMouseDown === next.onMouseDown &&
    prev.onContextMenu === next.onContextMenu
);

SegmenterVertexPoint.displayName = 'SegmenterVertexPoint';

export default SegmenterVertexPoint;
