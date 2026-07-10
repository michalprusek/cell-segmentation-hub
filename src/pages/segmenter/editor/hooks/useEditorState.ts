import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent,
  type RefObject,
} from 'react';
import { toast } from 'sonner';
import type { SegmenterPolygon } from '@/lib/segmenterApi';
import { useLanguage } from '@/contexts/exports';
import {
  calculateCenteringTransform,
  calculateFixedPointZoom,
  constrainTransform,
  getCanvasCoordinates,
} from '@/lib/coordinateUtils';
import {
  EditMode,
  EDITOR_CONSTANTS,
  EMPTY_VERTEX_DRAG_STATE,
  type Point,
  type TransformState,
  type VertexDragState,
} from '../types';

function generatePolygonId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `poly_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

interface DragOrigin {
  polygonId: string;
  vertexIndex: number;
  original: Point;
  startClientX: number;
  startClientY: number;
}

interface PanOrigin {
  startClientX: number;
  startClientY: number;
  startTransform: TransformState;
  moved: boolean;
}

export interface UseEditorStateOptions {
  /** Route param — used only to detect "a different image was navigated
   *  to" so the whole editable history resets even if React Router reuses
   *  this component instance across `:imageId` changes. */
  imageId: string | undefined;
  initialPolygons: SegmenterPolygon[];
  imageWidth: number;
  imageHeight: number;
  containerWidth: number;
  containerHeight: number;
  activeClassId: string | null;
}

export interface UseEditorStateResult {
  polygons: SegmenterPolygon[];
  selectedPolygonId: string | null;
  editMode: EditMode;
  transform: TransformState;
  tempPoints: Point[];
  cursorImagePoint: Point | null;
  vertexDragState: VertexDragState;
  canUndo: boolean;
  canRedo: boolean;
  hasUnsavedChanges: boolean;
  canvasRef: RefObject<HTMLDivElement>;

  setEditMode: (mode: EditMode) => void;
  selectPolygon: (id: string | null) => void;
  deletePolygon: (id: string) => void;
  deleteSelectedPolygon: () => void;
  setPolygonClass: (id: string, classId: string | null) => void;
  finishPolygon: () => void;
  cancelDraw: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;

  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;

  handleContainerMouseDown: (e: ReactMouseEvent) => void;
  handleContainerMouseMove: (e: ReactMouseEvent) => void;
  handleContainerMouseUp: () => void;
  handleWheel: (e: WheelEvent) => void;
  handlePolygonClick: (id: string) => void;
  handleVertexMouseDown: (
    polygonId: string,
    vertexIndex: number,
    e: ReactMouseEvent
  ) => void;
  handleVertexContextMenu: (
    polygonId: string,
    vertexIndex: number,
    e: ReactMouseEvent
  ) => void;
}

const DEFAULT_TRANSFORM: TransformState = {
  zoom: 1,
  translateX: 0,
  translateY: 0,
};

/**
 * Self-contained polygon-only editor state machine for `/segmenter`.
 * Modelled on `useEnhancedSegmentationEditor`/`useAdvancedInteractions`
 * (history/undo-redo shape, transform/zoom/pan math, vertex-drag-offset
 * rendering pattern) but written from scratch rather than stripped from
 * those files — the originals are ~2,300 combined lines threaded through
 * with video/MT/sperm/polyline branches that would have made "stripping"
 * riskier than a lean rewrite for a 4-mode polygon-only editor. Pure
 * geometry/transform math IS reused directly from `@/lib/coordinateUtils`.
 */
export function useEditorState({
  imageId,
  initialPolygons,
  imageWidth,
  imageHeight,
  containerWidth,
  containerHeight,
  activeClassId,
}: UseEditorStateOptions): UseEditorStateResult {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [history, setHistory] = useState<SegmenterPolygon[][]>([
    initialPolygons,
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [savedIndex, setSavedIndex] = useState(0);
  const polygons = history[historyIndex];

  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(
    null
  );
  const [editMode, setEditModeState] = useState<EditMode>(EditMode.View);
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  const [cursorImagePoint, setCursorImagePoint] = useState<Point | null>(null);
  const [vertexDragState, setVertexDragState] = useState<VertexDragState>(
    EMPTY_VERTEX_DRAG_STATE
  );
  const [transform, setTransform] = useState<TransformState>(DEFAULT_TRANSFORM);

  const dragOriginRef = useRef<DragOrigin | null>(null);
  const panOriginRef = useRef<PanOrigin | null>(null);
  const hasCenteredRef = useRef(false);
  const seededRef = useRef(initialPolygons.length > 0);
  const lastImageIdRef = useRef(imageId);

  // Hard reset when a DIFFERENT image is navigated to. React Router reuses
  // this component instance across `:imageId` param changes on the same
  // route, so without this the previous image's polygons/history/selection
  // would leak into the next image.
  useEffect(() => {
    if (lastImageIdRef.current === imageId) return;
    lastImageIdRef.current = imageId;
    setHistory([[]]);
    setHistoryIndex(0);
    setSavedIndex(0);
    setSelectedPolygonId(null);
    setEditModeState(EditMode.View);
    setTempPoints([]);
    setVertexDragState(EMPTY_VERTEX_DRAG_STATE);
    dragOriginRef.current = null;
    panOriginRef.current = null;
    hasCenteredRef.current = false;
    seededRef.current = false;
  }, [imageId]);

  // Seed the editable history once real annotation data arrives (the
  // annotation loader fetches asynchronously, so the first render(s) of
  // this hook typically see an empty `initialPolygons`). Only fires once
  // per image (guarded by `seededRef`) so it never clobbers in-progress
  // edits with a stale re-fetch.
  useEffect(() => {
    if (seededRef.current) return;
    if (initialPolygons.length > 0) {
      setHistory([initialPolygons]);
      setHistoryIndex(0);
      setSavedIndex(0);
      seededRef.current = true;
    }
  }, [initialPolygons]);

  // Centre the view once, the first time both the image and the container
  // have real pixel dimensions. Never re-runs afterward so it doesn't fight
  // a user's manual zoom/pan.
  useEffect(() => {
    if (hasCenteredRef.current) return;
    if (
      imageWidth > 0 &&
      imageHeight > 0 &&
      containerWidth > 0 &&
      containerHeight > 0
    ) {
      setTransform(
        calculateCenteringTransform(
          imageWidth,
          imageHeight,
          containerWidth,
          containerHeight
        )
      );
      hasCenteredRef.current = true;
    }
  }, [imageWidth, imageHeight, containerWidth, containerHeight]);

  const setEditMode = useCallback((mode: EditMode) => {
    setEditModeState(mode);
    setTempPoints([]);
    dragOriginRef.current = null;
    setVertexDragState(EMPTY_VERTEX_DRAG_STATE);
  }, []);

  const selectPolygon = useCallback((id: string | null) => {
    setSelectedPolygonId(id);
  }, []);

  const commit = useCallback(
    (next: SegmenterPolygon[]) => {
      setHistory(h => [...h.slice(0, historyIndex + 1), next]);
      setHistoryIndex(historyIndex + 1);
    },
    [historyIndex]
  );

  const deletePolygon = useCallback(
    (id: string) => {
      commit(polygons.filter(p => p.id !== id));
      setSelectedPolygonId(sel => (sel === id ? null : sel));
    },
    [polygons, commit]
  );

  const deleteSelectedPolygon = useCallback(() => {
    if (selectedPolygonId) deletePolygon(selectedPolygonId);
  }, [selectedPolygonId, deletePolygon]);

  const setPolygonClass = useCallback(
    (id: string, classId: string | null) => {
      commit(polygons.map(p => (p.id === id ? { ...p, classId } : p)));
    },
    [polygons, commit]
  );

  const finishPolygon = useCallback(() => {
    if (tempPoints.length < 3) return;
    const id = generatePolygonId();
    const newPolygon: SegmenterPolygon = {
      id,
      points: tempPoints.map(p => ({ x: p.x, y: p.y })),
      classId: activeClassId ?? null,
      instanceId: id,
    };
    commit([...polygons, newPolygon]);
    setTempPoints([]);
    setSelectedPolygonId(id);
  }, [tempPoints, activeClassId, polygons, commit]);

  const cancelDraw = useCallback(() => {
    setTempPoints([]);
  }, []);

  const undo = useCallback(() => {
    setHistoryIndex(i => Math.max(0, i - 1));
  }, []);

  const redo = useCallback(() => {
    setHistoryIndex(i => Math.min(history.length - 1, i + 1));
  }, [history.length]);

  const markSaved = useCallback(() => {
    setSavedIndex(historyIndex);
  }, [historyIndex]);

  const zoomAtCenter = useCallback(
    (zoomFactor: number) => {
      setTransform(t =>
        calculateFixedPointZoom(
          t,
          { x: containerWidth / 2, y: containerHeight / 2 },
          zoomFactor,
          EDITOR_CONSTANTS.MIN_ZOOM,
          EDITOR_CONSTANTS.MAX_ZOOM,
          containerWidth,
          containerHeight
        )
      );
    },
    [containerWidth, containerHeight]
  );

  const zoomIn = useCallback(
    () => zoomAtCenter(EDITOR_CONSTANTS.ZOOM_STEP),
    [zoomAtCenter]
  );
  const zoomOut = useCallback(
    () => zoomAtCenter(1 / EDITOR_CONSTANTS.ZOOM_STEP),
    [zoomAtCenter]
  );

  const resetView = useCallback(() => {
    if (
      imageWidth > 0 &&
      imageHeight > 0 &&
      containerWidth > 0 &&
      containerHeight > 0
    ) {
      setTransform(
        calculateCenteringTransform(
          imageWidth,
          imageHeight,
          containerWidth,
          containerHeight
        )
      );
    }
  }, [imageWidth, imageHeight, containerWidth, containerHeight]);

  const toImagePoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const coords = getCanvasCoordinates(
        clientX,
        clientY,
        transform,
        canvasRef
      );
      return { x: coords.imageX, y: coords.imageY };
    },
    [transform]
  );

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cursorPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const zoomFactor =
        e.deltaY < 0
          ? EDITOR_CONSTANTS.ZOOM_STEP
          : 1 / EDITOR_CONSTANTS.ZOOM_STEP;
      setTransform(t =>
        calculateFixedPointZoom(
          t,
          cursorPoint,
          zoomFactor,
          EDITOR_CONSTANTS.MIN_ZOOM,
          EDITOR_CONSTANTS.MAX_ZOOM,
          containerWidth,
          containerHeight
        )
      );
    },
    [containerWidth, containerHeight]
  );

  const handlePolygonClick = useCallback(
    (id: string) => {
      if (editMode === EditMode.DeletePolygon) {
        deletePolygon(id);
        return;
      }
      selectPolygon(id);
    },
    [editMode, deletePolygon, selectPolygon]
  );

  const handleVertexMouseDown = useCallback(
    (polygonId: string, vertexIndex: number, e: ReactMouseEvent) => {
      if (editMode !== EditMode.EditVertices) return;
      e.stopPropagation();
      e.preventDefault();
      const poly = polygons.find(p => p.id === polygonId);
      const original = poly?.points[vertexIndex];
      if (!original) return;
      dragOriginRef.current = {
        polygonId,
        vertexIndex,
        original,
        startClientX: e.clientX,
        startClientY: e.clientY,
      };
      setVertexDragState({
        isDragging: true,
        polygonId,
        vertexIndex,
        dragOffset: { x: 0, y: 0 },
      });
    },
    [editMode, polygons]
  );

  const handleVertexContextMenu = useCallback(
    (polygonId: string, vertexIndex: number, e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (editMode !== EditMode.EditVertices) return;
      const poly = polygons.find(p => p.id === polygonId);
      if (!poly) return;
      if (poly.points.length <= 3) {
        toast.warning(t('segmenter.editor.minVertices') as string);
        return;
      }
      commit(
        polygons.map(p =>
          p.id === polygonId
            ? { ...p, points: p.points.filter((_, i) => i !== vertexIndex) }
            : p
        )
      );
    },
    [editMode, polygons, commit, t]
  );

  const handleContainerMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (e.button !== 0) return;
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isShapeHit = targetTag === 'path' || targetTag === 'circle';

      if (editMode === EditMode.CreatePolygon) {
        if (imageWidth <= 0 || imageHeight <= 0) return;
        if (isShapeHit && targetTag === 'circle') return;
        const pt = toImagePoint(e.clientX, e.clientY);
        if (tempPoints.length >= 3) {
          const dx = pt.x - tempPoints[0].x;
          const dy = pt.y - tempPoints[0].y;
          const distImg = Math.sqrt(dx * dx + dy * dy);
          const closeThresholdImg =
            EDITOR_CONSTANTS.CLOSE_POLYGON_DISTANCE /
            Math.max(transform.zoom, 1e-4);
          if (distImg <= closeThresholdImg) {
            finishPolygon();
            return;
          }
        }
        setTempPoints(prev => [...prev, pt]);
        return;
      }

      if (!isShapeHit) {
        panOriginRef.current = {
          startClientX: e.clientX,
          startClientY: e.clientY,
          startTransform: transform,
          moved: false,
        };
      }
    },
    [
      editMode,
      imageWidth,
      imageHeight,
      tempPoints,
      transform,
      toImagePoint,
      finishPolygon,
    ]
  );

  const handleContainerMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      const pt = toImagePoint(e.clientX, e.clientY);
      setCursorImagePoint(pt);

      if (dragOriginRef.current) {
        const origin = dragOriginRef.current;
        const dxClient = e.clientX - origin.startClientX;
        const dyClient = e.clientY - origin.startClientY;
        const zoom = transform.zoom || 1;
        setVertexDragState(prev => ({
          ...prev,
          dragOffset: { x: dxClient / zoom, y: dyClient / zoom },
        }));
        return;
      }

      if (panOriginRef.current) {
        const origin = panOriginRef.current;
        const dx = e.clientX - origin.startClientX;
        const dy = e.clientY - origin.startClientY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) origin.moved = true;
        setTransform(
          constrainTransform(
            {
              zoom: origin.startTransform.zoom,
              translateX: origin.startTransform.translateX + dx,
              translateY: origin.startTransform.translateY + dy,
            },
            imageWidth,
            imageHeight,
            containerWidth,
            containerHeight,
            EDITOR_CONSTANTS.MIN_ZOOM,
            EDITOR_CONSTANTS.MAX_ZOOM
          )
        );
      }
    },
    [
      transform.zoom,
      toImagePoint,
      imageWidth,
      imageHeight,
      containerWidth,
      containerHeight,
    ]
  );

  const handleContainerMouseUp = useCallback(() => {
    if (dragOriginRef.current) {
      const origin = dragOriginRef.current;
      dragOriginRef.current = null;
      const dragState = vertexDragState;
      setVertexDragState(EMPTY_VERTEX_DRAG_STATE);
      const offset = dragState.dragOffset;
      // A click-without-drag on a vertex (mousedown immediately followed by
      // mouseup, no mousemove in between) seeds `dragOffset` at exactly
      // {0,0} — committing that would push a no-op undo step and flip
      // `hasUnsavedChanges` even though nothing actually changed.
      const isNoOpDrag = offset && offset.x === 0 && offset.y === 0;
      if (offset && !isNoOpDrag) {
        const newPoint = {
          x: origin.original.x + offset.x,
          y: origin.original.y + offset.y,
        };
        // Guard against NaN/Infinity ever reaching a committed polygon — the
        // backend's `sanitizeAnnotationPolygons` silently DROPS a polygon
        // once it has fewer than 3 valid points, so a corrupted vertex here
        // could make an entire polygon vanish on save with no error shown.
        if (Number.isFinite(newPoint.x) && Number.isFinite(newPoint.y)) {
          commit(
            polygons.map(p => {
              if (p.id !== origin.polygonId) return p;
              const points = p.points.slice();
              points[origin.vertexIndex] = newPoint;
              return { ...p, points };
            })
          );
        }
      }
      return;
    }

    if (panOriginRef.current) {
      const wasClick = !panOriginRef.current.moved;
      panOriginRef.current = null;
      if (wasClick && editMode !== EditMode.CreatePolygon) {
        selectPolygon(null);
      }
    }
  }, [vertexDragState, polygons, commit, editMode, selectPolygon]);

  return {
    polygons,
    selectedPolygonId,
    editMode,
    transform,
    tempPoints,
    cursorImagePoint,
    vertexDragState,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    hasUnsavedChanges: historyIndex !== savedIndex,
    canvasRef,

    setEditMode,
    selectPolygon,
    deletePolygon,
    deleteSelectedPolygon,
    setPolygonClass,
    finishPolygon,
    cancelDraw,
    undo,
    redo,
    markSaved,

    zoomIn,
    zoomOut,
    resetView,

    handleContainerMouseDown,
    handleContainerMouseMove,
    handleContainerMouseUp,
    handleWheel,
    handlePolygonClick,
    handleVertexMouseDown,
    handleVertexContextMenu,
  };
}
