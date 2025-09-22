/**
 * Vertex Rendering Performance Optimization Utilities
 *
 * This module provides optimized calculations for vertex rendering
 * to eliminate performance bottlenecks during zoom, pan, and interaction operations.
 */

// Pre-computed scaling factors for common zoom levels
const SCALE_CACHE = new Map<number, number>();
const STROKE_CACHE = new Map<string, number>();

/**
 * Optimized vertex radius calculation with caching
 * Replaces expensive Math.pow() calls with cached results
 */
export function getOptimizedVertexRadius(
  zoom: number,
  baseRadius: number = 3,
  isHovered: boolean = false,
  isStartPoint: boolean = false
): number {
  // Create cache key for this combination
  const cacheKey = Math.round(zoom * 100) / 100; // Round to 2 decimal places

  if (!SCALE_CACHE.has(cacheKey)) {
    // Calculate and cache the scaling factor
    const zoomExponent = 1.1;
    let scaleFactor: number;

    if (zoom <= 1) {
      scaleFactor = 1 / Math.pow(zoom, zoomExponent);
    } else {
      // Optimized calculation for high zoom levels
      scaleFactor = 1 / (zoom * zoom * Math.pow(zoom, zoomExponent - 2));
    }

    SCALE_CACHE.set(cacheKey, scaleFactor);
  }

  const radius = baseRadius * SCALE_CACHE.get(cacheKey)!;
  const hoverScale = isHovered ? 1.15 : 1;
  const startPointScale = isStartPoint ? 1.1 : 1;

  return Math.max(radius * hoverScale * startPointScale, 0.5);
}

/**
 * Optimized stroke width calculation with caching
 */
export function getOptimizedStrokeWidth(
  zoom: number,
  isHovered: boolean = false
): number {
  const cacheKey = `${Math.round(zoom * 100)}-${isHovered}`;

  if (!STROKE_CACHE.has(cacheKey)) {
    const baseStrokeWidth = isHovered ? 2.0 : 0.5;
    let zoomFactor: number;

    if (zoom <= 1) {
      zoomFactor = zoom * 0.9;
    } else {
      // Use square root for better performance than Math.pow
      zoomFactor = Math.sqrt(zoom) * 0.9;
    }

    const strokeWidth = Math.max(
      baseStrokeWidth / zoomFactor,
      isHovered ? 0.4 : 0.1
    );

    STROKE_CACHE.set(cacheKey, strokeWidth);
  }

  return STROKE_CACHE.get(cacheKey)!;
}

/**
 * Vertex object pool for reducing garbage collection pressure
 */
class VertexPool {
  private pool: Array<{ x: number; y: number; id: string }> = [];
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  acquire(x: number, y: number, id: string) {
    const vertex = this.pool.pop() || { x: 0, y: 0, id: '' };
    vertex.x = x;
    vertex.y = y;
    vertex.id = id;
    return vertex;
  }

  release(vertex: { x: number; y: number; id: string }) {
    if (this.pool.length < this.maxSize) {
      this.pool.push(vertex);
    }
  }

  clear() {
    this.pool.length = 0;
  }
}

// Global vertex pool instance
export const vertexPool = new VertexPool();

/**
 * Throttle function optimized for canvas operations
 * Uses requestAnimationFrame for smooth 60fps rendering
 */
export function rafThrottle<T extends (...args: any[]) => void>(
  func: T,
  immediate: boolean = false
): T {
  let rafId: number | null = null;
  let lastArgs: Parameters<T>;

  const throttled = (...args: Parameters<T>) => {
    lastArgs = args;

    if (rafId === null) {
      if (immediate) {
        func(...args);
      }

      rafId = requestAnimationFrame(() => {
        if (!immediate) {
          func(...lastArgs);
        }
        rafId = null;
      });
    }
  };

  return throttled as T;
}

/**
 * Viewport culling for vertices
 * Only render vertices visible in the current viewport
 */
export function getVisibleVertices<T extends { x: number; y: number }>(
  vertices: T[],
  viewport: {
    x: number;
    y: number;
    width: number;
    height: number;
    zoom: number;
  },
  buffer: number = 100
): T[] {
  const { x: viewX, y: viewY, width, height, zoom } = viewport;

  // Calculate visible bounds with buffer
  const minX = viewX - buffer / zoom;
  const maxX = viewX + width / zoom + buffer / zoom;
  const minY = viewY - buffer / zoom;
  const maxY = viewY + height / zoom + buffer / zoom;

  return vertices.filter(
    vertex =>
      vertex.x >= minX &&
      vertex.x <= maxX &&
      vertex.y >= minY &&
      vertex.y <= maxY
  );
}

/**
 * Clear optimization caches (call this when zoom range changes significantly)
 */
export function clearOptimizationCaches(): void {
  SCALE_CACHE.clear();
  STROKE_CACHE.clear();
  vertexPool.clear();
}

/**
 * Development-only performance logging
 */
export function debugLog(message: string, data?: any): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[VertexOptimization] ${message}`, data);
  }
}
