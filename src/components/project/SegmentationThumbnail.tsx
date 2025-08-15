import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface Point {
  x: number;
  y: number;
}

interface Polygon {
  id: string;
  points: Point[];
  type: 'external' | 'internal';
  class?: string;
}

interface SegmentationThumbnailProps {
  polygons: Polygon[];
  imageWidth: number;
  imageHeight: number;
  className?: string;
  simplified?: boolean;
}

// Douglas-Peucker algorithm for polygon simplification
const simplifyPolygon = (points: Point[], tolerance: number = 1): Point[] => {
  if (points.length <= 3) return points;
  
  // Find the point with the maximum distance from the line between start and end
  let maxDistance = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points[points.length - 1];
  
  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }
  
  // If max distance is greater than tolerance, recursively simplify
  if (maxDistance > tolerance) {
    const leftPart = simplifyPolygon(points.slice(0, maxIndex + 1), tolerance);
    const rightPart = simplifyPolygon(points.slice(maxIndex), tolerance);
    
    // Combine the two parts (removing the duplicate point at maxIndex)
    return [...leftPart.slice(0, -1), ...rightPart];
  } else {
    // If all points are within tolerance, return just the endpoints
    return [start, end];
  }
};

// Calculate perpendicular distance from a point to a line
const perpendicularDistance = (point: Point, lineStart: Point, lineEnd: Point): number => {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  if (dx === 0 && dy === 0) {
    // Line start and end are the same
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }
  
  const normalLength = Math.sqrt(dx * dx + dy * dy);
  return Math.abs((dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / normalLength);
};

const SegmentationThumbnail: React.FC<SegmentationThumbnailProps> = ({
  polygons,
  imageWidth,
  imageHeight,
  className,
  simplified = true
}) => {
  // Use the full container size and preserve aspect ratio
  // The SVG will scale to fit the container with proper viewBox
  const aspectRatio = imageWidth / imageHeight;
  
  // Calculate the viewBox dimensions based on original image dimensions
  // The scale factor will be handled by the viewBox and SVG scaling
  const viewBoxWidth = imageWidth;
  const viewBoxHeight = imageHeight;

  if (process.env.NODE_ENV === 'development') {
    console.log(`🎨 SegmentationThumbnail rendering:`, {
      polygonCount: polygons.length,
      dimensions: `${imageWidth}x${imageHeight}`,
      aspectRatio: aspectRatio.toFixed(2),
      viewBox: `0 0 ${viewBoxWidth} ${viewBoxHeight}`,
      simplified,
      samplePolygon: polygons[0] ? {
        id: polygons[0].id,
        type: polygons[0].type,
        pointCount: polygons[0].points.length,
        firstFewPoints: polygons[0].points.slice(0, 3)
      } : null
    });
  }
  
  // Process polygons for rendering
  const processedPolygons = useMemo(() => {
    return polygons.map(polygon => {
      // Use original coordinates - scaling will be handled by viewBox
      let points = polygon.points;
      
      // Simplify polygon if requested (for performance)
      if (simplified && points.length > 10) {
        const tolerance = Math.min(imageWidth, imageHeight) * 0.005; // 0.5% of image size
        points = simplifyPolygon(points, tolerance);
      }
      
      return {
        ...polygon,
        points: points,
        pathString: `M${points.map(p => `${p.x},${p.y}`).join(' L')} Z`
      };
    });
  }, [polygons, simplified, imageWidth, imageHeight]);
  
  // Separate external and internal polygons
  const externalPolygons = processedPolygons.filter(p => p.type === 'external');
  const internalPolygons = processedPolygons.filter(p => p.type === 'internal');
  
  if (polygons.length === 0) {
    return null;
  }
  
  return (
    <svg
      className={cn(
        "absolute inset-0 w-full h-full pointer-events-none",
        className
      )}
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        zIndex: 10
      }}
    >
      {/* Render external polygons (red) */}
      {externalPolygons.map(polygon => (
        <path
          key={polygon.id}
          d={polygon.pathString}
          fill="rgba(239, 68, 68, 0.2)"
          stroke="rgba(239, 68, 68, 0.8)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      
      {/* Render internal polygons (blue) */}
      {internalPolygons.map(polygon => (
        <path
          key={polygon.id}
          d={polygon.pathString}
          fill="rgba(14, 165, 233, 0.2)"
          stroke="rgba(14, 165, 233, 0.8)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      
    </svg>
  );
};

export default SegmentationThumbnail;