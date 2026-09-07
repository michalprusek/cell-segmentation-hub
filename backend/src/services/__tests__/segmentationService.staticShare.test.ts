/**
 * A manual save onto a frame of a STATIC-source channel is shared with every
 * other frame of the container.
 *
 * WHY THIS FILE EXISTS. `ChannelMeta.staticSource` means one picture was
 * stamped onto every frame the channel covers — an IRM snapshot glued over a
 * 300-frame fluorescence time-lapse. Every frame's segmentation is therefore a
 * segmentation of the SAME image, and `queueService` has treated it that way
 * for machine segmentation since 2026-08 (`projectStaticChannelResult` right
 * after a queue item completes). Nothing did for a MANUAL edit, so a user's
 * correction stayed on the frame they made it on. Measured read-only on
 * production, 2026-09-07:
 *
 *   container 5ac61392  frame 0: 67 polylines, frames 1-299: 68
 *                       (one track deleted on frame 0 alone)
 *   container aafdf846  frame 0: 146 = 125 tracked + 21 with NO trackId,
 *                       frames 1-298: 125
 *                       (21 microtubules hand-drawn on frame 0 alone)
 *
 * The user's workaround was 21 consecutive `tracks/propagate` calls at ~4 s
 * each — 73 s of waiting, and additive, so a deletion could not be shared at
 * all.
 *
 * The fixtures below use that container's real channel record, flags and all,
 * not a convenient one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { SegmentationService } from '../segmentationService';
import type { ImageService } from '../imageService';

const projectStaticChannelResult = vi.hoisted(() => vi.fn());

vi.mock('../staticChannelProjectionService', () => ({
  projectStaticChannelResult,
}));
vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    STORAGE_TYPE: 'local',
    UPLOAD_DIR: '/tmp/uploads',
    NODE_ENV: 'test',
  },
}));
vi.mock('../../storage');
vi.mock('../segmentationThumbnailService');
vi.mock('../thumbnailManager', () => ({
  ThumbnailManager: function MockThumbnailManager(this: any) {
    this.generateAllThumbnails = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('../imageService');

// ─── fixtures ────────────────────────────────────────────────────────────────

/** Denisa's container, verbatim: one IRM frame glued onto 300 fluorescent ones. */
const IRM_STATIC = {
  name: 'IRM',
  type: 'irm',
  pngBacked: true,
  staticSource: true,
  wavelengthNm: 510,
  isSegmentationSource: true,
};

/** The SAME channel with the one flag that decides this removed. */
const IRM_NOT_STATIC = { ...IRM_STATIC, staticSource: false };

const FLUORESCENT = {
  name: '488_nm',
  type: 'fluorescent',
  isSegmentationSource: false,
};

/**
 * A sparse channel: the microscope refreshed IRM every third frame, so the
 * frames in between hold no acquisition. Deliberately NOT shared — its real
 * frames are genuinely different timepoints.
 */
const IRM_SPARSE = {
  name: 'IRM',
  type: 'irm',
  sparseSource: true,
  sparseFill: { '1': 0, '2': 0 },
  isSegmentationSource: true,
};

const polyline = (extra: Record<string, unknown> = {}) => ({
  id: `polyline_${Math.random().toString(36).slice(2, 8)}`,
  points: [
    { x: 1786, y: 34 },
    { x: 1769.18, y: 37.46 },
  ],
  area: 0,
  confidence: 1,
  type: 'external' as const,
  geometry: 'polyline' as const,
  class: 'microtubule',
  ...extra,
});

// ─── harness ─────────────────────────────────────────────────────────────────

let prismaMock: any;
let imageServiceMock: any;
let service: SegmentationService;
/** Interleaved record of what happened, in order. */
let sequence: string[];

/** What the projection reports it wrote — the ids, not just a count. */
const PROJECTED_IDS = Array.from({ length: 299 }, (_, i) => `f${i + 1}`);

