/**
 * database.gaps6.test.ts
 *
 * Covers cleanupOrphanedRecords (lines 147-177) not covered by database.gaps5.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { cleanupOrphanedRecords } from '../database';
import { logger } from '../logger';

const mockLogger = logger as unknown as { info: ReturnType<typeof vi.fn> };

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    segmentation: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    segmentationQueue: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  };

  return {
    $transaction: vi
      .fn()
      .mockImplementation(
        async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx)
      ),
    _tx: tx,
  };
}

describe('cleanupOrphanedRecords()', () => {
  it('executes all three cleanup statements inside a transaction', async () => {
    const prisma = buildPrisma();

    await cleanupOrphanedRecords(prisma as never);

    expect(prisma._tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma._tx.segmentation.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ image: { is: null } }),
      })
    );
    expect(prisma._tx.segmentationQueue.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: expect.any(Array) }),
      })
    );
  });

  it('logs completion message after successful cleanup', async () => {
    const prisma = buildPrisma();

    await cleanupOrphanedRecords(prisma as never);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Orphaned records cleanup completed',
      'Database'
    );
  });

  it('propagates error when transaction fails with non-retryable error', async () => {
    const prisma = {
      $transaction: vi
        .fn()
        .mockRejectedValue(new Error('Unique constraint violation')),
    };

    await expect(
      cleanupOrphanedRecords(prisma as never)
    ).rejects.toThrow('Unique constraint violation');
  });

  it('deletes queue items older than 7 days with completed/failed status', async () => {
    const prisma = buildPrisma();

    await cleanupOrphanedRecords(prisma as never);

    const call = prisma._tx.segmentationQueue.deleteMany.mock.calls[0][0];
    const andClause = call.where.AND as Array<Record<string, unknown>>;

    // First condition: status in completed/failed
    expect(andClause[0]).toEqual({
      status: { in: ['completed', 'failed'] },
    });

    // Second condition: completedAt before 7 days ago (approximate check)
    const cutoff = (andClause[1] as { completedAt: { lt: Date } }).completedAt
      .lt;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThan(sevenDaysAgo - 5000);
    expect(cutoff.getTime()).toBeLessThan(sevenDaysAgo + 5000);
  });
});
