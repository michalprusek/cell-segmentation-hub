/**
 * Advanced polygon visibility management system
 * Implements frustum culling with smart threshold management
 * Inspired by SpheroSeg visibility optimization techniques
 */

import { Polygon } from '@/lib/segmentation';
import { BoundingBox } from '@/lib/polygonOptimization';
import { boundingBoxCache } from './BoundingBoxCache';

export interface ViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisibilityContext {
  zoom: number;
  offset: { x: number; y: number };
  containerWidth: number;
  containerHeight: number;
  selectedPolygonId?: string | null;
  forceRenderSelected?: boolean;
}

export interface VisibilityResult {
  visiblePolygons: Polygon[];
  totalPolygons: number;
  visibleCount: number;
  culledCount: number;
  renderingLevel: 'minimal' | 'reduced' | 'normal' | 'full';
}

/**
 * Smart threshold system that adapts to polygon count and performance
 */
class AdaptiveThresholds {
  private performanceHistory: number[] = [];
  private lastFrameTime = 0;

  updatePerformance(frameTime: number): void {
    this.lastFrameTime = frameTime;
    this.performanceHistory.push(frameTime);
    
    // Keep only last 30 frames for rolling average
    if (this.performanceHistory.length > 30) {
      this.performanceHistory.shift();
    }
  }

  getAverageFrameTime(): number {
    if (this.performanceHistory.length === 0) return 16; // Default to 60fps
    return this.performanceHistory.reduce((sum, time) => sum + time, 0) / this.performanceHistory.length;
  }

  /**
   * Get polygon count threshold for enabling frustum culling
   * Adapts based on current performance
   */
  getCullingThreshold(): number {
    const avgFrameTime = this.getAverageFrameTime();
    
    if (avgFrameTime > 33) { // < 30fps
      return 20; // Aggressive culling
    } else if (avgFrameTime > 20) { // < 50fps
      return 50; // Moderate culling
    } else {
      return 100; // Conservative culling
    }
  }

  /**
   * Get viewport buffer size based on zoom and performance
   */
  getViewportBuffer(zoom: number): number {
    const baseBuffer = 100; // Base buffer in pixels
    const avgFrameTime = this.getAverageFrameTime();
    
    let multiplier = 1.0;
    
    // Reduce buffer during poor performance
    if (avgFrameTime > 25) {
      multiplier = 0.5;
    } else if (avgFrameTime > 20) {
      multiplier = 0.75;
    }
    
    // Adjust buffer based on zoom level
    const zoomMultiplier = Math.max(0.3, Math.min(2.0, 1 / zoom));
    
    return baseBuffer * multiplier * zoomMultiplier;
  }

  shouldUseReducedRendering(): boolean {
    return this.getAverageFrameTime() > 25; // < 40fps
  }
}

/**
 * High-performance polygon visibility manager
 */
export class PolygonVisibilityManager {
  private thresholds = new AdaptiveThresholds();
  private lastViewport: ViewportBounds | null = null;
  private lastVisibilityResult: VisibilityResult | null = null;
  private frameCount = 0;

  /**
   * Determine which polygons should be rendered based on viewport
   */
  getVisiblePolygons(
    polygons: Polygon[],
    context: VisibilityContext
  ): VisibilityResult {
    const startTime = performance.now();
    
    // Calculate current viewport
    const viewport = this.calculateViewport(context);
    
    // Check if we can use cached result for small viewport changes
    if (this.canUseCachedResult(viewport, polygons.length)) {
      return this.lastVisibilityResult!;
    }

    const threshold = this.thresholds.getCullingThreshold();
    const renderingLevel = this.determineRenderingLevel(polygons.length, context.zoom);
    
    let visiblePolygons: Polygon[];
    let culledCount = 0;

    if (polygons.length <= threshold && renderingLevel !== 'minimal') {
      // Small number of polygons - render all (create copy to avoid mutation)
      visiblePolygons = polygons.slice();
    } else {
      // Large number of polygons - apply frustum culling
      const visibilityData = this.performFrustumCulling(polygons, viewport, context);
      visiblePolygons = visibilityData.visible;
      culledCount = visibilityData.culled;
    }

    // Ensure selected polygon is always visible
    if (context.selectedPolygonId && context.forceRenderSelected) {
      this.ensureSelectedVisible(visiblePolygons, polygons, context.selectedPolygonId);
    }

    // Sort polygons for optimal rendering order
    visiblePolygons = this.sortForRendering(visiblePolygons, context.selectedPolygonId);

    const result: VisibilityResult = {
      visiblePolygons,
      totalPolygons: polygons.length,
      visibleCount: visiblePolygons.length,
      culledCount,
      renderingLevel
    };

    // Update performance tracking
    const frameTime = performance.now() - startTime;
    this.thresholds.updatePerformance(frameTime);
    
    // Cache result for potential reuse
    this.lastViewport = viewport;
    this.lastVisibilityResult = result;
    this.frameCount++;

    return result;
  }

  /**
   * Calculate viewport bounds in image space
   */
  private calculateViewport(context: VisibilityContext): ViewportBounds {
    const { zoom, offset, containerWidth, containerHeight } = context;
    
    return {
      x: -offset.x,
      y: -offset.y,
      width: containerWidth / zoom,
      height: containerHeight / zoom
    };
  }

