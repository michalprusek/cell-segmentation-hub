/**
 * `assignNeuriteSomas` tags the ONE failure the user can fix.
 *
 * WHY THIS FILE EXISTS. The assignment measures in micrometres — the soma
 * splitting is h-maxima at 2 um depth in the distance transform — so without a
 * scale the frame is skipped rather than guessed at. That is the right
 * behaviour and it stays. What was wrong is what the user saw: the raw English
 * sentence "pixel size unknown — staging thresholds are in micrometres",
 * surfaced as a red toast in a Czech UI, with nothing saying where to set it.
 * Reported twice by the same user on 2026-09-08 against project "Neurite
 * practice", whose `pixelSizeUm` is NULL and whose `updatedAt` (2026-09-07
 * 09:07) shows the scale was never set. Both attempts at 14:12 returned 400.
 *
 * So the failure now travels as a CODE the editor translates. The pair below is
 * the point: a missing scale is coded, every other skip reason is not. Tagging
 * unconditionally would be the same bug with a different sentence — it would
 * tell a user with no soma polygons to go set the scale.
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
const PIXEL_SIZE_REASON =
  'pixel size unknown — staging thresholds are in micrometres';
const NO_SOMA_REASON = 'no soma polygons';

let prismaMock: any;
let service: SegmentationService;

/** Make `computeNeuriteFrame` skip the frame the way the real one does. */
const skipWith = (reason: string) =>
  computeNeuriteFrame.mockImplementation(
    async (_frame: unknown, _opts: unknown, skipped: unknown[]) => {
      skipped.push({ image: 'neurite.tif', reason });
      return null;
    }
  );

beforeEach(() => {
  vi.clearAllMocks();

  prismaMock = {
    project: { findUnique: vi.fn().mockResolvedValue({ pixelSizeUm: null }) },
    segmentation: {
      findUnique: vi.fn().mockResolvedValue({ id: 'seg-1', polygons: '[]' }),
      update: vi.fn(x => x),
    },
  };

  const imageServiceMock = {
    getImageById: vi.fn().mockResolvedValue({
      id: 'img-1',
      name: 'neurite.tif',
      projectId: 'proj-1',
      width: 6664,
      height: 6657,
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

const assign = () => service.assignNeuriteSomas('img-1', 'user-1');

describe('assignNeuriteSomas — an unset project scale is actionable', () => {
  it('codes a missing pixel size so the editor can say WHERE to set it', async () => {
    skipWith(PIXEL_SIZE_REASON);

    const err = await assign().then(
      () => {
        throw new Error('expected a rejection');
      },
      (e: Error & { code?: string }) => e
    );

    expect(err.code).toBe('NEURITE_PIXEL_SIZE_UNKNOWN');
    // The sentence still travels — it is the fallback for an older frontend.
    expect(err.message).toBe(PIXEL_SIZE_REASON);
  });

  it('leaves every OTHER skip reason uncoded', async () => {
    skipWith(NO_SOMA_REASON);

    const err = await assign().then(
      () => {
        throw new Error('expected a rejection');
      },
      (e: Error & { code?: string }) => e
    );

    expect(err.code).toBeUndefined();
    expect(err.message).toBe(NO_SOMA_REASON);
  });

  it('does not write to the segmentation when the frame is skipped', async () => {
    skipWith(PIXEL_SIZE_REASON);

    await expect(assign()).rejects.toThrow();
    expect(prismaMock.segmentation.update).not.toHaveBeenCalled();
  });
});