const STORED_ROW = {
  id: 'seg-f0',
  imageId: 'f0',
  model: 'manual',
  threshold: 0.5,
  confidence: 0.9,
  imageWidth: 1924,
  imageHeight: 1476,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  sequence = [];

  prismaMock = {
    segmentation: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'seg-f0',
        polygons: '[]',
        imageWidth: 1924,
        imageHeight: 1476,
      }),
      update: vi.fn(x => x),
      create: vi.fn().mockResolvedValue({ ...STORED_ROW, id: 'seg-new' }),
    },
    image: {
      findUnique: vi.fn().mockResolvedValue({ channels: [IRM_STATIC] }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(x => x),
    },
    $transaction: vi.fn(async () => {
      sequence.push('write');
      return [STORED_ROW];
    }),
  };

  imageServiceMock = {
    getImageById: vi
      .fn()
      .mockResolvedValue({ id: 'f0', parentVideoId: 'container-1' }),
    updateSegmentationStatus: vi.fn().mockResolvedValue(undefined),
  };

  projectStaticChannelResult.mockImplementation(async () => {
    sequence.push('project');
    return {
      applied: true,
      projected: PROJECTED_IDS.length,
      skipped: 0,
      projectedIds: PROJECTED_IDS,
    };
  });

  service = new SegmentationService(
    prismaMock as PrismaClient,
    imageServiceMock as ImageService
  );
});

const save = (polygons: unknown[] = [polyline()]) =>
  service.updateSegmentationResults('f0', polygons as never[], 'user');

/** The polygons array actually written to this frame's row. */
const storedPolygons = (): Array<Record<string, unknown>> => {
  const call = prismaMock.segmentation.update.mock.calls.find(
    (c: any) => c[0]?.data?.polygons
  );
  expect(call).toBeDefined();
  return JSON.parse(call[0].data.polygons);
};

// ─── the feature ─────────────────────────────────────────────────────────────

describe('updateSegmentationResults — sharing a save across a static channel', () => {
  it('projects onto the container and reports WHICH frames on the wire', async () => {
    const result = await save();

    expect(projectStaticChannelResult).toHaveBeenCalledTimes(1);
    expect(projectStaticChannelResult).toHaveBeenCalledWith({
      containerId: 'container-1',
      sourceImageId: 'f0',
      channel: 'IRM',
    });
    // Ids, not a count: the client marks these frames `segmented` locally, and
    // a frame the projection deliberately left alone must not be among them.
    expect(result.staticShare).toEqual({ frameIds: PROJECTED_IDS });
  });

  it('projects only AFTER this frame is persisted', async () => {
    // The projection reads the frame's STORED polygons and copies them out, so
    // running it first would broadcast the pre-edit state.
    await save();
    expect(sequence).toEqual(['write', 'project']);
  });

  it('shares a save that CREATES the row too, not just one that updates it', async () => {
    prismaMock.segmentation.findUnique.mockResolvedValue(null);
    const result = await save();
    expect(prismaMock.segmentation.create).toHaveBeenCalled();
    expect(projectStaticChannelResult).toHaveBeenCalledTimes(1);
    expect(result.staticShare).toEqual({ frameIds: PROJECTED_IDS });
  });
});

// ─── the gate: every fixture below differs in ONE fact ───────────────────────

describe('updateSegmentationResults — what is NOT shared', () => {
  const expectNoShare = async () => {
    const result = await save();
    expect(projectStaticChannelResult).not.toHaveBeenCalled();
    expect(result.staticShare).toBeUndefined();
    // …and nothing was minted onto the polygons either.
    expect(storedPolygons().every(p => p.trackId === undefined)).toBe(true);
  };

  it('a channel identical to the shared one but WITHOUT staticSource', async () => {
    prismaMock.image.findUnique.mockResolvedValue({
      channels: [IRM_NOT_STATIC],
    });
    await expectNoShare();
  });

  it('a static channel that is not the SEGMENTATION SOURCE', async () => {
    // The static IRM is present but the user segments from the fluorescent
    // channel, so the frames hold genuinely different pictures.
    prismaMock.image.findUnique.mockResolvedValue({
      channels: [
        { ...IRM_STATIC, isSegmentationSource: false },
        { ...FLUORESCENT, isSegmentationSource: true },
      ],
    });
    await expectNoShare();
  });

  it('a SPARSE channel — its real frames are different timepoints', async () => {
    prismaMock.image.findUnique.mockResolvedValue({ channels: [IRM_SPARSE] });
    await expectNoShare();
  });

  it('a frame the channel does not COVER', async () => {
    // "Add channel" can stamp its picture onto a user-chosen subset. A frame
    // outside it was segmented from a different picture entirely, so its
    // geometry must not be broadcast over the frames that do show the stamp —
    // and nothing downstream would catch it, because with alignment off
    // `projectionDelta` returns [0, 0] for every pair.
    prismaMock.image.findUnique.mockResolvedValue({
      channels: [{ ...IRM_STATIC, frameIds: ['f7', 'f8', 'f9'] }],
    });
    await expectNoShare();
  });

  it('…but still shares from a frame the subset DOES cover', async () => {
    // The discriminating half of the pair above: same partial coverage, and
    // this time the saved frame is inside it.
    prismaMock.image.findUnique.mockResolvedValue({
      channels: [{ ...IRM_STATIC, frameIds: ['f0', 'f8', 'f9'] }],
    });
    const result = await save();
    expect(projectStaticChannelResult).toHaveBeenCalledTimes(1);
    expect(result.staticShare).toEqual({ frameIds: PROJECTED_IDS });
  });

  it('a standalone image (no parentVideoId)', async () => {
    imageServiceMock.getImageById.mockResolvedValue({
      id: 'f0',
      parentVideoId: null,
    });
    await expectNoShare();
    // Not even the container lookup runs for an ordinary image.
    expect(prismaMock.image.findUnique).not.toHaveBeenCalled();
  });

  it('a container whose channels JSON is missing or not an array', async () => {
    prismaMock.image.findUnique.mockResolvedValue({ channels: null });
    await expectNoShare();
  });
});

