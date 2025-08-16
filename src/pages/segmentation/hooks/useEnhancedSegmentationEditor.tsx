import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { Point, Polygon } from '@/lib/segmentation';
import { EditMode, InteractionState, TransformState, EDITING_CONSTANTS } from '../types';
import { useAdvancedInteractions } from './useAdvancedInteractions';
import { usePolygonSlicing } from './usePolygonSlicing';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { 
  calculateCenteringTransform, 
  calculateFixedPointZoom,
  constrainTransform 
} from '@/lib/coordinateUtils';

interface UseEnhancedSegmentationEditorProps {
  initialPolygons?: Polygon[];
  imageWidth: number;
  imageHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  onSave?: (polygons: Polygon[]) => Promise<void>;
  onPolygonsChange?: (polygons: Polygon[]) => void;
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
  onPolygonsChange
}: UseEnhancedSegmentationEditorProps) => {

  // Core state
  const [polygons, setPolygons] = useState<Polygon[]>(initialPolygons);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>(EditMode.View);
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  const [hoveredVertex, setHoveredVertex] = useState<{ polygonId: string; vertexIndex: number } | null>(null);
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);

  // Transform state
  const [transform, setTransform] = useState<TransformState>(() => 
    calculateCenteringTransform(imageWidth, imageHeight, canvasWidth, canvasHeight)
  );

  // Update transformRef whenever transform changes
  transformRef.current = transform;

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
    isAddingPoints: false
  });

  // History management
  const [history, setHistory] = useState<Polygon[][]>([initialPolygons]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Refs
  const canvasRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<TransformState>(transform);

  // Update polygons when initialPolygons changes (e.g., when segmentation data loads)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 Initial polygons changed:', initialPolygons.length, 'polygons');
    }
    setPolygons(initialPolygons);
    // Reset history with new initial state
    setHistory([initialPolygons]);
    setHistoryIndex(0);
    setHasUnsavedChanges(false);
    if (process.env.NODE_ENV === 'development') {
      console.log('✅ Updated editor with', initialPolygons.length, 'polygons');
    }
  }, [initialPolygons]);

  // Update polygons with history tracking
  const updatePolygons = useCallback((newPolygons: Polygon[], addToHistory = true) => {
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
  }, [history, historyIndex, onPolygonsChange]);

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
      toast.success('Segmentation saved successfully');
    } catch (error) {
      toast.error('Failed to save segmentation');
      console.error('Save error:', error);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, hasUnsavedChanges, polygons]);

  // Transform operations with improved constraints
  const handleZoomIn = useCallback(() => {
    const center = { x: canvasWidth / 2, y: canvasHeight / 2 };
    const newTransform = calculateFixedPointZoom(
      transform, 
      center, 
      EDITING_CONSTANTS.ZOOM_FACTOR,
      EDITING_CONSTANTS.MIN_ZOOM,
      EDITING_CONSTANTS.MAX_ZOOM
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
      EDITING_CONSTANTS.MAX_ZOOM
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
  const handleDeletePolygon = useCallback((polygonId?: string) => {
    const idToDelete = polygonId || selectedPolygonId;
    if (!idToDelete) return;

    const updatedPolygons = polygons.filter(p => p.id !== idToDelete);
    updatePolygons(updatedPolygons);
    
    if (selectedPolygonId === idToDelete) {
      setSelectedPolygonId(null);
    }
    
    toast.success('Polygon deleted');
  }, [polygons, selectedPolygonId, updatePolygons]);

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
      isAddingPoints: false
    });
    setEditMode(EditMode.View);
  }, []);

  // Initialize hooks
  const interactions = useAdvancedInteractions({
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
    getPolygons
  });

  const slicing = usePolygonSlicing({
    polygons,
    selectedPolygonId,
    tempPoints,
    interactionState,
    setSelectedPolygonId,
    setTempPoints,
    setInteractionState,
    setEditMode,
    updatePolygons
  });

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
    onEscape: handleEscape
  });

  // Enhanced wheel handler with non-passive event listener
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mousePoint = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };

      const zoomFactor = e.deltaY < 0 ? EDITING_CONSTANTS.ZOOM_FACTOR : 1 / EDITING_CONSTANTS.ZOOM_FACTOR;
      
      // Use transformRef.current to get latest transform value
      const newTransform = calculateFixedPointZoom(
        transformRef.current,
        mousePoint,
        zoomFactor,
        EDITING_CONSTANTS.MIN_ZOOM,
        EDITING_CONSTANTS.MAX_ZOOM
      );

      setTransform(constrainTransform(
        newTransform,
        imageWidth,
        imageHeight,
        canvasWidth,
        canvasHeight
      ));
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

  // Enhanced pan handler with proper constraints
  const handlePan = useCallback((deltaX: number, deltaY: number) => {
    const newTransform = {
      ...transform,
      translateX: transform.translateX + deltaX,
      translateY: transform.translateY + deltaY
    };

    // Apply constraints to prevent image from getting stuck at boundaries
    const constrainedTransform = constrainTransform(
      newTransform,
      imageWidth,
      imageHeight,
      canvasWidth,
      canvasHeight
    );
    
    setTransform(constrainedTransform);
  }, [transform, imageWidth, imageHeight, canvasWidth, canvasHeight]);

  // Update interaction handlers to include pan handling
  const enhancedHandleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Track cursor position in image coordinates for visual feedback
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      
      // Convert to image coordinates
      const imageX = (canvasX - transform.translateX) / transform.zoom;
      const imageY = (canvasY - transform.translateY) / transform.zoom;
      
      setCursorPosition({ x: imageX, y: imageY });
    }

    // Handle panning if active
    if (interactionState.isPanning && interactionState.panStart) {
      const deltaX = e.clientX - interactionState.panStart.x;
      const deltaY = e.clientY - interactionState.panStart.y;
      
      handlePan(deltaX, deltaY);
      
      setInteractionState({
        ...interactionState,
        panStart: { x: e.clientX, y: e.clientY }
      });
      return;
    }

    // Delegate to advanced interactions
    interactions.handleMouseMove(e);
  }, [interactionState, handlePan, interactions, transform, canvasRef]);

  // Computed values
  const selectedPolygon = useMemo(() => 
    selectedPolygonId ? polygons.find(p => p.id === selectedPolygonId) : null,
    [polygons, selectedPolygonId]
  );

  const editorState = useMemo(() => ({
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
    isSaving
  }), [
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
    isSaving
  ]);

  return {
    // State
    ...editorState,
    
    // Refs
    canvasRef,
    
    // State setters
    setEditMode,
    setSelectedPolygonId,
    setTempPoints,
    setInteractionState,
    setHoveredVertex,
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
      isAltPressed: keyboardShortcuts.isAltPressed
    },
    
    // Utilities
    handleEscape
  };
};