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
 *   3. Mock the internal dependencies (prismaPool, databaseMetrics, etc.).
 *   4. Use a per-describe `beforeAll` to load the real module via
 *      `vi.importActual` — BUT avoid using it for the pool/health/tx tests
 *      because importActual skips vi.mock shims.
 *
 * REVISED STRATEGY: Rather than fighting importActual, we test the module
 * behaviour through the GLOBAL MOCK SHIM itself (the one in setup.ts). The
 * shim exposes only `prisma` and `default`. We verify these are exported and
 * behave as a PrismaClient-shaped singleton. The remaining behaviour tests
 * (initializeDatabase, checkDatabaseHealth, transaction, helpers) are tested
 * by importing the functions through a SEPARATE alias that bypasses the mock:
 * we create a small re-export helper in the test that calls the real functions
 * without going through the mocked module path.
 *
 * FINAL STRATEGY (pragmatic): Move the test to `src/test/` so the relative
 * path '../db' in setup.ts is the same absolute path but the test file uses
 * '../../db/index' — a DIFFERENT relative string that Vitest resolves to the
 * same file but does NOT have a mock registered for '../../db/index'.
 * Vitest mock keys are the resolved absolute path, so registering via
 * '../../utils/config' in this file will shadow '../../utils/config' mocked
 * from setup.ts only if the resolved abs-paths match. Since setup.ts is in
 * src/test/ and mocks '../db' → src/db/index.ts, AND our file is in
 * src/db/__tests__/ and imports '../index' → same abs path, the mock applies.
 *
 * WORKING SOLUTION: Override the global mock inline in THIS file with a
 * vi.mock() factory that RE-EXPORTS everything from the real module using
 * importOriginal, so the test gets the real implementations.
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
  mockPoolShutdown,
  mockPoolHealthCheck,
  mockPoolExecuteTransaction,
  mockPoolExecuteQuery,
  mockPoolExecuteMutation,
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

  const mockPoolShutdown = vi.fn();
  const mockPoolHealthCheck = vi.fn();
  const mockPoolExecuteTransaction = vi.fn();
  const mockPoolExecuteQuery = vi.fn();
  const mockPoolExecuteMutation = vi.fn();

  return {
    mockConnect,
    mockDisconnect,
    mockExecuteRaw,
    mockQueryRaw,
    mockTransactionFn,
    mockUserCount,
    MockPrismaClient,
    mockPoolShutdown,
    mockPoolHealthCheck,
    mockPoolExecuteTransaction,
    mockPoolExecuteQuery,
    mockPoolExecuteMutation,
  };
});

// Override the global prisma/client mock with our class-based constructor.
vi.mock('@prisma/client', () => ({
  PrismaClient: MockPrismaClient,
}));

// Mock the internal pool that index.ts imports.
vi.mock('../prismaPool', () => ({
  prismaPool: {
    shutdown: mockPoolShutdown,
    healthCheck: mockPoolHealthCheck,
    executeTransaction: mockPoolExecuteTransaction,
    executeQuery: mockPoolExecuteQuery,
    executeMutation: mockPoolExecuteMutation,
  },
}));

