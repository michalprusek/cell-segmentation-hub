/**
 * Advanced render batching system for optimal polygon rendering performance
 * Implements intelligent batching strategies inspired by SpheroSeg
 */

import { Polygon, Point } from '@/lib/segmentation';
import { BoundingBox } from '@/lib/polygonGeometry';
import { rafSchedule, rafThrottle } from '@/lib/performanceUtils';

export interface RenderBatch {
  id: string;
  polygons: Polygon[];
  boundingBox: BoundingBox;
  complexity: number;
  priority: number;
  renderHints: RenderHints;
}

export interface RenderHints {
  useSimplification: boolean;
  simplificationTolerance: number;
  renderVertices: boolean;
  renderLevel: 'minimal' | 'reduced' | 'normal' | 'detailed';
  batchSize: number;
}

export interface BatchingStrategy {
  maxBatchSize: number;
  complexityThreshold: number;
  spatialGrouping: boolean;
  priorityLevels: number;
}

export interface RenderContext {
  zoom: number;
  viewport: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  selectedPolygonId?: string | null;
  isAnimating: boolean;
  targetFPS: number;
}

/**
 * Intelligent batching strategies for different scenarios
 */
class BatchingStrategies {
  static getStrategy(
    polygonCount: number,
    zoom: number,
    isAnimating: boolean
  ): BatchingStrategy {
    if (isAnimating) {
      // Animation mode - prioritize frame rate
      return {
        maxBatchSize: 25,
        complexityThreshold: 50,
        spatialGrouping: false,
        priorityLevels: 2
      };
    } else if (polygonCount > 1000) {
      // High polygon count - aggressive batching
      return {
        maxBatchSize: 100,
        complexityThreshold: 200,
        spatialGrouping: true,
        priorityLevels: 4
      };
    } else if (zoom > 3.0) {
      // High zoom - detailed rendering
      return {
        maxBatchSize: 15,
        complexityThreshold: 30,
        spatialGrouping: false,
        priorityLevels: 3
      };
    } else {
      // Normal mode - balanced approach
      return {
        maxBatchSize: 50,
        complexityThreshold: 100,
        spatialGrouping: true,
        priorityLevels: 3
      };
    }
  }
}

/**
 * Progressive rendering controller for smooth user experience
 */
class ProgressiveRenderController {
  private renderQueue: RenderBatch[] = [];
  private isRendering = false;
  private frameTimeTarget = 16; // 60fps
  private lastFrameTime = 0;

  setTargetFPS(fps: number): void {
    this.frameTimeTarget = 1000 / fps;
  }

  addBatches(batches: RenderBatch[]): void {
    // Sort by priority (higher priority first)
    const sortedBatches = batches.sort((a, b) => b.priority - a.priority);
    this.renderQueue.push(...sortedBatches);
  }

  async renderProgressively(
    renderFunction: (batch: RenderBatch) => Promise<void>
  ): Promise<void> {
    if (this.isRendering) return;
    
    this.isRendering = true;
    
    while (this.renderQueue.length > 0) {
      const frameStart = performance.now();
      
      // Render batches until we approach frame time limit
      while (this.renderQueue.length > 0) {
        const batch = this.renderQueue.shift()!;
        await renderFunction(batch);
        
        const elapsed = performance.now() - frameStart;
        if (elapsed > this.frameTimeTarget * 0.8) { // 80% of frame time
          break;
        }
      }
      
      // Yield to browser for next frame
      await new Promise(resolve => requestAnimationFrame(() => resolve(void 0)));
    }
    
    this.isRendering = false;
  }

  clear(): void {
    this.renderQueue = [];
  }

  get queueLength(): number {
    return this.renderQueue.length;
  }
}

/**
 * High-performance render batch manager
 */
export class RenderBatchManager {
  private batchCache = new Map<string, RenderBatch[]>();
  private progressiveController = new ProgressiveRenderController();
  private lastRenderContext: RenderContext | null = null;
  private frameCount = 0;
  private performanceMetrics = {
    averageBatchTime: 0,
    totalBatches: 0,
    cacheHits: 0,
    cacheMisses: 0
  };

