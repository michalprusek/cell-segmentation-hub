import { startTransition, useCallback, useEffect, useRef } from 'react';
import { Point, Polygon } from '@/lib/segmentation';
import {
  EditMode,
  InteractionState,
  TransformState,
  EDITING_CONSTANTS,
} from '../types';
import { getCanvasCoordinates } from '@/lib/coordinateUtils';
import {
  isPointInPolygon,
  findClosestVertex,
  calculatePolygonPerimeter,
  createPolygon,
} from '@/lib/polygonGeometry';
import { vertexSpatialIndex } from '@/lib/rendering/VertexSpatialIndex';
import { polylineSemanticsForProjectType } from '@/lib/polylineSemantics';
import type { ProjectType } from '@/types';

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
  activePartClassRef?: React.RefObject<'head' | 'midpiece' | 'tail'>;
  activeInstanceIdRef?: React.RefObject<string>;
  /** Gates the MT-specific Add-Points auto-anchor flow. */
  projectType?: ProjectType;

  // State setters
  onPolygonSelection: (id: string | null) => void; // Centralized selection handler
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
  cursorPosition: _cursorPosition,
  isShiftPressed: isShiftPressedCallback,
  isSpacePressed: isSpacePressedCallback,
  activePartClassRef,
  activeInstanceIdRef,
  projectType,
  onPolygonSelection,
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
  // Last image-space point at which we ran the vertex-hover hit test.
  // Used to skip the spatial-index lookup when the cursor hasn't moved
  // far enough (in image coords) to possibly change which vertex is
  // under it. Huge win for 4000-point polygons.
  //
  // Must be reset whenever the hit-test target changes — otherwise the
  // first mousemove after (re)selection or drag-end skips the check and
  // hover stays stuck on an index from the previous target.
  const lastHoverCheckPoint = useRef<Point | null>(null);

  useEffect(() => {
    lastHoverCheckPoint.current = null;
  }, [selectedPolygonId, editMode]);

  /**
   * Handle View mode clicks - panning only (polygon selection handled by CanvasPolygon onClick)
   */
  const handleViewModeClick = useCallback(
    (imagePoint: Point, e: React.MouseEvent) => {
      // In View mode, deselect current polygon if clicking on empty space
      // Polygon selection is handled by CanvasPolygon onClick events which call stopPropagation()
      // So if this handler runs, it means we clicked on empty space
      if (selectedPolygonId) {
        onPolygonSelection(null);
        return;
      }

      // Start panning for free navigation when no polygon is selected
      setInteractionState({
        ...interactionState,
        isPanning: true,
        panStart: { x: e.clientX, y: e.clientY },
      });
    },
    [
      interactionState,
      selectedPolygonId,
      setInteractionState,
      onPolygonSelection,
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
        // Open polyline: auto-anchor at nearest endpoint, treat click as
        // first new point so the curve can be extended without first
        // clicking the original endpoint. Enter commits via
        // handleEnterPolyline. Closed polygons fall through to the
        // legacy click-vertex splice path below.
        const isExtendablePolyline =
          selectedPolygon.geometry === 'polyline' &&
          selectedPolygon.points.length >= 2;
        if (isExtendablePolyline) {
          const head = selectedPolygon.points[0];
          const tail =
            selectedPolygon.points[selectedPolygon.points.length - 1];
          const distHead =
            (imagePoint.x - head.x) ** 2 + (imagePoint.y - head.y) ** 2;
          const distTail =
            (imagePoint.x - tail.x) ** 2 + (imagePoint.y - tail.y) ** 2;
          const anchorIndex =
            distHead <= distTail ? 0 : selectedPolygon.points.length - 1;
          setInteractionState({
            ...interactionState,
            isAddingPoints: true,
            addPointStartVertex: {
              polygonId: selectedPolygonId,
              vertexIndex: anchorIndex,
            },
          });
          setTempPoints([imagePoint]);
          return;
        }
        // Other geometries / projects: keep the legacy click-vertex anchor.
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
        // Two completion paths: click a different vertex = splice via
        // insertPointsBetweenVertices (all geometries); Enter = endpoint
        // extension (MT only) via handleEnterPolyline.
        if (closestVertex && interactionState.addPointStartVertex) {
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

      // Step 1: If no polygon is selected, slice tool needs polygon selection first
      if (!selectedPolygonId) {
        // No polygon selected - slice tool needs polygon selection first
        return;
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
    ]
  );

  /**
   * Handle Create Polyline mode clicks — adds a point to the in-progress polyline
   */
  const handleCreatePolylineClick = useCallback(
    (imagePoint: Point) => {
      // Add point to temporary points
      setTempPoints([...tempPoints, imagePoint]);
    },
    [tempPoints, setTempPoints]
  );

  /**
   * Handle Create Polyline double-click to finalize
   */
  const handleCreatePolylineDoubleClick = useCallback(() => {
    // No duplicate point: React 18 batching means both click setState calls share the same base snapshot
    if (tempPoints.length >= 2) {
      const newPolyline = createPolygon(tempPoints);
      // A polyline is a generic labeling primitive; its identity fields follow
      // the PROJECT type, not a sperm default. Sperm carries head/midpiece/tail
      // part classes and the panel-managed `sperm_N` id; microtubule / generic
      // projects get a fresh unique kind-prefixed id and NO part class (part
      // classes are sperm-only). This stops a hand-drawn polyline in a
      // microtubule project from being stamped `partClass:'head'` + `sperm_1`
      // (which used to flip the whole sidebar to the sperm panel).
      const semantics = polylineSemanticsForProjectType(projectType);
      const polyline: Polygon = {
        ...newPolyline,
        geometry: 'polyline',
        partClass: semantics.supportsPartClass
          ? activePartClassRef?.current || undefined
          : undefined,
        instanceId:
          semantics.kind === 'sperm'
            ? activeInstanceIdRef?.current || undefined
            : `${semantics.idPrefix}${newPolyline.id.replace(/^polygon_/, '')}`,
      };
      const currentPolygons = getPolygons();
      updatePolygons([...currentPolygons, polyline]);

      // Reset state
      setTempPoints([]);
      setEditMode(EditMode.View);
    }
  }, [
    tempPoints,
    getPolygons,
    updatePolygons,
    setTempPoints,
    setEditMode,
    activePartClassRef,
    activeInstanceIdRef,
    projectType,
  ]);

  /**
   * Handle Delete Polygon mode clicks
   */
  const handleDeletePolygonClick = useCallback((_imagePoint: Point) => {
    // Delete mode now relies on polygon-level selection
    return;
  }, []);

  /**
   * Check if the event target is a vertex element
   */
  const isVertexTarget = useCallback((target: EventTarget | null): boolean => {
    if (!target || !(target instanceof SVGElement)) return false;
    return (
      target.dataset?.polygonId !== undefined &&
      target.dataset?.vertexIndex !== undefined
    );
  }, []);

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

      // Right-click - handle step-by-step undo OR allow vertex context menu
      if (e.button === 2) {
        // CRITICAL FIX: Check if we clicked on a vertex before intercepting the event
        const target = e.target as SVGElement;

        // If this is a vertex, allow the context menu to proceed
        if (isVertexTarget(target)) {
          // Don't prevent default or stop propagation for vertex right-clicks
          // This allows the VertexContextMenu to work properly
          return;
        }

        // Not a vertex - proceed with existing step-by-step undo logic
        // Special handling for polyline creation - step-by-step undo
        if (editMode === EditMode.CreatePolyline) {
          if (tempPoints.length > 0) {
            // Remove last placed point
            setTempPoints(tempPoints.slice(0, -1));
          } else {
            // No points - exit to View mode
            setEditMode(EditMode.View);
          }
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        // Special handling for slice mode - step-by-step undo
        if (editMode === EditMode.Slice) {
          if (tempPoints.length > 0) {
            // There's a slice point placed - remove it and go back to polygon selection
            setTempPoints([]);
            setInteractionState({
              ...interactionState,
              sliceStartPoint: null,
            });
          } else if (selectedPolygonId) {
            // Polygon is selected but no slice points - deselect polygon but stay in slice mode
            onPolygonSelection(null);
            setInteractionState({
              ...interactionState,
              sliceStartPoint: null,
            });
          } else {
            // Nothing selected - exit slice mode to View mode
            setEditMode(EditMode.View);
          }
        } else {
          // For other modes - always cancel current operation
          if (editMode !== EditMode.View) {
            setEditMode(EditMode.View);
            setTempPoints([]);
          }
        }
        e.preventDefault();
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
        // Canvas mouseDown event

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
                  onPolygonSelection(polygonId);
                }
                // Anchor at the clicked vertex — it becomes the PIVOT the new
                // sequence grows from. On commit (handleEnterPolyline) the arm
                // running from this pivot toward the drawn direction is
                // replaced by the new points; the opposite arm (plus the
                // pivot) is kept. A pivot that is itself an endpoint
                // degenerates to a plain endpoint extension.
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
              // Starting vertex drag

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
                // Vertex drag state initialized
              } else {
                // setVertexDragState not available
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
          case EditMode.CreatePolyline:
            handleCreatePolylineClick(imagePoint);
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
      tempPoints,
      getPolygons,
      setInteractionState,
      setVertexDragState,
      setEditMode,
      setTempPoints,
      canvasRef,
      handleAddPointsClick,
      handleCreatePolygonClick,
      handleCreatePolylineClick,
      handleDeletePolygonClick,
      handleEditVerticesClick,
      handleSliceClick,
      handleViewModeClick,
      isSpacePressedCallback,
      isVertexTarget,
      onPolygonSelection,
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

          // Vertex drag offset updated
        }
        return;
      }

      // Handle equidistant point placement with Shift key
      const isShiftCurrentlyPressed = isShiftPressedCallback
        ? isShiftPressedCallback()
        : false;

      // Shift-without-click bootstrap for open-polyline AddPoints: seed
      // state so the next mouseMove can enter the equidistant branch.
      if (
        isShiftCurrentlyPressed &&
        editMode === EditMode.AddPoints &&
        !interactionState.isAddingPoints &&
        selectedPolygonId
      ) {
        const selectedPolygon = getPolygons().find(
          p => p.id === selectedPolygonId
        );
        if (
          selectedPolygon &&
          selectedPolygon.geometry === 'polyline' &&
          selectedPolygon.points.length >= 2
        ) {
          const head = selectedPolygon.points[0];
          const tail =
            selectedPolygon.points[selectedPolygon.points.length - 1];
          const distHead =
            (imagePoint.x - head.x) ** 2 + (imagePoint.y - head.y) ** 2;
          const distTail =
            (imagePoint.x - tail.x) ** 2 + (imagePoint.y - tail.y) ** 2;
          const anchorIndex =
            distHead <= distTail ? 0 : selectedPolygon.points.length - 1;
          setInteractionState({
            ...interactionState,
            isAddingPoints: true,
            addPointStartVertex: {
              polygonId: selectedPolygonId,
              vertexIndex: anchorIndex,
            },
          });
          lastAutoAddedPoint.current = selectedPolygon.points[anchorIndex];
          // Seed tempPoints with the current cursor so Enter is always
          // commit-able, even if the user releases Shift between this
          // bootstrap tick and the next mouseMove.
          setTempPoints([imagePoint]);
          return;
        }
      }

      if (
        isShiftCurrentlyPressed &&
        (editMode === EditMode.CreatePolygon ||
          editMode === EditMode.CreatePolyline ||
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
          // Skip the hit test if the cursor barely moved in image space.
          // Threshold is sub-pixel in screen space (0.5px) so hover still
          // feels instantaneous — but at high zoom on a 4000-point polygon
          // this skips 90%+ of mousemove events.
          const hoverMoveThresholdSq = Math.max(
            0.25 / (transform.zoom * transform.zoom),
            0.0001
          );
          const last = lastHoverCheckPoint.current;
          if (last) {
            const mdx = imagePoint.x - last.x;
            const mdy = imagePoint.y - last.y;
            if (mdx * mdx + mdy * mdy < hoverMoveThresholdSq) {
              return;
            }
          }
          lastHoverCheckPoint.current = imagePoint;

          const hitRadius =
            EDITING_CONSTANTS.VERTEX_HIT_RADIUS / transform.zoom;
          const closestVertexIndex = vertexSpatialIndex.findNearestVertex(
            selectedPolygonId,
            selectedPolygon.points,
            imagePoint.x,
            imagePoint.y,
            hitRadius
          );

          if (closestVertexIndex !== null) {
            setHoveredVertex({
              polygonId: selectedPolygonId,
              vertexIndex: closestVertexIndex,
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

          // Invalidate the spatial index eagerly — identity-based rebuild
          // would catch it on the next query, but dropping it here keeps
          // any query in the same tick from hitting stale data.
          vertexSpatialIndex.invalidate(polygonId);
          // The cursor is still sitting on the dragged vertex's new
          // position, so clear the hover-skip memo — otherwise the next
          // mousemove may skip the hit test and leave hover stuck.
          lastHoverCheckPoint.current = null;

          // The polygons-array rebuild re-renders every memoized child.
          // For a 4000-point polygon that's the most expensive part of a
          // vertex drag. Marking it non-urgent lets the pointerup event
          // finish on the synchronous cycle and the heavy re-render run
          // in React's idle time, avoiding a visible stutter.
          startTransition(() => {
            updatePolygons(updatedPolygons);
          });

          // Drag state itself must clear synchronously so the UI stops
          // drawing the drag offset immediately.
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
    handleCreatePolylineDoubleClick,
  };
};

/**
 * Helper function to insert points between vertices using normalized path logic
 * Ensures consistent behavior regardless of click order (A→B vs B→A)
 */
export function insertPointsBetweenVertices(
  originalPoints: Point[],
  startVertexIndex: number,
  endVertexIndex: number,
  newPoints: Point[]
): Point[] | null {
  // The two clicked vertices split the boundary into two arcs (the "inner" arc
  // running directly between them by index, and the "outer" arc that wraps the
  // other way). The newly drawn sequence replaces ONE arc. We build both
  // genuinely-different candidates and KEEP whichever has the LARGER perimeter —
  // i.e. the sequence joins the bigger portion of the outline. (Requested
  // behavior: Add Points always grows toward the larger-perimeter result.)

  const numPoints = originalPoints.length;

  // Normalize so vertex1 is the smaller index and vertex2 the larger.
  const vertex1 = Math.min(startVertexIndex, endVertexIndex);
  const vertex2 = Math.max(startVertexIndex, endVertexIndex);

  // Adjacent vertices with nothing to add: no-op.
  if (
    newPoints.length === 0 &&
    (vertex2 - vertex1 === 1 || (vertex1 === 0 && vertex2 === numPoints - 1))
  ) {
    return originalPoints;
  }

  // Orient the drawn sequence to run vertex1 -> vertex2 (clicks may be in
  // either order).
  const seq =
    startVertexIndex > endVertexIndex ? [...newPoints].reverse() : newPoints;

  // Inner arc: vertex1 -> vertex1+1 -> ... -> vertex2 (direct, by index).
  const innerArc: Point[] = [];
  for (let i = vertex1; i <= vertex2; i++) innerArc.push(originalPoints[i]);

  // Outer arc: vertex2 -> ... -> numPoints-1 -> 0 -> ... -> vertex1 (wrapped).
  const outerArc: Point[] = [];
  for (let i = vertex2; i < numPoints; i++) outerArc.push(originalPoints[i]);
  for (let i = 0; i <= vertex1; i++) outerArc.push(originalPoints[i]);

  // Candidate A — keep the inner arc; the sequence replaces the outer arc.
  //   inner (v1..v2) then the sequence back (v2..v1).
  const keepInner = [...innerArc, ...[...seq].reverse()];
  // Candidate B — keep the outer arc; the sequence replaces the inner arc.
  //   outer (v2..v1 wrapped) then the sequence forward (v1..v2).
  const keepOuter = [...outerArc, ...seq];

  const perimeterInner = calculatePolygonPerimeter(keepInner);
  const perimeterOuter = calculatePolygonPerimeter(keepOuter);

  // Keep the larger-perimeter result.
  return perimeterInner >= perimeterOuter ? keepInner : keepOuter;
}
