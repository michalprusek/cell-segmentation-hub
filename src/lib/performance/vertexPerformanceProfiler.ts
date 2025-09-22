/**
 * Comprehensive vertex rendering performance profiler
 * Measures rendering performance across different vertex counts and scenarios
 */

export interface PerformanceMetrics {
  frameTime: number;
  fps: number;
  cpuTime: number;
  gpuTime?: number;
  memoryUsage: number;
  vertexCount: number;
  renderMode: 'svg' | 'canvas' | 'webgl';
  operation: string;
  timestamp: number;
}

export interface PerformanceTestScenario {
  name: string;
  vertexCounts: number[];
  operations: string[];
  duration: number; // Test duration in ms
  renderModes: ('svg' | 'canvas' | 'webgl')[];
}

export class VertexPerformanceProfiler {
  private metrics: PerformanceMetrics[] = [];
  private observer: PerformanceObserver | null = null;
  private frameCount = 0;
  private startTime = 0;
  private isProfilerActive = false;
  private memoryMonitorInterval: number | null = null;

  constructor() {
    this.initializePerformanceObserver();
  }

  private initializePerformanceObserver(): void {
    if ('PerformanceObserver' in window) {
      this.observer = new PerformanceObserver(list => {
        const entries = list.getEntries();
        for (const entry of entries) {
          if (
            entry.entryType === 'measure' &&
            entry.name.startsWith('vertex-render')
          ) {
            this.recordFrameMetric(entry);
          }
        }
      });

      try {
        this.observer.observe({
          entryTypes: ['measure', 'paint', 'layout-shift'],
        });
      } catch (e) {
        console.warn('PerformanceObserver not fully supported:', e);
      }
    }
  }

  private recordFrameMetric(entry: PerformanceEntry): void {
    if (!this.isProfilerActive) return;

    const metric: PerformanceMetrics = {
      frameTime: entry.duration,
      fps: 1000 / entry.duration,
      cpuTime: entry.duration,
      memoryUsage: this.getCurrentMemoryUsage(),
      vertexCount: this.extractVertexCount(entry.name),
      renderMode: this.extractRenderMode(entry.name),
      operation: this.extractOperation(entry.name),
      timestamp: entry.startTime,
    };

    this.metrics.push(metric);
  }

