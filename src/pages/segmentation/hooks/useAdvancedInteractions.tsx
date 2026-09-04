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
import {
  findJoinTarget,
  scanJoinTargets,
  joinPolylinePoints,
  inheritJoinClass,
  nearestEndpoint,
  endpointPoint,
  type Endpoint,
} from '../utils/polylineJoin';
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
  /**
   * Called when an Add-Points click landed on a foreign polyline endpoint
   * that is close enough to join but carries a DIFFERENT label. The editor
   * turns it into a toast; this hook cannot call `t()` itself (it is not
   * mounted under `LanguageProvider` in the hook tests, and composing the
   * sentence here would be a hard-coded English string either way), so the
   * message stays at the render layer.
   */
  onJoinBlockedByClass?: () => void;

  // State setters
  onPolygonSelection: (id: string | null) => void; // Centralized selection handler
  setEditMode: (mode: EditMode) => void;
  setInteractionState: (state: InteractionState) => void;
  setTempPoints: (points: Point[]) => void;
  setHoveredVertex: (
    vertex: { polygonId: string; vertexIndex: number } | null
  ) => void;
  setHoveredJoinTarget: (
    target: { polygonId: string; endpoint: 'head' | 'tail' } | null
  ) => void;
  setVertexDragState?: (state: {
    isDragging: boolean;
    polygonId: string | null;
    vertexIndex: number | null;
    dragOffset?: { x: number; y: number };
    originalPosition?: { x: number; y: number };
    mode?: 'vertex' | 'translate';
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
  onJoinBlockedByClass,
  onPolygonSelection,
  setEditMode,
  setInteractionState,
  setTempPoints,
  setHoveredVertex,
  setHoveredJoinTarget,
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
          vertexGrabPoint: { ...imagePoint },
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

      // Join: clicking a compatible foreign polyline's endpoint merges it
      // into the selected polyline (A survives, B is dropped from this frame).
      // Prefer the join only when the foreign endpoint is at least as close
      // as A's own nearest vertex, so existing splice/extend keeps priority.
      const { target: joinTarget, blockedByClass } = scanJoinTargets(
        polygons,
        selectedPolygon,
        imagePoint,
        hitRadius,
        projectType
      );
      const ownVertexDistSq = closestVertex
        ? closestVertex.distance ** 2
        : Infinity;
      // A refused join used to be completely silent — no toast, no hover
      // ring, the click just became a plain add-point — which is how the
      // feature came to look broken. Say why, then fall through so the click
      // still does its other job.
      if (blockedByClass && blockedByClass.distanceSq <= ownVertexDistSq) {
        onJoinBlockedByClass?.();
      }
      if (joinTarget && joinTarget.distanceSq <= ownVertexDistSq) {
        const targetPolygon = polygons.find(p => p.id === joinTarget.polygonId);
        if (targetPolygon) {
          const anchor = interactionState.addPointStartVertex;
          const lastIdx = selectedPolygon.points.length - 1;
          let aEnd: Endpoint;
          let bridge: Point[];
          if (
            interactionState.isAddingPoints &&
            anchor &&
            anchor.polygonId === selectedPolygonId
          ) {
            // Phase 2: connect at the anchored end; drawn points form a bridge.
            aEnd =
              anchor.vertexIndex === 0
                ? 'head'
                : anchor.vertexIndex === lastIdx
                  ? 'tail'
                  : nearestEndpoint(
                      selectedPolygon,
                      endpointPoint(targetPolygon, joinTarget.endpoint)
                    );
            bridge = tempPoints;
          } else {
            // Phase 1: direct join at A's end nearer to the clicked endpoint.
            aEnd = nearestEndpoint(
              selectedPolygon,
              endpointPoint(targetPolygon, joinTarget.endpoint)
            );
            bridge = [];
          }
          const merged = joinPolylinePoints(
            selectedPolygon,
            aEnd,
            targetPolygon,
            joinTarget.endpoint,
            bridge
          );
          // A survives, so A's fields are the merged polyline's fields — but
          // when A is the UNLABELLED side the label has to come across from
          // B, or the join would quietly throw away a label the user had
          // already assigned.
          const classPatch = inheritJoinClass(
            selectedPolygon,
            targetPolygon,
            projectType
          );
          updatePolygons(
            polygons
              .filter(p => p.id !== targetPolygon.id)
              .map(p =>
                p.id === selectedPolygonId
                  ? { ...p, ...classPatch, points: merged }
                  : p
              )
          );
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
      }

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
      projectType,
      onJoinBlockedByClass,
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
   * Finalize an in-progress CreatePolyline.
   *
   * The mode guard is load-bearing, not defensive. This used to be bound
   * straight to the canvas `onDoubleClick` with no mode check at all, so a
   * double-click ANYWHERE that had left ≥2 temp points behind appended a
   * brand-new `geometry:'polyline'` — in AddPoints that produced Valerie's
   * stray polygon instead of the elongation (reported 2026-09-04), and in
   * CreatePolygon it turned the in-progress polygon into a polyline. The
   * canvas now binds the mode-aware `handleCanvasDoubleClick`; this stays
   * guarded so no future binding can re-introduce the same bug.
   *
   * No duplicate trailing point: `handleMouseDown` drops the second
   * mousedown of a double-click (`e.detail > 1`), so `tempPoints` here holds
   * exactly the points the user placed.
   */
  const handleCreatePolylineDoubleClick = useCallback(() => {
    if (editMode !== EditMode.CreatePolyline) return;
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
    editMode,
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
                vertexGrabPoint: { ...imagePoint },
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

        // Grabbing the CONTOUR (not a vertex) translates the whole shape.
        //
        // Requested 2026-09-04. Deliberately gated to EditVertices: that is
        // the mode whose job is changing geometry, and it is where the
        // gesture cannot be confused with anything else. In View mode a drag
        // pans the canvas and a click selects — silently turning that into a
        // shape move would be a trap. The vertex branch above runs FIRST, so
        // a point still wins over the outline it sits on.
        if (
          target &&
          target.dataset &&
          target.dataset.polygonId &&
          target.dataset.vertexIndex === undefined &&
          editMode === EditMode.EditVertices
        ) {
          const polygonId = target.dataset.polygonId;
          const polygon = getPolygons().find(p => p.id === polygonId);
          if (polygon && polygon.points.length > 0) {
            // Dragging a shape that is not selected selects it, so the
            // gesture works on first contact instead of needing a click
            // first.
            if (selectedPolygonId !== polygonId) {
              onPolygonSelection(polygonId);
            }
            setInteractionState({
              ...interactionState,
              isDraggingVertex: true,
              draggedVertexInfo: { polygonId, vertexIndex: -1 },
              originalVertexPosition: { ...polygon.points[0] },
              vertexGrabPoint: { ...imagePoint },
            });
            if (setVertexDragState) {
              setVertexDragState({
                isDragging: true,
                polygonId,
                vertexIndex: null,
                originalPosition: { ...polygon.points[0] },
                dragOffset: { x: 0, y: 0 },
                mode: 'translate',
              });
            }
            return;
          }
        }

        // The SECOND mousedown of a physical double-click must not place a
        // point WHERE THE DOUBLE-CLICK ITSELF COMMITS — counting it would
        // leave a duplicate vertex at the finishing position. `detail` is the
        // browser's own click counter and reads ≥2 exactly when a `dblclick`
        // follows, so the two decisions can never disagree; a fast run of
        // clicks at DIFFERENT positions stays at 1 and still places every one.
        //
        // The condition is "will a dblclick commit here", NOT the mode alone.
        // `handleEnterPolyline` refuses AddPoints on a CLOSED polygon (that
        // flow finishes by clicking a second vertex) and refuses
        // CreatePolygon entirely (it closes by clicking its first point), so
        // suppressing there would drop a vertex and commit nothing in its
        // place — a silent loss, where the duplicate at least was visible and
        // removable with the right-click step-undo. Slice is ungated for the
        // same reason: its two clicks are the two ends of the cut.
        //
        // `getPolygons()` runs only on an actual repeat click in AddPoints.
        const isRepeatClick =
          e.detail > 1 &&
          (editMode === EditMode.CreatePolyline ||
            (editMode === EditMode.AddPoints &&
              (() => {
                const sel = getPolygons().find(p => p.id === selectedPolygonId);
                return sel?.geometry === 'polyline' && sel.points.length >= 2;
              })()));

        switch (editMode) {
          case EditMode.View:
            handleViewModeClick(imagePoint, e);
            break;
          case EditMode.CreatePolygon:
            handleCreatePolygonClick(imagePoint);
            break;
          case EditMode.CreatePolyline:
            if (!isRepeatClick) handleCreatePolylineClick(imagePoint);
            break;
          case EditMode.EditVertices:
            handleEditVerticesClick(imagePoint, e);
            break;
          case EditMode.AddPoints:
            if (!isRepeatClick) handleAddPointsClick(imagePoint);
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

        // Move the vertex BY the drag delta, not TO the cursor. Measured on
        // production 2026-09-04: grabbing a vertex 4 px off centre and
        // dragging by (120, 60) landed it 3.35 px away from the delta,
        // because the offset was taken from the vertex rather than from
        // where the pointer actually went down. The grab radius is 8 screen
        // px, so on a dense microtubule polyline that is enough to snatch a
        // neighbouring vertex and snap it under the cursor.
        if (interactionState.originalVertexPosition && setVertexDragState) {
          const grab =
            interactionState.vertexGrabPoint ??
            interactionState.originalVertexPosition;
          const offsetX = imagePoint.x - grab.x;
          const offsetY = imagePoint.y - grab.y;

          // Update only the drag offset, not the actual points
          setVertexDragState({
            isDragging: true,
            polygonId,
            // -1 is the translate sentinel written at drag start; the render
            // side keys on `mode`, so the index is carried but unused there.
            vertexIndex: vertexIndex < 0 ? null : vertexIndex,
            originalPosition: interactionState.originalVertexPosition,
            dragOffset: { x: offsetX, y: offsetY },
            mode: vertexIndex < 0 ? 'translate' : 'vertex',
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

      // Clear the join highlight whenever we leave add-points mode so a stale
      // ring can't linger (the render layer also gates on AddPoints).
      if (editMode !== EditMode.AddPoints) {
        setHoveredJoinTarget(null);
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

          // Add-points join hover: highlight a same-class foreign endpoint the
          // cursor is near, so the user sees it can be clicked to merge.
          if (editMode === EditMode.AddPoints) {
            const join = findJoinTarget(
              polygons,
              selectedPolygon,
              imagePoint,
              hitRadius,
              projectType
            );
            setHoveredJoinTarget(
              join
                ? { polygonId: join.polygonId, endpoint: join.endpoint }
                : null
            );
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
      setHoveredJoinTarget,
      setVertexDragState,
      canvasRef,
      handlePan,
      isShiftPressedCallback,
      projectType,
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

      // A vertex drag must NOT be ended by the pointer leaving the canvas.
      // `CanvasContainer` routes onMouseLeave to this handler, which used to
      // COMMIT the vertex whereever the pointer happened to cross the edge --
      // reported 2026-09-04 as a vertex jumping out of the field of view and
      // becoming impossible to grab or delete afterwards, since nothing
      // clamps the committed point back into the image. The genuine release
      // is caught by the window listener below, so leaving the canvas
      // mid-drag now just keeps dragging, and coming back resumes normally.
      if (e.type === 'mouseleave' && interactionState.isDraggingVertex) {
        return;
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
          // Commit the same thing the drag drew: the original position moved
          // BY the pointer delta. Committing the raw cursor position instead
          // silently discards wherever within the grab radius the user
          // actually took hold of the vertex.
          const grab =
            interactionState.vertexGrabPoint ??
            interactionState.originalVertexPosition;
          const origin = interactionState.originalVertexPosition;
          const finalPoint =
            grab && origin
              ? {
                  x: origin.x + (coordinates.imageX - grab.x),
                  y: origin.y + (coordinates.imageY - grab.y),
                }
              : { x: coordinates.imageX, y: coordinates.imageY };

          // Update the actual polygon points with the final position.
          // vertexIndex -1 is the whole-shape translate: every point moves by
          // the same delta, which is the same delta the preview drew.
          const dx = grab ? coordinates.imageX - grab.x : 0;
          const dy = grab ? coordinates.imageY - grab.y : 0;
          const polygons = getPolygons();
          const updatedPolygons = polygons.map(polygon => {
            if (polygon.id === polygonId) {
              if (vertexIndex < 0) {
                return {
                  ...polygon,
                  points: polygon.points.map(p => ({
                    x: p.x + dx,
                    y: p.y + dy,
                  })),
                };
              }
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
          vertexGrabPoint: null,
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

  // The canvas only sees a release that happens over it. Since a vertex drag
  // now survives leaving the canvas (see handleMouseUp), the genuine mouseup
  // has to be caught at the window, or the drag would hang until the next
  // click. Bound only while a vertex is actually being dragged.
  const mouseUpRef = useRef(handleMouseUp);
  mouseUpRef.current = handleMouseUp;
  useEffect(() => {
    if (!interactionState.isDraggingVertex) return;
    const onWindowMouseUp = (e: MouseEvent) => {
      // handleMouseUp reads only clientX/clientY and type off the event.
      mouseUpRef.current(e as unknown as React.MouseEvent<HTMLDivElement>);
    };
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => window.removeEventListener('mouseup', onWindowMouseUp);
  }, [interactionState.isDraggingVertex]);

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
