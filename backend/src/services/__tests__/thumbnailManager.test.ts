import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';
import type { Mock } from 'vitest';

// `thumbnailManager` is a thin orchestrator: it wires RetryService +
// ConcurrencyManager + BatchProcessor + SegmentationThumbnailService.
// We mock all four collaborators and verify the orchestration logic
// (call routing, success/error propagation, batch fan-out) without
// exercising any real DB / filesystem code paths.
//
// Vitest 4 specifics:
// - shared mock state must live in `vi.hoisted` (vi.mock factories run
//   before any top-level statements);
// - constructor mocks (`new ConcurrencyManager(...)` etc.) must use
//   function-form `mockImplementation(function(this) { ... })` — arrow
//   form returns a non-constructable plain function.

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
  const RetryServiceMock: any = vi.fn().mockImplementation(function (this: any) {
    this.executeWithRetry = (...args: unknown[]) =>
      state.executeWithRetry(...args);
  });
  RetryServiceMock.isCommonRetriableError = vi.fn(() => true);
  return { RetryService: RetryServiceMock };
});

vi.mock('../../utils/concurrencyManager', () => ({
  ConcurrencyManager: vi.fn().mockImplementation(function (this: any) {
    this.execute = (...args: unknown[]) => state.concurrencyExecute(...args);
    this.getStatus = () => state.concurrencyGetStatus();
  }),
}));

vi.mock('../../utils/batchProcessor', () => ({
  BatchProcessor: vi.fn().mockImplementation(function (this: any) {
    this.processBatch = (...args: unknown[]) => state.batchProcess(...args);
  }),
}));

vi.mock('../segmentationThumbnailService', () => ({
  SegmentationThumbnailService: vi.fn().mockImplementation(function (this: any) {
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

// SUT must be imported AFTER all jest.mock declarations (which are hoisted).
import { ThumbnailManager } from '../thumbnailManager';
import { logger } from '../../utils/logger';
import type { PrismaClient } from '@prisma/client';

const fakePrisma = {} as PrismaClient;

describe('ThumbnailManager', () => {
  let mgr: ThumbnailManager;

  beforeEach(() => {
    state.executeWithRetry.mockReset();
    state.concurrencyExecute.mockReset();
    state.concurrencyGetStatus.mockReset();
    state.batchProcess.mockReset();
    state.generateSegmentationThumbnail.mockReset();
    mgr = new ThumbnailManager(fakePrisma);
  });

  describe('generateImageThumbnailWithRetry', () => {
    it('routes through RetryService → ConcurrencyManager → segmentationThumbnailService', async () => {
      // Arrange: each layer forwards the inner fn so we can assert routing.
      state.generateSegmentationThumbnail.mockResolvedValue(
        '/thumbs/seg-1.jpg'
      );
      state.concurrencyExecute.mockImplementation(async (fn: any) => fn());
      state.executeWithRetry.mockImplementation(async (fn: any) => fn());

      const result = await mgr.generateImageThumbnailWithRetry('seg-1');

      expect(state.executeWithRetry).toHaveBeenCalledTimes(1);
      expect(state.concurrencyExecute).toHaveBeenCalledTimes(1);
      expect(state.generateSegmentationThumbnail).toHaveBeenCalledWith('seg-1');
      expect(result).toBe('/thumbs/seg-1.jpg');
    });

    it('passes the documented retry config to RetryService', async () => {
      state.generateSegmentationThumbnail.mockResolvedValue(null);
      state.concurrencyExecute.mockImplementation(async (fn: any) => fn());
      state.executeWithRetry.mockImplementation(async (fn: any) => fn());

      await mgr.generateImageThumbnailWithRetry('seg-2');

      // Second arg to executeWithRetry is the retry config.
      const retryConfig = state.executeWithRetry.mock.calls[0]?.[1] as
        | Record<string, unknown>
        | undefined;
      expect(retryConfig).toMatchObject({
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2,
      });
      expect(retryConfig?.operationName).toEqual(
        expect.stringContaining('seg-2')
      );
    });

    it('propagates failures from the underlying thumbnail service', async () => {
      const boom = new Error('disk full');
      state.executeWithRetry.mockRejectedValueOnce(boom);

      await expect(
        mgr.generateImageThumbnailWithRetry('seg-3')
      ).rejects.toThrow('disk full');
    });
  });

  describe('generateAllThumbnails', () => {
    it('delegates to generateImageThumbnailWithRetry', async () => {
      // generateAllThumbnails is currently a one-line wrapper; this test
      // pins that contract so future fan-outs are conscious changes.
      state.executeWithRetry.mockResolvedValue('/thumbs/x.jpg');
      state.concurrencyExecute.mockImplementation(async (fn: any) => fn());

      await mgr.generateAllThumbnails('seg-x');

      expect(state.executeWithRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateBatchThumbnails', () => {
    it('hands the segmentation IDs to BatchProcessor with batchSize/concurrency=5', async () => {
      state.batchProcess.mockResolvedValue(undefined);

      await mgr.generateBatchThumbnails(['a', 'b', 'c']);

      expect(state.batchProcess).toHaveBeenCalledTimes(1);
      const [ids, _itemFn, opts] = state.batchProcess.mock.calls[0] ?? [];
      expect(ids).toEqual(['a', 'b', 'c']);
      expect(opts).toMatchObject({ batchSize: 5, concurrency: 5 });
    });

    it('logs (not throws) when an individual item fails inside the batch', async () => {
      // Capture the per-item error handler the manager passes down,
      // then invoke it ourselves to verify it routes to logger.error.
      state.batchProcess.mockImplementation(
        async (_ids: any, _fn: any, opts: any) => {
          opts.onItemError?.('seg-broken', new Error('write failed'));
        }
      );
      (logger.error as Mock).mockClear();

      await mgr.generateBatchThumbnails(['seg-broken']);

      expect(logger.error).toHaveBeenCalledTimes(1);
      const [msg, err] = (logger.error as Mock).mock.calls[0] ?? [];
      expect(msg).toEqual(expect.stringContaining('seg-broken'));
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('getConcurrencyStatus', () => {
    it('forwards to ConcurrencyManager.getStatus', () => {
      state.concurrencyGetStatus.mockReturnValue({ active: 2, queued: 0 });
      expect(mgr.getConcurrencyStatus()).toEqual({ active: 2, queued: 0 });
      expect(state.concurrencyGetStatus).toHaveBeenCalledTimes(1);
    });
  });
});
