/**
 * dbIndex.test.ts
 *
 * Behavioral tests for src/db/index.ts.
 *
 * The global setup (src/test/setup.ts) mocks 'src/db/index.ts' with a minimal
 * prisma-only shim. To test the REAL module we need to:
 *   1. Use vi.hoisted() to create mock functions before any vi.mock() hoisting.
 *   2. Mock @prisma/client with a proper constructor (class, not plain object)
 *      so `new PrismaClient()` inside index.ts works.
 *   3. Mock the internal dependencies (databaseMetrics, prismaConfig, etc.).
 *   4. Override the global '../index' shim with the REAL module via
 *      importOriginal so the test exercises the real implementations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mock helpers so they are available in vi.mock factories ────────────

const {
  mockConnect,
  mockDisconnect,
  mockExecuteRaw,
  mockQueryRaw,
  mockTransactionFn,
  mockUserCount,
  MockPrismaClient,
  mockMetricsStop,
} = vi.hoisted(() => {
  const mockConnect = vi.fn();
  const mockDisconnect = vi.fn();
  const mockExecuteRaw = vi.fn();
  const mockQueryRaw = vi.fn();
  const mockTransactionFn = vi.fn();
  const mockUserCount = vi.fn();

  class MockPrismaClient {
    $connect = mockConnect;
    $disconnect = mockDisconnect;
    $executeRaw = mockExecuteRaw;
    $queryRaw = mockQueryRaw;
    $transaction = mockTransactionFn;
    user = { count: mockUserCount };
  }

  const mockMetricsStop = vi.fn();

  return {
    mockConnect,
    mockDisconnect,
    mockExecuteRaw,
    mockQueryRaw,
    mockTransactionFn,
    mockUserCount,
    MockPrismaClient,
    mockMetricsStop,
  };
});

// Override the global prisma/client mock with our class-based constructor.
vi.mock('@prisma/client', () => ({
  PrismaClient: MockPrismaClient,
}));

vi.mock('../../monitoring/databaseMetrics', () => ({
  databaseMetrics: { stop: mockMetricsStop },
}));

vi.mock('../prismaConfig', () => ({
  getPrismaConfig: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: { NODE_ENV: 'test' },
}));

// Override the global shim for '../db' (registered from src/test/setup.ts as
// src/db/index.ts) with the REAL module + our mocked dependencies. This uses
// the importOriginal helper to load the real implementation now that all
// dependency mocks are in place.
vi.mock('../index', async importOriginal => {
  const real = await importOriginal<typeof import('../index')>();
  return real;
});

import {
  prisma,
  initializeDatabase,
  disconnectDatabase,
  checkDatabaseHealth,
} from '../index';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('db/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── prisma singleton ──────────────────────────────────────────────────────

  describe('prisma singleton', () => {
    it('exports a prisma object', () => {
      expect(prisma).toBeDefined();
    });

    it('exposes $connect and $disconnect', () => {
      expect(typeof prisma.$connect).toBe('function');
      expect(typeof prisma.$disconnect).toBe('function');
    });

    it('returns the same object on repeated static imports (singleton)', async () => {
      const { prisma: p2 } = await import('../index');
      expect(p2).toBe(prisma);
    });
  });

  // ── initializeDatabase ────────────────────────────────────────────────────

  describe('initializeDatabase', () => {
    it('resolves with prisma on connect + SELECT 1 + user.count success', async () => {
      mockConnect.mockResolvedValueOnce(undefined);
      mockExecuteRaw.mockResolvedValueOnce(undefined);
      mockUserCount.mockResolvedValueOnce(5);

      const result = await initializeDatabase();

      expect(result).toBe(prisma);
      expect(mockConnect).toHaveBeenCalledOnce();
    });

    it('returns prisma when SELECT 1 (executeRaw) rejects', async () => {
      mockConnect.mockResolvedValueOnce(undefined);
      mockExecuteRaw.mockRejectedValueOnce(new Error('no such table'));

      await expect(initializeDatabase()).resolves.toBe(prisma);
    });

    it('returns prisma when user.count rejects (migration not yet run)', async () => {
      mockConnect.mockResolvedValueOnce(undefined);
      mockExecuteRaw.mockResolvedValueOnce(undefined);
      mockUserCount.mockRejectedValueOnce(new Error('table does not exist'));

      await expect(initializeDatabase()).resolves.toBe(prisma);
    });

    it('returns prisma after all 10 retries exhaust without throwing', async () => {
      mockConnect.mockRejectedValue(new Error('ECONNREFUSED'));

      vi.useFakeTimers();
      const promise = initializeDatabase();
      await vi.runAllTimersAsync();
      vi.useRealTimers();

      await expect(promise).resolves.toBe(prisma);
    }, 15_000);
  });

  // ── disconnectDatabase ────────────────────────────────────────────────────

  describe('disconnectDatabase', () => {
    it('stops metrics and calls prisma.$disconnect', async () => {
      mockDisconnect.mockResolvedValueOnce(undefined);

      await disconnectDatabase();

      expect(mockMetricsStop).toHaveBeenCalledOnce();
      expect(mockDisconnect).toHaveBeenCalledOnce();
    });

    it('does not rethrow when prisma.$disconnect rejects', async () => {
      mockDisconnect.mockRejectedValueOnce(new Error('busy'));

      await expect(disconnectDatabase()).resolves.toBeUndefined();
    });
  });

  // ── checkDatabaseHealth ───────────────────────────────────────────────────

  describe('checkDatabaseHealth', () => {
    it('returns healthy:true when $queryRaw resolves', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const h = await checkDatabaseHealth();

      expect(h.healthy).toBe(true);
      expect(h.message).toContain('accessible');
    });

    it('returns healthy:false when $queryRaw throws', async () => {
      mockQueryRaw.mockRejectedValueOnce(new Error('DB offline'));

      const h = await checkDatabaseHealth();

      expect(h.healthy).toBe(false);
      expect(h.message).toContain('not accessible');
    });
  });
});
