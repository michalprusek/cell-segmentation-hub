
import React from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import CanvasSvgFilters from './CanvasSvgFilters';
import CanvasPolygon from './CanvasPolygon';

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
  hoveredSegment
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

      {/* Temporary editing path */}
      {editMode && tempPoints.points.length > 0 && (
        <>
          {/* Points already added */}
          <polyline
            points={tempPoints.points.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#FF3B30"
            strokeWidth={2/zoom}
            strokeDasharray={`${4/zoom},${4/zoom}`}
            vectorEffect="non-scaling-stroke"
          />
          
          {/* Line from last point to cursor */}
          {cursorPosition && tempPoints.points.length > 0 && (
            <line
              x1={tempPoints.points[tempPoints.points.length - 1].x}
              y1={tempPoints.points[tempPoints.points.length - 1].y}
              x2={cursorPosition.x}
              y2={cursorPosition.y}
              stroke="#FF3B30"
              strokeWidth={1.5/zoom}
              strokeDasharray={`${4/zoom},${4/zoom}`}
              vectorEffect="non-scaling-stroke"
            />
          )}
          
          {/* Vertices for the points */}
          {tempPoints.points.map((point, index) => (
            <circle
              key={`temp-point-${index}`}
              cx={point.x}
              cy={point.y}
              r={5/zoom}
              fill={index === 0 ? "#FF3B30" : "#FFFFFF"}
              stroke="#FF3B30"
              strokeWidth={1.5/zoom}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </>
      )}
      
      {/* Slicing mode visualization */}
      {slicingMode && (
        <>
          {/* Slicing indicator line */}
          {sliceStartPoint && cursorPosition && (
            <line
              x1={sliceStartPoint.x}
              y1={sliceStartPoint.y}
              x2={cursorPosition.x}
              y2={cursorPosition.y}
              stroke="#FF0000"
              strokeWidth={2/zoom}
              strokeDasharray={`${6/zoom},${3/zoom}`}
              vectorEffect="non-scaling-stroke"
            />
          )}
          
          {/* Slicing start point */}
          {sliceStartPoint && (
            <circle
              cx={sliceStartPoint.x}
              cy={sliceStartPoint.y}
              r={6/zoom}
              fill="#FF0000"
              stroke="#FFFFFF"
              strokeWidth={1.5/zoom}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </>
      )}
      
      {/* Point adding mode visualization */}
      {pointAddingMode && hoveredSegment.projectedPoint && (
        <circle
          cx={hoveredSegment.projectedPoint.x}
          cy={hoveredSegment.projectedPoint.y}
          r={6/zoom}
          fill="#4CAF50"
          stroke="#FFFFFF"
          strokeWidth={1.5/zoom}
          vectorEffect="non-scaling-stroke"
          className="animate-pulse"
          style={{ animationDuration: '1s' }}
        />
      )}

      {/* Edit mode indicator */}
      {(editMode || slicingMode || pointAddingMode) && (
        <rect
          x={0}
          y={0}
          width={imageSize.width}
          height={imageSize.height}
          fill="none"
          stroke={
            slicingMode ? "#FF0000" : 
            pointAddingMode ? "#4CAF50" : 
            "#FF3B30"
          }
          strokeWidth={3/zoom}
          strokeDasharray={`${8/zoom},${8/zoom}`}
          pointerEvents="none"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
};

export default CanvasPolygonLayer;