// ─── cross-frame identity ────────────────────────────────────────────────────

describe('updateSegmentationResults — trackIds on a shared frame', () => {
  it('mints one for every untracked polyline, in the row AND in the response', async () => {
    // The response half is the load-bearing one: the editor paints what the
    // save returns, so an id that exists only in the database is sent back
    // absent on the NEXT save — `diffTrackOps` reads that as "the user deleted
    // these tracks" and the ids churn on every single save.
    const result = await save([
      polyline({ id: 'kept', trackId: 'mt_already' }),
      polyline({ id: 'hand-drawn-1' }),
      polyline({ id: 'hand-drawn-2' }),
    ]);

    const stored = storedPolygons();
    expect(stored.map(p => p.id)).toEqual([
      'kept',
      'hand-drawn-1',
      'hand-drawn-2',
    ]);
    expect(stored[0].trackId).toBe('mt_already');
    expect(stored[1].trackId).toMatch(/^mt_[0-9a-f]{8}$/);
    expect(stored[2].trackId).toMatch(/^mt_[0-9a-f]{8}$/);
    expect(stored[1].trackId).not.toBe(stored[2].trackId);

    const returned = result.polygons as Array<Record<string, unknown>>;
    expect(returned.map(p => p.trackId)).toEqual(stored.map(p => p.trackId));
  });

  it('mints nothing on a frame that is not shared', async () => {
    prismaMock.image.findUnique.mockResolvedValue({
      channels: [IRM_NOT_STATIC],
    });
    const result = await save([polyline({ id: 'p1' })]);
    expect(storedPolygons()[0].trackId).toBeUndefined();
    expect(
      (result.polygons as Array<Record<string, unknown>>)[0].trackId
    ).toBeUndefined();
  });
});

// ─── failure never costs the user their edit ─────────────────────────────────

describe('updateSegmentationResults — the share is best-effort', () => {
  it('a throwing projection still returns a successful save', async () => {
    projectStaticChannelResult.mockRejectedValue(new Error('db is on fire'));
    const result = await save();
    expect(result.id).toBe('seg-f0');
    expect(result.status).toBe('completed');
    expect(result.staticShare).toBeUndefined();
  });

  it('a throwing container lookup still returns a successful save', async () => {
    prismaMock.image.findUnique.mockRejectedValue(new Error('nope'));
    const result = await save();
    expect(result.status).toBe('completed');
    expect(projectStaticChannelResult).not.toHaveBeenCalled();
    expect(result.staticShare).toBeUndefined();
  });

  it('omits staticShare when the projection wrote nothing', async () => {
    // Every covered frame had an unrecorded alignment shift, so the projection
    // deliberately left them all alone. Reporting "shared across 0 frames"
    // would be a lie the editor then toasts.
    projectStaticChannelResult.mockResolvedValue({
      applied: false,
      projected: 0,
      skipped: 299,
      projectedIds: [],
    });
    const result = await save();
    expect(result.staticShare).toBeUndefined();
  });

  it('reports a PARTIAL projection rather than dropping it', async () => {
    // A chunk failed half way through; 120 frames are in the database and the
    // rest are not. Withholding the field would leave the editor painting the
    // cached pre-save polygons over rows the server did rewrite.
    const partial = PROJECTED_IDS.slice(0, 120);
    projectStaticChannelResult.mockResolvedValue({
      applied: false,
      projected: partial.length,
      skipped: 0,
      projectedIds: partial,
    });
    const result = await save();
    expect(result.staticShare).toEqual({ frameIds: partial });
  });
});
