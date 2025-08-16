import { useCallback, useRef } from 'react';
import { Point, Polygon } from '@/lib/segmentation';
import {
  EditMode,
  InteractionState,
  TransformState,
  EDITING_CONSTANTS,
} from '../types';
import {
  getCanvasCoordinates,
  canvasToImageCoordinates,
} from '@/lib/coordinateUtils';
import {
  isPointInPolygon,
  findClosestVertex,
  findClosestSegment,
  calculatePolygonArea,
  createPolygon,
} from '@/lib/polygonGeometry';

/**
 * Advanced interaction handler inspired by SpheroSeg
 * Provides sophisticated polygon editing capabilities
 */

interface UseAdvancedInteractionsProps {
  editMode: EditMode;
  interactionState: InteractionState;
  transform: TransformState;
  canvasRef: React.RefObject<HTMLDivElement>;
  selectedPolygonId: string | null;
  tempPoints: Point[];
  cursorPosition: Point | null;

  // State setters
  setSelectedPolygonId: (id: string | null) => void;
  setEditMode: (mode: EditMode) => void;
  setInteractionState: (state: InteractionState) => void;
  setTempPoints: (points: Point[]) => void;
  setHoveredVertex: (
    vertex: { polygonId: string; vertexIndex: number } | null
  ) => void;

  // Data operations
  updatePolygons: (polygons: Polygon[]) => void;
  getPolygons: () => Polygon[];
}

