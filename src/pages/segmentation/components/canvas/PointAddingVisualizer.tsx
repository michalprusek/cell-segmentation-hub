
import React from 'react';
import { Point } from '@/lib/segmentation';

interface PointAddingVisualizerProps {
  hoveredSegment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  };
  zoom: number;
  tempPoints?: Point[];
  selectedVertexIndex?: number | null;
  polygonPoints?: Point[] | null;
}

/**
 * Visualization component for point adding mode
 */
const PointAddingVisualizer = ({
  hoveredSegment,
  zoom,
  tempPoints = [],
  selectedVertexIndex = null,
  polygonPoints = null
}: PointAddingVisualizerProps) => {
  // If no hovered segment, nothing to visualize
  if (!hoveredSegment.polygonId && !hoveredSegment.projectedPoint && tempPoints.length === 0) {
    return null;
  }
  
  // Determine stroke width based on zoom
  const getStrokeWidth = () => {
    if (zoom > 4) {
      return 2/zoom;
    } else if (zoom > 3) {
      return 2.5/zoom;
    } else if (zoom < 0.5) {
      return 1.5/zoom;
    } else if (zoom < 0.7) {
      return 2/zoom;
    } else {
      return 3/zoom;
    }
  };
  
  const strokeWidth = getStrokeWidth();
  
  // Get point radius based on zoom
  const getPointRadius = () => {
    if (zoom > 4) {
      return 8/zoom;
    } else if (zoom > 3) {
      return 7/zoom;
    } else if (zoom < 0.5) {
      return 5/zoom;
    } else if (zoom < 0.7) {
      return 5.5/zoom;
    } else {
      return 6/zoom;
    }
  };
  
  const pointRadius = getPointRadius();
  
  // Helper to create path data string for temporary points
  const createPathData = (points: Point[]) => {
    if (points.length < 2) return '';
    
    let pathData = `M ${points[0].x} ${points[0].y}`;
    
    for (let i = 1; i < points.length; i++) {
      pathData += ` L ${points[i].x} ${points[i].y}`;
    }
    
    return pathData;
  };

  // Get starting vertex if we have a selected vertex index
  const startVertex = selectedVertexIndex !== null && polygonPoints && polygonPoints.length > selectedVertexIndex
    ? polygonPoints[selectedVertexIndex]
    : null;

  return (
    <g>
      {/* Highlight for the hovered vertex */}
      {hoveredSegment.projectedPoint && (
        <circle
          cx={hoveredSegment.projectedPoint.x}
          cy={hoveredSegment.projectedPoint.y}
          r={pointRadius * 1.5}
          fill="rgba(74, 222, 128, 0.5)"
          stroke="#4ADE80"
          strokeWidth={strokeWidth}
          style={{ pointerEvents: 'none' }}
        />
      )}
      
      {/* Highlight for the selected start vertex */}
      {startVertex && (
        <circle
          cx={startVertex.x}
          cy={startVertex.y}
          r={pointRadius * 1.5}
          fill="rgba(249, 115, 22, 0.5)"
          stroke="#F97316"
          strokeWidth={strokeWidth}
          style={{ pointerEvents: 'none' }}
          className="animate-pulse"
        />
      )}
      
      {/* Path connecting temporary points */}
      {tempPoints.length > 0 && startVertex && (
        <path
          d={`M ${startVertex.x} ${startVertex.y} ${createPathData(tempPoints).substring(1)}`}
          fill="none"
          stroke="#4ADE80"
          strokeWidth={strokeWidth}
          strokeDasharray={`${5/zoom},${3/zoom}`}
          style={{ pointerEvents: 'none' }}
        />
      )}
      
      {/* Temporary points */}
      {tempPoints.map((point, index) => (
        <circle
          key={`temp-add-point-${index}`}
          cx={point.x}
          cy={point.y}
          r={pointRadius}
          fill="#4ADE80"
          stroke="#FFFFFF"
          strokeWidth={strokeWidth}
          style={{ pointerEvents: 'none' }}
        />
      ))}
      
      {/* Line connecting last temp point to hovered point if both exist */}
      {tempPoints.length > 0 && hoveredSegment.projectedPoint && (
        <line
          x1={tempPoints[tempPoints.length - 1].x}
          y1={tempPoints[tempPoints.length - 1].y}
          x2={hoveredSegment.projectedPoint.x}
          y2={hoveredSegment.projectedPoint.y}
          stroke="#4ADE80"
          strokeWidth={strokeWidth}
          strokeDasharray={`${5/zoom},${3/zoom}`}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  );
};

export default PointAddingVisualizer;
