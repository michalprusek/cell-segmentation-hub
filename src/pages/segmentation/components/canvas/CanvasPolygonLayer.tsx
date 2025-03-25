
import React from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import CanvasSvgFilters from './CanvasSvgFilters';
import CanvasPolygon from './CanvasPolygon';
import TemporaryEditPath from './TemporaryEditPath';
import SlicingModeVisualizer from './SlicingModeVisualizer';
import PointAddingVisualizer from './PointAddingVisualizer';
import EditModeBorder from './EditModeBorder';

interface CanvasPolygonLayerProps {
  segmentation: SegmentationResult;
  imageSize: { width: number, height: number };
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null };
  vertexDragState: React.MutableRefObject<{
    isDragging: boolean;
    polygonId: string | null;
    vertexIndex: number | null;
  }>;
  zoom: number;
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
  tempPoints: { points: Array<{x: number, y: number}>, startIndex: number | null, endIndex: number | null, polygonId: string | null };
  cursorPosition: Point | null;
  sliceStartPoint: Point | null;
  hoveredSegment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  };
  isShiftPressed?: boolean;
}

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
}: CanvasPolygonLayerProps) => {
  if (!segmentation || imageSize.width <= 0) return null;
  
  return (
    <svg 
      width={imageSize.width}
      height={imageSize.height}
      className="absolute top-0 left-0"
      style={{ maxWidth: "none" }}
      shapeRendering="auto"
      vectorEffect="non-scaling-stroke"
      xmlns="http://www.w3.org/2000/svg"
    >
      <CanvasSvgFilters />
      
      {segmentation.polygons.map(polygon => (
        <CanvasPolygon 
          key={polygon.id}
          id={polygon.id}
          points={polygon.points}
          isSelected={selectedPolygonId === polygon.id}
          hoveredVertex={hoveredVertex}
          vertexDragState={vertexDragState.current}
          zoom={zoom}
        />
      ))}

      {/* Edit mode visualizations */}
      {editMode && (
        <TemporaryEditPath 
          tempPoints={tempPoints}
          cursorPosition={cursorPosition}
          zoom={zoom}
          isShiftPressed={isShiftPressed}
        />
      )}
      
      {/* Slicing mode visualization */}
      {slicingMode && (
        <SlicingModeVisualizer
          sliceStartPoint={sliceStartPoint}
          cursorPosition={cursorPosition}
          zoom={zoom}
        />
      )}
      
      {/* Point adding mode visualization */}
      {pointAddingMode && (
        <PointAddingVisualizer
          hoveredSegment={hoveredSegment}
          zoom={zoom}
        />
      )}

      {/* Edit mode border indicator */}
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