  private extractVertexCount(name: string): number {
    const match = name.match(/vertices-(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private extractRenderMode(name: string): 'svg' | 'canvas' | 'webgl' {
    if (name.includes('svg')) return 'svg';
    if (name.includes('canvas')) return 'canvas';
    if (name.includes('webgl')) return 'webgl';
    return 'svg'; // default
  }

  private extractOperation(name: string): string {
    if (name.includes('render')) return 'render';
    if (name.includes('drag')) return 'drag';
    if (name.includes('zoom')) return 'zoom';
    if (name.includes('pan')) return 'pan';
    if (name.includes('hover')) return 'hover';
    return 'unknown';
  }

  private getCurrentMemoryUsage(): number {
    if ('memory' in performance) {
      return (performance as any).memory.usedJSHeapSize;
    }
    return 0;
  }

  public startProfiling(): void {
    this.isProfilerActive = true;
    this.metrics = [];
    this.frameCount = 0;
    this.startTime = performance.now();

    // Monitor memory usage every 100ms
    this.memoryMonitorInterval = window.setInterval(() => {
      if (this.isProfilerActive) {
        const memUsage = this.getCurrentMemoryUsage();
        // Store memory samples for trend analysis
        this.metrics.push({
          frameTime: 0,
          fps: 0,
          cpuTime: 0,
          memoryUsage: memUsage,
          vertexCount: 0,
          renderMode: 'svg',
          operation: 'memory-sample',
          timestamp: performance.now(),
        });
      }
    }, 100);
  }

  public stopProfiling(): PerformanceMetrics[] {
    this.isProfilerActive = false;

    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval);
      this.memoryMonitorInterval = null;
    }

    return [...this.metrics];
  }

  public measureVertexRenderingOperation<T>(
    operation: string,
    vertexCount: number,
    renderMode: 'svg' | 'canvas' | 'webgl',
    fn: () => T
  ): T {
    const measureName = `vertex-render-${operation}-${renderMode}-vertices-${vertexCount}`;

    performance.mark(`${measureName}-start`);
    const result = fn();
    performance.mark(`${measureName}-end`);

    performance.measure(
      measureName,
      `${measureName}-start`,
      `${measureName}-end`
    );

    return result;
  }

  public async runVertexStressTest(
    scenario: PerformanceTestScenario
  ): Promise<PerformanceMetrics[]> {
    const results: PerformanceMetrics[] = [];

    console.log(`Starting stress test: ${scenario.name}`);

    for (const renderMode of scenario.renderModes) {
      for (const vertexCount of scenario.vertexCounts) {
        for (const operation of scenario.operations) {
          console.log(
            `Testing ${renderMode} ${operation} with ${vertexCount} vertices`
          );

          // Start profiling for this specific test
          this.startProfiling();

          // Simulate the operation for the specified duration
          await this.simulateVertexOperation(
            operation,
            vertexCount,
            renderMode,
            scenario.duration
          );

          // Stop profiling and collect metrics
          const metrics = this.stopProfiling();
          results.push(...metrics);

          // Brief pause between tests
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }

    return results;
  }

  private async simulateVertexOperation(
    operation: string,
    vertexCount: number,
    renderMode: 'svg' | 'canvas' | 'webgl',
    duration: number
  ): Promise<void> {
    const startTime = performance.now();
    let frameCount = 0;

    return new Promise(resolve => {
      const performFrame = () => {
        if (performance.now() - startTime >= duration) {
          resolve();
          return;
        }

        // Measure this frame
        this.measureVertexRenderingOperation(
          operation,
          vertexCount,
          renderMode,
          () => {
            // Simulate the rendering work
            this.simulateRenderingWork(operation, vertexCount);
            frameCount++;
          }
        );

        requestAnimationFrame(performFrame);
      };

      performFrame();
    });
  }

  private simulateRenderingWork(operation: string, vertexCount: number): void {
    // Simulate different types of rendering work
    switch (operation) {
      case 'render':
        // Simulate vertex rendering calculations
        for (let i = 0; i < vertexCount; i++) {
          const x = Math.sin(i * 0.1) * 100;
          const y = Math.cos(i * 0.1) * 100;
          const radius = Math.sqrt(x * x + y * y);
          // Simulate some rendering calculations
          Math.pow(radius, 1.2);
        }
        break;

      case 'drag':
        // Simulate vertex dragging calculations
        for (let i = 0; i < vertexCount; i++) {
          const transform = {
            x: i * 0.1 + Math.random() * 2,
            y: i * 0.1 + Math.random() * 2,
          };
          // Simulate transform calculations
          Math.atan2(transform.y, transform.x);
        }
        break;

      case 'zoom': {
        // Simulate zoom calculations
        const zoomFactor = 1.1 + Math.random() * 0.2;
        for (let i = 0; i < vertexCount; i++) {
          const scaledX = i * zoomFactor;
          const scaledY = i * zoomFactor;
          // Simulate zoom calculations
          Math.log(scaledX + scaledY + 1);
        }
        break;
      }

      case 'hover':
        // Simulate hover detection
        for (let i = 0; i < vertexCount; i++) {
          const distance = Math.sqrt(i * i + i * i);
          if (distance < 10) {
            // Simulate hover effect calculations
            Math.exp(-distance * 0.1);
          }
        }
        break;
    }
  }

  public getPerformanceReport(
    metrics: PerformanceMetrics[]
  ): PerformanceReport {
    const report: PerformanceReport = {
      summary: this.generateSummary(metrics),
      byRenderMode: this.groupByRenderMode(metrics),
      byVertexCount: this.groupByVertexCount(metrics),
      byOperation: this.groupByOperation(metrics),
      memoryTrends: this.analyzeMemoryTrends(metrics),
      recommendations: this.generateRecommendations(metrics),
    };

    return report;
  }

  private generateSummary(metrics: PerformanceMetrics[]): PerformanceSummary {
    const frameTimes = metrics
      .filter(m => m.operation !== 'memory-sample')
      .map(m => m.frameTime);
    const memoryUsages = metrics.map(m => m.memoryUsage).filter(m => m > 0);

    return {
      totalSamples: frameTimes.length,
      avgFrameTime: frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length,
      avgFPS:
        1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length),
      minFrameTime: Math.min(...frameTimes),
      maxFrameTime: Math.max(...frameTimes),
      p95FrameTime: this.percentile(frameTimes, 95),
      p99FrameTime: this.percentile(frameTimes, 99),
      avgMemoryUsage:
        memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length,
      maxMemoryUsage: Math.max(...memoryUsages),
      memoryGrowth: memoryUsages[memoryUsages.length - 1] - memoryUsages[0],
    };
  }

  private percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }

  private groupByRenderMode(
    metrics: PerformanceMetrics[]
  ): Record<string, PerformanceSummary> {
    const groups = this.groupBy(metrics, 'renderMode');
    const result: Record<string, PerformanceSummary> = {};

    for (const [mode, modeMetrics] of Object.entries(groups)) {
      result[mode] = this.generateSummary(modeMetrics);
    }

    return result;
  }

  private groupByVertexCount(
    metrics: PerformanceMetrics[]
  ): Record<number, PerformanceSummary> {
    const groups = this.groupBy(metrics, 'vertexCount');
    const result: Record<number, PerformanceSummary> = {};

    for (const [count, countMetrics] of Object.entries(groups)) {
      if (parseInt(count) > 0) {
        // Skip memory samples
        result[parseInt(count)] = this.generateSummary(countMetrics);
      }
    }

    return result;
  }

  private groupByOperation(
    metrics: PerformanceMetrics[]
  ): Record<string, PerformanceSummary> {
    const groups = this.groupBy(metrics, 'operation');
    const result: Record<string, PerformanceSummary> = {};

    for (const [operation, opMetrics] of Object.entries(groups)) {
      if (operation !== 'memory-sample') {
        result[operation] = this.generateSummary(opMetrics);
      }
    }

    return result;
  }

  private groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce(
      (groups, item) => {
        const value = String(item[key]);
        groups[value] = groups[value] || [];
        groups[value].push(item);
        return groups;
      },
      {} as Record<string, T[]>
    );
  }