export const useAdvancedInteractions = ({
  editMode,
  interactionState,
  transform,
  canvasRef,
  selectedPolygonId,
  tempPoints,
  cursorPosition,
  setSelectedPolygonId,
  setEditMode,
  setInteractionState,
  setTempPoints,
  setHoveredVertex,
  updatePolygons,
  getPolygons,
}: UseAdvancedInteractionsProps) => {
  // Refs for tracking modifier keys
  const isShiftPressed = useRef(false);
  const lastAutoAddedPoint = useRef<Point | null>(null);

  /**
   * Handle mouse down events with mode-specific logic
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Right-click - always cancel current operation
      if (e.button === 2) {
        if (editMode !== EditMode.View) {
          setEditMode(EditMode.View);
          setTempPoints([]);
        }
        e.stopPropagation();
        return;
      }

      // Left-click handling
      if (e.button === 0) {
        const coordinates = getCanvasCoordinates(
          e.clientX,
          e.clientY,
          transform,
          canvasRef
        );
        const imagePoint = { x: coordinates.imageX, y: coordinates.imageY };

        switch (editMode) {
          case EditMode.View:
            handleViewModeClick(imagePoint, e);
            break;
          case EditMode.CreatePolygon:
            handleCreatePolygonClick(imagePoint);
            break;
          case EditMode.EditVertices:
            handleEditVerticesClick(imagePoint);
            break;
          case EditMode.AddPoints:
            handleAddPointsClick(imagePoint);
            break;
          case EditMode.Slice:
            handleSliceClick(imagePoint);
            break;
          case EditMode.DeletePolygon:
            handleDeletePolygonClick(imagePoint);
            break;
        }
      }
    },
    [editMode, interactionState, transform, selectedPolygonId, tempPoints]
  );

  /**
   * Handle View mode clicks - polygon selection and panning
   */
  const handleViewModeClick = useCallback(
    (imagePoint: Point, e: React.MouseEvent) => {
      const polygons = getPolygons();

      // Check if we clicked on a polygon
      const containingPolygons = polygons.filter(polygon =>
        isPointInPolygon(imagePoint, polygon.points)
      );

      // Check if Alt key is pressed for forced panning
      const isAltPressed = e.altKey;

      if (isAltPressed) {
        // Start panning regardless of polygon selection
        setInteractionState({
          ...interactionState,
          isPanning: true,
          panStart: { x: e.clientX, y: e.clientY },
        });
        return;
      }

      if (containingPolygons.length > 0) {
        // If multiple polygons, prioritize the smallest one (likely a hole)
        if (containingPolygons.length > 1) {
          containingPolygons.sort((a, b) => {
            const areaA = calculatePolygonArea(a.points);
            const areaB = calculatePolygonArea(b.points);
            return areaA - areaB;
          });
        }

        setSelectedPolygonId(containingPolygons[0].id);
        setEditMode(EditMode.EditVertices);
      }

      // Start panning
      setInteractionState({
        ...interactionState,
        isPanning: true,
        panStart: { x: e.clientX, y: e.clientY },
      });
    },
    [
      interactionState,
      getPolygons,
      setSelectedPolygonId,
      setEditMode,
      setInteractionState,
    ]
  );

  /**
   * Handle Create Polygon mode clicks
   */
  const handleCreatePolygonClick = useCallback(
    (imagePoint: Point) => {
      // Check if we're clicking near the first point to close the polygon
      if (tempPoints.length >= 3) {
        const firstPoint = tempPoints[0];
        const dx = firstPoint.x - imagePoint.x;
        const dy = firstPoint.y - imagePoint.y;
        const closeDistance =
          EDITING_CONSTANTS.CLOSE_POLYGON_DISTANCE / transform.zoom;

        if (Math.sqrt(dx * dx + dy * dy) <= closeDistance) {
          // Close the polygon
          const newPolygon = createPolygon(tempPoints);
          const currentPolygons = getPolygons();
          updatePolygons([...currentPolygons, newPolygon]);

          // Reset state
          setTempPoints([]);
          setEditMode(EditMode.View);
          return;
        }
      }

      // Add point to temporary points
      setTempPoints([...tempPoints, imagePoint]);
    },
    [
      tempPoints,
      transform.zoom,
      getPolygons,
      updatePolygons,
      setTempPoints,
      setEditMode,
    ]
  );

  /**
   * Handle Edit Vertices mode clicks
   */
  const handleEditVerticesClick = useCallback(
    (imagePoint: Point) => {
      if (!selectedPolygonId) return;

      const polygons = getPolygons();
      const selectedPolygon = polygons.find(p => p.id === selectedPolygonId);
      if (!selectedPolygon) return;

      // Check if we're clicking on a vertex
      const hitRadius = EDITING_CONSTANTS.VERTEX_HIT_RADIUS / transform.zoom;
      const closestVertex = findClosestVertex(
        imagePoint,
        selectedPolygon.points,
        hitRadius
      );

      if (closestVertex) {
        // Start dragging this vertex
        setInteractionState({
          ...interactionState,
          isDraggingVertex: true,
          draggedVertexInfo: {
            polygonId: selectedPolygonId,
            vertexIndex: closestVertex.index,
          },
          originalVertexPosition: {
            ...selectedPolygon.points[closestVertex.index],
          },
        });
      }
    },
    [
      selectedPolygonId,
      interactionState,
      transform.zoom,
      getPolygons,
      setInteractionState,
    ]
  );

  /**
   * Handle Add Points mode clicks
   */
  const handleAddPointsClick = useCallback(
    (imagePoint: Point) => {
      if (!selectedPolygonId) return;

      const polygons = getPolygons();
      const selectedPolygon = polygons.find(p => p.id === selectedPolygonId);
      if (!selectedPolygon) return;

      if (interactionState.isAddingPoints) {
        // We're in the middle of adding points
        if (interactionState.addPointStartVertex) {
          // Check if we're clicking on another vertex to complete the sequence
          const hitRadius =
            EDITING_CONSTANTS.VERTEX_HIT_RADIUS / transform.zoom;
          const closestVertex = findClosestVertex(
            imagePoint,
            selectedPolygon.points,
            hitRadius
          );

          if (
            closestVertex &&
            closestVertex.index !==
              interactionState.addPointStartVertex.vertexIndex
          ) {
            // Complete the sequence - implement CVAT-like point insertion
            const newPoints = insertPointsBetweenVertices(
              selectedPolygon.points,
              interactionState.addPointStartVertex.vertexIndex,
              closestVertex.index,
              tempPoints
            );

            if (newPoints) {
              const updatedPolygons = polygons.map(polygon => {
                if (polygon.id === selectedPolygonId) {
                  return { ...polygon, points: newPoints };
                }
                return polygon;
              });
              updatePolygons(updatedPolygons);
            }

            // Reset state
            setTempPoints([]);
            setInteractionState({
              ...interactionState,
              isAddingPoints: false,
              addPointStartVertex: null,
              addPointEndVertex: null,
            });
            setEditMode(EditMode.EditVertices);
            return;
          }

          // Add point to sequence
          setTempPoints([...tempPoints, imagePoint]);
        }
      } else {
        // Start adding points - check if we clicked on a vertex
        const hitRadius = EDITING_CONSTANTS.VERTEX_HIT_RADIUS / transform.zoom;
        const closestVertex = findClosestVertex(
          imagePoint,
          selectedPolygon.points,
          hitRadius
        );

        if (closestVertex) {
          // Start adding points from this vertex
          setInteractionState({
            ...interactionState,
            isAddingPoints: true,
            addPointStartVertex: {
              polygonId: selectedPolygonId,
              vertexIndex: closestVertex.index,
            },
          });
          setTempPoints([]);
        }
      }
    },
    [
      selectedPolygonId,
      interactionState,
      tempPoints,
      transform.zoom,
      getPolygons,
      updatePolygons,
      setTempPoints,
      setInteractionState,
      setEditMode,
    ]
  );

  /**
   * Handle Slice mode clicks
   */
  const handleSliceClick = useCallback((imagePoint: Point) => {
    // Implementation will be added in Phase 2.2
    throw new Error(
      'NotImplementedError: Slice mode functionality is not yet implemented'
    );
  }, []);

  /**
   * Handle Delete Polygon mode clicks
   */
  const handleDeletePolygonClick = useCallback(
    (imagePoint: Point) => {
      const polygons = getPolygons();
      const containingPolygons = polygons.filter(polygon =>
        isPointInPolygon(imagePoint, polygon.points)
      );

      if (containingPolygons.length > 0) {
        // If multiple polygons, prioritize the smallest one
        if (containingPolygons.length > 1) {
          containingPolygons.sort((a, b) => {
            const areaA = calculatePolygonArea(a.points);
            const areaB = calculatePolygonArea(b.points);
            return areaA - areaB;
          });
        }

        const polygonToDelete = containingPolygons[0];
        const updatedPolygons = polygons.filter(
          p => p.id !== polygonToDelete.id
        );
        updatePolygons(updatedPolygons);

        if (selectedPolygonId === polygonToDelete.id) {
          setSelectedPolygonId(null);
        }
      }
    },
    [getPolygons, updatePolygons, selectedPolygonId, setSelectedPolygonId]
  );

  /**
   * Handle mouse move events
   */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const coordinates = getCanvasCoordinates(
        e.clientX,
        e.clientY,
        transform,
        canvasRef
      );
      const imagePoint = { x: coordinates.imageX, y: coordinates.imageY };

      // Handle panning
      if (interactionState.isPanning && interactionState.panStart) {
        const dx = e.clientX - interactionState.panStart.x;
        const dy = e.clientY - interactionState.panStart.y;

        // This would be handled by the parent component
        // We'll emit an event or call a callback

        setInteractionState({
          ...interactionState,
          panStart: { x: e.clientX, y: e.clientY },
        });
        return;
      }

      // Handle vertex dragging
      if (
        interactionState.isDraggingVertex &&
        interactionState.draggedVertexInfo
      ) {
        const { polygonId, vertexIndex } = interactionState.draggedVertexInfo;
        const polygons = getPolygons();

        const updatedPolygons = polygons.map(polygon => {
          if (polygon.id === polygonId) {
            const updatedPoints = [...polygon.points];
            updatedPoints[vertexIndex] = imagePoint;
            return { ...polygon, points: updatedPoints };
          }
          return polygon;
        });

        updatePolygons(updatedPolygons);
        return;
      }

      // Handle equidistant point placement with Shift key
      if (
        isShiftPressed.current &&
        (editMode === EditMode.CreatePolygon ||
          (editMode === EditMode.AddPoints && interactionState.isAddingPoints))
      ) {
        let referencePoint: Point | null = null;

        if (
          editMode === EditMode.AddPoints &&
          interactionState.addPointStartVertex &&
          tempPoints.length === 0
        ) {
          // Use start vertex as reference
          const selectedPolygon = getPolygons().find(
            p => p.id === selectedPolygonId
          );
          if (
            selectedPolygon &&
            interactionState.addPointStartVertex.vertexIndex <
              selectedPolygon.points.length
          ) {
            referencePoint =
              selectedPolygon.points[
                interactionState.addPointStartVertex.vertexIndex
              ];
          }
        } else if (tempPoints.length > 0) {
          referencePoint = tempPoints[tempPoints.length - 1];
        }

        if (referencePoint && lastAutoAddedPoint.current) {
          const dx = imagePoint.x - lastAutoAddedPoint.current.x;
          const dy = imagePoint.y - lastAutoAddedPoint.current.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          const MIN_DISTANCE =
            EDITING_CONSTANTS.MIN_AUTO_ADD_DISTANCE / transform.zoom;

          if (distance >= MIN_DISTANCE) {
            setTempPoints([...tempPoints, imagePoint]);
            lastAutoAddedPoint.current = imagePoint;
          }
        }

        if (!lastAutoAddedPoint.current && referencePoint) {
          lastAutoAddedPoint.current = referencePoint;
        }
      }

      // Update hover state for vertices
      if (
        (editMode === EditMode.EditVertices ||
          editMode === EditMode.AddPoints) &&
        selectedPolygonId
      ) {
        const polygons = getPolygons();
        const selectedPolygon = polygons.find(p => p.id === selectedPolygonId);

        if (selectedPolygon) {
          const hitRadius =
            EDITING_CONSTANTS.VERTEX_HIT_RADIUS / transform.zoom;
          const closestVertex = findClosestVertex(
            imagePoint,
            selectedPolygon.points,
            hitRadius
          );

          if (closestVertex) {
            setHoveredVertex({
              polygonId: selectedPolygonId,
              vertexIndex: closestVertex.index,
            });
          } else {
            setHoveredVertex(null);
          }
        }
      }
    },
    [
      editMode,
      interactionState,
      transform,
      selectedPolygonId,
      tempPoints,
      getPolygons,
      updatePolygons,
      setInteractionState,
      setTempPoints,
      setHoveredVertex,
    ]
  );

  /**
   * Handle mouse up events
   */
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // End panning
      if (interactionState.isPanning) {
        setInteractionState({
          ...interactionState,
          isPanning: false,
          panStart: null,
        });
      }

      // End vertex dragging
      if (interactionState.isDraggingVertex) {
        setInteractionState({
          ...interactionState,
          isDraggingVertex: false,
          draggedVertexInfo: null,
          originalVertexPosition: null,
        });
      }
    },
    [interactionState, setInteractionState]
  );

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
};

