import React from 'react';
import {
  EDITING_CONSTANTS,
  EditMode,
  InteractionState,
  TransformState,
} from '../../types';
import { Point, Polygon } from '@/lib/segmentation';
import {
  OVERLAY_DOT_CLASS,
  VERTEX_RADIUS_PX,
  dotRadiusStyle,
  screenPx,
} from '../../utils/overlayScale';

/** `on off` dash pattern in screen px. A CSS declaration, like every size in
 *  this layer, so it follows the overlay's inverse-zoom property. */
const dash = (on: number, off: number): string =>
  `${screenPx(on)} ${screenPx(off)}`;

/** Preview line width, screen px. */
const LINE_PX = 2;

interface CanvasTemporaryGeometryLayerProps {
  transform: TransformState;
  editMode: EditMode;
  tempPoints: Point[];
  cursorPosition: Point | null;
  interactionState: InteractionState;
  selectedPolygonId: string | null;
  polygons: Polygon[];
  hoveredJoinTarget: { polygonId: string; endpoint: 'head' | 'tail' } | null;
}

/**
 * Renders temporary geometry like preview lines, temp polygons, slice lines
 * Inspired by SpheroSeg's temporary geometry system
 */
const CanvasTemporaryGeometryLayer: React.FC<
  CanvasTemporaryGeometryLayerProps
