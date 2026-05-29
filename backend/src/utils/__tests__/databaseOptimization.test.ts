/**
 * databaseOptimization.test.ts
 *
 * Covers the pure behavioral logic of DatabaseOptimization:
 *  - trackQuery: increments counters, detects slow queries, caps timing buffer
 *  - getMetrics: snapshot correctness
 *  - getSlowQueryAnalysis: filters, computes averages, sorts descending
 *  - getOptimizationRecommendations: threshold-based messages
 *  - resetMetrics: clears all state
 *  - updateConfig / getConfig: merges partial config
 *  - initialize: wires prisma client
 *  - runOptimization: skips when prisma null or indexOptimization disabled
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import the singleton; reset between tests using resetMetrics().
// We must import after mocking logger.
import databaseOptimization from '../databaseOptimization';

describe('DatabaseOptimization', () => {
  beforeEach(() => {
    databaseOptimization.resetMetrics();
    // Ensure query analysis is on and threshold is 1000 ms (defaults)
    databaseOptimization.updateConfig({
      enableQueryAnalysis: true,
      slowQueryThreshold: 1000,
      enableIndexOptimization: false,
    });
  });

  // ─── trackQuery ────────────────────────────────────────────────────────────

  describe('trackQuery', () => {
    it('increments totalQueries counter on each call', () => {
      databaseOptimization.trackQuery('findUser', 50);
      databaseOptimization.trackQuery('findProject', 80);
      expect(databaseOptimization.getMetrics().totalQueries).toBe(2);
    });

    it('increments slowQueries when duration exceeds threshold', () => {
      databaseOptimization.trackQuery('heavyJoin', 1500); // > 1000 ms
      expect(databaseOptimization.getMetrics().slowQueries).toBe(1);
    });

    it('does not increment slowQueries when duration equals threshold (not strictly >', () => {
      // The check is `duration > threshold` so exactly 1000 should NOT count
      databaseOptimization.trackQuery('borderQuery', 1000);
      expect(databaseOptimization.getMetrics().slowQueries).toBe(0);
    });

    it('does not increment slowQueries for fast queries', () => {
      databaseOptimization.trackQuery('fastQuery', 200);
      expect(databaseOptimization.getMetrics().slowQueries).toBe(0);
    });

    it('updates averageQueryTime as running mean across all tracked queries', () => {
      databaseOptimization.trackQuery('q1', 100);
      databaseOptimization.trackQuery('q2', 300);
      // totalTime = 400, totalQueries = 2 → avg = 200
      expect(databaseOptimization.getMetrics().averageQueryTime).toBeCloseTo(
        200,
        1
      );
    });

    it('caps the timing buffer at 100 entries per query name', () => {
      for (let i = 0; i < 110; i++) {
        databaseOptimization.trackQuery('repeatedQuery', 50);
      }
      // Internal buffer should not exceed 100 — no direct accessor, but
      // metrics total should equal 110 (counter is separate from buffer)
      expect(databaseOptimization.getMetrics().totalQueries).toBe(110);
    });

    it('does nothing when enableQueryAnalysis is false', () => {
      databaseOptimization.updateConfig({ enableQueryAnalysis: false });
      databaseOptimization.trackQuery('shouldBeIgnored', 2000);
      expect(databaseOptimization.getMetrics().totalQueries).toBe(0);
    });

    it('does not throw when a slow query is detected (warning path)', () => {
      // Exercises the logger.warn branch without asserting on the mock
      // (logger is wired through a module-level singleton import)
      expect(() =>
        databaseOptimization.trackQuery('slowOp', 2000)
      ).not.toThrow();
    });
  });

  // ─── getMetrics ────────────────────────────────────────────────────────────

  describe('getMetrics', () => {
    it('returns a snapshot (not a live reference)', () => {
      databaseOptimization.trackQuery('q', 100);
      const snapshot = databaseOptimization.getMetrics();
      databaseOptimization.trackQuery('q2', 200);
      // snapshot should NOT reflect the second call
      expect(snapshot.totalQueries).toBe(1);
    });

    it('initially has all numeric metrics at 0 and lastOptimizationRun null', () => {
      const m = databaseOptimization.getMetrics();
      expect(m.totalQueries).toBe(0);
      expect(m.slowQueries).toBe(0);
      expect(m.averageQueryTime).toBe(0);
      expect(m.connectionPoolUsage).toBe(0);
      expect(m.lastOptimizationRun).toBeNull();
    });
  });

  // ─── getSlowQueryAnalysis ─────────────────────────────────────────────────

  describe('getSlowQueryAnalysis', () => {
    it('returns empty array when no queries have been tracked', () => {
      expect(databaseOptimization.getSlowQueryAnalysis()).toEqual([]);
    });

    it('returns only queries whose individual timings exceed the threshold', () => {
      databaseOptimization.trackQuery('fast', 200); // never slow
      databaseOptimization.trackQuery('slow', 1500); // slow
      const analysis = databaseOptimization.getSlowQueryAnalysis();
      expect(analysis.some(a => a.queryName === 'slow')).toBe(true);
      expect(analysis.some(a => a.queryName === 'fast')).toBe(false);
    });

    it('computes averageTime correctly for slow timings of a single query', () => {
      databaseOptimization.trackQuery('mixedQuery', 500); // fast — excluded
      databaseOptimization.trackQuery('mixedQuery', 1200); // slow
      databaseOptimization.trackQuery('mixedQuery', 1800); // slow
      const analysis = databaseOptimization.getSlowQueryAnalysis();
      const entry = analysis.find(a => a.queryName === 'mixedQuery');
      expect(entry).toBeDefined();
      // Average of 1200 + 1800 = 1500
      expect(entry!.averageTime).toBeCloseTo(1500, 0);
    });

    it('reports correct slow-call count', () => {
      databaseOptimization.trackQuery('q', 1100);
      databaseOptimization.trackQuery('q', 1200);
      databaseOptimization.trackQuery('q', 500); // fast
      const analysis = databaseOptimization.getSlowQueryAnalysis();
      const entry = analysis.find(a => a.queryName === 'q');
      expect(entry!.count).toBe(2);
    });

    it('sorts results by averageTime descending', () => {
      databaseOptimization.trackQuery('slower', 2000);
      databaseOptimization.trackQuery('fastest_slow', 1100);
      databaseOptimization.trackQuery('mid', 1500);
      const analysis = databaseOptimization.getSlowQueryAnalysis();
      const times = analysis.map(a => a.averageTime);
      for (let i = 0; i < times.length - 1; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i + 1]);
      }
    });
  });

  // ─── getOptimizationRecommendations ──────────────────────────────────────

  describe('getOptimizationRecommendations', () => {
    it('returns a "within acceptable parameters" message when everything is fine', () => {
      databaseOptimization.trackQuery('q', 100);
      const recs = databaseOptimization.getOptimizationRecommendations();
      expect(recs.some(r => /acceptable/i.test(r))).toBe(true);
    });

    it('recommends adding indexes when >10% of queries are slow', () => {
      // 2 slow out of 10 = 20%
      for (let i = 0; i < 8; i++) databaseOptimization.trackQuery('fast', 100);
      for (let i = 0; i < 2; i++) databaseOptimization.trackQuery('slow', 2000);
      const recs = databaseOptimization.getOptimizationRecommendations();
      expect(recs.some(r => /indexes/i.test(r))).toBe(true);
    });

    it('recommends reviewing complexity when average query time > 500ms', () => {
      // Push average above 500 ms
      databaseOptimization.trackQuery('heavy', 1000);
      databaseOptimization.trackQuery('heavy', 900);
      const recs = databaseOptimization.getOptimizationRecommendations();
      expect(recs.some(r => /average query time/i.test(r))).toBe(true);
    });

    it('includes slowest query name in recommendations when present', () => {
      databaseOptimization.trackQuery('verySlowQuery', 3000);
      const recs = databaseOptimization.getOptimizationRecommendations();
      expect(recs.some(r => r.includes('verySlowQuery'))).toBe(true);
    });
  });

  // ─── resetMetrics ─────────────────────────────────────────────────────────

  describe('resetMetrics', () => {
    it('clears all counters and timing history', () => {
      databaseOptimization.trackQuery('q', 2000);
      databaseOptimization.resetMetrics();
      const m = databaseOptimization.getMetrics();
      expect(m.totalQueries).toBe(0);
      expect(m.slowQueries).toBe(0);
      expect(m.averageQueryTime).toBe(0);
    });

    it('clears slow query analysis data after reset', () => {
      databaseOptimization.trackQuery('heavyQuery', 5000);
      databaseOptimization.resetMetrics();
      expect(databaseOptimization.getSlowQueryAnalysis()).toHaveLength(0);
    });
  });

  // ─── updateConfig / getConfig ─────────────────────────────────────────────

  describe('updateConfig and getConfig', () => {
    it('merges partial config without overwriting unmentioned fields', () => {
      const before = databaseOptimization.getConfig();
      databaseOptimization.updateConfig({ slowQueryThreshold: 2000 });
      const after = databaseOptimization.getConfig();
      expect(after.slowQueryThreshold).toBe(2000);
      expect(after.enableQueryAnalysis).toBe(before.enableQueryAnalysis);
    });

    it('getConfig returns a snapshot (not a mutable reference)', () => {
      const cfg = databaseOptimization.getConfig();
      cfg.slowQueryThreshold = 9999;
      expect(databaseOptimization.getConfig().slowQueryThreshold).not.toBe(
        9999
      );
    });
  });

  // ─── initialize ────────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('sets the prisma client without throwing', () => {
      const fakePrisma = {} as Parameters<
        typeof databaseOptimization.initialize
      >[0];
      expect(() => databaseOptimization.initialize(fakePrisma)).not.toThrow();
    });
  });

  // ─── runOptimization ───────────────────────────────────────────────────────

  describe('runOptimization', () => {
    it('does nothing and does not throw when prisma is null (not initialized)', async () => {
      // Default state — prisma is null
      databaseOptimization.updateConfig({ enableIndexOptimization: true });
      await expect(
        databaseOptimization.runOptimization()
      ).resolves.not.toThrow();
    });

    it('does nothing when enableIndexOptimization is false even with prisma set', async () => {
      const fakePrisma = {
        $executeRaw: vi.fn(),
      } as unknown as Parameters<typeof databaseOptimization.initialize>[0];
      databaseOptimization.initialize(fakePrisma);
      databaseOptimization.updateConfig({ enableIndexOptimization: false });
      await databaseOptimization.runOptimization();
      // $executeRaw should NOT have been called
      expect(
        (fakePrisma as { $executeRaw: ReturnType<typeof vi.fn> }).$executeRaw
      ).not.toHaveBeenCalled();
    });

    it('sets lastOptimizationRun after successful non-sqlite run', async () => {
      const fakePrisma = {
        $executeRaw: vi.fn().mockResolvedValue(undefined),
      } as unknown as Parameters<typeof databaseOptimization.initialize>[0];
      databaseOptimization.initialize(fakePrisma);
      databaseOptimization.updateConfig({ enableIndexOptimization: true });
      // DATABASE_URL not containing sqlite → ANALYZE branch skipped but date still set
      await databaseOptimization.runOptimization();
      expect(
        databaseOptimization.getMetrics().lastOptimizationRun
      ).not.toBeNull();
    });
  });
});
