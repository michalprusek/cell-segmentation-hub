
import React from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import CanvasSvgFilters from './CanvasSvgFilters';
import CanvasPolygon from './CanvasPolygon';
import TemporaryEditPath from './TemporaryEditPath';
import SlicingModeVisualizer from './SlicingModeVisualizer';
import PointAddingVisualizer from './PointAddingVisualizer';
import EditModeBorder from './EditModeBorder';
import { PolygonLayerProps } from '@/pages/segmentation/types';
import PolygonCollection from './PolygonCollection';
import EditorModeVisualizations from './EditorModeVisualizations';

/**
 * Komponenta zobrazující vrstvu s polygony na plátně
 */
const CanvasPolygonLayer = ({ 
  segmentation, 
  imageSize, 
  selectedPolygonId, 
  hoveredVertex, 
  vertexDragState,
  zoom,
  editMode,
  slicingMode,
  pointAddingMode,
  tempPoints,
  cursorPosition,
  sliceStartPoint,
  hoveredSegment,
  isShiftPressed
}: PolygonLayerProps) => {
  if (!segmentation || imageSize.width <= 0) return null;
  
  return (
    <svg 
      width={imageSize.width}
      height={imageSize.height}
      className="absolute top-0 left-0"
      style={{ maxWidth: "none" }}
      shapeRendering="geometricPrecision"
      vectorEffect="non-scaling-stroke"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
      overflow="visible"
    >
      <CanvasSvgFilters />
      
      {/* Vykreslení všech polygonů */}
      <PolygonCollection 
        polygons={segmentation.polygons}
        selectedPolygonId={selectedPolygonId}
        hoveredVertex={hoveredVertex}
        vertexDragState={vertexDragState.current}
        zoom={zoom}
      />

      {/* Vizualizace režimů editace */}
      <EditorModeVisualizations
        editMode={editMode}
        slicingMode={slicingMode}
        pointAddingMode={pointAddingMode}
        tempPoints={tempPoints}
        cursorPosition={cursorPosition}
        sliceStartPoint={sliceStartPoint}
        hoveredSegment={hoveredSegment}
        zoom={zoom}
        isShiftPressed={isShiftPressed}
      />

      {/* Indikátor okraje editačního režimu */}
      <EditModeBorder
        editMode={editMode}
        slicingMode={slicingMode}
        pointAddingMode={pointAddingMode}
        imageSize={imageSize}
        zoom={zoom}
      />
    </svg>
  );
};

export default CanvasPolygonLayer;
