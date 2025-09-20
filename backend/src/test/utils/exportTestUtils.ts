import { vi } from 'vitest';
import { ExportService } from '../../services/exportService';
import { WebSocketService } from '../../services/websocketService';
import * as SharingService from '../../services/sharingService';

/**
 * Test utilities for export cancellation race condition testing
 */

export interface MockExportJob {
  id: string;
  projectId: string;
  userId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  filePath?: string;
  createdAt: Date;
  cancelledAt?: Date;
  message?: string;
  options: any;
  bullJobId?: string;
}

export interface MockWebSocketService {
  sendToUser: ReturnType<typeof vi.fn>;
  broadcast: ReturnType<typeof vi.fn>;
  connected: boolean;
}

export interface MockSharingService {
  hasProjectAccess: ReturnType<typeof vi.fn>;
}

/**
 * Creates a mock WebSocket service for testing
 */
export function createMockWebSocketService(): MockWebSocketService {
  return {
    sendToUser: vi.fn().mockResolvedValue(undefined),
    broadcast: vi.fn().mockResolvedValue(undefined),
    connected: true,
  };
}

/**
 * Creates a mock sharing service for testing
 */
export function createMockSharingService(hasAccess: boolean = true): MockSharingService {
  return {
    hasProjectAccess: vi.fn().mockResolvedValue({
      hasAccess,
      accessType: hasAccess ? 'owner' : null,
    }),
  };
}

/**
 * Creates a mock export job for testing
 */
