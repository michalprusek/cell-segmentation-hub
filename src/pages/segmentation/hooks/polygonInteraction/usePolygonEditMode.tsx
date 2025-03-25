
import { SegmentationResult, Point } from '@/lib/segmentation';
import { useEditModeCore } from './editMode/useEditModeCore';
import { useSlicingMode } from './editMode/useSlicingMode';
import { usePointAddingMode } from './editMode/usePointAddingMode';
import { useCallback, useState, useEffect } from 'react';
import { useGeometryUtils } from './editMode/useGeometryUtils';

/**
 * Hook for managing polygon edit modes (adding/modifying vertices, slicing)
 */
export const usePolygonEditMode = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null,
  zoom: number = 1,
  offset: { x: number; y: number } = { x: 0, y: 0 }
) => {
  // Základní režim editace (přidávání vrcholů do nového polygonu)
  const editModeCore = useEditModeCore(
    segmentation,
    setSegmentation,
    selectedPolygonId,
    zoom,
    offset
  );
  
  // Režim rozdělování polygonů (slicing)
  const slicingMode = useSlicingMode(
    segmentation,
    setSegmentation,
    selectedPolygonId
  );
  
  // Režim přidávání bodů do existujícího polygonu
  const pointAddingMode = usePointAddingMode(
    segmentation,
    setSegmentation, 
    selectedPolygonId
  );

  const { distance } = useGeometryUtils();
  const [lastAutoAddedPoint, setLastAutoAddedPoint] = useState<Point | null>(null);
  const MIN_DISTANCE_FOR_AUTO_POINT = 20; // Minimální vzdálenost pro automatické přidávání bodů

  // Zajištění, že je aktivní vždy jen jeden režim
  const toggleEditMode = useCallback(() => {
    if (editModeCore.editMode) {
      // Pokud je již aktivní, deaktivujeme
      editModeCore.toggleEditMode();
    } else {
      // Jinak deaktivujeme ostatní režimy a aktivujeme tento
      if (slicingMode.slicingMode) slicingMode.toggleSlicingMode();
      if (pointAddingMode.pointAddingMode) pointAddingMode.togglePointAddingMode();
      editModeCore.toggleEditMode();
    }
  }, [editModeCore, slicingMode, pointAddingMode]);

  const toggleSlicingMode = useCallback(() => {
    if (slicingMode.slicingMode) {
      // Pokud je již aktivní, deaktivujeme
      slicingMode.toggleSlicingMode();
    } else {
      // Jinak deaktivujeme ostatní režimy a aktivujeme tento
      if (editModeCore.editMode) editModeCore.toggleEditMode();
      if (pointAddingMode.pointAddingMode) pointAddingMode.togglePointAddingMode();
      slicingMode.toggleSlicingMode();
    }
  }, [editModeCore, slicingMode, pointAddingMode]);

  const togglePointAddingMode = useCallback(() => {
    if (pointAddingMode.pointAddingMode) {
      // Pokud je již aktivní, deaktivujeme
      pointAddingMode.togglePointAddingMode();
    } else {
      // Jinak deaktivujeme ostatní režimy a aktivujeme tento
      if (editModeCore.editMode) editModeCore.toggleEditMode();
      if (slicingMode.slicingMode) slicingMode.toggleSlicingMode();
      pointAddingMode.togglePointAddingMode();
    }
  }, [editModeCore, slicingMode, pointAddingMode]);

  // Automatické přidávání bodů při držení Shift
  useEffect(() => {
    if (!editModeCore.editMode || !editModeCore.cursorPosition || !editModeCore.isShiftPressed || 
        editModeCore.tempPoints.points.length === 0) {
      setLastAutoAddedPoint(null);
      return;
    }
    
    const lastPoint = editModeCore.tempPoints.points[editModeCore.tempPoints.points.length - 1];
    const currentCursor = editModeCore.cursorPosition;
    
    // Pokud není nastaven poslední auto přidaný bod, nastavíme ho jako poslední bod v sekvenci
    if (!lastAutoAddedPoint) {
      setLastAutoAddedPoint(lastPoint);
      return;
    }
    
    // Zjistíme vzdálenost od posledního auto přidaného bodu k aktuálnímu kurzoru
    const dist = distance(lastAutoAddedPoint, currentCursor);
    
    // Pokud je vzdálenost větší než práh, přidáme nový bod
    if (dist >= MIN_DISTANCE_FOR_AUTO_POINT) {
      editModeCore.addPointToTemp(currentCursor);
      setLastAutoAddedPoint(currentCursor);
    }
  }, [
    editModeCore.editMode, 
    editModeCore.cursorPosition, 
    editModeCore.isShiftPressed, 
    editModeCore.tempPoints.points, 
    editModeCore.addPointToTemp, 
    lastAutoAddedPoint, 
    distance
  ]);

  // Kombinované handlery pro kliknutí v různých režimech editace
  const handleEditModeClick = (x: number, y: number) => {
    if (slicingMode.slicingMode) {
      return slicingMode.handleSlicingClick(x, y);
    } else if (pointAddingMode.pointAddingMode) {
      return pointAddingMode.handlePointAddingClick(x, y);
    } else if (editModeCore.editMode) {
      // Reset lastAutoAddedPoint při kliknutí (protože uživatel začíná nový segment)
      setLastAutoAddedPoint(null);
      return editModeCore.handleEditModeClick(x, y);
    }
    return false;
  };
  
  // Kombinované handlery pro pohyb myši v různých režimech editace
  const handleEditMouseMove = (x: number, y: number) => {
    if (slicingMode.slicingMode) {
      slicingMode.updateCursorPosition(x, y);
    } else if (pointAddingMode.pointAddingMode) {
      pointAddingMode.detectSegmentUnderCursor(x, y);
    }
    // Standardní editMode nepotřebuje speciální handler pro pohyb myši
  };

  return {
    // Základní editační režim
    editMode: editModeCore.editMode,
    tempPoints: editModeCore.tempPoints,
    cursorPosition: editModeCore.cursorPosition || slicingMode.cursorPosition,
    isShiftPressed: editModeCore.isShiftPressed,
    toggleEditMode,
    
    // Slicing režim
    slicingMode: slicingMode.slicingMode,
    sliceStartPoint: slicingMode.sliceStartPoint,
    toggleSlicingMode,
    
    // Režim přidávání bodů
    pointAddingMode: pointAddingMode.pointAddingMode,
    hoveredSegment: pointAddingMode.hoveredSegment,
    togglePointAddingMode,
    
    // Kombinované handlery
    handleEditModeClick,
    handleEditMouseMove
  };
};
