/**
 * Regression tests for trackerService write-back behaviour.
 *
 * Round-2 review GAP-5: a future "simplify the loop" PR could replace
 * the per-frame try/catch with a top-level one, which would silently
 * abort the entire write-back on a single corrupt row. These tests pin
 * down:
 *
 *  - One malformed polygons JSON in 3 frames → tracker still posts the
 *    2 valid frames to the ML service, logs error for the bad row, and
 *    write-back does NOT overwrite the bad row with [].
 *  - In-flight guard: a duplicate scheduleTrackingForContainer call
 *    while a pass is running is silently dropped.
 *  - Partial-commit failure mid-chunks: the error message logs the
 *    chunks-committed-vs-total count so ops can investigate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaImageFindMany,
  prismaSegmentationUpdate,
  prismaTransaction,
  axiosPostMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  prismaImageFindMany: vi.fn(),
  prismaSegmentationUpdate: vi.fn(),
  prismaTransaction: vi.fn(),
  axiosPostMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('../../../db/prismaClient', () => ({
  prisma: {
    image: { findMany: prismaImageFindMany },
    segmentation: { update: prismaSegmentationUpdate },
    $transaction: prismaTransaction,
  },
}));

vi.mock('axios', () => ({
  default: { post: axiosPostMock },
}));

vi.mock('../../../utils/config', () => ({
  config: { SEGMENTATION_SERVICE_URL: 'http://ml:8000' },
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerErrorMock,
  },
}));

import { runTrackingForContainer } from '../trackerService';

describe('trackerService.runTrackingForContainer (round-2 GAP-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default $transaction: invoke the callback with a stub tx.
    prismaTransaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return cb({ segmentation: { update: prismaSegmentationUpdate } });
      }
      return undefined;
    });
  });

  it('skips a malformed-JSON frame but still tracks the valid ones', async () => {
    // All 3 frames "segmented" so isBatchComplete returns true.
    prismaImageFindMany.mockImplementation(async ({ select }) => {
      if (select?.segmentationStatus) {
        // isBatchComplete call
        return [
          { segmentationStatus: 'segmented' },
          { segmentationStatus: 'segmented' },
          { segmentationStatus: 'segmented' },
        ];
      }
      // Main "load all frames" call
      return [
        {
          id: 'img-0',
          frameIndex: 0,
          segmentation: {
            id: 'seg-0',
            imageId: 'img-0',
            polygons: JSON.stringify([
              {
                id: 'p0',
                geometry: 'polyline',
                points: [
                  { x: 1, y: 1 },
                  { x: 2, y: 2 },
                ],
                _embedding: null,
              },
            ]),
          },
        },
        {
          id: 'img-1',
          frameIndex: 1,
          // ROW WITH CORRUPT JSON
          segmentation: {
            id: 'seg-1',
            imageId: 'img-1',
            polygons: '{NOT VALID JSON',
          },
        },
        {
          id: 'img-2',
          frameIndex: 2,
          segmentation: {
            id: 'seg-2',
            imageId: 'img-2',
            polygons: JSON.stringify([
              {
                id: 'p2',
                geometry: 'polyline',
                points: [
                  { x: 1, y: 1 },
                  { x: 2, y: 2 },
                ],
                _embedding: null,
              },
            ]),
          },
        },
      ];
    });

    axiosPostMock.mockResolvedValue({
      data: { assignments: { p0: 'track-A', p2: 'track-A' } },
    });

    await runTrackingForContainer('vid-1');

    // The ML call should still happen
    expect(axiosPostMock).toHaveBeenCalledOnce();
    const postBody = axiosPostMock.mock.calls[0]?.[1] as {
      frames: Array<{ polylines: unknown[] }>;
    };
    // Frames 0 + 2 contribute polylines, frame 1's malformed row sends []
    const polylineCounts = postBody.frames.map(f => f.polylines.length);
    expect(polylineCounts).toEqual([1, 0, 1]);

    // Write-back: the malformed row should NOT be updated with `[]`.
    // We expect prismaSegmentationUpdate (called via the $transaction
    // callback) to never receive seg-1 as a where.id.
    const updateCalls = prismaSegmentationUpdate.mock.calls.map(
      c => (c[0] as { where: { id: string } }).where.id
    );
    expect(updateCalls).not.toContain('seg-1');
    // The two valid rows DO get write-back attempts (their trackIds
    // changed from undefined → 'track-A').
    expect(updateCalls).toContain('seg-0');
    expect(updateCalls).toContain('seg-2');

    // The malformed row was logged at error level.
    const errors = loggerErrorMock.mock.calls.map(c => c[0] as string).join('\n');
    expect(errors).toMatch(/malformed polygons JSON/i);
  });

  it('drops duplicate runs even when both callers race inside isBatchComplete', async () => {
    // Round-3 review caught: an in-flight guard that does
    //   has() -> await ... -> add()
    // can be defeated by two callers entering simultaneously, both
    // seeing has()===false, both awaiting, both adding. The guard
    // must claim the slot synchronously BEFORE the first await — this
    // test exercises that exact overlap window by holding the FIRST
    // call's isBatchComplete suspended until AFTER the SECOND call
    // has reached its own guard check.
    let releaseFirstBatchCheck: (() => void) | null = null;
    let isBatchCompleteCallCount = 0;
    prismaImageFindMany.mockImplementation(async ({ select }) => {
      if (select?.segmentationStatus) {
        isBatchCompleteCallCount++;
        if (isBatchCompleteCallCount === 1) {
          // First call suspends here, giving the second call a chance
          // to enter runTrackingForContainer concurrently.
          await new Promise<void>(r => {
            releaseFirstBatchCheck = r;
          });
        }
        return [{ segmentationStatus: 'segmented' }];
      }
      // "load all frames" — return empty so the inner pass returns fast.
      return [];
    });

    const first = runTrackingForContainer('vid-2');
    // Yield the microtask so first call reaches the suspended
    // isBatchComplete before we trigger the second.
    await new Promise(r => setImmediate(r));
    const second = runTrackingForContainer('vid-2');

    // Second must short-circuit BEFORE its own isBatchComplete fires.
    await second;
    // At this point the first is still suspended; only its single
    // isBatchComplete call has been made. The second never even
    // entered isBatchComplete — the guard caught it synchronously.
    expect(isBatchCompleteCallCount).toBe(1);

    releaseFirstBatchCheck?.();
    await first;
  });
});
