import { logger } from '@/lib/logger';
/**
 * React hook for optimized polygon rendering
 * Provides a unified interface for all rendering optimizations
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Polygon } from '@/lib/segmentation';

// Import optimization systems
import {
  polygonVisibilityManager,
  VisibilityResult,
} from '@/lib/rendering/PolygonVisibilityManager';
import {
  renderBatchManager,
  RenderBatch,
} from '@/lib/rendering/RenderBatchManager';
import { lodManager, LODPolygon } from '@/lib/rendering/LODManager';
import { boundingBoxCache } from '@/lib/rendering/BoundingBoxCache';
import {
  getPolygonProcessingService,
  PolygonProcessingService,
} from '@/lib/rendering/WorkerOperations';

export interface OptimizedRenderingOptions {
  enableFrustumCulling?: boolean;
  enableLOD?: boolean;
  enableWorkers?: boolean;
  enableBatching?: boolean;
  targetFPS?: number;
  renderQuality?: 'low' | 'medium' | 'high' | 'ultra';
  maxBatchSize?: number;
  lodThreshold?: number;
}

export interface RenderingContext {
  zoom: number;
  offset: { x: number; y: number };
  containerWidth: number;
  containerHeight: number;
  selectedPolygonId?: string | null;
  isAnimating?: boolean;
}

export interface OptimizedRenderingResult {
  visiblePolygons: Polygon[];
  renderBatches: RenderBatch[];
  lodPolygons: LODPolygon[];
  visibilityResult: VisibilityResult;
  stats: RenderingStats;
  isLoading: boolean;
  error: string | null;
}

export interface RenderingStats {
  totalPolygons: number;
  visiblePolygons: number;
  culledPolygons: number;
  renderBatches: number;
  averageFrameTime: number;
  cacheHitRate: number;
  workerUtilization: number;
  memoryUsage: number;
}

/**
 * Performance monitoring class
 */
class PerformanceMonitor {
  private frameHistory: number[] = [];
  private lastFrameTime = performance.now();

  updateFrame(): number {
    const now = performance.now();
    const frameTime = now - this.lastFrameTime;
    this.lastFrameTime = now;

    this.frameHistory.push(frameTime);
    if (this.frameHistory.length > 30) {
      this.frameHistory.shift();
    }

    return frameTime;
  }

  getAverageFrameTime(): number {
    if (this.frameHistory.length === 0) return 16.67; // 60fps default
    return (
      this.frameHistory.reduce((sum, time) => sum + time, 0) /
      this.frameHistory.length
    );
  }

  getCurrentFPS(): number {
    const avgFrameTime = this.getAverageFrameTime();
    return Math.round(1000 / avgFrameTime);
  }

  reset(): void {
    this.frameHistory = [];
    this.lastFrameTime = performance.now();
  }
}

/**
 * Main optimized polygon rendering hook
 */
