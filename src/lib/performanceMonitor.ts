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

class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private startTimes: Map<string, number> = new Map();
  private maxMetricsPerType = 100; // Keep last 100 measurements per metric type

  /**
   * Start timing a performance measurement
   */
  startTiming(name: string, metadata?: Record<string, any>): string {
    const id = `${name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.startTimes.set(id, performance.now());
    
    if (metadata) {
      // Store metadata for later use
      this.startTimes.set(`${id}-metadata`, metadata as any);
    }

    return id;
  }

  /**
   * End timing and record measurement
   */
  endTiming(id: string): number {
    const startTime = this.startTimes.get(id);
    if (!startTime) {
      logger.warn('Performance timing not found', { id });
      return 0;
    }

    const duration = performance.now() - startTime;
    const metadata = this.startTimes.get(`${id}-metadata`) as Record<string, any> | undefined;
    
    // Extract metric name from ID
    const name = id.split('-')[0];
    
    const metric: PerformanceMetric = {
      name,
      duration,
      timestamp: Date.now(),
      metadata
    };

    this.recordMetric(metric);
    
    // Cleanup
    this.startTimes.delete(id);
    if (metadata) {
      this.startTimes.delete(`${id}-metadata`);
    }

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
    if (metric.duration > 1000) { // > 1 second
      logger.warn('Slow operation detected', {
        name: metric.name,
        duration: `${metric.duration.toFixed(2)}ms`,
        metadata: metric.metadata
      });
    }

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      logger.debug(`⏱️ Performance: ${metric.name}`, {
        duration: `${metric.duration.toFixed(2)}ms`,
        metadata: metric.metadata
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
      total
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
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
    this.startTimes.clear();
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
  measureRender(componentName: string, metadata?: Record<string, any>): () => void {
    const id = this.startTiming(`render-${componentName}`, metadata);
    
    return () => {
      const duration = this.endTiming(id);
      
      // Warn about slow renders
      if (duration > 16.67) { // > 1 frame at 60fps
        logger.warn('Slow render detected', {
          component: componentName,
          duration: `${duration.toFixed(2)}ms`,
          metadata
        });
      }
    };
  }

  /**
   * Monitor canvas drawing performance
   */
  measureCanvasDraw(operationName: string, metadata?: Record<string, any>): () => void {
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
    const lines: string[] = ['Performance Report:'];
    
    for (const [name, stat] of Object.entries(stats)) {
      lines.push(
        `  ${name}: avg=${stat.average.toFixed(2)}ms, min=${stat.min.toFixed(2)}ms, max=${stat.max.toFixed(2)}ms, count=${stat.count}`
      );
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
        jsHeapSizeLimit: memory.jsHeapSizeLimit
      };
    }
    return null;
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Helper functions for common use cases
export const measureThumbnailRender = (polygonCount: number, pointCount: number) => {
  return performanceMonitor.measureRender('thumbnail', {
    polygonCount,
    pointCount
  });
};

export const measureApiCall = (endpoint: string, metadata?: Record<string, any>) => {
  return performanceMonitor.measureApiCall(endpoint, metadata);
};

export const measureCanvasOperation = (operation: string, metadata?: Record<string, any>) => {
  return performanceMonitor.measureCanvasDraw(operation, metadata);
};

// Automatic performance reporting (every 5 minutes in development)
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    const report = performanceMonitor.getPerformanceReport();
    const memory = performanceMonitor.getMemoryUsage();
    
    if (report.includes('avg=')) { // Only log if we have data
      logger.debug('📊 Performance Report', {
        report,
        memory
      });
    }
  }, 5 * 60 * 1000);
}