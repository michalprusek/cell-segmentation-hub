/**
 * A static channel's frames must come out of the projection with a cross-frame
 * identity — the same `trackId` on the same filament in every frame, the anchor
 * included.
 *
 * WHY THIS FILE EXISTS. `collapseStaticChannelFrames` segments ONE frame and
 * `projectStaticChannelResult` copies its polylines onto the rest, then reports
 * `applied: true` so `queueService` does NOT schedule the tracker. The comment
 * that licensed that said the copies carry "the source frame's trackId" — but
 * the model emits no `track_id` (only `trackerService` writes the field), so
 * the source frame had none and the copies carried nothing. Measured read-only
 * on production container 4972cad8 (project CH5_DO4, an IRM channel glued onto
 * every frame with "Add channel") on 2026-08-31:
 *
 *     299 segmentation rows, 17 940 polylines, 0 with a trackId,
 *     all 299 polygon payloads byte-identical (md5 47038bc3…).
 *
 * Downstream, `PolygonContextMenu` computes `hasTrack = isMicrotubules &&
 * !!trackId`, so every cross-frame operation on that video — delete track,
 * propagate, kymograph — silently degraded to a single-frame one. That is the
 * user report ("nefunguje mi to u videa kde mám přilepený irm channel").
 *
 * The fixtures below use the field set of that container's real rows, not a
 * convenient one: `id: polyline_N`, an `instanceId` (which is per-inference and
 * NOT a cross-frame identity), `geometry: 'polyline'`, and no `trackId`.
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

const CONTAINER = '4972cad8-21e9-4e67-a568-6de5f982fcfc';

/** Ten frames stands in for the real 299 — the projection is per-frame. */
const FRAMES = Array.from({ length: 10 }, (_, i) => ({
  id: `f${i}`,
  frameIndex: i,
}));

interface RawPolyline {
  id: string;
  points: { x: number; y: number }[];
  geometry: string;
  class: string;
  instanceId: string;
  confidence: number;
  trackId?: string;
}

/** The real per-polyline field set, 60 of them as on the production frame. */
function modelOutput(count = 60): RawPolyline[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `polyline_${i + 1}`,
    points: [
      { x: 1786 - i, y: 34 + i },
      { x: 1769.18 - i, y: 37.462032318115234 + i },
    ],
    geometry: 'polyline',
    class: 'microtubule',
    instanceId: `mt_${(0xa01c27c9 + i).toString(16)}`,
    confidence: 1,
  }));
}

function primeContainer(channel: Record<string, unknown>) {
  imageFindUnique.mockResolvedValue({ channels: [channel] });
}

function primeSource(polygons: RawPolyline[]) {
  segFindUnique.mockResolvedValue({
    polygons: JSON.stringify(polygons),
    model: 'microtubule',
    threshold: 0.97,
    confidence: null,
    imageWidth: 1924,
    imageHeight: 1476,
  });
}

/** Frame id -> the polylines actually written to it. */
function writtenByFrame(): Map<string, RawPolyline[]> {
  const out = new Map<string, RawPolyline[]>();
  for (const call of segUpsert.mock.calls) {
    const arg = call[0] as {
      where: { imageId: string };
      create: { polygons: string };
      update: { polygons: string };
    };
    // create and update carry the same payload; either proves the write.
    expect(arg.create.polygons).toBe(arg.update.polygons);
    out.set(arg.where.imageId, JSON.parse(arg.create.polygons));
  }
  return out;
}

/** The polylines written back onto the anchor frame itself. */
function writtenToAnchor(): RawPolyline[] {
  expect(segUpdate).toHaveBeenCalledTimes(1);
  const arg = segUpdate.mock.calls[0][0] as {
    where: { imageId: string };
    data: { polygons: string };
  };
  expect(arg.where).toEqual({ imageId: 'f0' });
  return JSON.parse(arg.data.polygons);
}

beforeEach(() => {
  vi.clearAllMocks();
  imageFindMany.mockResolvedValue(FRAMES);
  primeSource(modelOutput());
  txn.mockResolvedValue([]);
  imageUpdate.mockResolvedValue({});
  segUpdate.mockResolvedValue({});
  segUpsert.mockImplementation((a: unknown) => a);
});

