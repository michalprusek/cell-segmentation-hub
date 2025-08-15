import { Point } from '@/lib/segmentation';

// Douglas-Peucker algorithm for polygon simplification optimized for performance
export const simplifyPolygon = (points: Point[], tolerance: number = 1): Point[] => {
  if (points.length <= 3) return points;
  
  const simplifyRecursive = (start: number, end: number): Point[] => {
    let maxDistance = 0;
    let maxIndex = 0;
    
    for (let i = start + 1; i < end; i++) {
      const distance = perpendicularDistance(points[i], points[start], points[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }
    
    if (maxDistance > tolerance) {
      const leftPart = simplifyRecursive(start, maxIndex);
      const rightPart = simplifyRecursive(maxIndex, end);
      return [...leftPart.slice(0, -1), ...rightPart];
    } else {
      return [points[start], points[end]];
    }
  };
  
  const result = simplifyRecursive(0, points.length - 1);
  
  // Prevent duplicate polygon closing points
  if (result.length > 2) {
    const firstPoint = result[0];
    const lastPoint = result[result.length - 1];
    
    // Only add closing point if the polygon isn't already closed
    if (firstPoint.x !== lastPoint.x || firstPoint.y !== lastPoint.y) {
      result.push(firstPoint);
    }
  }
  
  return result;
};

// Calculate perpendicular distance from a point to a line (optimized)
const perpendicularDistance = (point: Point, lineStart: Point, lineEnd: Point): number => {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  if (dx === 0 && dy === 0) {
    const ddx = point.x - lineStart.x;
    const ddy = point.y - lineStart.y;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }
  
  const normalLength = Math.sqrt(dx * dx + dy * dy);
  return Math.abs((dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / normalLength);
};

// Calculate bounding box for a polygon
export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export const calculateBoundingBox = (points: Point[]): BoundingBox => {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
};

// Check if bounding box intersects with viewport
export const isInViewport = (
  bbox: BoundingBox,
  viewportX: number,
  viewportY: number,
  viewportWidth: number,
  viewportHeight: number,
  buffer: number = 0.2 // 20% buffer
): boolean => {
  const bufferX = viewportWidth * buffer;
  const bufferY = viewportHeight * buffer;
  
  const expandedMinX = viewportX - bufferX;
  const expandedMinY = viewportY - bufferY;
  const expandedMaxX = viewportX + viewportWidth + bufferX;
  const expandedMaxY = viewportY + viewportHeight + bufferY;
  
  return !(
    bbox.maxX < expandedMinX ||
    bbox.minX > expandedMaxX ||
    bbox.maxY < expandedMinY ||
    bbox.minY > expandedMaxY
  );
};

// Get optimal simplification tolerance based on zoom level
export const getSimplificationTolerance = (
  zoom: number,
  polygonBoundingBox: BoundingBox,
  originalPointCount: number
): number => {
  // Base tolerance relative to polygon size
  const baseSize = Math.min(polygonBoundingBox.width, polygonBoundingBox.height);
  const baseTolerance = baseSize * 0.01; // 1% of polygon size
  
  // Adjust tolerance based on zoom level
  if (zoom < 0.5) {
    // Aggressive simplification for far zoom out
    return baseTolerance * 8;
  } else if (zoom < 1.0) {
    // Moderate simplification
    return baseTolerance * 4;
  } else if (zoom < 2.0) {
    // Light simplification
    return baseTolerance * 2;
  } else if (zoom < 4.0) {
    // Minimal simplification
    return baseTolerance * 0.5;
  } else {
    // No simplification at high zoom
    return 0;
  }
};

// Determine if vertices should be rendered based on zoom and selection
export const shouldRenderVertices = (
  zoom: number,
  isSelected: boolean,
  isHovered: boolean = false
): boolean => {
  if (zoom < 0.5) {
    // Never render vertices at very low zoom
    return false;
  } else if (zoom < 1.5) {
    // Only render vertices for selected or hovered polygons
    return isSelected || isHovered;
  } else {
    // Render vertices for selected polygons at high zoom
    return isSelected;
  }
};

// Level of Detail (LOD) system for vertex decimation
export const getVertexDecimationStep = (zoom: number, pointCount: number): number => {
  // No decimation for simple polygons
  if (pointCount <= 20) return 1;
  
  if (zoom < 0.5) {
    // Very low zoom: show every 20th vertex or none if too many points
    return pointCount > 500 ? 0 : 20; // 0 means don't render vertices
  } else if (zoom < 1.0) {
    // Low zoom: show every 10th vertex
    return pointCount > 300 ? 15 : 10;
  } else if (zoom < 1.5) {
    // Medium zoom: show every 5th vertex
    return pointCount > 200 ? 8 : 5;
  } else if (zoom < 3.0) {
    // High zoom: show every 3rd vertex
    return pointCount > 100 ? 4 : 3;
  } else {
    // Very high zoom: show every vertex for detailed editing
    return 1;
  }
};

// Get decimated vertices based on LOD
export const getDecimatedVertices = (points: Point[], zoom: number): Point[] => {
  const step = getVertexDecimationStep(zoom, points.length);
  
  if (step <= 0) return []; // Don't render vertices
  if (step === 1) return points; // Show all vertices
  
  const decimatedPoints: Point[] = [];
  
  // Always include first vertex
  if (points.length > 0) {
    decimatedPoints.push(points[0]);
  }
  
  // Add every nth vertex
  for (let i = step; i < points.length; i += step) {
    decimatedPoints.push(points[i]);
  }
  
  // Always include last vertex if it's not already included
  const lastIndex = points.length - 1;
  if (lastIndex > 0 && (lastIndex % step !== 0)) {
    decimatedPoints.push(points[lastIndex]);
  }
  
  return decimatedPoints;
};

// Calculate viewport bounds from current transform
export const getViewportBounds = (
  zoom: number,
  offset: { x: number; y: number },
  containerWidth: number,
  containerHeight: number
) => {
  // Transform container dimensions to image space
  const viewportWidth = containerWidth / zoom;
  const viewportHeight = containerHeight / zoom;
  const viewportX = -offset.x;
  const viewportY = -offset.y;
  
  return {
    x: viewportX,
    y: viewportY,
    width: viewportWidth,
    height: viewportHeight
  };
};

// Performance monitoring utility
export interface PerformanceMetrics {
  renderTime: number;
  polygonCount: number;
  vertexCount: number;
  simplificationRatio: number;
}

export const measureRenderPerformance = <T>(
  operation: () => T,
  polygonCount: number,
  originalVertexCount: number,
  simplifiedVertexCount: number
): { result: T; metrics: PerformanceMetrics } => {
  const startTime = performance.now();
  const result = operation();
  const endTime = performance.now();
  
  const metrics: PerformanceMetrics = {
    renderTime: endTime - startTime,
    polygonCount,
    vertexCount: simplifiedVertexCount,
    simplificationRatio: originalVertexCount > 0 ? simplifiedVertexCount / originalVertexCount : 1
  };
  
  return { result, metrics };
};