  /**
   * Determine rendering level based on polygon count and zoom
   */
  private determineRenderingLevel(
    polygonCount: number, 
    zoom: number
  ): 'minimal' | 'reduced' | 'normal' | 'full' {
    const shouldReduce = this.thresholds.shouldUseReducedRendering();
    
    if (polygonCount > 1000 || shouldReduce) {
      if (zoom < 0.25) return 'minimal';
      if (zoom < 0.5) return 'reduced';
      return 'normal';
    } else if (polygonCount > 500) {
      if (zoom < 0.5) return 'reduced';
      return 'normal';
    } else {
      return 'full';
    }
  }

  /**
   * Perform frustum culling with bounding box cache
   */
  private performFrustumCulling(
    polygons: Polygon[],
    viewport: ViewportBounds,
    context: VisibilityContext
  ): { visible: Polygon[]; culled: number } {
    const buffer = this.thresholds.getViewportBuffer(context.zoom);
    const expandedViewport = {
      x: viewport.x - buffer,
      y: viewport.y - buffer,
      width: viewport.width + 2 * buffer,
      height: viewport.height + 2 * buffer
    };

    // Get all bounding boxes in one batch for efficiency
    const boundingBoxes = boundingBoxCache.getBulkBoundingBoxes(
      polygons.map(p => ({ id: p.id, points: p.points }))
    );

    const visible: Polygon[] = [];
    let culled = 0;

    for (const polygon of polygons) {
      const bbox = boundingBoxes.get(polygon.id);
      if (!bbox) continue;

      if (this.isBoxInViewport(bbox, expandedViewport)) {
        visible.push(polygon);
      } else {
        culled++;
      }
    }

    return { visible, culled };
  }

  /**
   * Fast bounding box vs viewport intersection test
   */
  private isBoxInViewport(bbox: BoundingBox, viewport: ViewportBounds): boolean {
    return !(
      bbox.maxX < viewport.x ||
      bbox.minX > viewport.x + viewport.width ||
      bbox.maxY < viewport.y ||
      bbox.minY > viewport.y + viewport.height
    );
  }

  /**
   * Ensure selected polygon is always included in visible set
   */
  private ensureSelectedVisible(
    visiblePolygons: Polygon[],
    allPolygons: Polygon[],
    selectedId: string
  ): void {
    const isAlreadyVisible = visiblePolygons.some(p => p.id === selectedId);
    if (!isAlreadyVisible) {
      const selectedPolygon = allPolygons.find(p => p.id === selectedId);
      if (selectedPolygon) {
        visiblePolygons.push(selectedPolygon);
      }
    }
  }

  /**
   * Sort polygons for optimal rendering order
   */
  private sortForRendering(polygons: Polygon[], selectedId?: string | null): Polygon[] {
    // Create copy before sorting to avoid mutating input
    return Array.from(polygons).sort((a, b) => {
      // Selected polygon always on top
      if (a.id === selectedId) return 1;
      if (b.id === selectedId) return -1;
      
      // Internal polygons on top of external
      if (a.type === 'internal' && b.type !== 'internal') return 1;
      if (a.type !== 'internal' && b.type === 'internal') return -1;
      
      // Sort by polygon complexity (more complex = lower priority)
      return a.points.length - b.points.length;
    });
  }

  /**
   * Check if we can reuse cached visibility result
   */
  private canUseCachedResult(viewport: ViewportBounds, polygonCount: number): boolean {
    if (!this.lastViewport || !this.lastVisibilityResult) return false;
    
    // Don't cache for very dynamic scenes
    if (polygonCount > 500) return false;
    
    const threshold = Math.min(viewport.width, viewport.height) * 0.05; // 5% viewport size
    
    return (
      Math.abs(this.lastViewport.x - viewport.x) < threshold &&
      Math.abs(this.lastViewport.y - viewport.y) < threshold &&
      Math.abs(this.lastViewport.width - viewport.width) < threshold * 0.1 &&
      Math.abs(this.lastViewport.height - viewport.height) < threshold * 0.1
    );
  }

  /**
   * Get performance statistics
   */
  getStats() {
    return {
      frameCount: this.frameCount,
      averageFrameTime: this.thresholds.getAverageFrameTime(),
      cullingThreshold: this.thresholds.getCullingThreshold(),
      isUsingReducedRendering: this.thresholds.shouldUseReducedRendering(),
      cacheStats: boundingBoxCache.getStats()
    };
  }

  /**
   * Reset internal state (useful for testing or major scene changes)
   */
  reset(): void {
    this.lastViewport = null;
    this.lastVisibilityResult = null;
    this.frameCount = 0;
  }

  /**
   * Predict which polygons will be visible after a planned viewport change
   * Useful for preloading and smooth animations
   */
  predictVisiblePolygons(
    polygons: Polygon[],
    currentContext: VisibilityContext,
    futureOffset: { x: number; y: number },
    futureZoom?: number
  ): Polygon[] {
    const futureContext: VisibilityContext = {
      ...currentContext,
      offset: futureOffset,
      zoom: futureZoom ?? currentContext.zoom
    };

    const result = this.getVisiblePolygons(polygons, futureContext);
    return result.visiblePolygons;
  }
}

// Global singleton instance
export const polygonVisibilityManager = new PolygonVisibilityManager();