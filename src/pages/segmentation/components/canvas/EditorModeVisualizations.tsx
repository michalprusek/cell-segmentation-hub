
import React from 'react';
import { Point } from '@/lib/segmentation';
import { TempPointsState } from '@/pages/segmentation/types';
import TemporaryEditPath from './TemporaryEditPath';
import SlicingModeVisualizer from './SlicingModeVisualizer';
import PointAddingVisualizer from './pointAddingVisualizer';

interface EditorModeVisualizationsProps {
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
  tempPoints: TempPointsState;
  cursorPosition: Point | null;
  sliceStartPoint: Point | null;
  hoveredSegment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  };
  zoom: number;
  isShiftPressed?: boolean;
  selectedPolygonPoints?: Point[] | null;
  pointAddingTempPoints?: Point[];
  selectedVertexIndex?: number | null;
  sourcePolygonId?: string | null;
}

/**
 * Komponenta zobrazující vizualizace pro různé editační režimy
 */
const EditorModeVisualizations = ({
  editMode,
  slicingMode,
  pointAddingMode,
  tempPoints,
  cursorPosition,
  sliceStartPoint,
  hoveredSegment,
  zoom,
  isShiftPressed,
  selectedPolygonPoints,
  pointAddingTempPoints = [],
  selectedVertexIndex,
  sourcePolygonId
}: EditorModeVisualizationsProps) => {
  // Odstranil jsem console.log pro lepší výkon a čistotu kódu
  
  return (
    <>
      {/* Vizualizace editačního režimu - dočasné body a spojnice */}
      {editMode && (
        <TemporaryEditPath 
          tempPoints={tempPoints}
          cursorPosition={cursorPosition}
          zoom={zoom}
          isShiftPressed={isShiftPressed}
        />
      )}
      
      {/* Vizualizace režimu rozdělování */}
      {slicingMode && (
        <SlicingModeVisualizer
          sliceStartPoint={sliceStartPoint}
          cursorPosition={cursorPosition}
          zoom={zoom}
        />
      )}
      
      {/* Vizualizace režimu přidávání bodů */}
      {pointAddingMode && (
        <PointAddingVisualizer
          hoveredSegment={hoveredSegment}
          zoom={zoom}
          tempPoints={pointAddingTempPoints || []}
          selectedVertexIndex={selectedVertexIndex || null}
          sourcePolygonId={sourcePolygonId || null}
          polygonPoints={selectedPolygonPoints}
          cursorPosition={cursorPosition}
        />
      )}
    </>
  );
};

export default EditorModeVisualizations;
