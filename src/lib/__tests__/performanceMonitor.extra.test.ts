/**
 * performanceMonitor — additional behavioral tests targeting uncovered branches.
 *
 * Covered here (not in performanceMonitor.test.ts):
 *  1. recordWebSocketUpdate stores timing + records a metric with duration 0
 *  2. recordDatabaseFetch with no prior WS timing: no race-condition recorded,
 *     but the DB fetch metric IS still written.
 *  3. recordDatabaseFetch within 1 s of WS update → race-condition recorded.
 *  4. recordDatabaseFetch > 1 s after WS update → no race-condition.
 *  5. Race condition with timeDiff < 100 ms triggers logger.warn.
 *  6. Race condition with timeDiff >= 100 ms does NOT trigger logger.warn.
 *  7. getRaceConditionStats: correct resolved/unresolved counts + averages.
 *  8. getRaceConditionStats: zero state returns safe defaults.
 *  9. raceConditions array capped at 100 entries (oldest evicted).
 * 10. getPerformanceReport includes race-condition section when events exist.
 * 11. getPerformanceReport omits race-condition section when none exist.
 * 12. measureRender: fast render (< 16.67 ms) does NOT warn.
 * 13. measureCanvasDraw: records metric under `canvas-<name>`.
 * 14. measureApiCall: records metric under `api-<name>`.
 * 15. getMemoryUsage returns null when performance has no `memory` key.
 * 16. measure: metadata passed through to the recorded metric.
 * 17. WebSocket timing cleared after race detection (no double-counting).
 * 18. recordDatabaseFetch: success=false still writes metric.
 * 19. recordDatabaseFetch: retryCount forwarded into metric metadata.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger before importing the module-under-test
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

describe('PerformanceMonitor — uncovered branches', () => {
  let mockPerfNow: ReturnType<typeof vi.fn>;
  let mockDateNow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Stable performance.now mock — tests override per-call as needed
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

  // ── WebSocket / race-condition recording ─────────────────────────────────

  it('recordWebSocketUpdate stores WS timing and writes a metric with duration=0', () => {
    mockDateNow.mockReturnValue(1_500_000);
    performanceMonitor.recordWebSocketUpdate('img-abc', { extra: 'meta' });

    const stats = performanceMonitor.getStats('websocket_update');
    expect(stats).not.toBeNull();
    expect(stats!.count).toBe(1);
    expect(stats!.average).toBe(0); // duration is always 0 for WS updates
  });

  it('recordDatabaseFetch with no prior WS timing writes metric but no race', () => {
    mockDateNow.mockReturnValue(2_000_000);
    performanceMonitor.recordDatabaseFetch('img-xyz', 120, true, 0);

    const dbStats = performanceMonitor.getStats('database_fetch');
    expect(dbStats).not.toBeNull();
    expect(dbStats!.count).toBe(1);

    // No race conditions should have been recorded
    const raceStats = performanceMonitor.getRaceConditionStats();
    expect(raceStats.total).toBe(0);
  });

  it('recordDatabaseFetch within 1 s of WS update records a race condition', () => {
    // WS update at t=1000
    mockDateNow.mockReturnValueOnce(1_000);
    performanceMonitor.recordWebSocketUpdate('img-race');

    // DB fetch at t=1500 (500 ms later — inside the 1000 ms window)
    mockDateNow.mockReturnValueOnce(1_500);
    performanceMonitor.recordDatabaseFetch('img-race', 50, true, 0);

    const raceStats = performanceMonitor.getRaceConditionStats();
    expect(raceStats.total).toBe(1);
    expect(raceStats.averageTimeDiff).toBe(500);
  });

  it('recordDatabaseFetch > 1 s after WS update does NOT record a race condition', () => {
    // WS update at t=0
    mockDateNow.mockReturnValueOnce(0);
    performanceMonitor.recordWebSocketUpdate('img-norace');

    // DB fetch at t=2000 (> 1000 ms — outside the window)
    mockDateNow.mockReturnValueOnce(2_000);
    performanceMonitor.recordDatabaseFetch('img-norace', 200, true, 0);

    expect(performanceMonitor.getRaceConditionStats().total).toBe(0);
  });

  it('race condition with timeDiff < 100 ms triggers logger.warn', () => {
    // WS at t=1000, DB at t=1050 → timeDiff = 50 ms (< 100)
    mockDateNow.mockReturnValueOnce(1_000);
    performanceMonitor.recordWebSocketUpdate('img-warn');

    mockDateNow.mockReturnValueOnce(1_050);
    performanceMonitor.recordDatabaseFetch('img-warn', 50, false, 2);

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('Race condition detected'),
      expect.objectContaining({ timeDiff: '50ms', retryCount: 2 })
    );
  });

  it('race condition with timeDiff >= 100 ms does NOT trigger logger.warn about race', () => {
    // WS at t=1000, DB at t=1150 → timeDiff = 150 ms (> 100, still inside 1000)
    mockDateNow.mockReturnValueOnce(1_000);
    performanceMonitor.recordWebSocketUpdate('img-nowarn');

    vi.mocked(logger.warn).mockClear();

    mockDateNow.mockReturnValueOnce(1_150);
    performanceMonitor.recordDatabaseFetch('img-nowarn', 150, true, 0);

    // Race recorded but no warn call about "Race condition"
    expect(performanceMonitor.getRaceConditionStats().total).toBe(1);
    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const raceWarn = warnCalls.filter(args =>
      String(args[0]).includes('Race condition')
    );
    expect(raceWarn).toHaveLength(0);
  });

  // ── getRaceConditionStats ─────────────────────────────────────────────────

  it('getRaceConditionStats returns zeroed-out stats when no races recorded', () => {
    const stats = performanceMonitor.getRaceConditionStats();
    expect(stats).toEqual({
      total: 0,
      resolved: 0,
      unresolved: 0,
      averageTimeDiff: 0,
      averageRetries: 0,
    });
  });

  it('getRaceConditionStats: resolved=true increments resolved count', () => {
    // One resolved race — same pattern as the working "within 1s" test.
    mockDateNow.mockReturnValueOnce(1_000);
    performanceMonitor.recordWebSocketUpdate('img-resolved');

    mockDateNow.mockReturnValueOnce(1_500); // diff=500 <1000, resolved=true
    performanceMonitor.recordDatabaseFetch('img-resolved', 500, true, 2);

    const stats = performanceMonitor.getRaceConditionStats();
    expect(stats.total).toBe(1);
    expect(stats.resolved).toBe(1);
    expect(stats.unresolved).toBe(0);
    expect(stats.averageRetries).toBe(2);
  });

  it('getRaceConditionStats: resolved=false increments unresolved count', () => {
    mockDateNow.mockReturnValueOnce(2_000);
    performanceMonitor.recordWebSocketUpdate('img-unresolved');

    mockDateNow.mockReturnValueOnce(2_400); // diff=400 <1000, resolved=false
    performanceMonitor.recordDatabaseFetch('img-unresolved', 400, false, 3);

    const stats = performanceMonitor.getRaceConditionStats();
    expect(stats.total).toBe(1);
    expect(stats.resolved).toBe(0);
    expect(stats.unresolved).toBe(1);
    expect(stats.averageRetries).toBe(3);
  });

  it('raceConditions array is capped at 100 entries (oldest evicted)', () => {
    // Fill 101 race conditions — each pair needs two Date.now() calls
    for (let i = 0; i < 101; i++) {
      // WS at i*2, DB at i*2+50 (all within 1000 ms window)
      mockDateNow.mockReturnValueOnce(i * 2).mockReturnValueOnce(i * 2 + 50);
      performanceMonitor.recordWebSocketUpdate(`img-cap-${i}`);
      performanceMonitor.recordDatabaseFetch(`img-cap-${i}`, 50, true, 0);
    }

    const stats = performanceMonitor.getRaceConditionStats();
    expect(stats.total).toBe(100);
  });

  it('WS timing is cleared after race detection so a second DB fetch has no race', () => {
    mockDateNow.mockReturnValueOnce(1_000);
    performanceMonitor.recordWebSocketUpdate('img-onceonly');

    mockDateNow.mockReturnValueOnce(1_200);
    performanceMonitor.recordDatabaseFetch('img-onceonly', 200, true, 0);
    expect(performanceMonitor.getRaceConditionStats().total).toBe(1);

    // Second DB fetch for the same image — WS timing was deleted so no new race
    mockDateNow.mockReturnValueOnce(1_300);
    performanceMonitor.recordDatabaseFetch('img-onceonly', 100, true, 0);
    expect(performanceMonitor.getRaceConditionStats().total).toBe(1);
  });

  // ── getPerformanceReport with race-condition section ─────────────────────

  it('getPerformanceReport includes race-condition section when races exist', () => {
    // Piggyback on the same Date.now pattern that works in "within 1s" test.
    mockDateNow.mockReturnValueOnce(5_000);
    performanceMonitor.recordWebSocketUpdate('img-report');

    mockDateNow.mockReturnValueOnce(5_300); // diff=300 <1000
    performanceMonitor.recordDatabaseFetch('img-report', 300, true, 1);

    // Verify race was actually recorded before checking the report
    expect(performanceMonitor.getRaceConditionStats().total).toBe(1);

    const report = performanceMonitor.getPerformanceReport();
    expect(report).toContain('Race Condition Statistics:');
    expect(report).toContain('Total: 1');
    expect(report).toContain('Resolved: 1');
    expect(report).toContain('Unresolved: 0');
  });

  it('getPerformanceReport omits race-condition section when none exist', () => {
    const report = performanceMonitor.getPerformanceReport();
    expect(report).not.toContain('Race Condition Statistics:');
  });

  // ── measureRender / measureCanvasDraw / measureApiCall ───────────────────

  it('fast render (< 16.67 ms) does NOT emit a slow-render warning', () => {
    mockPerfNow.mockReturnValueOnce(0).mockReturnValueOnce(10);
    const end = performanceMonitor.measureRender('FastComp');
    end();

    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const slowWarn = warnCalls.filter(args =>
      String(args[0]).includes('Slow render')
    );
    expect(slowWarn).toHaveLength(0);

    const stats = performanceMonitor.getStats('render-FastComp');
    expect(stats!.average).toBe(10);
  });

  it('measureCanvasDraw records metric under `canvas-<name>` prefix', () => {
    mockPerfNow.mockReturnValueOnce(0).mockReturnValueOnce(7);
    const end = performanceMonitor.measureCanvasDraw('fill-rect');
    end();

    const stats = performanceMonitor.getStats('canvas-fill-rect');
    expect(stats).not.toBeNull();
    expect(stats!.average).toBe(7);
  });

  it('measureApiCall records metric under `api-<name>` prefix', () => {
    mockPerfNow.mockReturnValueOnce(0).mockReturnValueOnce(340);
    const end = performanceMonitor.measureApiCall('/export/download');
    end();

    const stats = performanceMonitor.getStats('api-/export/download');
    expect(stats).not.toBeNull();
    expect(stats!.average).toBe(340);
  });

  // ── getMemoryUsage edge cases ─────────────────────────────────────────────

  it('getMemoryUsage returns null when performance has no `memory` property', () => {
    Object.defineProperty(global, 'performance', {
      value: { now: mockPerfNow }, // no `memory` key
      writable: true,
      configurable: true,
    });
    expect(performanceMonitor.getMemoryUsage()).toBeNull();
  });

  it('getMemoryUsage returns the three heap fields when `memory` is present', () => {
    Object.defineProperty(global, 'performance', {
      value: {
        now: mockPerfNow,
        memory: {
          usedJSHeapSize: 100,
          totalJSHeapSize: 200,
          jsHeapSizeLimit: 400,
        },
      },
      writable: true,
      configurable: true,
    });
    expect(performanceMonitor.getMemoryUsage()).toEqual({
      usedJSHeapSize: 100,
      totalJSHeapSize: 200,
      jsHeapSizeLimit: 400,
    });
  });

  // ── measure() — metadata passthrough ─────────────────────────────────────

  it('measure passes metadata through to the recorded metric', async () => {
    mockPerfNow.mockReturnValueOnce(0).mockReturnValueOnce(88);
    const meta = { userId: 'u1', projectId: 'p1' };
    await performanceMonitor.measure('api-users', () => 'ok', meta);

    const recent = performanceMonitor.getRecentMetrics('api-users', 1);
    expect(recent[0].metadata).toEqual(meta);
  });

  // ── recordDatabaseFetch metadata fields ──────────────────────────────────

  it('recordDatabaseFetch with success=false still writes a metric', () => {
    mockDateNow.mockReturnValue(9_000_000);
    performanceMonitor.recordDatabaseFetch('img-fail', 300, false, 0);

    const stats = performanceMonitor.getStats('database_fetch');
    expect(stats).not.toBeNull();
    expect(stats!.count).toBe(1);
    expect(stats!.average).toBe(300);
  });

  it('recordDatabaseFetch retryCount is forwarded into metric metadata', () => {
    mockDateNow.mockReturnValue(9_500_000);
    performanceMonitor.recordDatabaseFetch('img-retry', 200, true, 3);

    const recent = performanceMonitor.getRecentMetrics('database_fetch', 1);
    expect(recent[0].metadata).toMatchObject({ retryCount: 3 });
  });
});
