/**
 * `assignNeuriteSomas` runs on an UNCALIBRATED project.
 *
 * WHY THIS FILE EXISTS. The assignment used to refuse a frame with no pixel
 * size, and for a while that refusal was defended here — the reasoning being
 * that a guessed scale gives confidently wrong answers rather than approximate
 * ones. It was true of the code as it stood, for a reason that turned out to be
 * a bug: `attach_somas` derived an INTEGER pixel radius from the scale and
 * measured it from the skeleton, which the medial axis places one local
 * half-width inside the filament. Sweeping the scale over 0.10 - 2.00 um/px on
 * two real production frames swung the attachments 3 -> 0 and 21 -> 11.
 *
 * With that fixed (`models/neurite_metrics/assign.py`, VENDOR EDIT 5 of 5) the
 * same sweep returns the complete neurite -> soma mapping BYTE-IDENTICAL at
 * every scale — 3/3 and 20/20 owners throughout — because the reach is
 * dominated by the filament's own half-width in pixels and the majority-owner
 * argmax cannot be moved by a uniform rescale. So the refusal lost its
 * justification, and a user with 259 uncalibrated projects lost a feature for
 * nothing.
 *
 * The EXPORT still refuses, and must: its staging rules are physical ("at least
 * 2 um", "2x the soma diameter"). This path reads `neurite_owners` and nothing
 * else.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { SegmentationService } from '../segmentationService';
import type { ImageService } from '../imageService';

const computeNeuriteFrame = vi.hoisted(() => vi.fn());

vi.mock('../export/neuriteMetricsExporter', () => ({ computeNeuriteFrame }));
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

/** Verbatim from `neuriteMetricsExporter`, not paraphrased. */
const NO_SOMA_REASON = 'no soma polygons';

let prismaMock: any;
let imageServiceMock: any;
let service: SegmentationService;

const POLYGONS = JSON.stringify([
  { id: 'n1', class: 'neurite', points: [], type: 'external' },
  { id: 's1', class: 'soma', points: [], type: 'external' },
]);

/** What the ML pipeline answers when it CAN measure the frame. */
const owners = () =>
  computeNeuriteFrame.mockResolvedValue({
    neurite_owners: { n1: { soma_polygon_id: 's1', shared: false } },
  });

beforeEach(() => {
  vi.clearAllMocks();

  prismaMock = {
    project: { findUnique: vi.fn().mockResolvedValue({ pixelSizeUm: null }) },
    segmentation: {
      findUnique: vi.fn().mockResolvedValue({ id: 'seg-1', polygons: POLYGONS }),
      update: vi.fn(x => x),
    },
  };

  imageServiceMock = {
    getImageById: vi.fn().mockResolvedValue({
      id: 'img-1',
      name: 'neurite.tif',
      projectId: 'proj-1',
      width: 1024,
      height: 1024,
      pixelSizeUm: null,
      originalPath: '/uploads/neurite.tif',
      parentVideoId: null,
    }),
  };

  service = new SegmentationService(
    prismaMock as PrismaClient,
    imageServiceMock as unknown as ImageService
  );
});

/** The scale the pipeline was actually handed. */
const scaleSent = () => computeNeuriteFrame.mock.calls[0][0].pixelSizeUm;

describe('assignNeuriteSomas — an uncalibrated project is not a blocker', () => {
  it('supplies a scale of its own when the project has none', async () => {
    owners();

    await service.assignNeuriteSomas('img-1', 'user-1');

    expect(computeNeuriteFrame).toHaveBeenCalledTimes(1);
    expect(scaleSent()).toBeGreaterThan(0);
  });

  it('prefers the project’s real scale when there is one', async () => {
    // The other half of the pair, and the reason the first test discriminates:
    // hard-coding the fallback unconditionally would satisfy it and silently
    // throw away every calibration in the database.
    owners();
    prismaMock.project.findUnique.mockResolvedValue({ pixelSizeUm: 0.0722222 });

    await service.assignNeuriteSomas('img-1', 'user-1');

    expect(scaleSent()).toBe(0.0722222);
  });

  it('does not treat a stored 0 as a calibration', async () => {
    // `??` would pass the 0 straight through and `computeNeuriteFrame` would
    // refuse it, restoring exactly the failure this removes.
    owners();
    prismaMock.project.findUnique.mockResolvedValue({ pixelSizeUm: 0 });

    await service.assignNeuriteSomas('img-1', 'user-1');

    expect(scaleSent()).toBeGreaterThan(0);
  });

  it('does not let the soma classifier overrule a hand-drawn label', async () => {
    // The classifier exists for somas the pipeline DERIVED from a mask, where
    // about half turn out to be growth cones. These polygons are the ones the
    // user drew and labelled `soma`, and a model rejecting that label removes
    // the polygon's ability to own a neurite while the editor keeps painting
    // it as a soma — invisible. Measured 2026-09-09 on production frame
    // `neurite_practice_3.png`: 2 of the user's 3 somas rejected at p_not_soma
    // 0.992 and 0.999, and one neurite lost its only candidate.
    owners();

    await service.assignNeuriteSomas('img-1', 'user-1');

    expect(computeNeuriteFrame.mock.calls[0][1]).toMatchObject({
      classify: false,
    });
  });

  it('still runs the classifier when a caller explicitly asks for it', async () => {
    // The pair that stops the line above from being a hard-coded `false`.
    owners();

    await service.assignNeuriteSomas('img-1', 'user-1', { classify: true });

    expect(computeNeuriteFrame.mock.calls[0][1]).toMatchObject({
      classify: true,
    });
  });

  it('still fails, with the reason, when the frame is unmeasurable', async () => {
    // Dropping the scale guard must not swallow the OTHER refusals — a frame
    // with no soma has nothing to assign to and the user needs to know which.
    computeNeuriteFrame.mockImplementation(
      async (_frame: unknown, _opts: unknown, skipped: unknown[]) => {
        skipped.push({ image: 'neurite.tif', reason: NO_SOMA_REASON });
        return null;
      }
    );

    await expect(service.assignNeuriteSomas('img-1', 'user-1')).rejects.toThrow(
      NO_SOMA_REASON
    );
    expect(prismaMock.segmentation.update).not.toHaveBeenCalled();
  });
});
