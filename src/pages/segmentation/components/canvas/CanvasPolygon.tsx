import React, { useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Polygon } from '@/lib/segmentation';
import PolygonVertices from './PolygonVertices';
import PolygonContextMenu from '../context-menu/PolygonContextMenu';
import { VertexDragState, EditMode } from '@/pages/segmentation/types';
import type { ProjectType } from '@/types';
import {
  colorFromInstanceId,
  isMicrotubuleInstance,
} from '@/pages/segmentation/utils/instanceColors';

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
  onChangePartClass?: (
    polygonId: string,
    partClass: 'head' | 'midpiece' | 'tail'
  ) => void;
  onChangeInstanceId?: (polygonId: string, instanceId: string) => void;
  availableInstanceIds?: string[];
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
  onDuplicateVertex?: (polygonId: string, vertexIndex: number) => void;
  onHover?: (polygonId: string | null) => void;
  editMode?: EditMode;
  /** Project-type gate for the polyline context menu. Sperm items only
   *  appear for ``'sperm'`` projects; the kymograph item is exclusive
   *  to ``'microtubules'``. Without this gate, MT users saw the sperm
   *  head/midpiece/tail items just because the callbacks were truthy. */
  projectType?: ProjectType;
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
    availableInstanceIds,
    onDeleteVertex,
    onDuplicateVertex,
    onHover,
    editMode,
    projectType,
  }: CanvasPolygonProps) => {
    const { id, points, type = 'external', parent_id } = polygon;

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

    // Generate SVG path string from valid points (no simplification).
    // Single-pass build: applies drag offset inline and avoids the double
    // array allocation the previous `.map(...).map(...)` chain used on every
    // frame of a 4000-point drag.
    const pathString = useMemo(() => {
      const minPoints = isPolyline ? 2 : 3;
      if (!validPoints || validPoints.length < minPoints) {
        return '';
      }

      const dragActive =
        !!vertexDragState?.isDragging &&
        vertexDragState.polygonId === id &&
        vertexDragState.vertexIndex !== null &&
        !!vertexDragState.dragOffset;
      const dragIdx = dragActive ? vertexDragState.vertexIndex : -1;
      const dragOffsetX = dragActive ? vertexDragState.dragOffset!.x : 0;
      const dragOffsetY = dragActive ? vertexDragState.dragOffset!.y : 0;

      const parts = new Array<string>(validPoints.length);
      for (let i = 0; i < validPoints.length; i++) {
        const p = validPoints[i];
        if (i === dragIdx) {
          parts[i] = `${p.x + dragOffsetX},${p.y + dragOffsetY}`;
        } else {
          parts[i] = `${p.x},${p.y}`;
        }
      }

      // Polylines: open path (no Z). Polygons: closed path (Z).
      return `M${parts.join(' L')}${isPolyline ? '' : ' Z'}`;
    }, [validPoints, vertexDragState, id, isPolyline]);

    // For the path stroke width, we need to adjust based on zoom level
    // When zoomed in, the stroke appears thicker so we need to make it thinner
    const strokeWidth = useMemo(() => {
      if (zoom > 4) {
        return 1.5 / zoom;
      } else if (zoom > 3) {
        return 2 / zoom;
      } else if (zoom < 0.5) {
        return 0.8 / zoom;
      } else if (zoom < 0.7) {
        return 1.2 / zoom;
      } else {
        return 2 / zoom;
      }
    }, [zoom]);

    // Determine if polygon is internal based on parent_id or type
    const isInternal = parent_id || type === 'internal';

    // Determine path color based on polygon type, polyline partClass, and selection status
    const pathColor = useMemo(() => {
      // Spheroid 'core' (closed polygon, dense central region from ASPP model)
      if (!isPolyline && polygon.partClass === 'core') {
        return isSelected ? '#16a34a' : '#22c55e'; // green
      }
      if (isPolyline) {
        // Microtubule polylines: deterministic per-instance HSL hash. The
        // tracker (backend/src/services/tracking/trackerService.ts) writes
        // a stable `trackId` across frames; `instanceId` is freshly
        // generated per-inference and only differs within a single frame.
        // Prefer `trackId` so the same microtubule keeps its color when
        // scrubbing; fall back to `instanceId` before tracking has run.
        // `class='microtubule'` is the authoritative ML signal; `mt_`
        // instanceId prefix is the legacy fallback.
        const isMt =
          !polygon.partClass &&
          (polygon.class === 'microtubule' ||
            isMicrotubuleInstance(polygon.instanceId));
        if (isMt) {
          const colorKey = polygon.trackId ?? polygon.instanceId ?? '';
          return colorFromInstanceId(colorKey, { selected: isSelected });
        }
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
    }, [
      isPolyline,
      polygon.partClass,
      polygon.class,
      polygon.instanceId,
      polygon.trackId,
      isSelected,
      isInternal,
    ]);

    // Compute hover-dependent stroke width multiplier
    const hoverStrokeMultiplier = isPolyline
      ? isHovered
        ? 2.5
        : 1.5
      : isHovered
        ? 1.3
        : 1;

    // Compute SVG filter for glow effects
    const pathFilter = (() => {
      if (isSelected && !isPolyline) {
        return `url(#${type === 'internal' ? 'blue' : 'red'}-glow)`;
      }
      if (isPolyline && (isSelected || isHovered)) {
        return 'url(#blue-glow)';
      }
      return '';
    })();

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
      (partClass: 'head' | 'midpiece' | 'tail') =>
        onChangePartClass?.(id, partClass),
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
        projectType={projectType}
        onChangePartClass={isPolyline ? handleChangePartClass : undefined}
        onChangeInstanceId={isPolyline ? handleChangeInstanceId : undefined}
        currentInstanceId={isPolyline ? polygon.instanceId : undefined}
        availableInstanceIds={isPolyline ? availableInstanceIds : undefined}
      >
        <g
          data-testid={id}
          className={cn('polygon-group', isInternal ? 'internal' : 'external')}
          tabIndex={0}
          role="button"
          aria-label={`${isPolyline ? 'Polyline' : 'Polygon'} ${id} - ${type} ${isPolyline ? 'polyline' : 'polygon'} with ${points.length} vertices`}
          onKeyDown={handleKeyDown}
          onMouseEnter={isPolyline ? handleMouseEnter : undefined}
          onMouseLeave={isPolyline ? handleMouseLeave : undefined}
          style={{ outline: 'none' }}
        >
          {/* Polyline hit-area: invisible thick stroke layered UNDER the
              visible path. Polylines are 1-D — the visible stroke is only
              a couple of pixels wide, so right-click / hover would
              otherwise demand pixel-perfect aim. A 12× wider transparent
              stroke makes the click target comfortable without changing
              the rendered look. Pointer-events confined to the stroke so
              the surrounding canvas drag/zoom still works. */}
          {isPolyline && pathString && (
            <path
              d={pathString}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(strokeWidth * 12, 6)}
              strokeLinecap="round"
              strokeLinejoin="round"
              onClick={handleClick}
              onDoubleClick={handleDoubleClick}
              vectorEffect="non-scaling-stroke"
              pointerEvents="stroke"
              style={{ cursor: 'pointer' }}
            />
          )}

          {/* Polygon/Polyline path - render even if path is empty for testing */}
          <path
            d={pathString || 'M0,0'}
            style={
              !isPolyline && polygon.partClass === 'core'
                ? { fill: 'rgba(34, 197, 94, 0.25)', stroke: '#22c55e' }
                : undefined
            }
            className={cn(
              'polygon-path cursor-pointer transition-colors',
              isPolyline
                ? 'polyline-path'
                : polygon.partClass === 'core'
                  ? 'polygon-core'
                  : isInternal
                    ? 'polygon-internal'
                    : 'polygon-external',
              isSelected && 'polygon-selected'
            )}
            fill={
              isPolyline
                ? 'none'
                : polygon.partClass === 'core'
                  ? 'rgba(34, 197, 94, 0.25)' // green core (#22c55e at 25%)
                  : isInternal
                    ? 'rgba(14, 165, 233, 0.1)'
                    : 'rgba(239, 68, 68, 0.1)'
            }
            stroke={pathColor}
            strokeWidth={Math.max(strokeWidth * hoverStrokeMultiplier, 0.5)}
            strokeOpacity={pathString ? 1 : 0}
            strokeLinecap="round"
            strokeLinejoin="round"
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            filter={pathFilter}
            vectorEffect="non-scaling-stroke"
            pointerEvents={isPolyline ? 'stroke' : 'all'}
          />

          {/* Polyline endpoint markers.
              - Microtubule projects: only render when selected — the
                MT visual identity is "plain curve on the image",
                clutter-free in the default state.
              - Sperm (and any other future polyline-bearing project):
                always render the start + end dots. Sperm artwork has
                always shown them and biologists expect that affordance
                to mark head / tail orientation. */}
          {isPolyline &&
            validPoints.length >= 2 &&
            (projectType === 'microtubules' ? isSelected : true) && (
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
      prevProps.polygon.class === nextProps.polygon.class &&
      prevProps.polygon.instanceId === nextProps.polygon.instanceId &&
      prevProps.polygon.trackId === nextProps.polygon.trackId &&
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
      prevProps.onChangePartClass === nextProps.onChangePartClass &&
      prevProps.onChangeInstanceId === nextProps.onChangeInstanceId &&
      prevProps.availableInstanceIds === nextProps.availableInstanceIds &&
      // projectType drives the context-menu's sperm-vs-MT gating; if
      // we forget to compare it here, switching project types in the
      // same session (or a per-polygon override one day) wouldn't
      // re-render the menu and the user would see stale options.
      prevProps.projectType === nextProps.projectType &&
      // editMode flips between View / EditVertices / Slice / AddPoints /
      // CreatePolygon / CreatePolyline / DeletePolygon and changes which
      // interactions the polygon should accept. Skipping it caused the
      // child to keep closures from the previous mode (e.g. View handlers
      // still firing after switching to Slice).
      prevProps.editMode === nextProps.editMode
    );
  }
);

CanvasPolygon.displayName = 'CanvasPolygon';

export default CanvasPolygon;
