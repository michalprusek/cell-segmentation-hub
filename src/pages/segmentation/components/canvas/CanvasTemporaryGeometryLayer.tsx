import React from 'react';
import { EditMode, InteractionState, TransformState } from '../../types';
import { Point, Polygon } from '@/lib/segmentation';
import { calculateVertexRadius, defaultConfig } from './CanvasVertex';

interface CanvasTemporaryGeometryLayerProps {
  transform: TransformState;
  editMode: EditMode;
  tempPoints: Point[];
  cursorPosition: Point | null;
  interactionState: InteractionState;
  selectedPolygonId: string | null;
  polygons: Polygon[];
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
}) => {
  const strokeWidth = Math.max(1, 2 / transform.zoom);
  // Use the same vertex radius calculation as regular vertices for consistency
  const vertexRadius = calculateVertexRadius(transform.zoom, defaultConfig);

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
          r={vertexRadius}
          fill={isFirstPoint ? '#3b82f6' : '#4ade80'}
          stroke="none"
          strokeWidth={0}
          style={{ opacity: 0.8 }}
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
          strokeWidth={strokeWidth}
          strokeDasharray={`${5 / transform.zoom} ${3 / transform.zoom}`}
          style={{ opacity: 0.7 }}
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
          strokeWidth={strokeWidth}
          strokeDasharray={`${3 / transform.zoom} ${2 / transform.zoom}`}
          style={{ opacity: 0.5 }}
        />
      );
    }

    // Render closing line if close to first point
    if (tempPoints.length >= 3 && cursorPosition) {
      const firstPoint = tempPoints[0];
      const dx = firstPoint.x - cursorPosition.x;
      const dy = firstPoint.y - cursorPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const closeDistance = 15 / transform.zoom;

      if (distance <= closeDistance) {
        elements.push(
          <line
            key="closing-line"
            x1={cursorPosition.x}
            y1={cursorPosition.y}
            x2={firstPoint.x}
            y2={firstPoint.y}
            stroke="#22c55e"
            strokeWidth={strokeWidth * 1.5}
            style={{ opacity: 0.8 }}
          />
        );

        // Highlight first point
        elements.push(
          <circle
            key="first-point-highlight"
            cx={firstPoint.x}
            cy={firstPoint.y}
            r={vertexRadius * 1.3}
            fill="none"
            stroke="#22c55e"
            strokeWidth={strokeWidth}
            style={{ opacity: 0.8 }}
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
          r={vertexRadius}
          fill="#ffcc00"
          stroke="none"
          strokeWidth={0}
          style={{ opacity: 0.9 }}
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
          strokeWidth={strokeWidth}
          strokeDasharray={`${4 / transform.zoom} ${2 / transform.zoom}`}
          style={{ opacity: 0.7 }}
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
          strokeWidth={strokeWidth * 1.5}
          style={{ opacity: 0.9 }}
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
          r={vertexRadius}
          fill="#60a5fa"
          stroke="none"
          strokeWidth={0}
          style={{ opacity: 0.8 }}
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
          strokeWidth={strokeWidth}
          strokeDasharray={`${4 / transform.zoom} ${2 / transform.zoom}`}
          style={{ opacity: 0.6 }}
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
            strokeWidth={strokeWidth}
            strokeDasharray={`${4 / transform.zoom} ${2 / transform.zoom}`}
            style={{ opacity: 0.6 }}
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
          strokeWidth={strokeWidth}
          strokeDasharray={`${2 / transform.zoom} ${2 / transform.zoom}`}
          style={{ opacity: 0.4 }}
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
            strokeWidth={strokeWidth}
            strokeDasharray={`${2 / transform.zoom} ${2 / transform.zoom}`}
            style={{ opacity: 0.3 }}
          />
        );
      }
    }

    return elements;
  };

  const renderDragPreview = () => {
    // Drag preview disabled - no ghost circle shown
    return null;
  };

  return (
    <g className="temporary-geometry-layer">
      {renderCreatePolygonPreview()}
      {renderSlicePreview()}
      {renderAddPointsPreview()}
      {renderDragPreview()}
    </g>
  );
};

export default CanvasTemporaryGeometryLayer;
