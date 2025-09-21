import { vi } from 'vitest';
import { renderHook, RenderHookResult, act } from '@testing-library/react';

/**
 * Frontend test utilities for export cancellation testing
 */

export interface MockSocket {
  connected: boolean;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  id: string;
  userId?: string;
  user?: any;
}

export interface MockApiClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

export interface MockExportStateManager {
  getExportState: ReturnType<typeof vi.fn>;
  saveExportState: ReturnType<typeof vi.fn>;
  saveExportStateThrottled: ReturnType<typeof vi.fn>;
  clearExportState: ReturnType<typeof vi.fn>;
}

/**
 * Creates a mock socket for WebSocket testing
 */
export function createMockSocket(
  overrides: Partial<MockSocket> = {}
): MockSocket {
  return {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    id: 'mock-socket-id',
    ...overrides,
  };
}

/**
 * Creates a mock API client
 */
export function createMockApiClient(): MockApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
  };
}

/**
 * Creates a mock export state manager
 */
export function createMockExportStateManager(): MockExportStateManager {
  return {
    getExportState: vi.fn().mockReturnValue(null),
    saveExportState: vi.fn(),
    saveExportStateThrottled: vi.fn(),
    clearExportState: vi.fn(),
  };
}

/**
 * Setup complete mock environment for export hook testing
 */
export function setupExportHookMocks() {
  const mockSocket = createMockSocket();
  const mockApiClient = createMockApiClient();
  const mockExportStateManager = createMockExportStateManager();

  // Mock useWebSocket hook
  const mockUseWebSocket = vi.fn().mockReturnValue({
    socket: mockSocket,
    isConnected: true,
  });

  // Mock download utilities
  const mockDownloadFromResponse = vi.fn().mockResolvedValue(undefined);
  const mockCanDownloadLargeFiles = vi.fn().mockReturnValue(true);

  // Mock logger
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  return {
    mockSocket,
    mockApiClient,
    mockExportStateManager,
    mockUseWebSocket,
    mockDownloadFromResponse,
    mockCanDownloadLargeFiles,
    mockLogger,
  };
}

/**
 * Simulates WebSocket events on a mock socket
 */
export class WebSocketEventSimulator {
  constructor(private mockSocket: MockSocket) {}

  /**
   * Simulate export progress event
   */
  simulateProgress(jobId: string, progress: number) {
    const handler = this.getEventHandler('export:progress');
    if (handler) {
      handler({ jobId, progress });
    }
  }

  /**
   * Simulate export completion event
   */
  simulateCompletion(jobId: string, filePath?: string) {
    const handler = this.getEventHandler('export:completed');
    if (handler) {
      handler({ jobId, filePath });
    }
  }

  /**
   * Simulate export failure event
   */
  simulateFailure(jobId: string, error: string) {
    const handler = this.getEventHandler('export:failed');
    if (handler) {
      handler({ jobId, error });
    }
  }

