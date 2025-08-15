/**
 * Level of Detail (LOD) management system for adaptive polygon rendering
 * Implements progressive detail reduction based on zoom, viewport, and performance
 * Inspired by SpheroSeg LOD strategies
 */

import { Point, Polygon } from '@/lib/segmentation';
import { BoundingBox, calculateBoundingBox } from '@/lib/polygonOptimization';
import { WorkerPool, WorkerOperation } from '@/lib/workerPool';

export interface LODLevel {
  name: string;
  minZoom: number;
  maxZoom: number;
  simplificationTolerance: number;
  maxVertices: number;
  renderVertices: boolean;
  renderStrokes: boolean;
  renderFills: boolean;
  decimationStep: number;
}

export interface LODPolygon {
  originalId: string;
  level: number;
  points: Point[];
  originalPointCount: number;
  simplificationRatio: number;
  boundingBox: BoundingBox;
  renderHints: LODRenderHints;
}

export interface LODRenderHints {
  strokeWidth: number;
  opacity: number;
  fillEnabled: boolean;
  strokeEnabled: boolean;
  verticesEnabled: boolean;
  shadowEnabled: boolean;
  antiAliasing: boolean;
}

export interface LODContext {
  zoom: number;
  viewport: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  targetFPS: number;
  currentFPS: number;
  polygonCount: number;
  isAnimating: boolean;
  renderQuality: 'low' | 'medium' | 'high' | 'ultra';
}

/**
 * Predefined LOD levels for different zoom ranges and performance requirements
 */
const DEFAULT_LOD_LEVELS: LODLevel[] = [
  {
    name: 'minimal',
    minZoom: 0.0,
    maxZoom: 0.25,
    simplificationTolerance: 10.0,
    maxVertices: 8,
    renderVertices: false,
    renderStrokes: true,
    renderFills: true,
    decimationStep: 10
  },
  {
    name: 'low',
    minZoom: 0.25,
    maxZoom: 0.5,
    simplificationTolerance: 5.0,
    maxVertices: 20,
    renderVertices: false,
    renderStrokes: true,
    renderFills: true,
    decimationStep: 5
  },
  {
    name: 'medium',
    minZoom: 0.5,
    maxZoom: 1.0,
    simplificationTolerance: 2.0,
    maxVertices: 50,
    renderVertices: false,
    renderStrokes: true,
    renderFills: true,
    decimationStep: 3
  },
  {
    name: 'high',
    minZoom: 1.0,
    maxZoom: 2.0,
    simplificationTolerance: 1.0,
    maxVertices: 100,
    renderVertices: true,
    renderStrokes: true,
    renderFills: true,
    decimationStep: 2
  },
  {
    name: 'ultra',
    minZoom: 2.0,
    maxZoom: Infinity,
    simplificationTolerance: 0.5,
    maxVertices: Infinity,
    renderVertices: true,
    renderStrokes: true,
    renderFills: true,
    decimationStep: 1
  }
];

/**
 * Worker operation for polygon simplification
 */
class SimplifyOperation extends WorkerOperation<
  { points: Point[]; tolerance: number },
  Point[]
> {
  readonly type = 'simplify';
  
  async execute(input: { points: Point[]; tolerance: number }): Promise<Point[]> {
    // This method is implemented by the worker pool infrastructure
    // Worker implementations will handle the actual simplification logic
    return input.points; // Fallback to original points if worker execution fails
  }
}

/**
 * Adaptive LOD controller that adjusts quality based on performance
 */
class AdaptiveLODController {
  private frameTimeHistory: number[] = [];
  private currentQualityLevel: 'low' | 'medium' | 'high' | 'ultra' = 'high';
  private lastAdjustmentTime = 0;
  private adjustmentCooldown = 1000; // 1 second
  
  updateFrameTime(frameTime: number): void {
    this.frameTimeHistory.push(frameTime);
    
    // Keep only last 30 frames for rolling average
    if (this.frameTimeHistory.length > 30) {
      this.frameTimeHistory.shift();
    }
    
    // Adjust quality based on performance every few seconds
    const now = Date.now();
    if (now - this.lastAdjustmentTime > this.adjustmentCooldown) {
      this.adjustQualityLevel();
      this.lastAdjustmentTime = now;
    }
  }
  
