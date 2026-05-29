/**
 * performanceMonitor – gaps2: branches not covered by test.ts or extra.test.ts.
 *
 * Targets:
 *  1. endTiming with unknown id → warns and returns 0
 *  2. recordMetric trims array when it exceeds maxMetricsPerType (100)
 *  3. recordMetric: duration > 1000 → logger.warn about slow operation
 *  4. getRecentMetrics: returns empty array for unknown name
 *  5. getRecentMetrics: returns last N metrics from the array
 *  6. getAllStats: returns empty object when no metrics recorded
 *  7. getAllStats: includes entries for all recorded metric types
 *  8. getStats: returns null for an unknown name
 *  9. measure: records duration and returns the function result
 * 10. measure: re-throws when fn throws, but still records timing
 * 11. measureRender: slow render (> 16.67 ms) emits logger.warn
 * 12. clear: removes all metrics, pendingTimings, raceConditions, wsTimings
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { performanceMonitor } from '@/lib/performanceMonitor';
import { logger } from '@/lib/logger';

describe('PerformanceMonitor – gaps2', () => {
  let mockPerfNow: ReturnType<typeof vi.fn>;
  let mockDateNow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPerfNow = vi.fn().mockReturnValue(0);
    Object.defineProperty(global, 'performance', {
      value: { now: mockPerfNow },
      writable: true,
      configurable: true,
    });
    mockDateNow = vi.fn().mockReturnValue(1_000_000);
    Date.now = mockDateNow;

    performanceMonitor.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    performanceMonitor.clear();
    vi.clearAllMocks();
  });

  // ── 1. endTiming with unknown id ──────────────────────────────────────────

  it('endTiming with an unknown id warns and returns 0', () => {
    const duration = performanceMonitor.endTiming('nonexistent-id');
    expect(duration).toBe(0);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'Performance timing not found',
      expect.objectContaining({ id: 'nonexistent-id' })
    );
  });

  // ── 2. recordMetric trims array at 100 ───────────────────────────────────

  it('recordMetric evicts oldest when metrics exceed 100', () => {
    // Record 101 metrics for the same name
    for (let i = 0; i <= 100; i++) {
      performanceMonitor.recordMetric({
        name: 'trim-test',
        duration: i,
        timestamp: Date.now(),
      });
    }

    const stats = performanceMonitor.getStats('trim-test');
    expect(stats).not.toBeNull();
    // count should be capped at 100
    expect(stats!.count).toBe(100);
    // The first entry (duration=0) should have been evicted
    // min should be ≥ 1 since entry 0 was dropped
    expect(stats!.min).toBeGreaterThanOrEqual(1);
  });

  // ── 3. duration > 1000 triggers slow-operation warning ───────────────────

  it('recordMetric logs a slow-operation warning for duration > 1000ms', () => {
    performanceMonitor.recordMetric({
      name: 'slow-op',
      duration: 1500,
      timestamp: Date.now(),
    });

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'Slow operation detected',
      expect.objectContaining({ name: 'slow-op' })
    );
  });

  it('recordMetric does NOT warn for duration <= 1000ms', () => {
    performanceMonitor.recordMetric({
      name: 'fast-op',
      duration: 999,
      timestamp: Date.now(),
    });

    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const slowWarn = warnCalls.filter(args =>
      String(args[0]).includes('Slow operation')
    );
    expect(slowWarn).toHaveLength(0);
  });

  // ── 4. getRecentMetrics: unknown name returns [] ─────────────────────────

  it('getRecentMetrics returns empty array for unknown metric name', () => {
    const result = performanceMonitor.getRecentMetrics('no-such-metric');
    expect(result).toEqual([]);
  });

  // ── 5. getRecentMetrics: returns last N ──────────────────────────────────

  it('getRecentMetrics returns the last N metrics', () => {
    for (let i = 0; i < 15; i++) {
      performanceMonitor.recordMetric({
        name: 'recent-test',
        duration: i,
        timestamp: Date.now(),
      });
    }

    const recent = performanceMonitor.getRecentMetrics('recent-test', 5);
    expect(recent).toHaveLength(5);
    // Last 5 entries: duration 10..14
    expect(recent[0].duration).toBe(10);
    expect(recent[4].duration).toBe(14);
  });

  // ── 6. getAllStats: empty when no metrics ─────────────────────────────────

  it('getAllStats returns empty object when no metrics have been recorded', () => {
    const stats = performanceMonitor.getAllStats();
    expect(stats).toEqual({});
  });

  // ── 7. getAllStats: includes all recorded types ───────────────────────────

  it('getAllStats returns an entry for each recorded metric type', () => {
    performanceMonitor.recordMetric({
      name: 'type-a',
      duration: 10,
      timestamp: Date.now(),
    });
    performanceMonitor.recordMetric({
      name: 'type-b',
      duration: 20,
      timestamp: Date.now(),
    });

    const stats = performanceMonitor.getAllStats();
    expect(Object.keys(stats)).toContain('type-a');
    expect(Object.keys(stats)).toContain('type-b');
    expect(stats['type-a'].average).toBe(10);
    expect(stats['type-b'].average).toBe(20);
  });

  // ── 8. getStats: null for unknown name ───────────────────────────────────

  it('getStats returns null for an unknown metric name', () => {
    expect(performanceMonitor.getStats('unknown-metric')).toBeNull();
  });

  // ── 9. measure: records duration and returns fn result ───────────────────

  it('measure records the correct duration and returns the function result', async () => {
    mockPerfNow.mockReturnValueOnce(0).mockReturnValueOnce(42);
    const result = await performanceMonitor.measure(
      'measure-ok',
      () => 'hello'
    );

    expect(result).toBe('hello');
    const stats = performanceMonitor.getStats('measure-ok');
    expect(stats).not.toBeNull();
    expect(stats!.average).toBe(42);
  });

  // ── 10. measure: re-throws when fn throws ────────────────────────────────

  it('measure re-throws fn errors and still records timing', async () => {
    mockPerfNow.mockReturnValueOnce(0).mockReturnValueOnce(10);

    await expect(
      performanceMonitor.measure('measure-fail', () => {
        throw new Error('measure error');
      })
    ).rejects.toThrow('measure error');

    // Timing was recorded despite the throw
    const stats = performanceMonitor.getStats('measure-fail');
    expect(stats).not.toBeNull();
    expect(stats!.count).toBe(1);
  });

  // ── 11. measureRender: slow render warns ─────────────────────────────────

  it('measureRender emits slow-render warning for duration > 16.67ms', () => {
    // start=0, end=20 → duration=20ms > 16.67ms
    mockPerfNow.mockReturnValueOnce(0).mockReturnValueOnce(20);
    const end = performanceMonitor.measureRender('SlowComponent');
    end();

    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const slowRenderWarn = warnCalls.filter(args =>
      String(args[0]).includes('Slow render')
    );
    expect(slowRenderWarn.length).toBeGreaterThan(0);
  });

  // ── 12. clear: wipes everything ──────────────────────────────────────────

  it('clear() removes all recorded metrics, timings, races, and ws timings', () => {
    // Add some data
    performanceMonitor.recordMetric({
      name: 'x',
      duration: 5,
      timestamp: Date.now(),
    });
    performanceMonitor.startTiming('pending-timing');

    // Add a race condition
    mockDateNow.mockReturnValueOnce(1_000);
    performanceMonitor.recordWebSocketUpdate('clear-img');
    mockDateNow.mockReturnValueOnce(1_200);
    performanceMonitor.recordDatabaseFetch('clear-img', 200, true, 0);

    // Verify something was recorded
    expect(performanceMonitor.getStats('x')).not.toBeNull();
    expect(performanceMonitor.getRaceConditionStats().total).toBe(1);

    performanceMonitor.clear();

    expect(performanceMonitor.getStats('x')).toBeNull();
    expect(performanceMonitor.getRaceConditionStats().total).toBe(0);
    expect(performanceMonitor.getAllStats()).toEqual({});
  });
});
