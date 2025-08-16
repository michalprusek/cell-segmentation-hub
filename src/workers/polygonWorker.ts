/**
 * High-performance polygon processing Web Worker
 * Handles computationally expensive polygon operations off the main thread
 * Inspired by SpheroSeg worker architecture
 */

interface Point {
  x: number;
  y: number;
}

interface WorkerMessage {
  id: string;
  type: string;
  payload: any;
}

interface WorkerResponse {
  id: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTime?: number;
}

interface SimplifyRequest {
  points: Point[];
  tolerance: number;
  preserveTopology?: boolean;
}

interface IntersectionRequest {
  polygon1: Point[];
  polygon2: Point[];
}

interface SliceRequest {
  polygon: Point[];
  lineStart: Point;
  lineEnd: Point;
}

interface AreaCalculationRequest {
  points: Point[];
}

interface ConvexHullRequest {
  points: Point[];
}

interface BufferRequest {
  points: Point[];
  distance: number;
  segments?: number;
}

/**
 * High-performance Ramer-Douglas-Peucker simplification algorithm
 */
function simplifyPolygon(points: Point[], tolerance: number, preserveTopology: boolean = true): Point[] {
  if (points.length <= 3) return [...points];
  
  const simplifyRecursive = (start: number, end: number): Point[] => {
    let maxDistance = 0;
    let maxIndex = 0;
    
    // Find the point with maximum distance from the line
    for (let i = start + 1; i < end; i++) {
      const distance = perpendicularDistance(points[i], points[start], points[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }
    
    if (maxDistance > tolerance) {
      // Recursively simplify both parts
      const leftPart = simplifyRecursive(start, maxIndex);
      const rightPart = simplifyRecursive(maxIndex, end);
      return [...leftPart.slice(0, -1), ...rightPart];
    } else {
      return [points[start], points[end]];
    }
  };
  
  const simplified = simplifyRecursive(0, points.length - 1);
  
  // Ensure polygon is closed if it was originally closed
  if (preserveTopology && points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001) {
      if (simplified.length > 2) {
        simplified.push(simplified[0]);
      }
    }
  }
  
  return simplified;
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  if (dx === 0 && dy === 0) {
    const ddx = point.x - lineStart.x;
    const ddy = point.y - lineStart.y;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }
  
  const normalLength = Math.sqrt(dx * dx + dy * dy);
  return Math.abs((dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / normalLength);
}

/**
 * Calculate polygon area using shoelace formula
 */
function calculatePolygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  
  return Math.abs(area) / 2;
}

/**
 * Calculate polygon perimeter
 */
function calculatePolygonPerimeter(points: Point[]): number {
  if (points.length < 2) return 0;
  
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const dx = points[j].x - points[i].x;
    const dy = points[j].y - points[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  
  return perimeter;
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 */
function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (
      polygon[i].y > point.y !== polygon[j].y > point.y &&
      point.x < ((polygon[j].x - polygon[i].x) * (point.y - polygon[i].y)) / (polygon[j].y - polygon[i].y) + polygon[i].x
    ) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Find intersection points between two line segments
 */
function lineIntersection(
  p1: Point, p2: Point, 
  p3: Point, p4: Point
): Point | null {
  const x1 = p1.x, y1 = p1.y;
  const x2 = p2.x, y2 = p2.y;
  const x3 = p3.x, y3 = p3.y;
  const x4 = p4.x, y4 = p4.y;
  
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  
  if (Math.abs(denominator) < 1e-10) {
    return null; // Lines are parallel
  }
  
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator;
  
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1)
    };
  }
  
  return null;
}

/**
 * Find all intersection points between two polygons
 */
function polygonIntersections(polygon1: Point[], polygon2: Point[]): Point[] {
  const intersections: Point[] = [];
  
  for (let i = 0; i < polygon1.length; i++) {
    const p1 = polygon1[i];
    const p2 = polygon1[(i + 1) % polygon1.length];
    
    for (let j = 0; j < polygon2.length; j++) {
      const p3 = polygon2[j];
      const p4 = polygon2[(j + 1) % polygon2.length];
      
      const intersection = lineIntersection(p1, p2, p3, p4);
      if (intersection) {
        intersections.push(intersection);
      }
    }
  }
  
  return intersections;
}

/**
 * Slice a polygon with a line
 */
function slicePolygon(polygon: Point[], lineStart: Point, lineEnd: Point): Point[][] {
  const intersections: Array<{ point: Point; edgeIndex: number; t: number }> = [];
  
  // Find all intersections with polygon edges
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    
    const intersection = lineIntersection(lineStart, lineEnd, p1, p2);
    if (intersection) {
      // Calculate parameter t along the edge
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const t = dx !== 0 ? (intersection.x - p1.x) / dx : (intersection.y - p1.y) / dy;
      
      intersections.push({
        point: intersection,
        edgeIndex: i,
        t: Math.max(0, Math.min(1, t))
      });
    }
  }
  
  if (intersections.length < 2) {
    return [polygon]; // No valid slice
  }
  
  // Sort intersections by edge index and parameter t
  intersections.sort((a, b) => {
    if (a.edgeIndex !== b.edgeIndex) {
      return a.edgeIndex - b.edgeIndex;
    }
    return a.t - b.t;
  });
  
  // Create two new polygons
  const polygon1: Point[] = [];
  const polygon2: Point[] = [];
  
  let currentPolygon = polygon1;
  let intersectionIndex = 0;
  
  for (let i = 0; i < polygon.length; i++) {
    const vertex = polygon[i];
    
    // Check if we need to add intersection points before this vertex
    while (
      intersectionIndex < intersections.length &&
      intersections[intersectionIndex].edgeIndex === i
    ) {
      const intersection = intersections[intersectionIndex];
      
      currentPolygon.push(intersection.point);
      
      // Switch to the other polygon
      currentPolygon = currentPolygon === polygon1 ? polygon2 : polygon1;
      currentPolygon.push(intersection.point);
      
      intersectionIndex++;
    }
    
    currentPolygon.push(vertex);
  }
  
  return [polygon1, polygon2].filter(p => p.length >= 3);
}