  private adjustQualityLevel(): void {
    if (this.frameTimeHistory.length < 10) return;
    
    const avgFrameTime = this.frameTimeHistory.reduce((sum, time) => sum + time, 0) / this.frameTimeHistory.length;
    const targetFrameTime = 16.67; // 60 FPS
    
    if (avgFrameTime > targetFrameTime * 2) { // < 30 FPS
      if (this.currentQualityLevel !== 'low') {
        this.currentQualityLevel = 'low';
        console.log('LOD: Reduced quality to low due to poor performance');
      }
    } else if (avgFrameTime > targetFrameTime * 1.5) { // < 40 FPS
      if (this.currentQualityLevel === 'ultra' || this.currentQualityLevel === 'high') {
        this.currentQualityLevel = 'medium';
        console.log('LOD: Reduced quality to medium due to performance');
      }
    } else if (avgFrameTime < targetFrameTime * 0.8) { // > 75 FPS
      if (this.currentQualityLevel === 'low') {
        this.currentQualityLevel = 'medium';
        console.log('LOD: Increased quality to medium due to good performance');
      } else if (this.currentQualityLevel === 'medium') {
        this.currentQualityLevel = 'high';
        console.log('LOD: Increased quality to high due to good performance');
      }
    }
  }
  
  getCurrentQuality(): 'low' | 'medium' | 'high' | 'ultra' {
    return this.currentQualityLevel;
  }
  
  setQuality(quality: 'low' | 'medium' | 'high' | 'ultra'): void {
    this.currentQualityLevel = quality;
  }
}

/**
 * Level of Detail manager for polygon rendering optimization
 */
export class LODManager {
  private lodLevels: LODLevel[];
  private workerPool: WorkerPool | null = null;
  private simplifyOperation = new SimplifyOperation();
  private lodCache = new Map<string, LODPolygon[]>();
  private adaptiveController = new AdaptiveLODController();
  private stats = {
    totalSimplifications: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageSimplificationTime: 0
  };

  constructor(
    customLODLevels?: LODLevel[],
    workerPool?: WorkerPool
  ) {
    this.lodLevels = customLODLevels || DEFAULT_LOD_LEVELS;
    this.workerPool = workerPool || null;
    
    // Sort LOD levels by zoom range
    this.lodLevels.sort((a, b) => a.minZoom - b.minZoom);
  }

  /**
   * Generate LOD polygons for all appropriate levels
   */
  async generateLODPolygons(
    polygons: Polygon[],
    context: LODContext
  ): Promise<LODPolygon[]> {
    const startTime = performance.now();
    const currentLevel = this.determineLODLevel(context);
    const lodPolygons: LODPolygon[] = [];
    
    // Update adaptive quality based on performance
    this.adaptiveController.updateFrameTime(1000 / (context.currentFPS || 60));
    context.renderQuality = this.adaptiveController.getCurrentQuality();
    
    for (const polygon of polygons) {
      const cacheKey = this.generateCacheKey(polygon, currentLevel);
      const cached = this.lodCache.get(cacheKey);
      
      if (cached && cached.length > 0) {
        lodPolygons.push(...cached);
        this.stats.cacheHits++;
        continue;
      }
      
      this.stats.cacheMisses++;
      
      const lodPolygon = await this.createLODPolygon(
        polygon,
        currentLevel,
        context
      );
      
      if (lodPolygon) {
        lodPolygons.push(lodPolygon);
        
        // Cache the result
        this.lodCache.set(cacheKey, [lodPolygon]);
        this.cleanupCache();
      }
    }
    
    const processingTime = performance.now() - startTime;
    this.updatePerformanceStats(processingTime);
    
    return lodPolygons;
  }