export function useOptimizedPolygonRendering(
  polygons: Polygon[],
  context: RenderingContext,
  options: OptimizedRenderingOptions = {}
): OptimizedRenderingResult {
  // Default options
  const opts = useMemo(
    () => ({
      enableFrustumCulling: true,
      enableLOD: true,
      enableWorkers: true,
      enableBatching: true,
      targetFPS: 60,
      renderQuality: 'high' as const,
      maxBatchSize: 50,
      lodThreshold: 100,
      ...options,
    }),
    [options]
  );

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibilityResult, setVisibilityResult] = useState<VisibilityResult>({
    visiblePolygons: [],
    totalPolygons: 0,
    visibleCount: 0,
    culledCount: 0,
    renderingLevel: 'normal',
  });
  const [renderBatches, setRenderBatches] = useState<RenderBatch[]>([]);
  const [lodPolygons, setLodPolygons] = useState<LODPolygon[]>([]);

  // Services and monitoring
  const polygonServiceRef = useRef<PolygonProcessingService | null>(null);
  const performanceMonitor = useRef(new PerformanceMonitor());
  const isInitialized = useRef(false);

  // Initialize services
  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;
    // Capture ref value at effect start for cleanup
    const currentMonitor = performanceMonitor.current;

    const initializeServices = async () => {
      if (isInitialized.current) return;

      try {
        setIsLoading(true);
        setError(null);

        if (opts.enableWorkers && !abortController.signal.aborted) {
          polygonServiceRef.current = getPolygonProcessingService();
          await polygonServiceRef.current.warmUp();

          // Check if component is still mounted after async operation
          if (!isMounted) return;
        }

        // Initialize managers with custom settings
        renderBatchManager.setTargetFPS(opts.targetFPS);

        isInitialized.current = true;
      } catch (err) {
        if (!abortController.signal.aborted) {
          logger.error('Failed to initialize polygon rendering services:', err);
          setError(
            err instanceof Error ? err.message : 'Initialization failed'
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initializeServices();

    return () => {
      isMounted = false;
      abortController.abort();
      isInitialized.current = false;

      // Cancel any pending operations and cleanup
      if (polygonServiceRef.current) {
        polygonServiceRef.current.cancelPendingOperations?.();
        polygonServiceRef.current.terminate();
        polygonServiceRef.current = null;
      }

      // Clear performance monitor using captured value
      if (currentMonitor) {
        currentMonitor.reset?.();
      }
    };
  }, [opts.enableWorkers, opts.targetFPS]);

  // Create visibility context
  const visibilityContext = useMemo(
    () => ({
      zoom: context.zoom,
      offset: context.offset,
      containerWidth: context.containerWidth,
      containerHeight: context.containerHeight,
      selectedPolygonId: context.selectedPolygonId,
      forceRenderSelected: true,
    }),
    [context]
  );

  // Create render context
  const renderContext = useMemo(
    () => ({
      zoom: context.zoom,
      viewport: {
        x: -context.offset.x,
        y: -context.offset.y,
        width: context.containerWidth / context.zoom,
        height: context.containerHeight / context.zoom,
      },
      selectedPolygonId: context.selectedPolygonId,
      isAnimating: context.isAnimating || false,
      targetFPS: opts.targetFPS,
    }),
    [context, opts.targetFPS]
  );

  // Create LOD context
  const lodContext = useMemo(
    () => ({
      zoom: context.zoom,
      viewport: renderContext.viewport,
      targetFPS: opts.targetFPS,
      currentFPS: performanceMonitor.current.getCurrentFPS(),
      polygonCount: polygons.length,
      isAnimating: context.isAnimating || false,
      renderQuality: opts.renderQuality,
    }),
    [
      context,
      renderContext.viewport,
      opts.targetFPS,
      opts.renderQuality,
      polygons.length,
    ]
  );

  // Main processing pipeline
  const processPolygons = useCallback(async () => {
    if (!isInitialized.current || polygons.length === 0) {
      setVisibilityResult({
        visiblePolygons: [],
        totalPolygons: 0,
        visibleCount: 0,
        culledCount: 0,
        renderingLevel: 'normal',
      });
      setRenderBatches([]);
      setLodPolygons([]);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      performanceMonitor.current.updateFrame();

      // Step 1: Frustum culling
      let currentVisibilityResult = visibilityResult;
      if (opts.enableFrustumCulling) {
        currentVisibilityResult = polygonVisibilityManager.getVisiblePolygons(
          polygons,
          visibilityContext
        );
        setVisibilityResult(currentVisibilityResult);
      } else {
        currentVisibilityResult = {
          visiblePolygons: polygons,
          totalPolygons: polygons.length,
          visibleCount: polygons.length,
          culledCount: 0,
          renderingLevel: 'normal',
        };
        setVisibilityResult(currentVisibilityResult);
      }

      // Step 2: Generate render batches
      let currentBatches: RenderBatch[] = [];
      if (
        opts.enableBatching &&
        currentVisibilityResult.visiblePolygons.length > 0
      ) {
        currentBatches = renderBatchManager.createBatches(
          currentVisibilityResult.visiblePolygons,
          renderContext
        );
        setRenderBatches(currentBatches);
      }

      // Step 3: Generate LOD polygons
      if (
        opts.enableLOD &&
        currentVisibilityResult.visiblePolygons.length > opts.lodThreshold
      ) {
        try {
          const lodResult = await lodManager.generateLODPolygons(
            currentVisibilityResult.visiblePolygons,
            lodContext
          );
          setLodPolygons(lodResult);
        } catch (lodError) {
          logger.warn('LOD generation failed:', lodError);
          setLodPolygons([]);
        }
      } else {
        setLodPolygons([]);
      }
    } catch (err) {
      logger.error('Error processing polygons:', err);
      setError(err instanceof Error ? err.message : 'Processing failed');
    } finally {
      setIsLoading(false);
    }
  }, [
    polygons,
    visibilityContext,
    renderContext,
    lodContext,
    opts.enableFrustumCulling,
    opts.enableBatching,
    opts.enableLOD,
    opts.lodThreshold,
    // visibilityResult removed - it's updated inside the function, causing render loops
  ]);

  // Process polygons when context changes
  useEffect(() => {
    processPolygons();
  }, [processPolygons]);

  // Generate stats
  const stats = useMemo((): RenderingStats => {
    const boundingBoxStats = boundingBoxCache.getStats();
    const visibilityStats = polygonVisibilityManager.getStats();
    const batchStats = renderBatchManager.getStats();
    const lodStats = lodManager.getStats();
    const workerStats = polygonServiceRef.current?.getStats();

    return {
      totalPolygons: polygons.length,
      visiblePolygons: visibilityResult.visibleCount,
      culledPolygons: visibilityResult.culledCount,
      renderBatches: renderBatches.length,
      averageFrameTime: performanceMonitor.current.getAverageFrameTime(),
      cacheHitRate: boundingBoxStats.hitRate,
      workerUtilization: workerStats
        ? (workerStats.busyWorkers / workerStats.totalWorkers) * 100
        : 0,
      memoryUsage: boundingBoxStats.memoryUsage + lodStats.cacheSize * 500, // Rough estimate
    };
  }, [polygons.length, visibilityResult, renderBatches.length]);

  // Cleanup on unmount
  useEffect(() => {
    // Capture ref value at effect start for cleanup
    const currentMonitor = performanceMonitor.current;

    return () => {
      if (currentMonitor) {
        currentMonitor.reset();
      }
    };
  }, []);

  return {
    visiblePolygons: visibilityResult.visiblePolygons,
    renderBatches,
    lodPolygons,
    visibilityResult,
    stats,
    isLoading,
    error,
  };
}

/**
 * Utility hook for polygon processing operations
 */
export function usePolygonProcessing() {
  const serviceRef = useRef<PolygonProcessingService | null>(null);
  const servicePromiseRef = useRef<Promise<PolygonProcessingService> | null>(
    null
  );
  const [isReady, setIsReady] = useState(false);
  const isInitializing = useRef(false);

  useEffect(() => {
    const initializeService = async () => {
      if (isInitializing.current) return;
      isInitializing.current = true;

      try {
        if (!servicePromiseRef.current) {
          servicePromiseRef.current = Promise.resolve(
            getPolygonProcessingService()
          );
        }

        const service = await servicePromiseRef.current;
        serviceRef.current = service;
        setIsReady(true);
      } catch (error) {
        logger.error('Failed to initialize polygon processing service:', error);
        setIsReady(false);
      } finally {
        isInitializing.current = false;
      }
    };

    initializeService();

    return () => {
      // Cleanup: reset promise but don't terminate global service
      servicePromiseRef.current = null;
      setIsReady(false);
    };
  }, []);

  const getService =
    useCallback(async (): Promise<PolygonProcessingService> => {
      if (serviceRef.current) return serviceRef.current;

      if (!servicePromiseRef.current) {
        throw new Error('PolygonProcessingService not initialized');
      }

      const service = await servicePromiseRef.current;
      serviceRef.current = service;
      return service;
    }, []);

  const simplifyPolygon = useCallback(
    async (points: import('@/lib/segmentation').Point[], tolerance: number) => {
      const service = await getService();
      return service.simplifyPolygon(points, tolerance);
    },
    [getService]
  );

  const calculateArea = useCallback(
    async (points: import('@/lib/segmentation').Point[]) => {
      const service = await getService();
      return service.calculateArea(points);
    },
    [getService]
  );

  const slicePolygon = useCallback(
    async (
      polygon: import('@/lib/segmentation').Point[],
      lineStart: import('@/lib/segmentation').Point,
      lineEnd: import('@/lib/segmentation').Point
    ) => {
      const service = await getService();
      return service.slicePolygon(polygon, lineStart, lineEnd);
    },
    [getService]
  );

  return {
    simplifyPolygon,
    calculateArea,
    slicePolygon,
    service: serviceRef.current,
    isReady,
  };
}

/**
 * Hook for performance monitoring
 */
export function useRenderingPerformance() {
  const [fps, setFps] = useState(60);
  const [frameTime, setFrameTime] = useState(16.67);
  const monitor = useRef(new PerformanceMonitor());

  useEffect(() => {
    const interval = setInterval(() => {
      monitor.current.updateFrame();
      setFps(monitor.current.getCurrentFPS());
      setFrameTime(monitor.current.getAverageFrameTime());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const reset = useCallback(() => {
    monitor.current.reset();
  }, []);

  return {
    fps,
    frameTime,
    reset,
  };
}