  /**
   * Simulate export cancellation event
   */
  simulateCancellation(jobId: string, previousStatus: string = 'processing') {
    const handler = this.getEventHandler('export:cancelled');
    if (handler) {
      handler({
        jobId,
        previousStatus,
        cancelledAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Get event handler for a specific event type
   */
  private getEventHandler(eventType: string) {
    const call = this.mockSocket.on.mock.calls.find(
      (call: any) => call[0] === eventType
    );
    return call ? call[1] : null;
  }

  /**
   * Simulate connection events
   */
  simulateConnect() {
    const handler = this.getEventHandler('connect');
    if (handler) {
      handler();
    }
    this.mockSocket.connected = true;
  }

  simulateDisconnect() {
    const handler = this.getEventHandler('disconnect');
    if (handler) {
      handler();
    }
    this.mockSocket.connected = false;
  }
}

/**
 * Utility for testing race conditions in React hooks
 */
export class ReactHookRaceConditionTester<TProps, TResult> {
  constructor(
    private hook: (props: TProps) => TResult,
    private initialProps: TProps
  ) {}

  private result?: RenderHookResult<TResult, TProps>;

  /**
   * Render the hook
   */
  render(): RenderHookResult<TResult, TProps> {
    this.result = renderHook(this.hook, { initialProps: this.initialProps });
    return this.result;
  }

  /**
   * Execute a sequence of actions with timing
   */
  async executeSequence(
    actions: Array<{
      delayMs: number;
      action: (result: TResult) => void | Promise<void>;
      description: string;
    }>
  ) {
    if (!this.result) {
      throw new Error('Hook must be rendered before executing sequence');
    }

    const startTime = Date.now();

    for (const { delayMs, action, description: _description } of actions) {
      const elapsed = Date.now() - startTime;
      const waitTime = Math.max(0, delayMs - elapsed);

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      await act(async () => {
        await action(this.result!.result.current);
      });
    }
  }

  /**
   * Simulate rapid state changes
   */
  async simulateRapidStateChanges(
    stateChanger: (result: TResult) => void,
    count: number = 10,
    intervalMs: number = 10
  ) {
    if (!this.result) {
      throw new Error('Hook must be rendered before simulating state changes');
    }

    for (let i = 0; i < count; i++) {
      await act(async () => {
        stateChanger(this.result!.result.current);
      });

      if (i < count - 1) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
  }

  /**
   * Wait for async state updates
   */
  async waitForUpdate(
    predicate: (result: TResult) => boolean,
    timeoutMs: number = 5000
  ) {
    if (!this.result) {
      throw new Error('Hook must be rendered before waiting for update');
    }

    const startTime = Date.now();

    while (!predicate(this.result.result.current)) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timeout waiting for hook update after ${timeoutMs}ms`);
      }

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });
    }
  }
}

/**
 * Performance testing utilities for React hooks
 */
export class ReactHookPerformanceTester {
  private measurements: Array<{
    operation: string;
    duration: number;
    timestamp: number;
  }> = [];

  /**
   * Measure hook operation performance
   */
  async measureOperation<T>(
    operation: () => Promise<T> | T,
    operationName: string
  ): Promise<T> {
    const startTime = performance.now();
    const result = await operation();
    const duration = performance.now() - startTime;

    this.measurements.push({
      operation: operationName,
      duration,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Measure multiple iterations of an operation
   */
  async measureIterations<T>(
    operation: () => Promise<T> | T,
    operationName: string,
    iterations: number
  ): Promise<T[]> {
    const results: T[] = [];

    for (let i = 0; i < iterations; i++) {
      const result = await this.measureOperation(
        operation,
        `${operationName}_${i}`
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Get performance statistics
   */
  getStats(operationPattern?: string) {
    let measurements = this.measurements;

    if (operationPattern) {
      measurements = this.measurements.filter(m =>
        m.operation.includes(operationPattern)
      );
    }

    if (measurements.length === 0) {
      return null;
    }

    const durations = measurements.map(m => m.duration);
    const sorted = [...durations].sort((a, b) => a - b);

    return {
      count: measurements.length,
      min: Math.min(...durations),
      max: Math.max(...durations),
      average: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  /**
   * Clear measurements
   */
  clear() {
    this.measurements = [];
  }

  /**
   * Assert performance is within acceptable limits
   */
  assertPerformance(
    operationPattern: string,
    maxAverageMs: number,
    maxP95Ms?: number
  ) {
    const stats = this.getStats(operationPattern);

    if (!stats) {
      throw new Error(`No measurements found for pattern: ${operationPattern}`);
    }

    expect(stats.average).toBeLessThan(maxAverageMs);

    if (maxP95Ms) {
      expect(stats.p95).toBeLessThan(maxP95Ms);
    }
  }
}

/**
 * Utility for testing memory leaks in React components
 */
export class ReactMemoryLeakTester {
  private initialMemory?: NodeJS.MemoryUsage;
  private snapshots: Array<{
    label: string;
    memory: NodeJS.MemoryUsage;
    timestamp: number;
  }> = [];

  /**
   * Start memory tracking
   */
  start() {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    this.initialMemory = process.memoryUsage();
    this.snapshots = [];
    this.takeSnapshot('initial');
  }

  /**
   * Take a memory snapshot
   */
  takeSnapshot(label: string) {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    this.snapshots.push({
      label,
      memory: process.memoryUsage(),
      timestamp: Date.now(),
    });
  }

  /**
   * Check for memory leaks
   */
  checkForLeaks(thresholdMB: number = 10): boolean {
    if (!this.initialMemory || this.snapshots.length < 2) {
      return false;
    }

    const latest = this.snapshots[this.snapshots.length - 1];
    const growthMB =
      (latest.memory.heapUsed - this.initialMemory.heapUsed) / 1024 / 1024;

    return growthMB > thresholdMB;
  }

  /**
   * Get memory growth statistics
   */
  getGrowthStats() {
    if (!this.initialMemory || this.snapshots.length === 0) {
      return null;
    }

    const latest = this.snapshots[this.snapshots.length - 1];
    const growthBytes = latest.memory.heapUsed - this.initialMemory.heapUsed;
    const duration = latest.timestamp - this.snapshots[0].timestamp;

    return {
      totalGrowthMB: growthBytes / 1024 / 1024,
      growthPerSecondMB: growthBytes / 1024 / 1024 / (duration / 1000),
      snapshots: this.snapshots.length,
      duration,
    };
  }

  /**
   * Assert no significant memory leaks
   */
  assertNoLeaks(maxGrowthMB: number = 10) {
    const hasLeaks = this.checkForLeaks(maxGrowthMB);
    const stats = this.getGrowthStats();

    if (hasLeaks && stats) {
      throw new Error(
        `Memory leak detected: ${stats.totalGrowthMB.toFixed(2)}MB growth exceeds threshold of ${maxGrowthMB}MB`
      );
    }
  }
}

/**
 * Utilities for testing async state management
 */
export class AsyncStateTestUtils {
  /**
   * Wait for multiple state updates to complete
   */
  static async waitForStateUpdates(
    checks: Array<() => boolean>,
    timeoutMs: number = 5000
  ) {
    const startTime = Date.now();

    while (checks.some(check => !check())) {
      if (Date.now() - startTime > timeoutMs) {
        const failedChecks = checks
          .map((check, index) => ({ index, passed: check() }))
          .filter(result => !result.passed)
          .map(result => result.index);

        throw new Error(
          `Timeout waiting for state updates. Failed checks: ${failedChecks.join(', ')}`
        );
      }

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });
    }
  }

  /**
   * Execute operations with controlled timing
   */
  static async executeWithTiming<T>(
    operations: Array<{
      operation: () => Promise<T> | T;
      delayMs: number;
      description?: string;
    }>
  ): Promise<T[]> {
    const results: T[] = [];
    const startTime = Date.now();

    for (const { operation, delayMs, description } of operations) {
      const elapsed = Date.now() - startTime;
      const waitTime = Math.max(0, delayMs - elapsed);

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      const result = await operation();
      results.push(result);

      if (description) {
        // ${description} completed at T+${Date.now() - startTime}ms
      }
    }

    return results;
  }

  /**
   * Simulate user interactions with realistic delays
   */
  static async simulateUserInteraction<T>(
    interactions: Array<{
      action: () => Promise<T> | T;
      description: string;
      thinkingTimeMs?: number;
    }>
  ): Promise<T[]> {
    const results: T[] = [];

    for (const { action, description: _description, thinkingTimeMs = 100 } of interactions) {
      // Simulate user thinking time
      if (thinkingTimeMs > 0) {
        await new Promise(resolve => setTimeout(resolve, thinkingTimeMs));
      }

      // User action: ${description}
      const result = await action();
      results.push(result);
    }

    return results;
  }
}

/**
 * Export test data generators
 */
export class FrontendTestDataGenerators {
  /**
   * Generate mock export job
   */
  static generateMockJob(overrides: any = {}) {
    const defaults = {
      id: `test-job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending' as const,
      progress: 0,
      filePath: undefined,
      createdAt: new Date(),
    };

    return { ...defaults, ...overrides };
  }

  /**
   * Generate mock export options
   */
  static generateMockExportOptions(overrides: any = {}) {
    const defaults = {
      includeOriginalImages: true,
      includeVisualizations: false,
      annotationFormats: ['json'],
      metricsFormats: ['csv'],
      includeDocumentation: true,
    };

    return { ...defaults, ...overrides };
  }

  /**
   * Generate realistic project data
   */
  static generateMockProject(overrides: any = {}) {
    const id = Math.random().toString(36).substr(2, 9);
    return {
      id: `project-${id}`,
      title: `Test Project ${id}`,
      description: `Test project description ${id}`,
      ...overrides,
    };
  }
}

/**
 * Export all utilities
 */
export default {
  createMockSocket,
  createMockApiClient,
  createMockExportStateManager,
  setupExportHookMocks,
  WebSocketEventSimulator,
  ReactHookRaceConditionTester,
  ReactHookPerformanceTester,
  ReactMemoryLeakTester,
  AsyncStateTestUtils,
  FrontendTestDataGenerators,
};