  /**
   * Create LOD polygon for specific level
   */
  private async createLODPolygon(
    polygon: Polygon,
    level: LODLevel,
    context: LODContext
  ): Promise<LODPolygon | null> {
    let processedPoints = [...polygon.points];
    
    // Apply simplification if needed
    if (level.simplificationTolerance > 0 && processedPoints.length > level.maxVertices) {
      if (this.workerPool) {
        try {
          processedPoints = await this.workerPool.execute(
            this.simplifyOperation,
            {
              points: processedPoints,
              tolerance: level.simplificationTolerance
            }
          );
          this.stats.totalSimplifications++;
        } catch (error) {
          console.warn('LOD: Worker simplification failed, using original points:', error);
        }
      } else {
        // Fallback to simple decimation if no worker available
        processedPoints = this.decimatePoints(processedPoints, level.decimationStep);
      }
    }
    
    // Apply vertex limit
    if (processedPoints.length > level.maxVertices) {
      processedPoints = this.decimatePoints(processedPoints, 
        Math.ceil(processedPoints.length / level.maxVertices));
    }
    
    const boundingBox = calculateBoundingBox(processedPoints);
    const renderHints = this.generateRenderHints(level, context, polygon);
    
    return {
      originalId: polygon.id,
      level: this.lodLevels.indexOf(level),
      points: processedPoints,
      originalPointCount: polygon.points.length,
      simplificationRatio: processedPoints.length / polygon.points.length,
      boundingBox,
      renderHints
    };
  }

  /**
   * Determine appropriate LOD level based on context
   */
  private determineLODLevel(context: LODContext): LODLevel {
    let baseLevel = this.lodLevels.find(level => 
      context.zoom >= level.minZoom && context.zoom < level.maxZoom
    ) || this.lodLevels[this.lodLevels.length - 1];
    
    // Adjust based on adaptive quality
    const qualityAdjustment = this.getQualityAdjustment(context.renderQuality);
    const adjustedLevelIndex = Math.max(0, 
      Math.min(this.lodLevels.length - 1, 
        this.lodLevels.indexOf(baseLevel) + qualityAdjustment
      )
    );
    
    // Further adjust based on polygon count and animation state
    if (context.isAnimating || context.polygonCount > 1000) {
      const performanceAdjustment = context.isAnimating ? -1 : 0;
      const finalIndex = Math.max(0, adjustedLevelIndex + performanceAdjustment);
      return this.lodLevels[finalIndex];
    }
    
    return this.lodLevels[adjustedLevelIndex];
  }

  /**
   * Get quality adjustment offset
   */
  private getQualityAdjustment(quality: 'low' | 'medium' | 'high' | 'ultra'): number {
    switch (quality) {
      case 'low': return -2;
      case 'medium': return -1;
      case 'high': return 0;
      case 'ultra': return 1;
      default: return 0;
    }
  }

  /**
   * Generate render hints based on LOD level and context
   */
  private generateRenderHints(
    level: LODLevel,
    context: LODContext,
    polygon: Polygon
  ): LODRenderHints {
    const isSelected = false; // This would be passed from context in real implementation
    const baseOpacity = isSelected ? 1.0 : 0.8;
    
    // Adjust opacity based on zoom
    const zoomOpacity = Math.min(1.0, context.zoom * 0.5 + 0.5);
    
    return {
      strokeWidth: Math.max(0.5, level.minZoom * 2),
      opacity: baseOpacity * zoomOpacity,
      fillEnabled: level.renderFills,
      strokeEnabled: level.renderStrokes,
      verticesEnabled: level.renderVertices && context.zoom > 1.0,
      shadowEnabled: context.zoom > 1.5 && context.renderQuality !== 'low',
      antiAliasing: context.renderQuality === 'high' || context.renderQuality === 'ultra'
    };
  }

  /**
   * Simple point decimation for fallback
   */
  private decimatePoints(points: Point[], step: number): Point[] {
    if (step <= 1 || points.length <= 3) return points;
    
    const decimated: Point[] = [];
    
    // Always include first point
    decimated.push(points[0]);
    
    // Include every nth point
    for (let i = step; i < points.length; i += step) {
      decimated.push(points[i]);
    }
    
    // Always include last point if it's not already included
    const lastIndex = points.length - 1;
    if (lastIndex > 0 && (lastIndex % step !== 0)) {
      decimated.push(points[lastIndex]);
    }
    
    return decimated;
  }