> = ({
  transform,
  editMode,
  tempPoints,
  cursorPosition,
  interactionState,
  selectedPolygonId,
  polygons,
  hoveredJoinTarget,
}) => {
  // Every size here is in SCREEN pixels, through the same custom property
  // the committed shapes use (`utils/overlayScale.ts`). The preview line used
  // to be `Math.max(1, 2 / zoom)` user units — 2 px up to zoom 2, then one
  // IMAGE pixel wide: 10 px at zoom 10, hiding the structure being traced.
  //
  // Same radius as a committed vertex handle, so a point does not change
  // size at the moment the shape is finished.
  const vertexRadius = VERTEX_RADIUS_PX;

  const renderCreatePolygonPreview = () => {
    if (editMode !== EditMode.CreatePolygon || tempPoints.length === 0) {
      return null;
    }

    const elements = [];

    // Render existing temp points
    tempPoints.forEach((point, index) => {
      const isFirstPoint = index === 0;
      elements.push(
        <circle
          key={`temp-vertex-${index}`}
          cx={point.x}
          cy={point.y}
          className={OVERLAY_DOT_CLASS}
          fill={isFirstPoint ? '#3b82f6' : '#4ade80'}
          stroke="none"
          style={{ ...dotRadiusStyle(vertexRadius), opacity: 0.8 }}
        />
      );
    });

    // Render lines between temp points
    for (let i = 0; i < tempPoints.length - 1; i++) {
      const start = tempPoints[i];
      const end = tempPoints[i + 1];
      elements.push(
        <line
          key={`temp-line-${i}`}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke="#4ade80"
          style={{
            strokeWidth: screenPx(LINE_PX),
            strokeDasharray: dash(5, 3),
            opacity: 0.7,
          }}
        />
      );
    }

    // Render line from last point to cursor
    if (cursorPosition && tempPoints.length > 0) {
      const lastPoint = tempPoints[tempPoints.length - 1];
      elements.push(
        <line
          key="cursor-preview-line"
          x1={lastPoint.x}
          y1={lastPoint.y}
          x2={cursorPosition.x}
          y2={cursorPosition.y}
          stroke="#4ade80"
          style={{
            strokeWidth: screenPx(LINE_PX),
            strokeDasharray: dash(3, 2),
            opacity: 0.5,
          }}
        />
      );
    }

    // Render closing line if close to first point
    if (tempPoints.length >= 3 && cursorPosition) {
      const firstPoint = tempPoints[0];
      const dx = firstPoint.x - cursorPosition.x;
      const dy = firstPoint.y - cursorPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // Must stay the threshold useAdvancedInteractions actually closes on —
      // this only draws the "you can close here" hint, so a divergence would
      // promise a close the click does not perform.
      const closeDistance =
        EDITING_CONSTANTS.CLOSE_POLYGON_DISTANCE / transform.zoom;

      if (distance <= closeDistance) {
        elements.push(
          <line
            key="closing-line"
            x1={cursorPosition.x}
            y1={cursorPosition.y}
            x2={firstPoint.x}
            y2={firstPoint.y}
            stroke="#22c55e"
            style={{ strokeWidth: screenPx(LINE_PX * 1.5), opacity: 0.8 }}
          />
        );

        // Highlight first point
        elements.push(
          <circle
            key="first-point-highlight"
            cx={firstPoint.x}
            cy={firstPoint.y}
            className={OVERLAY_DOT_CLASS}
            fill="none"
            stroke="#22c55e"
            style={{
              ...dotRadiusStyle(vertexRadius * 1.3),
              strokeWidth: screenPx(LINE_PX),
              opacity: 0.8,
            }}
          />
        );
      }
    }

    return elements;
  };

  const renderSlicePreview = () => {
    if (editMode !== EditMode.Slice) {
      return null;
    }

    const elements = [];

    // Render temp slice points
    tempPoints.forEach((point, index) => {
      elements.push(
        <circle
          key={`slice-point-${index}`}
          cx={point.x}
          cy={point.y}
          className={OVERLAY_DOT_CLASS}
          fill="#ffcc00"
          stroke="none"
          style={{ ...dotRadiusStyle(vertexRadius), opacity: 0.9 }}
        />
      );
    });

    // Render slice line
    if (tempPoints.length === 1 && cursorPosition) {
      // Preview line from first point to cursor
      elements.push(
        <line
          key="slice-preview-line"
          x1={tempPoints[0].x}
          y1={tempPoints[0].y}
          x2={cursorPosition.x}
          y2={cursorPosition.y}
          stroke="#ffcc00"
          style={{
            strokeWidth: screenPx(LINE_PX),
            strokeDasharray: dash(4, 2),
            opacity: 0.7,
          }}
        />
      );
    } else if (tempPoints.length === 2) {
      // Final slice line
      elements.push(
        <line
          key="slice-line"
          x1={tempPoints[0].x}
          y1={tempPoints[0].y}
          x2={tempPoints[1].x}
          y2={tempPoints[1].y}
          stroke="#ffcc00"
          style={{ strokeWidth: screenPx(LINE_PX * 1.5), opacity: 0.9 }}
        />
      );
    }

    return elements;
  };

  const renderAddPointsPreview = () => {
    if (editMode !== EditMode.AddPoints || !interactionState.isAddingPoints) {
      return null;
    }

    const elements = [];

    // Render temp points for add points mode
    tempPoints.forEach((point, index) => {
      elements.push(
        <circle
          key={`add-point-${index}`}
          cx={point.x}
          cy={point.y}
          className={OVERLAY_DOT_CLASS}
          fill="#60a5fa"
          stroke="none"
          style={{ ...dotRadiusStyle(vertexRadius), opacity: 0.8 }}
        />
      );
    });

    // Render lines between temp points
    for (let i = 0; i < tempPoints.length - 1; i++) {
      const start = tempPoints[i];
      const end = tempPoints[i + 1];
      elements.push(
        <line
          key={`add-line-${i}`}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke="#60a5fa"
          style={{
            strokeWidth: screenPx(LINE_PX),
            strokeDasharray: dash(4, 2),
            opacity: 0.6,
          }}
        />
      );
    }

    // Render line from start vertex to first temp point
    if (
      tempPoints.length > 0 &&
      selectedPolygonId &&
      interactionState.addPointStartVertex
    ) {
      const selectedPolygon = polygons.find(p => p.id === selectedPolygonId);
      if (
        selectedPolygon &&
        interactionState.addPointStartVertex.vertexIndex <
          selectedPolygon.points.length
      ) {
        const startVertex =
          selectedPolygon.points[
            interactionState.addPointStartVertex.vertexIndex
          ];
        elements.push(
          <line
            key="start-vertex-line"
            x1={startVertex.x}
            y1={startVertex.y}
            x2={tempPoints[0].x}
            y2={tempPoints[0].y}
            stroke="#60a5fa"
            style={{
              strokeWidth: screenPx(LINE_PX),
              strokeDasharray: dash(4, 2),
              opacity: 0.6,
            }}
          />
        );
      }
    }

    // Render line from last temp point to cursor
    if (cursorPosition && tempPoints.length > 0) {
      const lastPoint = tempPoints[tempPoints.length - 1];
      elements.push(
        <line
          key="cursor-add-line"
          x1={lastPoint.x}
          y1={lastPoint.y}
          x2={cursorPosition.x}
          y2={cursorPosition.y}
          stroke="#60a5fa"
          style={{
            strokeWidth: screenPx(LINE_PX),
            strokeDasharray: dash(2, 2),
            opacity: 0.4,
          }}
        />
      );
    } else if (
      cursorPosition &&
      tempPoints.length === 0 &&
      selectedPolygonId &&
      interactionState.addPointStartVertex
    ) {
      // Line from start vertex to cursor when no temp points yet
      const selectedPolygon = polygons.find(p => p.id === selectedPolygonId);
      if (
        selectedPolygon &&
        interactionState.addPointStartVertex.vertexIndex <
          selectedPolygon.points.length
      ) {
        const startVertex =
          selectedPolygon.points[
            interactionState.addPointStartVertex.vertexIndex
          ];
        elements.push(
          <line
            key="start-cursor-line"
            x1={startVertex.x}
            y1={startVertex.y}
            x2={cursorPosition.x}
            y2={cursorPosition.y}
            stroke="#60a5fa"
            style={{
              strokeWidth: screenPx(LINE_PX),
              strokeDasharray: dash(2, 2),
              opacity: 0.3,
            }}
          />
        );
      }
    }

    return elements;
  };

  const renderCreatePolylinePreview = () => {
    if (editMode !== EditMode.CreatePolyline || tempPoints.length === 0) {
      return null;
    }

    const elements = [];

    // Render existing temp points with partClass-aware color
    tempPoints.forEach((point, index) => {
      const isFirstPoint = index === 0;
      elements.push(
        <circle
          key={`temp-polyline-vertex-${index}`}
          cx={point.x}
          cy={point.y}
          className={OVERLAY_DOT_CLASS}
          fill={isFirstPoint ? '#a855f7' : '#c084fc'}
          stroke="none"
          style={{ ...dotRadiusStyle(vertexRadius), opacity: 0.8 }}
        />
      );
    });

    // Render lines between temp points (solid purple for polylines)
    for (let i = 0; i < tempPoints.length - 1; i++) {
      const start = tempPoints[i];
      const end = tempPoints[i + 1];
      elements.push(
        <line
          key={`temp-polyline-line-${i}`}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke="#a855f7"
          style={{
            strokeWidth: screenPx(LINE_PX * 1.5),
            strokeDasharray: dash(5, 3),
            opacity: 0.7,
          }}
        />
      );
    }

    // Render line from last point to cursor (no closing line - polylines are open)
    if (cursorPosition && tempPoints.length > 0) {
      const lastPoint = tempPoints[tempPoints.length - 1];
      elements.push(
        <line
          key="cursor-polyline-preview-line"
          x1={lastPoint.x}
          y1={lastPoint.y}
          x2={cursorPosition.x}
          y2={cursorPosition.y}
          stroke="#a855f7"
          style={{
            strokeWidth: screenPx(LINE_PX),
            strokeDasharray: dash(3, 2),
            opacity: 0.5,
          }}
        />
      );
    }

    return elements;
  };

  const renderJoinTargetHighlight = () => {
    if (editMode !== EditMode.AddPoints || !hoveredJoinTarget) {
      return null;
    }
    const target = polygons.find(p => p.id === hoveredJoinTarget.polygonId);
    if (!target || target.points.length < 2) {
      return null;
    }
    const p =
      hoveredJoinTarget.endpoint === 'head'
        ? target.points[0]
        : target.points[target.points.length - 1];
    return (
      <circle
        key="join-target-ring"
        cx={p.x}
        cy={p.y}
        className={OVERLAY_DOT_CLASS}
        fill="none"
        stroke="#f59e0b"
        style={{
          ...dotRadiusStyle(vertexRadius * 1.6),
          strokeWidth: screenPx(2.5),
          opacity: 0.95,
        }}
      />
    );
  };

  return (
    <g className="temporary-geometry-layer">
      {renderCreatePolygonPreview()}
      {renderCreatePolylinePreview()}
      {renderSlicePreview()}
      {renderAddPointsPreview()}
      {renderJoinTargetHighlight()}
    </g>
  );
};

export default CanvasTemporaryGeometryLayer;