describe('projectStaticChannelResult — cross-frame identity on a static channel', () => {
  it('leaves EVERY polyline of EVERY frame with a trackId', async () => {
    // The production shape exactly: `staticSource`, full coverage, no
    // `staticShifts` (the channel was added without alignment).
    primeContainer({ name: 'IRM', staticSource: true, pngBacked: true });

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'IRM',
    });

    expect(outcome.applied).toBe(true);
    expect(outcome.projected).toBe(9);

    const written = writtenByFrame();
    expect([...written.keys()]).toEqual(FRAMES.slice(1).map(f => f.id));
    for (const [frameId, polys] of written) {
      expect(polys).toHaveLength(60);
      const missing = polys.filter(p => !p.trackId);
      expect(missing, `frame ${frameId} has untracked polylines`).toEqual([]);
    }
  });

  it('gives the ANCHOR frame the same ids, not just its copies', async () => {
    // The frame that produced the result is a frame the user opens too. If it
    // alone lacks the ids, a right-click there still finds no track.
    primeContainer({ name: 'IRM', staticSource: true });

    await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'IRM',
    });

    const anchor = writtenToAnchor();
    const anchorIds = anchor.map(p => p.trackId);
    expect(anchorIds.every(id => typeof id === 'string' && id.length > 0)).toBe(
      true
    );
    for (const polys of writtenByFrame().values()) {
      expect(polys.map(p => p.trackId)).toEqual(anchorIds);
    }
  });

  it('keeps one filament on one id across all 10 frames', async () => {
    // THE cross-frame invariant. Per-frame ids would render as ten separate
    // one-frame tracks and colour-flicker on every scrub.
    primeContainer({ name: 'IRM', staticSource: true });

    await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'IRM',
    });

    const frames = [writtenToAnchor(), ...writtenByFrame().values()];
    for (let i = 0; i < 60; i++) {
      const ids = new Set(frames.map(f => f[i].trackId));
      expect(ids.size, `polyline_${i + 1} split across frames`).toBe(1);
    }
  });

  it('gives the 60 filaments 60 different ids', async () => {
    // The other half: one id shared by two filaments merges them into one
    // track, and a delete-track would then take both.
    primeContainer({ name: 'IRM', staticSource: true });

    await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'IRM',
    });

    expect(new Set(writtenToAnchor().map(p => p.trackId)).size).toBe(60);
  });

  it('mints an id that is not the per-inference instanceId', async () => {
    // `instanceId` is regenerated per inference (failure pattern #4); reusing
    // it as a cross-frame identity is exactly the mistake it documents.
    primeContainer({ name: 'IRM', staticSource: true });

    await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'IRM',
    });

    const anchor = writtenToAnchor();
    expect(anchor.every(p => p.trackId !== p.instanceId)).toBe(true);
    // …and `trackId` is the ONLY thing the minting added.
    const source = modelOutput();
    anchor.forEach((p, i) => {
      expect(Object.keys(p).sort()).toEqual(
        [...Object.keys(source[i]), 'trackId'].sort()
      );
      expect(p.points).toEqual(source[i].points);
      expect(p.instanceId).toBe(source[i].instanceId);
      expect(p.id).toBe(source[i].id);
    });
  });

  it('carries identity across an ALIGNED channel, where geometry moves', async () => {
    // With alignment on, each copy is translated by a known amount. The shift
    // must reach the points and NOT the identity.
    primeContainer({
      name: 'IRM',
      staticSource: true,
      staticShifts: { f0: [0, 0], f1: [3, -2] },
    });

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'IRM',
    });

    // Only f1 has a recorded shift; the rest are left to segment normally.
    expect(outcome.projected).toBe(1);
    expect(outcome.skipped).toBe(8);
    const f1 = writtenByFrame().get('f1');
    const anchor = writtenToAnchor();
    expect(f1?.map(p => p.trackId)).toEqual(anchor.map(p => p.trackId));
    expect(f1?.[0].points[0]).toEqual({ x: 1786 - 2, y: 34 + 3 });
  });

  it('mints nothing when alignment left no target projectable', async () => {
    // `addChannelService` warns when alignment fails for most of a channel's
    // frames, so a channel whose only recorded shift is the anchor's is a real
    // outcome. Nothing gets projected, the tracker runs — and the anchor must
    // NOT be left holding 60 ids that exist on no other frame.
    primeContainer({
      name: 'IRM',
      staticSource: true,
      staticShifts: { f0: [0, 0] },
    });

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'IRM',
    });

    expect(segUpdate).not.toHaveBeenCalled();
    expect(segUpsert).not.toHaveBeenCalled();
    expect(outcome).toEqual({ applied: false, projected: 0, skipped: 0 });
  });

  it('keeps an id the user propagated by hand and mints only the rest', async () => {
    const polys = modelOutput(3);
    polys[1].trackId = 'mt_userpicked';
    primeSource(polys);
    primeContainer({ name: 'IRM', staticSource: true });

    await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'IRM',
    });

    const anchor = writtenToAnchor();
    expect(anchor[1].trackId).toBe('mt_userpicked');
    expect(new Set(anchor.map(p => p.trackId)).size).toBe(3);
  });

  it('does not rewrite the anchor when every polyline is already tracked', async () => {
    // A resegment of a container the tracker had already been over. Nothing to
    // mint means nothing to write — the extra UPDATE would only bump
    // `updatedAt` and wake the editor's poll for no reason.
    const polys = modelOutput(3).map((p, i) => ({ ...p, trackId: `track_${i}` }));
    primeSource(polys);
    primeContainer({ name: 'IRM', staticSource: true });

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'IRM',
    });

    expect(segUpdate).not.toHaveBeenCalled();
    expect(outcome.applied).toBe(true);
    for (const written of writtenByFrame().values()) {
      expect(written.map(p => p.trackId)).toEqual([
        'track_0',
        'track_1',
        'track_2',
      ]);
    }
  });

  it('projects nothing when the anchor write-back fails', async () => {
    // Degrade the way the rest of this module degrades: leave the frames to
    // the ordinary segment-then-track path rather than scatter ids the anchor
    // does not carry.
    primeContainer({ name: 'IRM', staticSource: true });
    segUpdate.mockRejectedValue(new Error('deadlock detected'));

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'IRM',
    });

    expect(segUpsert).not.toHaveBeenCalled();
    expect(outcome).toEqual({ applied: false, projected: 0, skipped: 0 });
  });
});