  /**
   * Create optimized render batches from visible polygons
   */
  createBatches(
    polygons: Polygon[],
    context: RenderContext
  ): RenderBatch[] {
    const startTime = performance.now();
    
    // Check cache first
    const cacheKey = this.generateCacheKey(polygons, context);
    const cached = this.batchCache.get(cacheKey);
    
    if (cached && this.canUseCachedBatches(context)) {
      this.performanceMetrics.cacheHits++;
      return cached;
    }

    this.performanceMetrics.cacheMisses++;
    
    // Create new batches
    const strategy = BatchingStrategies.getStrategy(
      polygons.length,
      context.zoom,
      context.isAnimating
    );
    
    const batches = this.generateBatches(polygons, context, strategy);
    
    // Cache the result
    this.batchCache.set(cacheKey, batches);
    this.cleanupCache();
    
    // Update metrics
    const batchTime = performance.now() - startTime;
    this.updatePerformanceMetrics(batchTime, batches.length);
    
    this.lastRenderContext = context;
    this.frameCount++;
    
    return batches;
  }

  /**
   * Generate optimized batches using spatial grouping and complexity analysis
   */
  private generateBatches(
    polygons: Polygon[],
    context: RenderContext,
    strategy: BatchingStrategy
  ): RenderBatch[] {
    if (polygons.length === 0) return [];

    // Analyze polygon complexities
    const analyzedPolygons = polygons.map(polygon => ({
      polygon,
      complexity: this.calculateComplexity(polygon),
      priority: this.calculatePriority(polygon, context)
    }));

    // Group by priority levels
    const priorityGroups = this.groupByPriority(
      analyzedPolygons,
      strategy.priorityLevels
    );

    const batches: RenderBatch[] = [];

    // Create batches for each priority level
    for (const [priority, group] of priorityGroups.entries()) {
      const priorityBatches = strategy.spatialGrouping
        ? this.createSpatialBatches(group, strategy, priority)
        : this.createSequentialBatches(group, strategy, priority);
      
      batches.push(...priorityBatches);
    }

    return batches;
  }

  /**
   * Create batches using spatial grouping for better cache coherency
   */
  private createSpatialBatches(
    analyzedPolygons: Array<{
      polygon: Polygon;
      complexity: number;
      priority: number;
    }>,
    strategy: BatchingStrategy,
    priority: number
  ): RenderBatch[] {
    // Sort by spatial position (top-left to bottom-right)
    const spatialSorted = analyzedPolygons.sort((a, b) => {
      const aBounds = this.getPolygonBounds(a.polygon);
      const bBounds = this.getPolygonBounds(b.polygon);
      
      // Sort by Y first, then X
      const yDiff = aBounds.minY - bBounds.minY;
      return yDiff !== 0 ? yDiff : aBounds.minX - bBounds.minX;
    });

    return this.createBatchesFromSorted(spatialSorted, strategy, priority);
  }

  /**
   * Create batches sequentially (simpler approach for low polygon counts)
   */
  private createSequentialBatches(
    analyzedPolygons: Array<{
      polygon: Polygon;
      complexity: number;
      priority: number;
    }>,
    strategy: BatchingStrategy,
    priority: number
  ): RenderBatch[] {
    return this.createBatchesFromSorted(analyzedPolygons, strategy, priority);
  }

  /**
   * Create batches from sorted polygon list
   */
  private createBatchesFromSorted(
    sortedPolygons: Array<{
      polygon: Polygon;
      complexity: number;
      priority: number;
    }>,
    strategy: BatchingStrategy,
    priority: number
  ): RenderBatch[] {
    const batches: RenderBatch[] = [];
    let currentBatch: typeof sortedPolygons = [];
    let currentComplexity = 0;

    for (const item of sortedPolygons) {
      const wouldExceedSize = currentBatch.length >= strategy.maxBatchSize;
      const wouldExceedComplexity = 
        currentComplexity + item.complexity > strategy.complexityThreshold;

      if ((wouldExceedSize || wouldExceedComplexity) && currentBatch.length > 0) {
        // Create batch from current items
        batches.push(this.createBatch(currentBatch, priority));
        
        // Start new batch
        currentBatch = [item];
        currentComplexity = item.complexity;
      } else {
        currentBatch.push(item);
        currentComplexity += item.complexity;
      }
    }

    // Add remaining items as final batch
    if (currentBatch.length > 0) {
      batches.push(this.createBatch(currentBatch, priority));
    }

    return batches;
  }

