
import React, { useState, useEffect } from 'react';
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
  const [cursorPosition, setCursorPosition] = useState<{x: number, y: number} | null>(null);
  
  // Track cursor position for edit mode line
  useEffect(() => {
    if (!editMode || tempPoints.points.length === 0) {
      setCursorPosition(null);
      return;
    }
    
    const handleMouseMove = (e: MouseEvent) => {
      const svgElement = document.querySelector('svg') as SVGSVGElement;
      if (!svgElement) return;
      
      const rect = svgElement.getBoundingClientRect();
      const point = svgElement.createSVGPoint();
      
      point.x = e.clientX - rect.left;
      point.y = e.clientY - rect.top;
      
      // Transform to SVG coordinate space if needed
      const matrix = svgElement.getScreenCTM();
      if (matrix) {
        const transformedPoint = point.matrixTransform(matrix.inverse());
        setCursorPosition({ x: transformedPoint.x, y: transformedPoint.y });
      } else {
        setCursorPosition({ x: point.x, y: point.y });
      }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [editMode, tempPoints.points.length]);
  
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
          {/* Points already added */}
          <polyline
            points={tempPoints.points.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#FF3B30"
            strokeWidth={2/zoom}
            strokeDasharray={`${4/zoom},${4/zoom}`}
            shapeRendering="geometricPrecision"
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
              shapeRendering="geometricPrecision"
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