  private analyzeMemoryTrends(metrics: PerformanceMetrics[]): MemoryTrend {
    const memoryMetrics = metrics.filter(m => m.memoryUsage > 0);
    if (memoryMetrics.length < 2) {
      return {
        isIncreasing: false,
        growthRate: 0,
        peakUsage: 0,
        samples: [],
      };
    }

    const samples = memoryMetrics.map(m => ({
      timestamp: m.timestamp,
      usage: m.memoryUsage,
    }));

    const first = samples[0];
    const last = samples[samples.length - 1];
    const growthRate =
      (last.usage - first.usage) / (last.timestamp - first.timestamp);

    return {
      isIncreasing: growthRate > 0,
      growthRate,
      peakUsage: Math.max(...samples.map(s => s.usage)),
      samples,
    };
  }

  private generateRecommendations(
    metrics: PerformanceMetrics[]
  ): PerformanceRecommendation[] {
    const recommendations: PerformanceRecommendation[] = [];
    const summary = this.generateSummary(metrics);

    // FPS recommendations
    if (summary.avgFPS < 30) {
      recommendations.push({
        type: 'critical',
        category: 'fps',
        message: `Average FPS (${summary.avgFPS.toFixed(1)}) is below acceptable threshold (30 FPS)`,
        suggestion:
          'Consider implementing LOD (Level of Detail) or vertex decimation',
      });
    } else if (summary.avgFPS < 60) {
      recommendations.push({
        type: 'warning',
        category: 'fps',
        message: `Average FPS (${summary.avgFPS.toFixed(1)}) is below optimal (60 FPS)`,
        suggestion: 'Optimize rendering pipeline or reduce vertex density',
      });
    }

    // Frame time recommendations
    if (summary.p95FrameTime > 33) {
      // 30 FPS threshold
      recommendations.push({
        type: 'critical',
        category: 'frame-time',
        message: `95th percentile frame time (${summary.p95FrameTime.toFixed(1)}ms) exceeds 33ms`,
        suggestion:
          'Implement frame rate limiting and optimize worst-case scenarios',
      });
    }

    // Memory recommendations
    if (summary.memoryGrowth > 10 * 1024 * 1024) {
      // 10MB growth
      recommendations.push({
        type: 'warning',
        category: 'memory',
        message: `Memory usage increased by ${(summary.memoryGrowth / 1024 / 1024).toFixed(1)}MB during test`,
        suggestion: 'Check for memory leaks and implement object pooling',
      });
    }

    // WebGL recommendations
    const webglMetrics = metrics.filter(m => m.renderMode === 'webgl');
    if (webglMetrics.length === 0) {
      recommendations.push({
        type: 'info',
        category: 'webgl',
        message: 'WebGL rendering not tested',
        suggestion:
          'Implement WebGL renderer for better performance with high vertex counts',
      });
    }

    return recommendations;
  }