/**
 * Helper function to insert points between vertices using CVAT-like algorithm
 */
function insertPointsBetweenVertices(
  originalPoints: Point[],
  startVertexIndex: number,
  endVertexIndex: number,
  newPoints: Point[]
): Point[] | null {
  if (newPoints.length === 0) return null;

  const numPoints = originalPoints.length;

  // Create two candidate polygons by replacing different paths
  const candidate1Points: Point[] = [];
  const candidate2Points: Point[] = [];

  // Candidate 1: Replace the forward path
  if (startVertexIndex < endVertexIndex) {
    // No wrapping case
    for (let i = 0; i <= startVertexIndex; i++) {
      candidate1Points.push(originalPoints[i]);
    }
    candidate1Points.push(...newPoints);
    for (let i = endVertexIndex; i < numPoints; i++) {
      candidate1Points.push(originalPoints[i]);
    }
  } else {
    // Wrapping case
    for (let i = 0; i <= endVertexIndex; i++) {
      candidate1Points.push(originalPoints[i]);
    }
    candidate1Points.push(...[...newPoints].reverse());
    for (let i = startVertexIndex; i < numPoints; i++) {
      candidate1Points.push(originalPoints[i]);
    }
  }

  // Candidate 2: Replace the backward path
  if (startVertexIndex < endVertexIndex) {
    candidate2Points.push(originalPoints[startVertexIndex]);
    candidate2Points.push(...newPoints);
    candidate2Points.push(originalPoints[endVertexIndex]);

    let idx = (endVertexIndex + 1) % numPoints;
    while (idx !== startVertexIndex) {
      candidate2Points.push(originalPoints[idx]);
      idx = (idx + 1) % numPoints;
    }
  } else {
    candidate2Points.push(originalPoints[startVertexIndex]);
    candidate2Points.push(...newPoints);
    candidate2Points.push(originalPoints[endVertexIndex]);

    for (let i = endVertexIndex + 1; i < startVertexIndex; i++) {
      candidate2Points.push(originalPoints[i]);
    }
  }

  // Calculate perimeters and choose the larger one (CVAT-like behavior)
  const perimeter1 = calculatePolygonPerimeter(candidate1Points);
  const perimeter2 = calculatePolygonPerimeter(candidate2Points);

  return perimeter1 >= perimeter2 ? candidate1Points : candidate2Points;
}

/**
 * Helper function to calculate polygon perimeter
 */
function calculatePolygonPerimeter(points: Point[]): number {
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const nextIndex = (i + 1) % points.length;
    const dx = points[nextIndex].x - points[i].x;
    const dy = points[nextIndex].y - points[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter;
}
