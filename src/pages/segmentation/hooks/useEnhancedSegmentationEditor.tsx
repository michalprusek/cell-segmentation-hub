import { logger } from '@/lib/logger';
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { Point, Polygon } from '@/lib/segmentation';
import {
  EditMode,
  InteractionState,
  TransformState,
  EDITING_CONSTANTS,
} from '../types';
import { useAdvancedInteractions } from './useAdvancedInteractions';
import { usePolygonSlicing } from './usePolygonSlicing';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import {
  calculateCenteringTransform,
  calculateFixedPointZoom,
  constrainTransform,
} from '@/lib/coordinateUtils';
import { rafThrottle } from '@/lib/performanceUtils';
import { useLanguage } from '@/contexts/LanguageContext';

interface UseEnhancedSegmentationEditorProps {
  initialPolygons?: Polygon[];
  imageWidth: number;
  imageHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  onSave?: (polygons: Polygon[]) => Promise<void>;
  onPolygonsChange?: (polygons: Polygon[]) => void;
  imageId?: string; // Add imageId to detect image changes
}

/**
 * Main hook that integrates all SpheroSeg-inspired functionality
 * Provides a complete polygon editing solution
 */
export const useEnhancedSegmentationEditor = ({
  initialPolygons = [],
  imageWidth,
  imageHeight,
  canvasWidth,
  canvasHeight,
  onSave,
  onPolygonsChange,
  imageId,
}: UseEnhancedSegmentationEditorProps) => {
  const { t } = useLanguage();

  // Core state
  const [polygons, setPolygons] = useState<Polygon[]>(initialPolygons);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(
    null
  );
  const [editMode, setEditMode] = useState<EditMode>(EditMode.View);
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  const [hoveredVertex, setHoveredVertex] = useState<{
    polygonId: string;
    vertexIndex: number;
  } | null>(null);
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);

  // Vertex drag state for smooth dragging
  const [vertexDragState, setVertexDragState] = useState<{
    isDragging: boolean;
    polygonId: string | null;
    vertexIndex: number | null;
    dragOffset?: { x: number; y: number };
    originalPosition?: { x: number; y: number };
  }>({
    isDragging: false,
    polygonId: null,
    vertexIndex: null,
  });

  // Transform state
  const [transform, setTransform] = useState<TransformState>(() =>
    calculateCenteringTransform(
      imageWidth,
      imageHeight,
      canvasWidth,
      canvasHeight
    )
  );

  // Refs (declare before using)
  const canvasRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<TransformState>(transform);

  // Update transformRef whenever transform changes
  transformRef.current = transform;

  // Create throttled cursor position update
  const throttledSetCursorPosition = useMemo(
    () => rafThrottle((position: Point) => setCursorPosition(position), 16).fn,
    []
  );

  // Interaction state
  const [interactionState, setInteractionState] = useState<InteractionState>({
    isDraggingVertex: false,
    isPanning: false,
    panStart: null,
    draggedVertexInfo: null,
    originalVertexPosition: null,
    sliceStartPoint: null,
    addPointStartVertex: null,
    addPointEndVertex: null,
    isAddingPoints: false,
  });

  // History management
  const [history, setHistory] = useState<Polygon[][]>([initialPolygons]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Track image changes and polygon data
  const initialPolygonsRef = useRef<Polygon[]>([]);
  const currentImageIdRef = useRef<string | undefined>(undefined);
  const hasInitialized = useRef(false);

  useEffect(() => {
    // Check if this is truly new data (different imageId, different length, or first load)
    const imageChanged = currentImageIdRef.current !== imageId;
    const lengthChanged =
      initialPolygons.length !== initialPolygonsRef.current.length;
    const isNewData = !hasInitialized.current || imageChanged || lengthChanged;

    if (isNewData) {
      if (process.env.NODE_ENV === 'development') {
        logger.debug(
          '🔄 Loading new polygon data:',
          initialPolygons.length,
          'polygons for image:',
          imageId,
          { imageChanged, lengthChanged, isFirstLoad: !hasInitialized.current }
        );
      }

      // Reset all editor state when switching images
      setPolygons(initialPolygons);
      setSelectedPolygonId(null); // Clear selection
      setEditMode(EditMode.View); // Reset to view mode
      setTempPoints([]); // Clear temp points
      setHoveredVertex(null); // Clear hover state
      setCursorPosition(null); // Clear cursor
      setVertexDragState({
        isDragging: false,
        polygonId: null,
        vertexIndex: null,
      }); // Reset drag state

      // Reset interaction state
      setInteractionState({
        isDraggingVertex: false,
        isPanning: false,
        panStart: null,
        draggedVertexInfo: null,
        originalVertexPosition: null,
        sliceStartPoint: null,
        addPointStartVertex: null,
        addPointEndVertex: null,
        isAddingPoints: false,
      });

      // Reset history with new initial state
      setHistory([initialPolygons]);
      setHistoryIndex(0);
      setHasUnsavedChanges(false);

      // Update refs
      initialPolygonsRef.current = initialPolygons;
      currentImageIdRef.current = imageId;
      hasInitialized.current = true;

      if (process.env.NODE_ENV === 'development') {
        logger.debug(
          '✅ Loaded',
          initialPolygons.length,
          'polygons for image:',
          imageId
        );
      }
    }
  }, [initialPolygons, imageId]);

  // Update polygons with history tracking
  const updatePolygons = useCallback(
    (newPolygons: Polygon[], addToHistory = true) => {
      setPolygons(newPolygons);
      setHasUnsavedChanges(true);

      if (addToHistory) {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(newPolygons);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
      }

      if (onPolygonsChange) {
        onPolygonsChange(newPolygons);
      }
    },
    [history, historyIndex, onPolygonsChange]
  );

  // Get current polygons
  const getPolygons = useCallback(() => polygons, [polygons]);

  // History operations
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const handleUndo = useCallback(() => {
    if (canUndo) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setPolygons(history[newIndex]);
      setHasUnsavedChanges(newIndex !== 0);

      if (onPolygonsChange) {
        onPolygonsChange(history[newIndex]);
      }
    }
  }, [canUndo, historyIndex, history, onPolygonsChange]);

  const handleRedo = useCallback(() => {
    if (canRedo) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setPolygons(history[newIndex]);
      setHasUnsavedChanges(true);

      if (onPolygonsChange) {
        onPolygonsChange(history[newIndex]);
      }
    }
  }, [canRedo, historyIndex, history, onPolygonsChange]);

  // Save operation
  const handleSave = useCallback(async () => {
    if (!onSave || !hasUnsavedChanges) return;

    setIsSaving(true);
    try {
      await onSave(polygons);
      setHasUnsavedChanges(false);
      toast.success(t('toast.segmentation.saved'));
    } catch (error) {
      toast.error(t('toast.segmentation.failed'));
      logger.error('Save error:', error);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, hasUnsavedChanges, polygons, t]);

  // Transform operations with improved constraints
  const handleZoomIn = useCallback(() => {
    const center = { x: canvasWidth / 2, y: canvasHeight / 2 };
    const newTransform = calculateFixedPointZoom(
      transform,
      center,
      EDITING_CONSTANTS.ZOOM_FACTOR,
      EDITING_CONSTANTS.MIN_ZOOM,
      EDITING_CONSTANTS.MAX_ZOOM,
      canvasWidth,
      canvasHeight
    );
    const constrainedTransform = constrainTransform(
      newTransform,
      imageWidth,
      imageHeight,
      canvasWidth,
      canvasHeight
    );
    setTransform(constrainedTransform);
  }, [transform, canvasWidth, canvasHeight, imageWidth, imageHeight]);

  const handleZoomOut = useCallback(() => {
    const center = { x: canvasWidth / 2, y: canvasHeight / 2 };
    const newTransform = calculateFixedPointZoom(
      transform,
      center,
      1 / EDITING_CONSTANTS.ZOOM_FACTOR,
      EDITING_CONSTANTS.MIN_ZOOM,
      EDITING_CONSTANTS.MAX_ZOOM,
      canvasWidth,
      canvasHeight
    );
    const constrainedTransform = constrainTransform(
      newTransform,
      imageWidth,
      imageHeight,
      canvasWidth,
      canvasHeight
    );
    setTransform(constrainedTransform);
  }, [transform, canvasWidth, canvasHeight, imageWidth, imageHeight]);

  const handleResetView = useCallback(() => {
    const newTransform = calculateCenteringTransform(
      imageWidth,
      imageHeight,
      canvasWidth,
      canvasHeight
    );
    setTransform(newTransform);
  }, [imageWidth, imageHeight, canvasWidth, canvasHeight]);

  // Polygon operations
  const handleDeletePolygon = useCallback(
    (polygonId?: string) => {
      const idToDelete = polygonId || selectedPolygonId;
      if (!idToDelete) return;

      const updatedPolygons = polygons.filter(p => p.id !== idToDelete);
      updatePolygons(updatedPolygons);

      if (selectedPolygonId === idToDelete) {
        setSelectedPolygonId(null);
      }

      toast.success(t('toast.segmentation.deleted'));
    },
    [polygons, selectedPolygonId, updatePolygons, t]
  );

  // Escape handler
  const handleEscape = useCallback(() => {
    // Reset all temporary state
    setTempPoints([]);
    setInteractionState({
      isDraggingVertex: false,
      isPanning: false,
      panStart: null,
      draggedVertexInfo: null,
      originalVertexPosition: null,
      sliceStartPoint: null,
      addPointStartVertex: null,
      addPointEndVertex: null,
      isAddingPoints: false,
    });
    // If we have a selected polygon, go to EditVertices mode instead of View mode
    // This keeps the polygon selected when exiting other modes
    if (selectedPolygonId) {
      setEditMode(EditMode.EditVertices);
    } else {
      setEditMode(EditMode.View);
    }
  }, [selectedPolygonId]);

  // Initialize keyboard shortcuts first to get access to shift key state
  const keyboardShortcuts = useKeyboardShortcuts({
    editMode,
    canUndo,
    canRedo,
    selectedPolygonId,
    setEditMode,
    handleUndo,
    handleRedo,
    handleSave,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    handleDeletePolygon,
    onEscape: handleEscape,
  });

  // Initialize hooks (moved after handlePan definition to avoid TDZ error)

  const slicing = usePolygonSlicing({
    polygons,
    selectedPolygonId,
    tempPoints,
    interactionState,
    setSelectedPolygonId,
    setTempPoints,
    setInteractionState,
    setEditMode,
    updatePolygons,
  });

  // Handle slice completion when two temp points are placed in slice mode
  useEffect(() => {
    if (editMode === EditMode.Slice && tempPoints.length === 2) {
      // Trigger slice action with error handling
      const executeSliceAction = async () => {
        try {
          await slicing.handleSliceAction();
        } catch (error) {
          console.error('Failed to execute slice action:', error);
          // TODO: Set error state or show user notification
          // setSliceError(error) or toast.error('Slice operation failed')
        }
      };
      executeSliceAction();
    }
  }, [editMode, tempPoints.length, slicing]);

  // Enhanced wheel handler with non-passive event listener
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mousePoint = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      const zoomFactor =
        e.deltaY < 0
          ? EDITING_CONSTANTS.ZOOM_FACTOR
          : 1 / EDITING_CONSTANTS.ZOOM_FACTOR;

      // Use transformRef.current to get latest transform value
      const newTransform = calculateFixedPointZoom(
        transformRef.current,
        mousePoint,
        zoomFactor,
        EDITING_CONSTANTS.MIN_ZOOM,
        EDITING_CONSTANTS.MAX_ZOOM,
        rect.width,
        rect.height
      );

      setTransform(
        constrainTransform(
          newTransform,
          imageWidth,
          imageHeight,
          canvasWidth,
          canvasHeight
        )
      );
    };

    const element = canvasRef.current;
    if (element) {
      // Add non-passive wheel event listener to allow preventDefault
      element.addEventListener('wheel', handleWheel, { passive: false });

      return () => {
        element.removeEventListener('wheel', handleWheel);
      };
    }
  }, [imageWidth, imageHeight, canvasWidth, canvasHeight]); // Removed transform from dependencies

  // Enhanced pan handler with smooth continuous movement
  const handlePan = useCallback(
    (deltaX: number, deltaY: number) => {
      const newTransform = {
        ...transform,
        translateX: transform.translateX + deltaX,
        translateY: transform.translateY + deltaY,
      };

      // Apply generous constraints that allow free movement
      const constrainedTransform = constrainTransform(
        newTransform,
        imageWidth,
        imageHeight,
        canvasWidth,
        canvasHeight
      );

      setTransform(constrainedTransform);
    },
    [transform, imageWidth, imageHeight, canvasWidth, canvasHeight]
  );

  // Initialize advanced interactions after handlePan is defined
  const interactions = useAdvancedInteractions({
    editMode,
    interactionState,
    transform,
    canvasRef,
    selectedPolygonId,
    tempPoints,
    cursorPosition,
    isShiftPressed: keyboardShortcuts.isShiftPressed,
    isSpacePressed: keyboardShortcuts.isSpacePressed,
    setSelectedPolygonId,
    setEditMode,
    setInteractionState,
    setTempPoints,
    setHoveredVertex,
    setVertexDragState,
    updatePolygons,
    getPolygons,
    handlePan,
  });

  // Update interaction handlers to include pan handling
  const enhancedHandleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Track cursor position in image coordinates for visual feedback
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;

        // Get the container dimensions
        const containerWidth = rect.width;
        const containerHeight = rect.height;

        // The content is centered, so we need to adjust for that
        const centerOffsetX = containerWidth / 2;
        const centerOffsetY = containerHeight / 2;

        // Convert to image coordinates using the same calculation as getCanvasCoordinates
        const imageX =
          (canvasX - centerOffsetX - transform.translateX) / transform.zoom;
        const imageY =
          (canvasY - centerOffsetY - transform.translateY) / transform.zoom;

        // Use throttled version to prevent excessive re-renders
        throttledSetCursorPosition({ x: imageX, y: imageY });
      }

      // Handle panning if active - use incremental deltas for smooth movement
      if (interactionState.isPanning && interactionState.panStart) {
        const deltaX = e.clientX - interactionState.panStart.x;
        const deltaY = e.clientY - interactionState.panStart.y;

        // Apply the delta movement
        handlePan(deltaX, deltaY);

        // Update pan start position for next delta calculation
        setInteractionState({
          ...interactionState,
          panStart: { x: e.clientX, y: e.clientY },
        });
        return;
      }

      // Delegate to advanced interactions
      interactions.handleMouseMove(e);
    },
    [
      interactionState,
      handlePan,
      interactions,
      transform,
      canvasRef,
      throttledSetCursorPosition,
    ]
  );

  // Computed values
  const selectedPolygon = useMemo(
    () =>
      selectedPolygonId ? polygons.find(p => p.id === selectedPolygonId) : null,
    [polygons, selectedPolygonId]
  );

  const editorState = useMemo(
    () => ({
      editMode,
      selectedPolygonId,
      selectedPolygon,
      polygons,
      transform,
      interactionState,
      tempPoints,
      hoveredVertex,
      cursorPosition,
      hasUnsavedChanges,
      canUndo,
      canRedo,
      isSaving,
    }),
    [
      editMode,
      selectedPolygonId,
      selectedPolygon,
      polygons,
      transform,
      interactionState,
      tempPoints,
      hoveredVertex,
      cursorPosition,
      hasUnsavedChanges,
      canUndo,
      canRedo,
      isSaving,
    ]
  );

  return {
    // State
    ...editorState,
    vertexDragState,

    // Refs
    canvasRef,

    // State setters
    setEditMode,
    setSelectedPolygonId,
    setTempPoints,
    setInteractionState,
    setHoveredVertex,
    setVertexDragState,
    setTransform,

    // Core operations
    updatePolygons,
    getPolygons,

    // History operations
    handleUndo,
    handleRedo,

    // Save operation
    handleSave,

    // Transform operations
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    handlePan,

    // Polygon operations
    handleDeletePolygon,

    // Event handlers
    handleMouseDown: interactions.handleMouseDown,
    handleMouseMove: enhancedHandleMouseMove,
    handleMouseUp: interactions.handleMouseUp,

    // Mode-specific handlers
    slicing,

    // Keyboard state
    keyboardState: {
      isShiftPressed: keyboardShortcuts.isShiftPressed,
      isCtrlPressed: keyboardShortcuts.isCtrlPressed,
      isAltPressed: keyboardShortcuts.isAltPressed,
    },

    // Utilities
    handleEscape,
  };
};