describe('projectStaticChannelResult — the sparse branch is untouched', () => {
  const SPARSE = {
    name: 'Channel_1',
    sparseSource: true,
    sparseFill: { '1': 0, '2': 0, '4': 3, '5': 3 },
  };

  it('mints nothing: the tracker still runs and would overwrite it', async () => {
    primeContainer(SPARSE);

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'Channel_1',
    });

    expect(segUpdate).not.toHaveBeenCalled();
    expect(outcome.applied).toBe(false);
    expect([...writtenByFrame().keys()]).toEqual(['f1', 'f2']);
    // The gaps are copies of an anchor that has no id yet — by design, the
    // tracker that follows assigns one to both.
    for (const polys of writtenByFrame().values()) {
      expect(polys.every(p => p.trackId === undefined)).toBe(true);
    }
  });

  it('still carries an id the anchor DOES have onto its gaps', async () => {
    const polys = modelOutput(2).map((p, i) => ({ ...p, trackId: `track_${i}` }));
    primeSource(polys);
    primeContainer(SPARSE);

    await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'Channel_1',
    });

    expect(segUpdate).not.toHaveBeenCalled();
    for (const written of writtenByFrame().values()) {
      expect(written.map(p => p.trackId)).toEqual(['track_0', 'track_1']);
    }
  });
});

describe('projectStaticChannelResult — containers with no static channel', () => {
  it('writes nothing at all for a channel that is neither static nor sparse', async () => {
    primeContainer({ name: 'IRM' });

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'IRM',
    });

    expect(segUpdate).not.toHaveBeenCalled();
    expect(segUpsert).not.toHaveBeenCalled();
    expect(outcome).toEqual({ applied: false, projected: 0, skipped: 0 });
  });

  it('does not mint for a static channel whose coverage excludes every sibling', async () => {
    // Nothing to project means nothing to identify — and the tracker runs.
    primeContainer({ name: 'IRM', staticSource: true, frameIds: ['f0'] });

    const outcome = await projectStaticChannelResult({
      containerId: CONTAINER,
      sourceImageId: 'f0',
      channel: 'IRM',
    });

    expect(segUpdate).not.toHaveBeenCalled();
    expect(outcome.applied).toBe(false);
  });
});
