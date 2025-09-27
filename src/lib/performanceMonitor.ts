import { logger } from '@/lib/logger';

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

interface PerformanceStats {
  average: number;
  min: number;
  max: number;
  count: number;
  total: number;
}

interface PendingTiming {
  name: string;
  startTime: number;
  metadata?: Record<string, any>;
}

interface RaceConditionEvent {
  imageId: string;
  wsUpdateTime: number;
  dbFetchTime: number;
  retryCount: number;
  resolved: boolean;
  timeDiff: number;
}

class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private pendingTimings: Map<string, PendingTiming> = new Map();
  private raceConditions: RaceConditionEvent[] = [];
  private wsTimings: Map<string, number> = new Map(); // Track WebSocket update times
  private maxMetricsPerType = 100; // Keep last 100 measurements per metric type
  private maxRaceConditions = 100; // Keep last 100 race condition events

  /**
   * Start timing a performance measurement
   */
  startTiming(name: string, metadata?: Record<string, any>): string {
    const id = `${name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const pendingTiming: PendingTiming = {
      name,
      startTime: performance.now(),
      metadata,
    };
    this.pendingTimings.set(id, pendingTiming);

    return id;
  }

  /**
   * End timing and record measurement
   */
  endTiming(id: string): number {
    const pendingTiming = this.pendingTimings.get(id);
    if (!pendingTiming) {
      logger.warn('Performance timing not found', { id });
      return 0;
    }

    const duration = performance.now() - pendingTiming.startTime;

    const metric: PerformanceMetric = {
      name: pendingTiming.name,
      duration,
      timestamp: Date.now(),
      metadata: pendingTiming.metadata,
    };

    this.recordMetric(metric);

    // Cleanup
    this.pendingTimings.delete(id);

    return duration;
  }

  /**
   * Record a direct performance metric
   */
  recordMetric(metric: PerformanceMetric): void {
    if (!this.metrics.has(metric.name)) {
      this.metrics.set(metric.name, []);
    }

    const metrics = this.metrics.get(metric.name)!;
    metrics.push(metric);

    // Keep only the latest metrics to prevent memory growth
    if (metrics.length > this.maxMetricsPerType) {
      metrics.splice(0, metrics.length - this.maxMetricsPerType);
    }

    // Log slow operations
    if (metric.duration > 1000) {
      // > 1 second
      logger.warn('Slow operation detected', {
        name: metric.name,
        duration: `${metric.duration.toFixed(2)}ms`,
        metadata: metric.metadata,
      });
    }

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      logger.debug(`⏱️ Performance: ${metric.name}`, {
        duration: `${metric.duration.toFixed(2)}ms`,
        metadata: metric.metadata,
      });
    }
  }

  /**
   * Get performance statistics for a metric type
   */
  getStats(name: string): PerformanceStats | null {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    const durations = metrics.map(m => m.duration);
    const total = durations.reduce((sum, d) => sum + d, 0);

    return {
      average: total / durations.length,
      min: Math.min(...durations),
      max: Math.max(...durations),
      count: durations.length,
      total,
    };
  }

  /**
   * Get all performance statistics
   */
  getAllStats(): Record<string, PerformanceStats> {
    const stats: Record<string, PerformanceStats> = {};

    for (const [name] of this.metrics) {
      const stat = this.getStats(name);
      if (stat) {
        stats[name] = stat;
      }
    }

    return stats;
  }

  /**
   * Measure a function execution time
   */
  async measure<T>(
    name: string,
    fn: () => Promise<T> | T,
    metadata?: Record<string, any>
  ): Promise<T> {
    const id = this.startTiming(name, metadata);

    try {
      const result = await fn();
      this.endTiming(id);
      return result;
    } catch (error) {
      this.endTiming(id);
      throw error;
    }
  }

  /**
   * Record WebSocket update timing for race condition detection
   */
  recordWebSocketUpdate(imageId: string, metadata?: Record<string, any>): void {
    const now = Date.now();
    this.wsTimings.set(imageId, now);

    this.recordMetric({
      name: 'websocket_update',
      duration: 0,
      timestamp: now,
      metadata: { imageId, ...metadata },
    });
  }

  /**
   * Record database fetch and check for race conditions
   */
  recordDatabaseFetch(
    imageId: string,
    duration: number,
    success: boolean,
    retryCount: number = 0
  ): void {
    const now = Date.now();
    const wsTime = this.wsTimings.get(imageId);

    // Check for race condition
    if (wsTime) {
      const timeDiff = now - wsTime;

      // Race condition detected if DB fetch happens within 1 second of WS update
      if (timeDiff < 1000) {
        this.recordRaceCondition(imageId, wsTime, now, retryCount, success);
      }

      // Clean up old timing
      this.wsTimings.delete(imageId);
    }

    this.recordMetric({
      name: 'database_fetch',
      duration,
      timestamp: now,
      metadata: { imageId, success, retryCount },
    });
  }

  /**
   * Record a race condition event
   */
  private recordRaceCondition(
    imageId: string,
    wsUpdateTime: number,
    dbFetchTime: number,
    retryCount: number,
    resolved: boolean
  ): void {
    const event: RaceConditionEvent = {
      imageId,
      wsUpdateTime,
      dbFetchTime,
      retryCount,
      resolved,
      timeDiff: dbFetchTime - wsUpdateTime,
    };

    this.raceConditions.push(event);

    // Log significant race conditions
    if (event.timeDiff < 100) {
      logger.warn(`🏁 Race condition detected for ${imageId.slice(0, 8)}:`, {
        timeDiff: `${event.timeDiff}ms`,
        retryCount,
        resolved,
      });
    }

    // Maintain max size
    if (this.raceConditions.length > this.maxRaceConditions) {
      this.raceConditions.shift();
    }
  }

  /**
   * Get race condition statistics
   */
  getRaceConditionStats(): {
    total: number;
    resolved: number;
    unresolved: number;
    averageTimeDiff: number;
    averageRetries: number;
  } {
    if (this.raceConditions.length === 0) {
      return {
        total: 0,
        resolved: 0,
        unresolved: 0,
        averageTimeDiff: 0,
        averageRetries: 0,
      };
    }

    const resolved = this.raceConditions.filter(rc => rc.resolved).length;
    const avgTimeDiff =
      this.raceConditions.reduce((sum, rc) => sum + rc.timeDiff, 0) /
      this.raceConditions.length;
    const avgRetries =
      this.raceConditions.reduce((sum, rc) => sum + rc.retryCount, 0) /
      this.raceConditions.length;

    return {
      total: this.raceConditions.length,
      resolved,
      unresolved: this.raceConditions.length - resolved,
      averageTimeDiff: Math.round(avgTimeDiff),
      averageRetries: Math.round(avgRetries * 10) / 10,
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
    this.pendingTimings.clear();
    this.raceConditions = [];
    this.wsTimings.clear();
  }

  /**
   * Get recent metrics for a specific type
   */
  getRecentMetrics(name: string, count: number = 10): PerformanceMetric[] {
    const metrics = this.metrics.get(name);
    if (!metrics) return [];

    return metrics.slice(-count);
  }

  /**
   * Monitor rendering performance
   */
  measureRender(
    componentName: string,
    metadata?: Record<string, any>
  ): () => void {
    const id = this.startTiming(`render-${componentName}`, metadata);

    return () => {
      const duration = this.endTiming(id);

      // Warn about slow renders
      if (duration > 16.67) {
        // > 1 frame at 60fps
        logger.warn('Slow render detected', {
          component: componentName,
          duration: `${duration.toFixed(2)}ms`,
          metadata,
        });
      }
    };
  }

  /**
   * Monitor canvas drawing performance
   */
  measureCanvasDraw(
    operationName: string,
    metadata?: Record<string, any>
  ): () => void {
    const id = this.startTiming(`canvas-${operationName}`, metadata);

    return () => {
      this.endTiming(id);
    };
  }

  /**
   * Monitor API call performance
   */
  measureApiCall(endpoint: string, metadata?: Record<string, any>): () => void {
    const id = this.startTiming(`api-${endpoint}`, metadata);

    return () => {
      this.endTiming(id);
    };
  }

  /**
   * Get performance report
   */
  getPerformanceReport(): string {
    const stats = this.getAllStats();
    const raceStats = this.getRaceConditionStats();
    const lines: string[] = ['Performance Report:'];

    for (const [name, stat] of Object.entries(stats)) {
      lines.push(
        `  ${name}: avg=${stat.average.toFixed(2)}ms, min=${stat.min.toFixed(2)}ms, max=${stat.max.toFixed(2)}ms, count=${stat.count}`
      );
    }

    // Add race condition statistics
    if (raceStats.total > 0) {
      lines.push('\nRace Condition Statistics:');
      lines.push(`  Total: ${raceStats.total}`);
      lines.push(`  Resolved: ${raceStats.resolved} (${Math.round(raceStats.resolved / raceStats.total * 100)}%)`);
      lines.push(`  Unresolved: ${raceStats.unresolved}`);
      lines.push(`  Average Time Diff: ${raceStats.averageTimeDiff}ms`);
      lines.push(`  Average Retries: ${raceStats.averageRetries}`);
    }

    return lines.join('\n');
  }

  /**
   * Monitor memory usage
   */
  getMemoryUsage(): Record<string, number> | null {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memory = (performance as any).memory;
      return {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
      };
    }
    return null;
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Helper functions for common use cases
export const measureThumbnailRender = (
  polygonCount: number,
  pointCount: number
) => {
  return performanceMonitor.measureRender('thumbnail', {
    polygonCount,
    pointCount,
  });
};

export const measureApiCall = (
  endpoint: string,
  metadata?: Record<string, any>
) => {
  return performanceMonitor.measureApiCall(endpoint, metadata);
};

export const measureCanvasOperation = (
  operation: string,
  metadata?: Record<string, any>
) => {
  return performanceMonitor.measureCanvasDraw(operation, metadata);
};

// Automatic performance reporting (every 5 minutes in development)
if (process.env.NODE_ENV === 'development') {
  setInterval(
    () => {
      const report = performanceMonitor.getPerformanceReport();
      const memory = performanceMonitor.getMemoryUsage();

      if (report.includes('avg=')) {
        // Only log if we have data
        logger.debug('📊 Performance Report', {
          report,
          memory,
        });
      }
    },
    5 * 60 * 1000
  );
}
