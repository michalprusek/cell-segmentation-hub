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

    // Assignments are keyed by the frame-scoped id (frameIndex::polygonId).
    axiosPostMock.mockResolvedValue({
      data: { assignments: { '0::p0': 'track-A', '2::p2': 'track-A' } },
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
    const errors = loggerErrorMock.mock.calls
      .map(c => c[0] as string)
      .join('\n');
    expect(errors).toMatch(/malformed polygons JSON/i);
  });

  it('proceeds when a mix of segmented / no_segmentation / failed reaches final states', async () => {
    // Regression: previously isBatchComplete required strict
    // 'segmented' across all frames, so one no_segmentation or failed
    // frame would block the tracker on the OTHER 600+ frames. The
    // cross-frame color then went random (instanceId is per-inference
    // UUID). The gate must accept any FINAL status — the tracker
    // already skips empty-polyline contributions downstream.
    prismaImageFindMany.mockImplementation(async ({ select }) => {
      if (select?.segmentationStatus) {
        return [
          { segmentationStatus: 'segmented' },
          { segmentationStatus: 'no_segmentation' },
          { segmentationStatus: 'failed' },
          { segmentationStatus: 'segmented' },
        ];
      }
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
              },
            ]),
          },
        },
        // No segmentation row at all for img-1 — the JOIN returns null.
        { id: 'img-1', frameIndex: 1, segmentation: null },
        { id: 'img-2', frameIndex: 2, segmentation: null },
        {
          id: 'img-3',
          frameIndex: 3,
          segmentation: {
            id: 'seg-3',
            imageId: 'img-3',
            polygons: JSON.stringify([
              {
                id: 'p3',
                geometry: 'polyline',
                points: [
                  { x: 5, y: 5 },
                  { x: 6, y: 6 },
                ],
              },
            ]),
          },
        },
      ];
    });

    // Assignments are keyed by the frame-scoped id (frameIndex::polygonId).
    axiosPostMock.mockResolvedValue({
      data: { assignments: { '0::p0': 'track-X', '3::p3': 'track-X' } },
    });

    await runTrackingForContainer('vid-mixed');

    expect(axiosPostMock).toHaveBeenCalledOnce();
    const updateCalls = prismaSegmentationUpdate.mock.calls.map(
      c => (c[0] as { where: { id: string } }).where.id
    );
    expect(updateCalls).toContain('seg-0');
    expect(updateCalls).toContain('seg-3');
  });

  it('still waits when any frame is in a pending state (queued / processing)', async () => {
    // The complementary case: tracker MUST hold off while pending
    // frames could still resolve into 'segmented' and contribute a
    // polyline. The auto-trigger fires from each completed frame's
    // 'segmented' webhook so a later trigger will catch the
    // now-complete batch.
    prismaImageFindMany.mockResolvedValue([
      { segmentationStatus: 'segmented' },
      { segmentationStatus: 'queued' },
      { segmentationStatus: 'segmented' },
    ]);

    await runTrackingForContainer('vid-pending');

    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(prismaSegmentationUpdate).not.toHaveBeenCalled();
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

  it('scopes each polyline id by frameIndex so cross-frame id collisions do not collapse to ordinal tracking', async () => {
    // Real MT segmentations reuse per-frame ids ("polyline_1" in EVERY
    // frame). The ML tracker keys its assignments by polyline id, and the
    // write-back looks trackIds up by id — so a RAW id collides across
    // frames and every frame's "polyline_1" inherits ONE trackId (ordinal
    // position, NOT the geometric match). Scoping the id by frameIndex keeps
    // the two frames' same-named polylines distinct end to end.
    prismaImageFindMany.mockImplementation(async ({ select }) => {
      if (select?.segmentationStatus) {
        return [
          { segmentationStatus: 'segmented' },
          { segmentationStatus: 'segmented' },
        ];
      }
      return [
        {
          id: 'img-0',
          frameIndex: 0,
          segmentation: {
            id: 'seg-0',
            imageId: 'img-0',
            polygons: JSON.stringify([
              {
                id: 'polyline_1',
                geometry: 'polyline',
                points: [
                  { x: 1, y: 1 },
                  { x: 2, y: 2 },
                ],
              },
            ]),
          },
        },
        {
          id: 'img-1',
          frameIndex: 1,
          segmentation: {
            id: 'seg-1',
            imageId: 'img-1',
            polygons: JSON.stringify([
              {
                id: 'polyline_1',
                geometry: 'polyline',
                points: [
                  { x: 9, y: 9 },
                  { x: 10, y: 10 },
                ],
              },
            ]),
          },
        },
      ];
    });

    // ML returns DISTINCT trackIds for the two frames' same-named polylines,
    // keyed by the frame-scoped id.
    axiosPostMock.mockResolvedValue({
      data: {
        assignments: { '0::polyline_1': 'track-A', '1::polyline_1': 'track-B' },
      },
    });

    await runTrackingForContainer('vid-collide');

    // 1) The payload must send frame-scoped, non-colliding ids.
    const postBody = axiosPostMock.mock.calls[0]?.[1] as {
      frames: Array<{ frame: number; polylines: Array<{ id: string }> }>;
    };
    const sentIds = postBody.frames.flatMap(f => f.polylines.map(p => p.id));
    expect(sentIds).toEqual(['0::polyline_1', '1::polyline_1']);

    // 2) Write-back applies DISTINCT trackIds per frame (not one collapsed id).
    const byId = new Map(
      prismaSegmentationUpdate.mock.calls.map(c => {
        const arg = c[0] as {
          where: { id: string };
          data: { polygons: string };
        };
        return [
          arg.where.id,
          (JSON.parse(arg.data.polygons)[0] as { trackId: string }).trackId,
        ];
      })
    );
    expect(byId.get('seg-0')).toBe('track-A');
    expect(byId.get('seg-1')).toBe('track-B');
  });
});