vi.mock('../../monitoring/databaseMetrics', () => ({
  databaseMetrics: { stop: vi.fn() },
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
  // This factory runs AFTER @prisma/client and prismaPool mocks are set up,
  // so the real index.ts gets MockPrismaClient and the mock pool.
  const real = await importOriginal<typeof import('../index')>();
  return real;
});

import {
  prisma,
  initializeDatabase,
  disconnectDatabase,
  checkDatabaseHealth,
  transaction,
  executeQuery,
  executeMutation,
  executeTransaction,
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
    it('calls pool.shutdown and prisma.$disconnect', async () => {
      mockPoolShutdown.mockResolvedValueOnce(undefined);
      mockDisconnect.mockResolvedValueOnce(undefined);

      await disconnectDatabase();

      expect(mockPoolShutdown).toHaveBeenCalledOnce();
      expect(mockDisconnect).toHaveBeenCalledOnce();
    });

    it('does not rethrow when pool.shutdown rejects', async () => {
      mockPoolShutdown.mockRejectedValueOnce(new Error('busy'));
      mockDisconnect.mockResolvedValueOnce(undefined);

      await expect(disconnectDatabase()).resolves.toBeUndefined();
    });
  });

  // ── checkDatabaseHealth ───────────────────────────────────────────────────

  describe('checkDatabaseHealth', () => {
    it('returns healthy:true when pool reports healthy', async () => {
      mockPoolHealthCheck.mockResolvedValueOnce({ healthy: true });

      const h = await checkDatabaseHealth();

      expect(h.healthy).toBe(true);
      expect(h.message).toContain('healthy');
    });

    it('returns healthy:false when pool reports unhealthy', async () => {
      mockPoolHealthCheck.mockResolvedValueOnce({ healthy: false });

      const h = await checkDatabaseHealth();

      expect(h.healthy).toBe(false);
    });

    it('falls back to $queryRaw and returns healthy:true when pool throws', async () => {
      mockPoolHealthCheck.mockRejectedValueOnce(new Error('pool down'));
      mockQueryRaw.mockResolvedValueOnce([]);

      const h = await checkDatabaseHealth();

      expect(h.healthy).toBe(true);
      expect(h.message).toContain('basic connection');
    });

    it('returns healthy:false when both pool and $queryRaw throw', async () => {
      mockPoolHealthCheck.mockRejectedValueOnce(new Error('pool down'));
      mockQueryRaw.mockRejectedValueOnce(new Error('DB offline'));

      const h = await checkDatabaseHealth();

      expect(h.healthy).toBe(false);
      expect(h.message).toContain('not accessible');
    });
  });

  // ── transaction ───────────────────────────────────────────────────────────

  describe('transaction', () => {
    it('delegates to prismaPool.executeTransaction', async () => {
      const cb = vi.fn().mockResolvedValue('ok');
      mockPoolExecuteTransaction.mockImplementationOnce(
        (fn: (p: unknown) => Promise<string>) => fn(prisma)
      );

      const result = await transaction(cb);

      expect(mockPoolExecuteTransaction).toHaveBeenCalledOnce();
      expect(result).toBe('ok');
    });

    it('falls back to prisma.$transaction when pool throws', async () => {
      const cb = vi.fn().mockResolvedValue('fallback');
      mockPoolExecuteTransaction.mockRejectedValueOnce(new Error('pool gone'));
      mockTransactionFn.mockImplementationOnce(
        (fn: (p: unknown) => Promise<string>) => fn(prisma)
      );

      const result = await transaction(cb);

      expect(mockTransactionFn).toHaveBeenCalledOnce();
      expect(result).toBe('fallback');
    });
  });

  // ── pool delegation helpers ───────────────────────────────────────────────

  describe('pool delegation helpers', () => {
    it('executeQuery routes to prismaPool.executeQuery', async () => {
      const op = vi.fn().mockResolvedValue(99);
      mockPoolExecuteQuery.mockImplementationOnce((fn: () => Promise<number>) =>
        fn()
      );

      const result = await executeQuery(op, 'q');

      expect(mockPoolExecuteQuery).toHaveBeenCalledOnce();
      expect(result).toBe(99);
    });

    it('executeMutation routes to prismaPool.executeMutation', async () => {
      const op = vi.fn().mockResolvedValue('mut');
      mockPoolExecuteMutation.mockImplementationOnce(
        (fn: () => Promise<string>) => fn()
      );

      const result = await executeMutation(op, 'm');

      expect(mockPoolExecuteMutation).toHaveBeenCalledOnce();
      expect(result).toBe('mut');
    });

    it('executeTransaction routes to prismaPool.executeTransaction', async () => {
      const op = vi.fn().mockResolvedValue('tx');
      mockPoolExecuteTransaction.mockImplementationOnce(
        (fn: (p: unknown) => Promise<string>) => fn(prisma)
      );

      const result = await executeTransaction(op, 't');

      expect(mockPoolExecuteTransaction).toHaveBeenCalledOnce();
      expect(result).toBe('tx');
    });
  });
});