  // Note: calculateBoundingBox is now imported from polygonOptimization.ts

  /**
   * Generate cache key for LOD polygon
   */
  private generateCacheKey(polygon: Polygon, level: LODLevel): string {
    // Create a hash of the polygon points for change detection
    const pointsHash = polygon.points
      .map(p => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`)
      .join('|');
    
    return `${polygon.id}_${level.name}_${pointsHash.slice(0, 50)}`;
  }

  /**
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    const maxCacheSize = 500;
    if (this.lodCache.size > maxCacheSize) {
      const entries = Array.from(this.lodCache.entries());
      const toDelete = entries.slice(0, entries.length - maxCacheSize);
      
      for (const [key] of toDelete) {
        this.lodCache.delete(key);
      }
    }
  }

  /**
   * Update performance statistics
   */
  private updatePerformanceStats(processingTime: number): void {
    const alpha = 0.1; // Exponential moving average
    this.stats.averageSimplificationTime = 
      this.stats.averageSimplificationTime * (1 - alpha) + processingTime * alpha;
  }

  /**
   * Get all available LOD levels
   */
  getLODLevels(): LODLevel[] {
    return [...this.lodLevels];
  }

  /**
   * Add custom LOD level
   */
  addLODLevel(level: LODLevel): void {
    this.lodLevels.push(level);
    this.lodLevels.sort((a, b) => a.minZoom - b.minZoom);
  }

  /**
   * Set adaptive quality manually
   */
  setAdaptiveQuality(quality: 'low' | 'medium' | 'high' | 'ultra'): void {
    this.adaptiveController.setQuality(quality);
  }

  /**
   * Get current adaptive quality level
   */
  getCurrentQuality(): 'low' | 'medium' | 'high' | 'ultra' {
    return this.adaptiveController.getCurrentQuality();
  }

  /**
   * Get performance and cache statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.lodCache.size,
      currentQuality: this.adaptiveController.getCurrentQuality(),
      availableLevels: this.lodLevels.map(l => l.name)
    };
  }

  /**
   * Clear all caches and reset statistics
   */
  reset(): void {
    this.lodCache.clear();
    this.stats = {
      totalSimplifications: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageSimplificationTime: 0
    };
  }

  /**
   * Preload LOD polygons for predicted viewport changes
   * Includes memory limits to prevent unbounded growth
   */
  async preloadLOD(
    polygons: Polygon[],
    futureContext: LODContext,
    maxMemoryMB: number = 50
  ): Promise<void> {
    const startCacheSize = this.lodCache.size;
    const maxCacheEntries = Math.max(100, Math.floor(maxMemoryMB * 1024 * 1024 / 2000)); // ~2KB per entry estimate
    
    // Prevent preloading if we're already at memory limit
    if (this.lodCache.size >= maxCacheEntries) {
      console.warn('LOD: Skipping preload due to memory limit');
      return;
    }
    
    // Limit the number of polygons to preload based on available memory
    const availableSlots = maxCacheEntries - this.lodCache.size;
    const polygonsToPreload = polygons.slice(0, Math.min(polygons.length, availableSlots));
    
    // Generate LOD polygons in background for smooth transitions
    const lodPolygons = await this.generateLODPolygons(polygonsToPreload, futureContext);
    
    // Cache results for faster access later
    for (const lodPolygon of lodPolygons) {
      const originalPolygon = polygonsToPreload.find(p => p.id === lodPolygon.originalId);
      if (originalPolygon) {
        const level = this.lodLevels[lodPolygon.level];
        const cacheKey = this.generateCacheKey(originalPolygon, level);
        this.lodCache.set(cacheKey, [lodPolygon]);
      }
      
      // Safety check to prevent unbounded growth during preload
      if (this.lodCache.size >= maxCacheEntries) {
        console.warn('LOD: Stopping preload due to memory limit reached');
        break;
      }
    }
    
    const entriesAdded = this.lodCache.size - startCacheSize;
    if (entriesAdded > 0) {
      console.log(`LOD: Preloaded ${entriesAdded} cache entries`);
    }
  }
}

// Global singleton instance
export const lodManager = new LODManager();