  /**
   * Create a render batch from analyzed polygons
   */
  private createBatch(
    analyzedPolygons: Array<{
      polygon: Polygon;
      complexity: number;
      priority: number;
    }>,
    priority: number
  ): RenderBatch {
    const polygons = analyzedPolygons.map(item => item.polygon);
    const totalComplexity = analyzedPolygons.reduce(
      (sum, item) => sum + item.complexity,
      0
    );

    return {
      id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      polygons,
      boundingBox: this.calculateBatchBoundingBox(polygons),
      complexity: totalComplexity,
      priority,
      renderHints: this.generateRenderHints(polygons, totalComplexity, priority)
    };
  }

  /**
   * Calculate polygon complexity score
   */
  private calculateComplexity(polygon: Polygon): number {
    // Base complexity from point count
    let complexity = polygon.points.length;
    
    // Add complexity for polygon type
    if (polygon.type === 'internal') {
      complexity *= 1.2; // Internal polygons are slightly more complex to render
    }
    
    return complexity;
  }

  /**
   * Calculate rendering priority for polygon
   */
  private calculatePriority(polygon: Polygon, context: RenderContext): number {
    let priority = 0;
    
    // Selected polygon gets highest priority
    if (polygon.id === context.selectedPolygonId) {
      priority += 1000;
    }
    
    // Internal polygons get higher priority
    if (polygon.type === 'internal') {
      priority += 100;
    }
    
    // Polygons in viewport center get higher priority
    const polygonBounds = this.getPolygonBounds(polygon);
    const centerDistance = this.calculateDistanceFromCenter(
      polygonBounds,
      context.viewport
    );
    priority += Math.max(0, 50 - centerDistance);
    
    return priority;
  }

  /**
   * Group polygons by priority levels
   */
  private groupByPriority(
    analyzedPolygons: Array<{
      polygon: Polygon;
      complexity: number;
      priority: number;
    }>,
    priorityLevels: number
  ): Map<number, typeof analyzedPolygons> {
    const groups = new Map<number, typeof analyzedPolygons>();
    
    // Calculate priority thresholds
    const priorities = analyzedPolygons.map(item => item.priority);
    const maxPriority = Math.max(...priorities);
    const minPriority = Math.min(...priorities);
    const priorityRange = maxPriority - minPriority;
    
    for (const item of analyzedPolygons) {
      let level = 0;
      
      if (priorityRange > 0) {
        const normalizedPriority = (item.priority - minPriority) / priorityRange;
        level = Math.min(
          priorityLevels - 1,
          Math.floor(normalizedPriority * priorityLevels)
        );
      }
      
      if (!groups.has(level)) {
        groups.set(level, []);
      }
      groups.get(level)!.push(item);
    }
    
    return groups;
  }

  /**
   * Generate render hints for a batch
   */
  private generateRenderHints(
    polygons: Polygon[],
    totalComplexity: number,
    priority: number
  ): RenderHints {
    const avgComplexity = totalComplexity / polygons.length;
    
    return {
      useSimplification: avgComplexity > 50,
      simplificationTolerance: Math.min(3.0, avgComplexity / 20),
      renderVertices: priority > 500, // Only for high-priority polygons
      renderLevel: this.determineRenderLevel(avgComplexity, priority),
      batchSize: polygons.length
    };
  }

  /**
   * Determine render level based on complexity and priority
   */
  private determineRenderLevel(
    avgComplexity: number,
    priority: number
  ): 'minimal' | 'reduced' | 'normal' | 'detailed' {
    if (priority > 800) return 'detailed';
    if (priority > 400) return 'normal';
    if (avgComplexity > 100) return 'reduced';
    return 'normal';
  }

