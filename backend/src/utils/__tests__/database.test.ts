/**
 * Tests for src/utils/database.ts
 *
 *  - withTransaction:        first-attempt success, retry-on-deadlock/timeout
 *                            with exponential backoff, retry exhaustion,
 *                            immediate throw on non-retryable error.
 *  - batchOperation:         empty input, batching, default batch size.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  withTransaction,
  batchOperation,
} from '../database';
import { logger } from '../logger';

const mockLogger = logger as unknown as { info: ReturnType<typeof vi.fn> };

// ─── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Run `body` with `setTimeout` patched to fire its callback synchronously,
 * so the retry backoff delay in withTransaction doesn't slow the test down.
 */
async function withInstantTimers<T>(body: () => Promise<T>): Promise<T> {
  const orig = global.setTimeout;
  global.setTimeout = ((fn: () => void) => {
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as never;
  try {
    return await body();
  } finally {
    global.setTimeout = orig;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── withTransaction ─────────────────────────────────────────────────────────

describe('withTransaction', () => {
  it('returns result on first attempt', async () => {
    const mockTx = {};
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(mockTx)
        ),
    };

    const result = await withTransaction(
      prisma as never,
      async () => 'success',
      {}
    );

    expect(result).toBe('success');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('retries on a deadlock error and succeeds on the next attempt', async () => {
    await withInstantTimers(async () => {
      const prismaError = new Error('concurrent deadlock detected');
      const mockTx = {};
      let callCount = 0;
      const prisma = {
        $transaction: vi
          .fn()
          .mockImplementation(
            async (callback: (tx: unknown) => Promise<unknown>) => {
              callCount++;
              if (callCount < 2) throw prismaError;
              return callback(mockTx);
            }
          ),
      };

      const result = await withTransaction(
        prisma as never,
        async () => 'ok',
        {},
        3
      );

      expect(result).toBe('ok');
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  it('throws after exhausting all retries on a timeout error', async () => {
    await withInstantTimers(async () => {
      const prismaError = new Error('timeout - transaction timed out');
      const prisma = {
        $transaction: vi.fn().mockRejectedValue(prismaError),
      };

      await expect(
        withTransaction(prisma as never, async () => 'ok', {}, 2)
      ).rejects.toThrow('timeout');

      // retries=2 → 2 total attempts
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  it('throws immediately on a non-retryable error without retrying', async () => {
    const prismaError = new Error('Unique constraint violation');
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(prismaError),
    };

    await expect(
      withTransaction(prisma as never, async () => 'ok', {}, 3)
    ).rejects.toThrow('Unique constraint violation');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ─── batchOperation ──────────────────────────────────────────────────────────

describe('batchOperation', () => {
  it('returns empty array for empty input', async () => {
    const result = await batchOperation<number, number>([], async x => x, 5);
    expect(result).toEqual([]);
  });

  it('processes all items in order across batches', async () => {
    const result = await batchOperation(
      [1, 2, 3, 4, 5],
      async (x: number) => x * 2,
      2 // batchSize
    );
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });

  it('uses default batchSize of 10', async () => {
    const items = Array.from({ length: 15 }, (_, i) => i + 1);
    const result = await batchOperation(items, async x => x);
    expect(result).toHaveLength(15);
  });
});

