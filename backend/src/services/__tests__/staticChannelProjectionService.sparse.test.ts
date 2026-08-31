/**
 * The DB half of the sparse forward fill.
 *
 * `planSparseCollapse` DROPS a gap frame from the segmentation queue, on the
 * strength of `sparseFill`. This module is the only thing that then gives that
 * frame a result. So the two have to agree on exactly which frames are gaps and
 * which anchor each one belongs to — if they resolve through different fields,
 * a container that has one and not the other loses those frames from BOTH
 * sides: never queued, never projected, sitting at `no_segmentation` forever
 * with nothing raising a word. `test_survives_a_missing_id_map` is that
 * invariant, and it is the reason this file exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  imageFindUnique,
  imageFindMany,
  imageUpdate,
  segFindUnique,
  segUpsert,
  segUpdate,
  txn,
} = vi.hoisted(() => ({
  imageFindUnique: vi.fn() as ReturnType<typeof vi.fn>,
  imageFindMany: vi.fn() as ReturnType<typeof vi.fn>,
  imageUpdate: vi.fn() as ReturnType<typeof vi.fn>,
  segFindUnique: vi.fn() as ReturnType<typeof vi.fn>,
  segUpsert: vi.fn() as ReturnType<typeof vi.fn>,
  // The static branch mints a trackId onto the anchor before projecting; the
  // sparse branch must never reach this (see the trackId suite).
  segUpdate: vi.fn() as ReturnType<typeof vi.fn>,
  txn: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock('../../db', () => ({
  prisma: {
    image: {
      findUnique: imageFindUnique,
      findMany: imageFindMany,
      update: imageUpdate,
    },
    segmentation: {
      findUnique: segFindUnique,
      upsert: segUpsert,
      update: segUpdate,
    },
    $transaction: txn,
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { projectStaticChannelResult } from '../staticChannelProjectionService';

const CONTAINER = 'container-1';

/** Refreshed every 3rd frame: 0, 3 and 6 are real, the rest read backwards. */
const SPARSE_FILL = { '1': 0, '2': 0, '4': 3, '5': 3, '7': 6, '8': 6 };

const FRAMES = Array.from({ length: 9 }, (_, i) => ({
  id: `f${i}`,
  frameIndex: i,
}));

const POLYGONS = JSON.stringify([
  { points: [{ x: 1, y: 2 }], trackId: 'mt_a' },
]);

function primeContainer(channel: Record<string, unknown>) {
  imageFindUnique.mockResolvedValue({ channels: [channel] });
}

/** The frame ids that were written a projected segmentation. */
function projectedTargets(): string[] {
  return segUpsert.mock.calls.map(
    c => (c[0] as { where: { imageId: string } }).where.imageId
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  imageFindMany.mockResolvedValue(FRAMES);
  segFindUnique.mockResolvedValue({
    polygons: POLYGONS,
    model: 'microtubule',
    threshold: 0.97,
    confidence: null,
    imageWidth: 64,
    imageHeight: 64,
  });
  txn.mockResolvedValue([]);
  imageUpdate.mockResolvedValue({});
  segUpdate.mockResolvedValue({});
  segUpsert.mockImplementation((a: unknown) => a);
});

describe('projectStaticChannelResult — sparse channel', () => {
  it('fills in only the gaps that read from THIS anchor', () => {
    primeContainer({
      name: 'irm',
      sparseSource: true,
      sparseFill: SPARSE_FILL,
    });

    return projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f3',
      channel: 'irm',
    }).then(outcome => {
      expect(projectedTargets()).toEqual(['f4', 'f5']);
      expect(outcome.projected).toBe(2);
    });
  });

  it('never suppresses the tracker for a sparse channel', async () => {
    // A static channel is one picture on every frame, so tracking has nothing
    // to do. A sparse one's REAL frames are genuinely different timepoints, so
    // the tracker still has to link them.
    primeContainer({
      name: 'irm',
      sparseSource: true,
      sparseFill: SPARSE_FILL,
    });

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'irm',
    });

    expect(outcome.projected).toBe(2);
    expect(outcome.applied).toBe(false);
  });

  it('does nothing when the completed frame is nobody’s anchor', async () => {
    primeContainer({
      name: 'irm',
      sparseSource: true,
      sparseFill: SPARSE_FILL,
    });

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f1',
      channel: 'irm',
    });

    expect(segUpsert).not.toHaveBeenCalled();
    expect(outcome.projected).toBe(0);
  });

  it('survives a missing id map — the frames the queue dropped still get filled', async () => {
    // THE invariant. `sparseFillFrameIds` is a rendering optimisation and may
    // be absent or partial (`withSparseFrameIds` omits a gap with no Image
    // row). If this resolution consulted it, those frames would be dropped from
    // the queue by `planSparseCollapse` and then never projected here.
    primeContainer({
      name: 'irm',
      sparseSource: true,
      sparseFill: SPARSE_FILL,
      // deliberately no sparseFillFrameIds
    });

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f6',
      channel: 'irm',
    });

    expect(projectedTargets()).toEqual(['f7', 'f8']);
    expect(outcome.projected).toBe(2);
  });

  it('carries the anchor’s trackId onto the gap frames', async () => {
    // The gap IS the anchor's pixels, so it is the same filament — not a match
    // for it. This is what makes identity exact instead of inferred.
    primeContainer({
      name: 'irm',
      sparseSource: true,
      sparseFill: SPARSE_FILL,
    });

    await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'irm',
    });

    const written = JSON.parse(
      (segUpsert.mock.calls[0][0] as { create: { polygons: string } }).create
        .polygons
    );
    expect(written[0].trackId).toBe('mt_a');
    expect(written[0].points).toEqual([{ x: 1, y: 2 }]);
  });

  it('ignores a channel that is not flagged sparse', async () => {
    primeContainer({ name: 'irm', sparseFill: SPARSE_FILL });

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'irm',
    });

    expect(segUpsert).not.toHaveBeenCalled();
    expect(outcome).toEqual({ applied: false, projected: 0, skipped: 0 });
  });

  it('still projects a STATIC channel onto every covered frame', async () => {
    // The pre-existing behaviour must be untouched by the sparse branch.
    primeContainer({ name: 'irm', staticSource: true });

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'irm',
    });

    expect(projectedTargets()).toEqual(FRAMES.slice(1).map(f => f.id));
    expect(outcome.applied).toBe(true);
  });
});
