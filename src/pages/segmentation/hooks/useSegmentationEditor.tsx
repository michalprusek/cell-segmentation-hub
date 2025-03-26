
import { useState, useCallback, useEffect, useRef } from 'react';
import { useSegmentationCore } from './useSegmentationCore';
import { useSegmentationView } from './useSegmentationView';
import { usePolygonInteraction } from './usePolygonInteraction';
import { useSegmentationHistory } from './useSegmentationHistory';

/**
 * Hlavní hook pro segmentační editor, který kombinuje funkcionalitu ze všech dílčích hooků
 */
export const useSegmentationEditor = (
  projectId: string | undefined,
  imageId: string | undefined,
  userId: string | undefined
) => {
  // Základní data a funkce segmentačního editoru
  const core = useSegmentationCore(projectId, imageId, userId);
  
  // Funkce pro práci s zobrazením a navigací
  const view = useSegmentationView(core.canvasContainerRef, core.imageSrc);
  
  // Funkce pro interakci s polygony
  const polygonInteraction = usePolygonInteraction(
    core.segmentation,
    core.setSegmentation,
    view.zoom,
    view.offset,
    view.setOffset
  );
  
  // Funkce pro správu historie segmentace
  const historyManagement = useSegmentationHistory(
    core.segmentation,
    core.setSegmentation
  );
  
  // Sledování stisknutí Shift klávesy pro ekvidistantní přidávání bodů
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(true);
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  
  // Connect vertex drag state to history management
  useEffect(() => {
    const isDragging = polygonInteraction.vertexDragState.current.isDragging;
    historyManagement.setDraggingVertex(isDragging);
  }, [
    polygonInteraction.vertexDragState.current.isDragging,
    historyManagement.setDraggingVertex
  ]);
  
  // Keyboard event handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      polygonInteraction.exitAllEditModes();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      polygonInteraction.handleDeletePolygon();
    } else if (e.key === 'e' || e.key === 'E') {
      polygonInteraction.toggleEditMode();
    } else if (e.key === 's' || e.key === 'S') {
      polygonInteraction.toggleSlicingMode();
    } else if (e.key === 'a' || e.key === 'A') {
      polygonInteraction.togglePointAddingMode();
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      historyManagement.handleUndo();
    } else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
      historyManagement.handleRedo();
    }
  }, [
    polygonInteraction.handleDeletePolygon,
    polygonInteraction.toggleEditMode,
    polygonInteraction.toggleSlicingMode,
    polygonInteraction.togglePointAddingMode,
    polygonInteraction.exitAllEditModes,
    historyManagement.handleUndo,
    historyManagement.handleRedo
  ]);
  
  // Kombinace všech stavů a funkcí z dílčích hooků
  return {
    ...core,
    ...view,
    ...polygonInteraction,
    ...historyManagement,
    handleKeyDown,
    isShiftPressed,
    // Explicitly expose source polygon ID
    sourcePolygonId: polygonInteraction.sourcePolygonId,
    // Explicitně exportujeme funkce pro editaci polygonů
    handleSlicePolygon: polygonInteraction.handleSlicePolygon,
    handleEditPolygon: polygonInteraction.handleEditPolygon,
    handleDeleteVertex: polygonInteraction.handleDeleteVertex,
    handleDuplicateVertex: polygonInteraction.handleDuplicateVertex
  };
};