  public dispose(): void {
    this.stopProfiling();
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}

export interface PerformanceSummary {
  totalSamples: number;
  avgFrameTime: number;
  avgFPS: number;
  minFrameTime: number;
  maxFrameTime: number;
  p95FrameTime: number;
  p99FrameTime: number;
  avgMemoryUsage: number;
  maxMemoryUsage: number;
  memoryGrowth: number;
}

export interface MemoryTrend {
  isIncreasing: boolean;
  growthRate: number; // bytes per ms
  peakUsage: number;
  samples: Array<{ timestamp: number; usage: number }>;
}

export interface PerformanceRecommendation {
  type: 'critical' | 'warning' | 'info';
  category: 'fps' | 'frame-time' | 'memory' | 'webgl' | 'general';
  message: string;
  suggestion: string;
}

export interface PerformanceReport {
  summary: PerformanceSummary;
  byRenderMode: Record<string, PerformanceSummary>;
  byVertexCount: Record<number, PerformanceSummary>;
  byOperation: Record<string, PerformanceSummary>;
  memoryTrends: MemoryTrend;
  recommendations: PerformanceRecommendation[];
}

// Default test scenarios
export const VERTEX_PERFORMANCE_SCENARIOS: PerformanceTestScenario[] = [
  {
    name: 'Basic Vertex Rendering',
    vertexCounts: [50, 100, 500, 1000, 2000],
    operations: ['render'],
    duration: 2000,
    renderModes: ['svg', 'canvas'],
  },
  {
    name: 'Interactive Operations',
    vertexCounts: [500, 1000, 2000],
    operations: ['drag', 'hover', 'zoom'],
    duration: 3000,
    renderModes: ['svg', 'canvas'],
  },
  {
    name: 'High Vertex Count Stress Test',
    vertexCounts: [2000, 3000, 5000],
    operations: ['render', 'drag'],
    duration: 5000,
    renderModes: ['svg', 'canvas'],
  },
  {
    name: 'WebGL Performance Baseline',
    vertexCounts: [1000, 2000, 5000, 10000],
    operations: ['render', 'drag', 'zoom'],
    duration: 3000,
    renderModes: ['webgl'],
  },
];