/**
 * Calculate convex hull using Graham scan algorithm
 */
function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return [...points];
  
  // Find the bottommost point (and leftmost if tie)
  let bottom = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].y < points[bottom].y || 
        (points[i].y === points[bottom].y && points[i].x < points[bottom].x)) {
      bottom = i;
    }
  }
  
  // Swap bottom point to first position
  [points[0], points[bottom]] = [points[bottom], points[0]];
  const pivot = points[0];
  
  // Sort points by polar angle with respect to pivot
  const sortedPoints = points.slice(1).sort((a, b) => {
    const angleA = Math.atan2(a.y - pivot.y, a.x - pivot.x);
    const angleB = Math.atan2(b.y - pivot.y, b.x - pivot.x);
    
    if (Math.abs(angleA - angleB) < 1e-10) {
      // Same angle, sort by distance
      const distA = (a.x - pivot.x) ** 2 + (a.y - pivot.y) ** 2;
      const distB = (b.x - pivot.x) ** 2 + (b.y - pivot.y) ** 2;
      return distA - distB;
    }
    
    return angleA - angleB;
  });
  
  const hull: Point[] = [pivot];
  
  for (const point of sortedPoints) {
    // Remove points that create clockwise turn
    while (hull.length > 1 && crossProduct(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
      hull.pop();
    }
    hull.push(point);
  }
  
  return hull;
}

/**
 * Calculate cross product for three points
 */
function crossProduct(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Create buffer around polygon
 */
function bufferPolygon(points: Point[], distance: number, segments: number = 8): Point[] {
  if (points.length < 3 || distance <= 0) return [...points];
  
  const bufferedPoints: Point[] = [];
  
  for (let i = 0; i < points.length; i++) {
    const prevIndex = (i - 1 + points.length) % points.length;
    const nextIndex = (i + 1) % points.length;
    
    const prev = points[prevIndex];
    const current = points[i];
    const next = points[nextIndex];
    
    // Calculate normals
    const normal1 = getNormal(prev, current, distance);
    const normal2 = getNormal(current, next, distance);
    
    // Calculate bisector
    const bisector = {
      x: (normal1.x + normal2.x) / 2,
      y: (normal1.y + normal2.y) / 2
    };
    
    // Normalize bisector
    const length = Math.sqrt(bisector.x * bisector.x + bisector.y * bisector.y);
    if (length > 0) {
      bisector.x = (bisector.x / length) * distance;
      bisector.y = (bisector.y / length) * distance;
    }
    
    bufferedPoints.push({
      x: current.x + bisector.x,
      y: current.y + bisector.y
    });
  }
  
  return bufferedPoints;
}

/**
 * Get normal vector for a line segment
 */
function getNormal(p1: Point, p2: Point, length: number): Point {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const segmentLength = Math.sqrt(dx * dx + dy * dy);
  
  if (segmentLength === 0) {
    return { x: 0, y: length };
  }
  
  return {
    x: (-dy / segmentLength) * length,
    y: (dx / segmentLength) * length
  };
}

/**
 * Main message handler
 */
self.onmessage = function(event: MessageEvent<WorkerMessage>) {
  const { id, type, payload } = event.data;
  const startTime = performance.now();
  
  try {
    let result: any;
    
    switch (type) {
      case 'simplify':
        const simplifyReq = payload as SimplifyRequest;
        result = simplifyPolygon(
          simplifyReq.points, 
          simplifyReq.tolerance, 
          simplifyReq.preserveTopology
        );
        break;
        
      case 'intersections':
        const intersectionReq = payload as IntersectionRequest;
        result = polygonIntersections(intersectionReq.polygon1, intersectionReq.polygon2);
        break;
        
      case 'slice':
        const sliceReq = payload as SliceRequest;
        result = slicePolygon(sliceReq.polygon, sliceReq.lineStart, sliceReq.lineEnd);
        break;
        
      case 'area':
        const areaReq = payload as AreaCalculationRequest;
        result = {
          area: calculatePolygonArea(areaReq.points),
          perimeter: calculatePolygonPerimeter(areaReq.points)
        };
        break;
        
      case 'convexHull':
        const hullReq = payload as ConvexHullRequest;
        result = convexHull(hullReq.points);
        break;
        
      case 'buffer':
        const bufferReq = payload as BufferRequest;
        result = bufferPolygon(
          bufferReq.points, 
          bufferReq.distance, 
          bufferReq.segments
        );
        break;
        
      case 'pointInPolygon':
        result = pointInPolygon(payload.point, payload.polygon);
        break;
        
      default:
        throw new Error(`Unknown operation type: ${type}`);
    }
    
    const executionTime = performance.now() - startTime;
    
    const response: WorkerResponse = {
      id,
      success: true,
      result,
      executionTime
    };
    
    self.postMessage(response);
    
  } catch (error) {
    const executionTime = performance.now() - startTime;
    
    const response: WorkerResponse = {
      id,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTime
    };
    
    self.postMessage(response);
  }
};

// Export type for use in main thread
export type PolygonWorkerMessage = WorkerMessage;
export type PolygonWorkerResponse = WorkerResponse;