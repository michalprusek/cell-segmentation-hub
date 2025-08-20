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
  isShiftPressed?: () => boolean;
  isSpacePressed?: () => boolean;

  // State setters
  setSelectedPolygonId: (id: string | null) => void;
  setEditMode: (mode: EditMode) => void;
  setInteractionState: (state: InteractionState) => void;
  setTempPoints: (points: Point[]) => void;
  setHoveredVertex: (
    vertex: { polygonId: string; vertexIndex: number } | null
  ) => void;
  setVertexDragState?: (state: {
    isDragging: boolean;
    polygonId: string | null;
    vertexIndex: number | null;
    dragOffset?: { x: number; y: number };
    originalPosition?: { x: number; y: number };
  }) => void;

  // Data operations
  updatePolygons: (polygons: Polygon[]) => void;
  getPolygons: () => Polygon[];

  // Transform operations
  handlePan?: (deltaX: number, deltaY: number) => void;
}

export const useAdvancedInteractions = ({
  editMode,
  interactionState,
  transform,
  canvasRef,
  selectedPolygonId,
  tempPoints,
  cursorPosition,
  isShiftPressed: isShiftPressedCallback,
  isSpacePressed: isSpacePressedCallback,
  setSelectedPolygonId,
  setEditMode,
  setInteractionState,
  setTempPoints,
  setHoveredVertex,
  setVertexDragState,
  updatePolygons,
  getPolygons,
  handlePan,
}: UseAdvancedInteractionsProps) => {
  // Refs for tracking state
  const lastAutoAddedPoint = useRef<Point | null>(null);

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
        return; // Don't start panning if we selected a polygon
      }

      // No polygon clicked - start panning for free navigation
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
    (imagePoint: Point, e?: React.MouseEvent) => {
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
        const originalPosition = selectedPolygon.points[closestVertex.index];

        setInteractionState({
          ...interactionState,
          isDraggingVertex: true,
          draggedVertexInfo: {
            polygonId: selectedPolygonId,
            vertexIndex: closestVertex.index,
          },
          originalVertexPosition: {
            ...originalPosition,
          },
        });

        // Initialize vertex drag state with original position
        if (setVertexDragState) {
          setVertexDragState({
            isDragging: true,
            polygonId: selectedPolygonId,
            vertexIndex: closestVertex.index,
            originalPosition: { ...originalPosition },
            dragOffset: { x: 0, y: 0 },
          });
        }
      } else {
        // No vertex clicked - check if we're inside the selected polygon and start panning
        // This allows panning when clicking inside a selected polygon but not on a vertex
        if (isPointInPolygon(imagePoint, selectedPolygon.points) && e) {
          setInteractionState({
            ...interactionState,
            isPanning: true,
            panStart: { x: e.clientX, y: e.clientY },
          });
        }
      }
    },
    [
      selectedPolygonId,
      interactionState,
      transform.zoom,
      getPolygons,
      setInteractionState,
      setVertexDragState,
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

      const hitRadius = EDITING_CONSTANTS.VERTEX_HIT_RADIUS / transform.zoom;
      const closestVertex = findClosestVertex(
        imagePoint,
        selectedPolygon.points,
        hitRadius
      );

      if (!interactionState.isAddingPoints) {
        // Start adding points - must click on a vertex
        if (closestVertex) {
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
      } else {
        // We're in adding points mode
        if (closestVertex && interactionState.addPointStartVertex) {
          // Check if clicking on different vertex to complete the sequence
          if (
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

            // Reset state and switch back to edit vertices mode when done adding points
            setTempPoints([]);
            setInteractionState({
              ...interactionState,
              isAddingPoints: false,
              addPointStartVertex: null,
              addPointEndVertex: null,
            });
            // Switch back to edit vertices mode when add points is completed
            setEditMode(EditMode.EditVertices);
            return;
          }
        } else {
          // Add intermediate point to sequence (not on a vertex)
          setTempPoints([...tempPoints, imagePoint]);
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
  const handleSliceClick = useCallback(
    (imagePoint: Point) => {
      const polygons = getPolygons();

      // Step 1: If no polygon is selected, try to find one at the click point
      if (!selectedPolygonId) {
        const containingPolygons = polygons.filter(polygon =>
          isPointInPolygon(imagePoint, polygon.points)
        );

        if (containingPolygons.length > 0) {
          // If multiple polygons, prioritize the smallest one (likely a hole)
          if (containingPolygons.length > 1) {
            containingPolygons.sort((a, b) => {
              const areaA = calculatePolygonArea(a.points);
              const areaB = calculatePolygonArea(b.points);
              return areaA - areaB;
            });
          }

          // Select the polygon but don't start slicing yet - wait for next click
          const polygonToSlice = containingPolygons[0];
          setSelectedPolygonId(polygonToSlice.id);
          return;
        } else {
          // No polygon found at click point
          return;
        }
      }

      // We have a selected polygon, continue with slice logic
      const selectedPolygon = polygons.find(p => p.id === selectedPolygonId);
      if (!selectedPolygon) return;

      if (tempPoints.length === 0) {
        // Step 2: First slice point - set slice start
        setTempPoints([imagePoint]);
        setInteractionState({
          ...interactionState,
          sliceStartPoint: imagePoint,
        });
      } else if (tempPoints.length === 1) {
        // Step 3: Second slice point - set slice end and attempt slice
        const newTempPoints = [...tempPoints, imagePoint];
        setTempPoints(newTempPoints);

        // The slice will be handled by the slicing hook
        // which is connected to the parent component
      }
    },
    [
      selectedPolygonId,
      tempPoints,
      interactionState,
      getPolygons,
      setTempPoints,
      setInteractionState,
      setSelectedPolygonId,
    ]
  );

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
   * Handle mouse down events with mode-specific logic
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Middle mouse button - always start panning in any mode
      if (e.button === 1) {
        setInteractionState({
          ...interactionState,
          isPanning: true,
          panStart: { x: e.clientX, y: e.clientY },
        });
        e.preventDefault();
        return;
      }

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

        // Check if Alt key or Space key is pressed for forced panning in any mode
        if (e.altKey || (isSpacePressedCallback && isSpacePressedCallback())) {
          // Start panning regardless of current mode
          setInteractionState({
            ...interactionState,
            isPanning: true,
            panStart: { x: e.clientX, y: e.clientY },
          });
          return;
        }

        // Check if we clicked on a vertex element directly
        const target = e.target as SVGElement;
        if (target && target.dataset) {
          const polygonId = target.dataset.polygonId;
          const vertexIndex = target.dataset.vertexIndex;

          if (
            polygonId &&
            vertexIndex !== undefined &&
            editMode === EditMode.EditVertices
          ) {
            // We clicked directly on a vertex
            const index = parseInt(vertexIndex, 10);
            const polygons = getPolygons();
            const polygon = polygons.find(p => p.id === polygonId);
            if (polygon && polygon.points[index]) {
              const originalPosition = polygon.points[index];

              // Check if Shift is pressed - start add points mode
              if (e.shiftKey) {
                // Only set selected polygon if it's not already selected
                if (selectedPolygonId !== polygonId) {
                  setSelectedPolygonId(polygonId);
                }
                setEditMode(EditMode.AddPoints);
                setInteractionState({
                  ...interactionState,
                  isAddingPoints: true,
                  addPointStartVertex: {
                    polygonId,
                    vertexIndex: index,
                  },
                });
                setTempPoints([]);
                return;
              }

              // Start dragging this vertex
              setInteractionState({
                ...interactionState,
                isDraggingVertex: true,
                draggedVertexInfo: {
                  polygonId,
                  vertexIndex: index,
                },
                originalVertexPosition: {
                  ...originalPosition,
                },
              });

              // Initialize vertex drag state with original position
              if (setVertexDragState) {
                setVertexDragState({
                  isDragging: true,
                  polygonId,
                  vertexIndex: index,
                  originalPosition: { ...originalPosition },
                  dragOffset: { x: 0, y: 0 },
                });
              }
              return;
            }
          }
        }

        switch (editMode) {
          case EditMode.View:
            handleViewModeClick(imagePoint, e);
            break;
          case EditMode.CreatePolygon:
            handleCreatePolygonClick(imagePoint);
            break;
          case EditMode.EditVertices:
            handleEditVerticesClick(imagePoint, e);
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
    [
      editMode,
      interactionState,
      transform,
      selectedPolygonId,
      getPolygons,
      setInteractionState,
      setVertexDragState,
      setEditMode,
      setTempPoints,
      canvasRef,
      handleAddPointsClick,
      handleCreatePolygonClick,
      handleDeletePolygonClick,
      handleEditVerticesClick,
      handleSliceClick,
      handleViewModeClick,
      setSelectedPolygonId,
      isSpacePressedCallback,
    ]
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

      // Handle panning - use smooth incremental movement
      if (
        interactionState.isPanning &&
        interactionState.panStart &&
        handlePan
      ) {
        const dx = e.clientX - interactionState.panStart.x;
        const dy = e.clientY - interactionState.panStart.y;

        // Only apply movement if there's actual delta to prevent unnecessary updates
        if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
          // Call the pan handler from parent component with the delta
          handlePan(dx, dy);

          // Update pan start position for next delta calculation
          setInteractionState({
            ...interactionState,
            panStart: { x: e.clientX, y: e.clientY },
          });
        }
        return;
      }

      // Handle vertex dragging - calculate offset instead of updating points
      if (
        interactionState.isDraggingVertex &&
        interactionState.draggedVertexInfo
      ) {
        const { polygonId, vertexIndex } = interactionState.draggedVertexInfo;

        // Calculate drag offset from original position
        if (interactionState.originalVertexPosition && setVertexDragState) {
          const offsetX =
            imagePoint.x - interactionState.originalVertexPosition.x;
          const offsetY =
            imagePoint.y - interactionState.originalVertexPosition.y;

          // Update only the drag offset, not the actual points
          setVertexDragState({
            isDragging: true,
            polygonId,
            vertexIndex,
            originalPosition: interactionState.originalVertexPosition,
            dragOffset: { x: offsetX, y: offsetY },
          });
        }
        return;
      }

      // Handle equidistant point placement with Shift key
      const isShiftCurrentlyPressed = isShiftPressedCallback
        ? isShiftPressedCallback()
        : false;

      if (
        isShiftCurrentlyPressed &&
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

        if (referencePoint) {
          if (!lastAutoAddedPoint.current) {
            lastAutoAddedPoint.current = referencePoint;
          }

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
      } else {
        // Reset when shift is released
        if (!isShiftCurrentlyPressed) {
          lastAutoAddedPoint.current = null;
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
      setInteractionState,
      setTempPoints,
      setHoveredVertex,
      setVertexDragState,
      canvasRef,
      handlePan,
      isShiftPressedCallback,
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

      // End vertex dragging - apply final position
      if (
        interactionState.isDraggingVertex &&
        interactionState.draggedVertexInfo
      ) {
        const { polygonId, vertexIndex } = interactionState.draggedVertexInfo;

        // Apply the final position if we have a drag offset
        if (setVertexDragState) {
          // Get the current drag state to apply the final position
          const coordinates = getCanvasCoordinates(
            e.clientX,
            e.clientY,
            transform,
            canvasRef
          );
          const finalPoint = { x: coordinates.imageX, y: coordinates.imageY };

          // Update the actual polygon points with the final position
          const polygons = getPolygons();
          const updatedPolygons = polygons.map(polygon => {
            if (polygon.id === polygonId) {
              const updatedPoints = [...polygon.points];
              updatedPoints[vertexIndex] = finalPoint;
              return { ...polygon, points: updatedPoints };
            }
            return polygon;
          });

          updatePolygons(updatedPolygons);

          // Clear the drag state
          setVertexDragState({
            isDragging: false,
            polygonId: null,
            vertexIndex: null,
            dragOffset: undefined,
            originalPosition: undefined,
          });
        }

        setInteractionState({
          ...interactionState,
          isDraggingVertex: false,
          draggedVertexInfo: null,
          originalVertexPosition: null,
        });
      }
    },
    [
      interactionState,
      setInteractionState,
      setVertexDragState,
      getPolygons,
      updatePolygons,
      transform,
      canvasRef,
    ]
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
  // If no new points, remove points between vertices instead
  if (newPoints.length === 0) {
    return removePointsBetweenVertices(
      originalPoints,
      startVertexIndex,
      endVertexIndex
    );
  }

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

/**
 * Helper function to remove points between two vertices
 * Chooses the shorter path to maintain logical polygon shape
 */
function removePointsBetweenVertices(
  originalPoints: Point[],
  startVertexIndex: number,
  endVertexIndex: number
): Point[] {
  const numPoints = originalPoints.length;

  // If adjacent vertices, no points to remove
  if (
    Math.abs(startVertexIndex - endVertexIndex) === 1 ||
    Math.abs(startVertexIndex - endVertexIndex) === numPoints - 1
  ) {
    return originalPoints;
  }

  // Create two candidate polygons by keeping different paths
  const candidate1Points: Point[] = [];
  const candidate2Points: Point[] = [];

  // Candidate 1: Keep the forward path from start to end
  if (startVertexIndex < endVertexIndex) {
    // Direct path (remove points between)
    for (let i = 0; i <= startVertexIndex; i++) {
      candidate1Points.push(originalPoints[i]);
    }
    for (let i = endVertexIndex; i < numPoints; i++) {
      candidate1Points.push(originalPoints[i]);
    }
  } else {
    // Wrapped path (remove points between, crossing zero)
    for (let i = 0; i <= endVertexIndex; i++) {
      candidate1Points.push(originalPoints[i]);
    }
    for (let i = startVertexIndex; i < numPoints; i++) {
      candidate1Points.push(originalPoints[i]);
    }
  }

  // Candidate 2: Keep the backward path from end to start
  if (startVertexIndex < endVertexIndex) {
    // Keep points from start to end (remove the rest)
    for (let i = startVertexIndex; i <= endVertexIndex; i++) {
      candidate2Points.push(originalPoints[i]);
    }
  } else {
    // Keep wrapped path from start to end
    for (let i = startVertexIndex; i < numPoints; i++) {
      candidate2Points.push(originalPoints[i]);
    }
    for (let i = 0; i <= endVertexIndex; i++) {
      candidate2Points.push(originalPoints[i]);
    }
  }

  // Return the polygon with shorter perimeter (removes more points)
  const perimeter1 = calculatePolygonPerimeter(candidate1Points);
  const perimeter2 = calculatePolygonPerimeter(candidate2Points);

  return perimeter1 <= perimeter2 ? candidate1Points : candidate2Points;
}
