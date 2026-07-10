import React, {
  useCallback,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { SegmenterPolygon } from '@/lib/segmenterApi';
import { EditMode, type VertexDragState } from '../../types';
import { hexToRgba } from '../../utils/classColor';
import SegmenterVertexPoint from './SegmenterVertexPoint';

interface SegmenterPolygonShapeProps {
  polygon: SegmenterPolygon;
  isSelected: boolean;
  /** Resolved fill/stroke colour for this polygon's `classId` (SSOT lookup
   *  done once by the parent against the dataset's class palette). */
  color: string;
  zoom: number;
  editMode: EditMode;
  vertexDragState: VertexDragState;
  onClick: (id: string) => void;
  onVertexMouseDown: (
    polygonId: string,
    vertexIndex: number,
    e: ReactMouseEvent
  ) => void;
  onVertexContextMenu: (
    polygonId: string,
    vertexIndex: number,
    e: ReactMouseEvent
  ) => void;
}

/**
 * Renders one polygon: fill + stroke path (coloured by its class), plus its
 * vertices when selected. Adapted from
 * `@/pages/segmentation/components/canvas/CanvasPolygon.tsx`, stripped of
 * everything polyline/MT/sperm-specific — this editor only ever has closed
 * polygons and a single generic `classId`. Overlap (including same-class)
 * "just works" because every polygon is an independent `<path>` in the
 * same `<svg>` — nothing collapses them into a shared raster.
 */
const SegmenterPolygonShape = React.memo(
  ({
    polygon,
    isSelected,
    color,
    zoom,
    editMode,
    vertexDragState,
    onClick,
    onVertexMouseDown,
    onVertexContextMenu,
  }: SegmenterPolygonShapeProps) => {
    const points = polygon.points;
    const isDraggingThisPolygon =
      vertexDragState.isDragging && vertexDragState.polygonId === polygon.id;

    const displayPoints = useMemo(() => {
      if (
        !isDraggingThisPolygon ||
        vertexDragState.vertexIndex === null ||
        !vertexDragState.dragOffset
      ) {
        return points;
      }
      const idx = vertexDragState.vertexIndex;
      const offset = vertexDragState.dragOffset;
      return points.map((p, i) =>
        i === idx ? { x: p.x + offset.x, y: p.y + offset.y } : p
      );
    }, [
      points,
      isDraggingThisPolygon,
      vertexDragState.vertexIndex,
      vertexDragState.dragOffset,
    ]);

    const pathD = useMemo(() => {
      if (displayPoints.length < 3) return '';
      const parts = displayPoints.map(p => `${p.x},${p.y}`);
      return `M${parts.join(' L')} Z`;
    }, [displayPoints]);

    const strokeWidth = Math.max(2 / zoom, 0.5) * (isSelected ? 1.6 : 1);
    const fill = hexToRgba(color, isSelected ? 0.28 : 0.16);

    const handleClick = useCallback(
      (e: ReactMouseEvent) => {
        e.stopPropagation();
        onClick(polygon.id);
      },
      [onClick, polygon.id]
    );

    const showInteractiveVertices =
      isSelected && editMode === EditMode.EditVertices;
    const showStaticVertices = isSelected && !showInteractiveVertices;
    const staticVertexRadius = Math.max(3 / zoom, 1);

    return (
      <g data-testid={`segmenter-polygon-${polygon.id}`}>
        <path
          d={pathD || 'M0,0'}
          fill={fill}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeOpacity={pathD ? 1 : 0}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: 'pointer' }}
          onClick={handleClick}
          data-testid={`segmenter-polygon-path-${polygon.id}`}
        />
        {showInteractiveVertices &&
          displayPoints.map((p, i) => (
            <SegmenterVertexPoint
              key={i}
              point={p}
              zoom={zoom}
              isDragging={
                isDraggingThisPolygon && vertexDragState.vertexIndex === i
              }
              onMouseDown={e => onVertexMouseDown(polygon.id, i, e)}
              onContextMenu={e => onVertexContextMenu(polygon.id, i, e)}
            />
          ))}
        {showStaticVertices &&
          displayPoints.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={staticVertexRadius}
              fill={color}
              stroke="#ffffff"
              strokeWidth={Math.max(0.8 / zoom, 0.25)}
              pointerEvents="none"
            />
          ))}
      </g>
    );
  },
  (prev, next) => {
    const prevDrag = prev.vertexDragState;
    const nextDrag = next.vertexDragState;
    const dragRelevant =
      prevDrag.polygonId === prev.polygon.id ||
      nextDrag.polygonId === next.polygon.id;
    const sameDrag =
      !dragRelevant ||
      (prevDrag.isDragging === nextDrag.isDragging &&
        prevDrag.vertexIndex === nextDrag.vertexIndex &&
        prevDrag.dragOffset?.x === nextDrag.dragOffset?.x &&
        prevDrag.dragOffset?.y === nextDrag.dragOffset?.y);

    return (
      prev.polygon === next.polygon &&
      prev.isSelected === next.isSelected &&
      prev.color === next.color &&
      prev.zoom === next.zoom &&
      prev.editMode === next.editMode &&
      sameDrag &&
      prev.onClick === next.onClick &&
      prev.onVertexMouseDown === next.onVertexMouseDown &&
      prev.onVertexContextMenu === next.onVertexContextMenu
    );
  }
);

SegmenterPolygonShape.displayName = 'SegmenterPolygonShape';

export default SegmenterPolygonShape;
