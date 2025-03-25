
import React from 'react';
import { SegmentationResult } from '@/lib/segmentation';
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
  tempPoints: { points: Array<{x: number, y: number}>, startIndex: number | null, endIndex: number | null, polygonId: string | null };
}

const CanvasPolygonLayer = ({ 
  segmentation, 
  imageSize, 
  selectedPolygonId, 
  hoveredVertex, 
  vertexDragState,
  zoom,
  editMode,
  tempPoints
}: CanvasPolygonLayerProps) => {
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
          <polyline
            points={tempPoints.points.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#FF3B30"
            strokeWidth={2/zoom}
            strokeDasharray={`${4/zoom},${4/zoom}`}
            shapeRendering="geometricPrecision"
          />
          {tempPoints.points.map((point, index) => (
            <circle
              key={`temp-point-${index}`}
              cx={point.x}
              cy={point.y}
              r={5/zoom}
              fill={index === 0 ? "#FF3B30" : "#FFFFFF"}
              stroke="#FF3B30"
              strokeWidth={1.5/zoom}
              shapeRendering="geometricPrecision"
            />
          ))}
        </>
      )}

      {/* Edit mode indicator */}
      {editMode && (
        <rect
          x={0}
          y={0}
          width={imageSize.width}
          height={imageSize.height}
          fill="none"
          stroke="#FF3B30"
          strokeWidth={3/zoom}
          strokeDasharray={`${8/zoom},${8/zoom}`}
          pointerEvents="none"
          shapeRendering="geometricPrecision"
        />
      )}
    </svg>
  );
};

export default CanvasPolygonLayer;