export function createMockExportJob(overrides: Partial<MockExportJob> = {}): MockExportJob {
  const defaults: MockExportJob = {
    id: `test-job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    projectId: 'test-project-123',
    userId: 'test-user-123',
    status: 'pending',
    progress: 0,
    createdAt: new Date(),
    options: {
      includeOriginalImages: true,
      includeVisualizations: false,
      annotationFormats: ['json'],
      metricsFormats: ['csv'],
    },
  };

  return { ...defaults, ...overrides };
}

/**
 * Sets up export service with mocked dependencies
 */
export function setupMockExportService(
  wsService?: MockWebSocketService,
  sharingService?: MockSharingService
) {
  const mockWsService = wsService || createMockWebSocketService();
  const mockSharingService = sharingService || createMockSharingService();

  // Mock WebSocket service
  const WebSocketServiceMock = vi.mocked(WebSocketService);
  WebSocketServiceMock.getInstance = vi.fn().mockReturnValue(mockWsService);

  // Mock sharing service
  const SharingServiceMock = vi.mocked(SharingService);
  SharingServiceMock.hasProjectAccess = mockSharingService.hasProjectAccess;

  // Get export service instance
  const exportService = ExportService.getInstance();
  exportService.setWebSocketService(mockWsService as any);

  // Clear existing jobs
  (exportService as any).exportJobs.clear();

  return {
    exportService,
    mockWsService,
    mockSharingService,
  };
}

/**
 * Utility to simulate race condition timing
 */
export class RaceConditionSimulator {
  private events: Array<{
    timestamp: number;
    action: () => void | Promise<void>;
    description: string;
  }> = [];

  /**
   * Schedule an action to occur at a specific time offset
   */
  scheduleAction(delayMs: number, action: () => void | Promise<void>, description: string) {
    this.events.push({
      timestamp: delayMs,
      action,
      description,
    });
    return this;
  }

  /**
   * Execute all scheduled actions with proper timing
   */
  async execute() {
    // Sort events by timestamp
    this.events.sort((a, b) => a.timestamp - b.timestamp);

    const startTime = Date.now();
    const results: Array<{ description: string; executed: boolean; error?: any }> = [];

    for (const event of this.events) {
      const elapsed = Date.now() - startTime;
      const waitTime = Math.max(0, event.timestamp - elapsed);

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      try {
        await event.action();
        results.push({ description: event.description, executed: true });
      } catch (error) {
        results.push({ description: event.description, executed: false, error });
      }
    }

    return results;
  }

  /**
   * Clear all scheduled events
   */
  clear() {
    this.events = [];
    return this;
  }
}

/**
 * Creates a race condition simulator for the exact bug scenario
 */
export function createBugReportRaceCondition(
  jobId: string = 'f574e1b4-b0a5-4035-95d0-18fef944762d'
) {
  return new RaceConditionSimulator()
    .scheduleAction(0, () => {
      // T+0ms: Export job started
    }, 'Export started')
    .scheduleAction(7500, () => {
      // T+7500ms: User clicks cancel
    }, 'User cancellation')
    .scheduleAction(8000, () => {
      // T+8000ms: Processing completes (race condition)
    }, 'Processing completion')
    .scheduleAction(9000, () => {
      // T+9000ms: Auto-download would trigger
    }, 'Auto-download attempt');
}

/**
 * Performance measurement utilities
 */
export class PerformanceTracker {
  private measurements: Map<string, number[]> = new Map();

  /**
   * Start measuring an operation
   */
  start(operationName: string): () => number {
    const startTime = performance.now();
    return () => {
      const duration = performance.now() - startTime;
      this.addMeasurement(operationName, duration);
      return duration;
    };
  }

  /**
   * Add a measurement manually
   */
  addMeasurement(operationName: string, duration: number) {
    if (!this.measurements.has(operationName)) {
      this.measurements.set(operationName, []);
    }
    this.measurements.get(operationName)!.push(duration);
  }

  /**
   * Get statistics for an operation
   */
  getStats(operationName: string) {
    const measurements = this.measurements.get(operationName) || [];
    if (measurements.length === 0) {
      return null;
    }

    const sorted = [...measurements].sort((a, b) => a - b);
    return {
      count: measurements.length,
      min: Math.min(...measurements),
      max: Math.max(...measurements),
      average: measurements.reduce((sum, val) => sum + val, 0) / measurements.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  /**
   * Get all statistics
   */
  getAllStats() {
    const results: Record<string, any> = {};
    for (const operationName of this.measurements.keys()) {
      results[operationName] = this.getStats(operationName);
    }
    return results;
  }

  /**
   * Clear all measurements
   */
  clear() {
    this.measurements.clear();
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const stats = this.getAllStats();
    let report = 'Performance Test Report\n';
    report += '========================\n\n';

    for (const [operation, operationStats] of Object.entries(stats)) {
      if (operationStats) {
        report += `${operation}:\n`;
        report += `  Count: ${operationStats.count}\n`;
        report += `  Average: ${operationStats.average.toFixed(2)}ms\n`;
        report += `  Min: ${operationStats.min.toFixed(2)}ms\n`;
        report += `  Max: ${operationStats.max.toFixed(2)}ms\n`;
        report += `  Median: ${operationStats.median.toFixed(2)}ms\n`;
        report += `  95th percentile: ${operationStats.p95.toFixed(2)}ms\n`;
        report += `  99th percentile: ${operationStats.p99.toFixed(2)}ms\n\n`;
      }
    }

    return report;
  }
}

/**
 * Memory usage tracker for leak detection
 */
export class MemoryTracker {
  private snapshots: Array<{
    label: string;
    timestamp: number;
    memory: NodeJS.MemoryUsage;
  }> = [];

  /**
   * Take a memory snapshot
   */
  snapshot(label: string) {
    this.snapshots.push({
      label,
      timestamp: Date.now(),
      memory: process.memoryUsage(),
    });
  }

  /**
   * Calculate memory growth between snapshots
   */
  getGrowth(fromLabel: string, toLabel: string) {
    const fromSnapshot = this.snapshots.find(s => s.label === fromLabel);
    const toSnapshot = this.snapshots.find(s => s.label === toLabel);

    if (!fromSnapshot || !toSnapshot) {
      return null;
    }

    return {
      heapUsed: toSnapshot.memory.heapUsed - fromSnapshot.memory.heapUsed,
      heapTotal: toSnapshot.memory.heapTotal - fromSnapshot.memory.heapTotal,
      external: toSnapshot.memory.external - fromSnapshot.memory.external,
      rss: toSnapshot.memory.rss - fromSnapshot.memory.rss,
      duration: toSnapshot.timestamp - fromSnapshot.timestamp,
    };
  }

  /**
   * Check for potential memory leaks
   */
  detectLeaks(thresholdMB: number = 10): boolean {
    if (this.snapshots.length < 2) {
      return false;
    }

    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];

    const growthMB = (last.memory.heapUsed - first.memory.heapUsed) / 1024 / 1024;
    return growthMB > thresholdMB;
  }

  /**
   * Generate memory report
   */
  generateReport(): string {
    let report = 'Memory Usage Report\n';
    report += '==================\n\n';

    this.snapshots.forEach((snapshot, index) => {
      report += `${index + 1}. ${snapshot.label} (${new Date(snapshot.timestamp).toISOString()})\n`;
      report += `   Heap Used: ${(snapshot.memory.heapUsed / 1024 / 1024).toFixed(2)}MB\n`;
      report += `   Heap Total: ${(snapshot.memory.heapTotal / 1024 / 1024).toFixed(2)}MB\n`;
      report += `   External: ${(snapshot.memory.external / 1024 / 1024).toFixed(2)}MB\n`;
      report += `   RSS: ${(snapshot.memory.rss / 1024 / 1024).toFixed(2)}MB\n\n`;
    });

    if (this.snapshots.length >= 2) {
      const growth = this.getGrowth(this.snapshots[0].label, this.snapshots[this.snapshots.length - 1].label);
      if (growth) {
        report += 'Total Growth:\n';
        report += `   Heap Used: ${(growth.heapUsed / 1024 / 1024).toFixed(2)}MB\n`;
        report += `   Duration: ${growth.duration}ms\n`;
        report += `   Potential Leak: ${this.detectLeaks() ? 'YES' : 'NO'}\n`;
      }
    }

    return report;
  }

  /**
   * Clear all snapshots
   */
  clear() {
    this.snapshots = [];
  }
}

/**
 * Utilities for testing concurrent operations
 */
export class ConcurrencyTestUtils {
  /**
   * Execute operations concurrently with staggered timing
   */
  static async executeConcurrently<T>(
    operations: Array<() => Promise<T>>,
    options: {
      staggerMs?: number;
      maxConcurrent?: number;
    } = {}
  ): Promise<T[]> {
    const { staggerMs = 0, maxConcurrent = operations.length } = options;
    const results: T[] = [];
    const batches: Array<() => Promise<T>>[] = [];

    // Split into batches if maxConcurrent is specified
    for (let i = 0; i < operations.length; i += maxConcurrent) {
      batches.push(operations.slice(i, i + maxConcurrent));
    }

    for (const batch of batches) {
      const batchPromises = batch.map(async (operation, index) => {
        if (staggerMs > 0 && index > 0) {
          await new Promise(resolve => setTimeout(resolve, index * staggerMs));
        }
        return operation();
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Create a barrier that waits for all operations to reach a point
   */
  static createBarrier(count: number) {
    let waiting = 0;
    const waiters: Array<() => void> = [];

    return {
      wait: () => new Promise<void>(resolve => {
        waiting++;
        if (waiting === count) {
          // All operations reached the barrier
          waiters.forEach(waiter => waiter());
          waiters.length = 0;
          waiting = 0;
          resolve();
        } else {
          waiters.push(resolve);
        }
      }),
    };
  }

  /**
   * Simulate network delays with jitter
   */
  static async simulateNetworkDelay(
    baseDelayMs: number = 100,
    jitterPercent: number = 0.2
  ): Promise<void> {
    const jitter = (Math.random() - 0.5) * 2 * jitterPercent;
    const delay = baseDelayMs * (1 + jitter);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, delay)));
  }
}

/**
 * Test data generators
 */
export class TestDataGenerators {
  /**
   * Generate test export options
   */
  static generateExportOptions(overrides: any = {}) {
    const defaults = {
      includeOriginalImages: true,
      includeVisualizations: false,
      visualizationOptions: {
        showNumbers: true,
        polygonColors: {
          external: '#ff0000',
          internal: '#00ff00',
        },
        strokeWidth: 2,
        fontSize: 12,
        transparency: 0.5,
      },
      annotationFormats: ['json'],
      metricsFormats: ['csv'],
      includeDocumentation: true,
      selectedImageIds: [],
      pixelToMicrometerScale: 1.0,
    };

    return { ...defaults, ...overrides };
  }

  /**
   * Generate realistic job IDs
   */
  static generateJobId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate test user data
   */
  static generateTestUser(overrides: any = {}) {
    const id = Math.random().toString(36).substr(2, 9);
    return {
      id: `user-${id}`,
      email: `test-${id}@example.com`,
      username: `testuser${id}`,
      password: 'hashedpassword',
      isVerified: true,
      ...overrides,
    };
  }

  /**
   * Generate test project data
   */
  static generateTestProject(userId: string, overrides: any = {}) {
    const id = Math.random().toString(36).substr(2, 9);
    return {
      id: `project-${id}`,
      title: `Test Project ${id}`,
      description: `Test project for export testing ${id}`,
      userId,
      ...overrides,
    };
  }
}

/**
 * Assertion helpers for export tests
 */
export class ExportTestAssertions {
  /**
   * Assert that a job is in cancelled state
   */
  static assertJobCancelled(job: MockExportJob) {
    expect(job.status).toBe('cancelled');
    expect(job.cancelledAt).toBeDefined();
    expect(job.filePath).toBeUndefined();
  }

  /**
   * Assert that no download occurred
   */
  static assertNoDownload(mockApiGet: any, mockDownloadFn: any) {
    expect(mockApiGet).not.toHaveBeenCalledWith(
      expect.stringContaining('/download'),
      expect.anything()
    );
    expect(mockDownloadFn).not.toHaveBeenCalled();
  }

  /**
   * Assert WebSocket cancellation event
   */
  static assertCancellationEvent(mockWsService: MockWebSocketService, jobId: string, userId: string) {
    expect(mockWsService.sendToUser).toHaveBeenCalledWith(
      userId,
      'export:cancelled',
      expect.objectContaining({
        jobId,
        cancelledAt: expect.any(Date),
      })
    );
  }

  /**
   * Assert no completion event was sent
   */
  static assertNoCompletionEvent(mockWsService: MockWebSocketService, jobId: string) {
    expect(mockWsService.sendToUser).not.toHaveBeenCalledWith(
      expect.anything(),
      'export:completed',
      expect.objectContaining({ jobId })
    );
  }

  /**
   * Assert performance within limits
   */
  static assertPerformanceWithinLimits(
    duration: number,
    maxMs: number,
    operation: string = 'Operation'
  ) {
    expect(duration).toBeLessThan(maxMs);
    if (duration > maxMs * 0.8) {
      // Warning: ${operation} took ${duration}ms, approaching limit of ${maxMs}ms
    }
  }

  /**
   * Assert memory usage is reasonable
   */
  static assertMemoryUsageReasonable(
    initialMemory: NodeJS.MemoryUsage,
    finalMemory: NodeJS.MemoryUsage,
    maxGrowthMB: number = 50
  ) {
    const growthMB = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
    expect(growthMB).toBeLessThan(maxGrowthMB);

    if (growthMB > maxGrowthMB * 0.8) {
      // Warning: Memory growth ${growthMB}MB, approaching limit of ${maxGrowthMB}MB
    }
  }
}

/**
 * Export all utilities as default export for convenience
 */
export default {
  createMockWebSocketService,
  createMockSharingService,
  createMockExportJob,
  setupMockExportService,
  RaceConditionSimulator,
  createBugReportRaceCondition,
  PerformanceTracker,
  MemoryTracker,
  ConcurrencyTestUtils,
  TestDataGenerators,
  ExportTestAssertions,
};