  /**
   * Calculate bounding box for entire batch
   */
  private calculateBatchBoundingBox(polygons: Polygon[]): BoundingBox {
    if (polygons.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const polygon of polygons) {
      const bounds = this.getPolygonBounds(polygon);
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Get polygon bounding box (cached when possible)
   */
  private getPolygonBounds(polygon: Polygon): BoundingBox {
    // Simple calculation for immediate use
    // In production, this would use the BoundingBoxCache
    const points = polygon.points;
    
    if (!points || points.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }
    
    let minX = points[0].x, minY = points[0].y;
    let maxX = points[0].x, maxY = points[0].y;

    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

    return {
      minX, minY, maxX, maxY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Calculate distance from viewport center
   */
  private calculateDistanceFromCenter(
    bounds: BoundingBox,
    viewport: { x: number; y: number; width: number; height: number }
  ): number {
    const viewportCenterX = viewport.x + viewport.width / 2;
    const viewportCenterY = viewport.y + viewport.height / 2;
    
    const polygonCenterX = bounds.minX + bounds.width / 2;
    const polygonCenterY = bounds.minY + bounds.height / 2;
    
    const dx = polygonCenterX - viewportCenterX;
    const dy = polygonCenterY - viewportCenterY;
    
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Generate cache key for batching result
   */
  private generateCacheKey(polygons: Polygon[], context: RenderContext): string {
    const polygonHash = polygons.length > 0 
      ? polygons.map(p => p.id).sort().join(',').slice(0, 50) // Truncate for performance
      : 'empty';
    
    return [
      polygonHash,
      Math.round(context.zoom * 100),
      Math.round(context.viewport.x / 10) * 10,
      Math.round(context.viewport.y / 10) * 10,
      context.isAnimating ? 'anim' : 'static',
      context.selectedPolygonId || 'none'
    ].join('|');
  }

  /**
   * Check if cached batches can be reused
   */
  private canUseCachedBatches(context: RenderContext): boolean {
    if (!this.lastRenderContext) return false;
    
    const last = this.lastRenderContext;
    const zoomDiff = Math.abs(context.zoom - last.zoom);
    const xDiff = Math.abs(context.viewport.x - last.viewport.x);
    const yDiff = Math.abs(context.viewport.y - last.viewport.y);
    
    return (
      zoomDiff < 0.1 &&
      xDiff < 50 &&
      yDiff < 50 &&
      context.isAnimating === last.isAnimating &&
      context.selectedPolygonId === last.selectedPolygonId
    );
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(batchTime: number, batchCount: number): void {
    this.performanceMetrics.totalBatches += batchCount;
    
    const alpha = 0.1; // Exponential moving average
    this.performanceMetrics.averageBatchTime = 
      this.performanceMetrics.averageBatchTime * (1 - alpha) + batchTime * alpha;
  }

  /**
   * Clean up old cache entries (LRU-style)
   */
  private cleanupCache(): void {
    const maxCacheSize = 50;
    
    // Remove oldest entries one by one until we reach the max size
    while (this.batchCache.size > maxCacheSize) {
      const firstKey = this.batchCache.keys().next().value;
      if (firstKey !== undefined) {
        this.batchCache.delete(firstKey);
      } else {
        break; // Safety break if iterator is exhausted
      }
    }
  }

  /**
   * Get performance statistics
   */
  getStats() {
    return {
      ...this.performanceMetrics,
      cacheSize: this.batchCache.size,
      frameCount: this.frameCount,
      progressiveQueueLength: this.progressiveController.queueLength
    };
  }

  /**
   * Clear all caches and reset state
   */
  reset(): void {
    this.batchCache.clear();
    this.progressiveController.clear();
    this.lastRenderContext = null;
    this.frameCount = 0;
    this.performanceMetrics = {
      averageBatchTime: 0,
      totalBatches: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
  }

  /**
   * Set target FPS for progressive rendering
   */
  setTargetFPS(fps: number): void {
    this.progressiveController.setTargetFPS(fps);
  }

  /**
   * Render batches progressively for smooth performance
   */
  async renderBatchesProgressively(
    batches: RenderBatch[],
    renderFunction: (batch: RenderBatch) => Promise<void>
  ): Promise<void> {
    this.progressiveController.addBatches(batches);
    return this.progressiveController.renderProgressively(renderFunction);
  }
}

// Global singleton instance
export const renderBatchManager = new RenderBatchManager();