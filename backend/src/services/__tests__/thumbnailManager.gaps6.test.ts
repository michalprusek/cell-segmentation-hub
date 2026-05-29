/**
 * thumbnailManager.gaps6.test.ts
 *
 * Covers lines 59 and 64 not hit by thumbnailManager.test.ts:
 *   59  — the per-item callback `id => this.generateAllThumbnails(id)` passed to processBatch
 *   64  — the onBatchComplete callback body (logger.info call)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';

const { state } = vi.hoisted(() => ({
  state: {
    executeWithRetry: vi.fn(),
    concurrencyExecute: vi.fn(),
    concurrencyGetStatus: vi.fn(),
    batchProcess: vi.fn(),
    generateSegmentationThumbnail: vi.fn(),
  },
}));

vi.mock('../../utils/retryService', () => {
  const RetryServiceMock: ReturnType<typeof vi.fn> = vi
    .fn()
    .mockImplementation(function (this: Record<string, unknown>) {
      this.executeWithRetry = (...args: unknown[]) =>
        state.executeWithRetry(...args);
    });
  (RetryServiceMock as Record<string, unknown>).isCommonRetriableError = vi.fn(
    () => true
  );
  return { RetryService: RetryServiceMock };
});

vi.mock('../../utils/concurrencyManager', () => ({
  ConcurrencyManager: vi
    .fn()
    .mockImplementation(function (this: Record<string, unknown>) {
      this.execute = (...args: unknown[]) => state.concurrencyExecute(...args);
      this.getStatus = () => state.concurrencyGetStatus();
    }),
}));

vi.mock('../../utils/batchProcessor', () => ({
  BatchProcessor: vi
    .fn()
    .mockImplementation(function (this: Record<string, unknown>) {
      this.processBatch = (...args: unknown[]) => state.batchProcess(...args);
    }),
}));

vi.mock('../segmentationThumbnailService', () => ({
  SegmentationThumbnailService: vi
    .fn()
    .mockImplementation(function (this: Record<string, unknown>) {
      this.generateSegmentationThumbnail = (id: string) =>
        state.generateSegmentationThumbnail(id);
    }),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ThumbnailManager } from '../thumbnailManager';
import { logger } from '../../utils/logger';
import type { PrismaClient } from '@prisma/client';

const fakePrisma = {} as PrismaClient;

describe('ThumbnailManager.generateBatchThumbnails — real callbacks', () => {
  let mgr: ThumbnailManager;

  beforeEach(() => {
    Object.values(state).forEach(fn => (fn as Mock).mockReset());
    mgr = new ThumbnailManager(fakePrisma);
  });

  it('per-item callback (line 59) calls generateAllThumbnails for each id', async () => {
    // Use real processBatch — capture the item function and call it
    state.batchProcess.mockImplementation(
      async (
        _ids: string[],
        itemFn: (id: string) => Promise<void>,
        _opts: unknown
      ) => {
        await itemFn('seg-abc');
      }
    );

    // generateAllThumbnails → generateImageThumbnailWithRetry → executeWithRetry
    state.executeWithRetry.mockImplementation(async (fn: () => unknown) =>
      fn()
    );
    state.concurrencyExecute.mockImplementation(async (fn: () => unknown) =>
      fn()
    );
    state.generateSegmentationThumbnail.mockResolvedValue('/thumb.jpg');

    await mgr.generateBatchThumbnails(['seg-abc']);

    expect(state.generateSegmentationThumbnail).toHaveBeenCalledWith('seg-abc');
  });

  it('onBatchComplete callback (line 64) logs a completion info message', async () => {
    // Invoke onBatchComplete with realistic arguments
    state.batchProcess.mockImplementation(
      async (
        _ids: string[],
        _itemFn: unknown,
        opts: { onBatchComplete?: (i: number, r: unknown[]) => void }
      ) => {
        opts.onBatchComplete?.(0, ['result-a', 'result-b']);
      }
    );

    (logger.info as Mock).mockClear();

    await mgr.generateBatchThumbnails(['a', 'b']);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Thumbnail batch 1 completed, 2 successful')
    );
  });
});
