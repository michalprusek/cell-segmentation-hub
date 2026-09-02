/**
 * kymographService.test.ts
 *
 * Behavioral tests for buildKymograph():
 *  - Input validation (sourceChannel regex, channelColor hex format)
 *  - Prisma lookups: container-not-found, non-container, channel whitelist
 *  - Frame lookups: no-frames, seed-frame-missing, polyline-missing
 *  - ML POST payload: tracked vs static-line mode, channelColor forwarding,
 *    coordinate mapping (x,y → row,col), framePngPath construction
 *  - Response mapping from ML data envelope
 *  - Axios error propagation
 *  - Redis response cache: hit/miss, staleness on edit, per-parameter keying,
 *    what is deliberately NOT cached, and degradation when Redis is down
 *  - Polygon fetch cost: which frames' `polygons` the service reads at all
 *  - Prefetched per-container rows (`containerContext`): no queries, no
 *    behaviour change, one parse per frame however many builds
 *
 * ...and for buildKymographBatch(): that the bodies it carries are the SAME
 * bodies the single path posts (that equivalence is the whole reason the batch
 * is a transport rather than a second renderer), and that one item's failure
 * costs one item.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks before all imports so the factory runs first.
vi.mock('../../db/prismaClient', () => ({
  prisma: {
    image: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../utils/config', () => ({
  config: {
    UPLOAD_DIR: '/uploads',
    SEGMENTATION_SERVICE_URL: 'http://ml:8000',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('axios');

// In-memory stand-in for the Redis-backed cacheService. Values round-trip
// through JSON exactly as Redis stores them, so a hit can never hand back the
// very object the miss produced.
const cacheMocks = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, JSON.parse(JSON.stringify(value)));
      return true;
    }),
  };
});

vi.mock('../cacheService', () => ({
  cacheService: { get: cacheMocks.get, set: cacheMocks.set },
  CacheService: { TTL_PRESETS: { MEDIUM: 1800 } },
}));

import { buildKymograph, buildKymographBatch } from '../kymographService';
import { prisma } from '../../db/prismaClient';
import axios from 'axios';

const mockPrisma = prisma as unknown as {
  image: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};
const mockAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Staleness tokens the cache key is built from. Distinct values so a test
 *  that bumps one cannot accidentally collide with the other. */
const CONTAINER_UPDATED_AT = new Date('2026-08-30T09:00:00.000Z');
const IMAGE_UPDATED_AT = new Date('2026-08-30T10:00:00.000Z');
const SEG_UPDATED_AT = new Date('2026-08-30T11:00:00.000Z');

function makeContainer(overrides?: object) {
  return {
    id: 'container-1',
    projectId: 'project-1',
    isVideoContainer: true,
    channels: [] as Array<{ name: string }>,
    updatedAt: CONTAINER_UPDATED_AT,
    ...overrides,
  };
}

function makeFrame(
  frameIndex: number,
  polygons: object[] | null,
  overrides?: object
) {
  return {
    id: `frame-${frameIndex}`,
    frameIndex,
    updatedAt: IMAGE_UPDATED_AT,
    segmentation: polygons
      ? { polygons: JSON.stringify(polygons), updatedAt: SEG_UPDATED_AT }
      : null,
    ...overrides,
  };
}

const POLYLINE_STATIC = {
  id: 'poly-1',
  points: [
    { x: 10, y: 20 },
    { x: 30, y: 40 },
  ],
  geometry: 'polyline',
};

const POLYLINE_TRACKED = {
  ...POLYLINE_STATIC,
  trackId: 'track-abc',
};

const ML_RESPONSE = {
  data: {
    png_base64: 'iVBOR',
    csv_base64: 'ZnJhbW',
    frame_count: 2,
    length_px: 55,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildKymograph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheMocks.store.clear();
    mockAxios.post = vi.fn().mockResolvedValue(ML_RESPONSE);
  });

  // ── Input validation ──────────────────────────────────────────────────────

  describe('input validation', () => {
    it('rejects sourceChannel with path separators', async () => {
      await expect(
        buildKymograph({
          videoContainerId: 'c',
          polylineId: 'p',
          frameIndex: 0,
          sourceChannel: '../etc/passwd',
        })
      ).rejects.toThrow('Invalid sourceChannel');
    });

    it('rejects sourceChannel with spaces', async () => {
      await expect(
        buildKymograph({
          videoContainerId: 'c',
          polylineId: 'p',
          frameIndex: 0,
          sourceChannel: 'chan nel',
        })
      ).rejects.toThrow('Invalid sourceChannel');
    });

    it('accepts a valid alphanumeric sourceChannel without DB call', async () => {
      // Fails on DB (container not found) but never on the regex guard.
      mockPrisma.image.findUnique.mockResolvedValue(null);
      await expect(
        buildKymograph({
          videoContainerId: 'c',
          polylineId: 'p',
          frameIndex: 0,
          sourceChannel: 'IRM-1',
        })
      ).rejects.toThrow('videoContainerId does not refer');
    });

    it('rejects channelColor that is not a hex #RRGGBB', async () => {
      await expect(
        buildKymograph({
          videoContainerId: 'c',
          polylineId: 'p',
          frameIndex: 0,
          sourceChannel: 'IRM',
          channelColor: 'red',
        })
      ).rejects.toThrow('Invalid channelColor');
    });

    it('accepts a valid #RRGGBB channelColor', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(null);
      await expect(
        buildKymograph({
          videoContainerId: 'c',
          polylineId: 'p',
          frameIndex: 0,
          sourceChannel: 'IRM',
          channelColor: '#ff00aa',
        })
      ).rejects.toThrow('videoContainerId does not refer');
      // Regex passed — error is from the DB lookup, not validation.
    });
  });

  // ── Prisma lookups ────────────────────────────────────────────────────────

  describe('container lookup', () => {
    it('throws when container row is null', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(null);
      await expect(
        buildKymograph({
          videoContainerId: 'missing',
          polylineId: 'p',
          frameIndex: 0,
          sourceChannel: 'IRM',
        })
      ).rejects.toThrow('videoContainerId does not refer to a video container');
    });

    it('throws when row exists but isVideoContainer=false', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ isVideoContainer: false })
      );
      await expect(
        buildKymograph({
          videoContainerId: 'c',
          polylineId: 'p',
          frameIndex: 0,
          sourceChannel: 'IRM',
        })
      ).rejects.toThrow('videoContainerId does not refer to a video container');
    });

    it('throws when sourceChannel is not in declared channel list', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ channels: [{ name: 'BF' }, { name: 'GFP' }] })
      );
      await expect(
        buildKymograph({
          videoContainerId: 'c',
          polylineId: 'p',
          frameIndex: 0,
          sourceChannel: 'IRM',
        })
      ).rejects.toThrow('Unknown source channel: IRM');
    });

    it('allows any sourceChannel when channels array is empty', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(makeContainer());
      mockPrisma.image.findMany.mockResolvedValue([]);
      await expect(
        buildKymograph({
          videoContainerId: 'c',
          polylineId: 'p',
          frameIndex: 0,
          sourceChannel: 'IRM',
        })
      ).rejects.toThrow('No frames found');
    });
  });

  describe('frame lookups', () => {
    beforeEach(() => {
      mockPrisma.image.findUnique.mockResolvedValue(makeContainer());
    });

    it('throws when no frames exist for container', async () => {
      mockPrisma.image.findMany.mockResolvedValue([]);
      await expect(
        buildKymograph({
          videoContainerId: 'c',
          polylineId: 'p',
          frameIndex: 0,
          sourceChannel: 'IRM',
        })
      ).rejects.toThrow('No frames found for the given video container');
    });

    it('throws when the requested frameIndex is not among frames', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(1, [POLYLINE_STATIC]),
      ]);
      await expect(
        buildKymograph({
          videoContainerId: 'c',
          polylineId: 'p',
          frameIndex: 0,
          sourceChannel: 'IRM',
        })
      ).rejects.toThrow('Frame 0 not found in container');
    });

    it('throws when polylineId is not found in the seed frame', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [{ id: 'other-poly', points: [] }]),
      ]);
      await expect(
        buildKymograph({
          videoContainerId: 'c',
          polylineId: 'poly-missing',
          frameIndex: 0,
          sourceChannel: 'IRM',
        })
      ).rejects.toThrow('Polyline poly-missing not found in frame 0');
    });

    it('throws when the seed polyline has no points array', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [{ id: 'poly-1' /* no points */ }]),
      ]);
      await expect(
        buildKymograph({
          videoContainerId: 'c',
          polylineId: 'poly-1',
          frameIndex: 0,
          sourceChannel: 'IRM',
        })
      ).rejects.toThrow('Polyline poly-1 not found in frame 0');
    });
  });

  // ── ML POST payload ───────────────────────────────────────────────────────

  describe('ML POST payload construction', () => {
    beforeEach(() => {
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ projectId: 'proj-42' })
      );
    });

    it('maps point coordinates as [y, x] (row, col) in polyline_rc', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      const body = mockAxios.post.mock.calls[0][1];
      expect(body.frames[0].polyline_rc).toEqual([
        [20, 10], // y=20, x=10
        [40, 30], // y=40, x=30
      ]);
    });

    it('builds the correct image_path with padded frame index', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(3, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 3,
        sourceChannel: 'BF',
      });

      const body = mockAxios.post.mock.calls[0][1];
      expect(body.frames[0].image_path).toBe(
        '/uploads/projects/proj-42/images/container-1/frames/0003/BF.png'
      );
    });

    it('posts to /api/v1/kymograph on the configured ML URL', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      expect(mockAxios.post.mock.calls[0][0]).toBe(
        'http://ml:8000/api/v1/kymograph'
      );
    });

    it('sets tracked=false and sends no target_width in static-line mode', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      const body = mockAxios.post.mock.calls[0][1];
      expect(body.tracked).toBe(false);
      // The ML service sizes the column axis from the seed polyline's arc
      // length and has ignored `target_width` since 2026-09-01. Sending a
      // value it ignores would read as a setting that does something.
      expect(body).not.toHaveProperty('target_width');
    });

    it('sends intensity_width 5 when the caller passes none', async () => {
      // The default the export runs on, and therefore what decides every
      // intensity column in velocity_metrics.xlsx. Raised 3 -> 5 on
      // 2026-09-01; must match the ML field default and the editor modal.
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      expect(mockAxios.post.mock.calls[0][1].intensity_width).toBe(5);
    });

    it('omits line_width / line_reduce when the caller wants a plain line', async () => {
      // The whole backward-compatibility story: a caller that never heard of
      // the line width posts byte-for-byte the body it posted before the field
      // existed, and the ML service renders the identical kymograph.
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      const body = mockAxios.post.mock.calls[0][1];
      expect(body).not.toHaveProperty('line_width');
      expect(body).not.toHaveProperty('line_reduce');
    });

    it('omits the intensity floor when the caller sets none', async () => {
      // Same backward-compatibility story as line_width above, and it matters
      // more here: the ML model is `extra="forbid"`, so posting the field to an
      // ml container that has not been recreated yet 422s every kymograph.
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      expect(mockAxios.post.mock.calls[0][1]).not.toHaveProperty(
        'min_intensity_minus_bg'
      );
    });

    it('forwards the intensity floor when the caller sets one', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
        detectVelocity: true,
        minIntensityMinusBg: 18.5,
      });

      // Not rounded: real values sit in the tens (9-51 counts above background
      // on a 488 nm production container), where a whole count is a coarse step.
      expect(mockAxios.post.mock.calls[0][1].min_intensity_minus_bg).toBe(18.5);
    });

    it('treats a zero or negative floor as off rather than as an error', async () => {
      // It arrives from a number input the user can empty; a blank field has to
      // restore the unfiltered view, not fail the request.
      for (const value of [0, -5]) {
        mockAxios.post.mockClear();
        mockPrisma.image.findMany.mockResolvedValue([
          makeFrame(0, [POLYLINE_STATIC]),
        ]);
        await buildKymograph({
          videoContainerId: 'container-1',
          polylineId: 'poly-1',
          frameIndex: 0,
          sourceChannel: 'IRM',
          minIntensityMinusBg: value,
          useCache: false,
        });
        expect(mockAxios.post.mock.calls[0][1]).not.toHaveProperty(
          'min_intensity_minus_bg'
        );
      }
    });

    it('forwards line_width and line_reduce when the caller asks for a band', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
        lineWidth: 9,
        lineReduce: 'max',
      });

      const body = mockAxios.post.mock.calls[0][1];
      expect(body.line_width).toBe(9);
      expect(body.line_reduce).toBe('max');
    });

    it('clamps an out-of-range line width instead of letting the ML 422 it', async () => {
      // Defence in depth: the route validates 1..51 first, but this service is
      // also called from the export, which does not go through it.
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
        lineWidth: 999,
      });

      expect(mockAxios.post.mock.calls[0][1].line_width).toBe(51);
    });

    it('drops line_reduce at width 1, where it cannot change a pixel', async () => {
      // One sample per column: mean and max of it are the same number. Sending
      // the choice anyway would split the response cache for nothing.
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
        lineWidth: 1,
        lineReduce: 'max',
      });

      const body = mockAxios.post.mock.calls[0][1];
      expect(body).not.toHaveProperty('line_width');
      expect(body).not.toHaveProperty('line_reduce');
    });

    it('sets tracked=true when the seed polyline has a trackId', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_TRACKED]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      const body = mockAxios.post.mock.calls[0][1];
      expect(body.tracked).toBe(true);
    });

    it('omits channel_color when not provided', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      const body = mockAxios.post.mock.calls[0][1];
      expect(body).not.toHaveProperty('channel_color');
    });

    it('includes channel_color when provided', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
        channelColor: '#aabbcc',
      });

      const body = mockAxios.post.mock.calls[0][1];
      expect(body.channel_color).toBe('#aabbcc');
    });

    it('uses static seed geometry for frames missing the trackId sibling', async () => {
      // Frame 0 has trackId, frame 1 has no matching sibling.
      const frames = [
        makeFrame(0, [POLYLINE_TRACKED]),
        makeFrame(1, [{ id: 'unrelated', points: [{ x: 99, y: 99 }] }]),
      ];
      mockPrisma.image.findMany.mockResolvedValue(frames);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      const body = mockAxios.post.mock.calls[0][1];
      // Frame 1 falls back to seed-frame geometry ([y,x] = [20,10], [40,30])
      expect(body.frames[1].polyline_rc).toEqual([
        [20, 10],
        [40, 30],
      ]);
    });

    it('in tracked mode uses sibling polyline geometry when found', async () => {
      const sibling = {
        id: 'poly-frame1',
        points: [{ x: 5, y: 6 }],
        trackId: 'track-abc',
      };
      const frames = [
        makeFrame(0, [POLYLINE_TRACKED]),
        makeFrame(1, [sibling]),
      ];
      mockPrisma.image.findMany.mockResolvedValue(frames);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      const body = mockAxios.post.mock.calls[0][1];
      expect(body.frames[1].polyline_rc).toEqual([[6, 5]]);
    });
  });

  // ── Response mapping ──────────────────────────────────────────────────────

  describe('response mapping', () => {
    beforeEach(() => {
      mockPrisma.image.findUnique.mockResolvedValue(makeContainer());
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
    });

    it('maps ML response fields to the service result shape', async () => {
      const result = await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      expect(result).toEqual({
        pngBase64: 'iVBOR',
        csvBase64: 'ZnJhbW',
        frameCount: 2,
        lengthPx: 55,
        tracked: false,
        sourceChannel: 'IRM',
        pixelSizeUm: null,
        frameIntervalMs: null,
        filteredTrackCount: 0,
        // Both default to 0 when the ML service does not report them — an ml
        // container that predates the intensity floor omits the fields.
        filteredDimTrackCount: 0,
        unmeasuredTrackCount: 0,
      });
    });

    it('handles ML response wrapped under a data envelope', async () => {
      mockAxios.post.mockResolvedValue({
        data: {
          data: {
            png_base64: 'A',
            csv_base64: 'B',
            frame_count: 1,
            length_px: 10,
          },
        },
      });

      const result = await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });
      expect(result.pngBase64).toBe('A');
    });

    it('propagates tracked=true in result when polyline has trackId', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_TRACKED]),
      ]);
      const result = await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });
      expect(result.tracked).toBe(true);
    });
  });

  // ── Error propagation ─────────────────────────────────────────────────────

  describe('error propagation', () => {
    beforeEach(() => {
      mockPrisma.image.findUnique.mockResolvedValue(makeContainer());
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
    });

    it('propagates axios errors from the ML service', async () => {
      mockAxios.post.mockRejectedValue(new Error('ML service unreachable'));
      await expect(
        buildKymograph({
          videoContainerId: 'container-1',
          polylineId: 'poly-1',
          frameIndex: 0,
          sourceChannel: 'IRM',
        })
      ).rejects.toThrow('ML service unreachable');
    });

    it('propagates prisma errors from findMany', async () => {
      mockPrisma.image.findMany.mockRejectedValue(new Error('DB timeout'));
      await expect(
        buildKymograph({
          videoContainerId: 'container-1',
          polylineId: 'poly-1',
          frameIndex: 0,
          sourceChannel: 'IRM',
        })
      ).rejects.toThrow('DB timeout');
    });
  });

  // ── Corrupt polygon JSON ──────────────────────────────────────────────────

  describe('corrupt polygon JSON in frames', () => {
    beforeEach(() => {
      mockPrisma.image.findUnique.mockResolvedValue(makeContainer());
    });

    // Tracked seed on purpose: static-line mode never reads another frame's
    // polygons at all, so a corrupt frame can only be exercised via a trackId.
    it('falls back to static seed when a frame has invalid JSON polygons', async () => {
      const frames = [
        makeFrame(0, [POLYLINE_TRACKED]),
        makeFrame(1, null, {
          segmentation: { polygons: 'NOT_JSON', updatedAt: SEG_UPDATED_AT },
        }),
      ];
      mockPrisma.image.findMany.mockResolvedValue(frames);
      // Should not throw — corrupt JSON causes fallback to seed geometry.
      await expect(
        buildKymograph({
          videoContainerId: 'container-1',
          polylineId: 'poly-1',
          frameIndex: 0,
          sourceChannel: 'IRM',
        })
      ).resolves.toBeDefined();

      const body = mockAxios.post.mock.calls[0][1];
      expect(body.frames[1].polyline_rc).toEqual([
        [20, 10],
        [40, 30],
      ]);
    });
  });

  // ── Velocity mapping (detectVelocity) ──────────────────────────────────────
  describe('velocity mapping', () => {
    const ML_WITH_TRACKS = {
      data: {
        png_base64: 'iVBOR',
        csv_base64: 'ZnJhbW',
        frame_count: 2,
        length_px: 55,
        tracks: [
          {
            points: [
              [0, 10],
              [1, 11],
            ],
            net_pxframe: 0.5,
            snr: 4.2,
            total_run_time_frames: 4,
            total_run_displacement_px: 2,
            edge: 'right',
            intensity_signal: 800,
            intensity_background: 100,
            intensity_minus_bg: 700,
          },
        ],
      },
    };

    beforeEach(() => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
      ]);
      mockAxios.post = vi.fn().mockResolvedValue(ML_WITH_TRACKS);
    });

    const call = (detectVelocity: boolean) =>
      buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'GFP',
        detectVelocity,
      });

    it('forwards detect_velocity and converts px/frame → µm/s with calibration', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ pixelSizeUm: 0.07245, frameIntervalMs: 400 })
      );
      const res = await call(true);

      // Forwards detection + intensity width + calibration + velocity cut-off
      // so the ML service can drop non-processive tracks before rendering.
      expect(mockAxios.post.mock.calls[0][1]).toMatchObject({
        detect_velocity: true,
        intensity_width: 5,
        min_net_velocity_um_s: 0.01,
        pixel_size_um: 0.07245,
        frame_interval_ms: 400,
      });
      // 1 px/frame = pixelSizeUm / (frameIntervalMs/1000) µm/s
      const factor = 0.07245 / (400 / 1000);
      expect(res.tracks).toHaveLength(1);
      expect(res.tracks?.[0].netVelocityPxPerFrame).toBe(0.5);
      expect(res.tracks?.[0].netVelocityUmPerSec).toBeCloseTo(0.5 * factor, 9);
      // Run length = displacement_px × pixelSizeUm; run time = frames × s/frame.
      expect(res.tracks?.[0].totalRunLengthUm).toBeCloseTo(2 * 0.07245, 9);
      expect(res.tracks?.[0].totalRunTimeS).toBeCloseTo(4 * (400 / 1000), 9);
      // Intensity + edge pass through unchanged (calibration-independent).
      expect(res.tracks?.[0].intensitySignal).toBe(800);
      expect(res.tracks?.[0].intensityBackground).toBe(100);
      expect(res.tracks?.[0].intensityMinusBackground).toBe(700);
      expect(res.tracks?.[0].edge).toBe('right');
      // Bright flag defaults to false when the ML track omits it.
      expect(res.tracks?.[0].bright).toBe(false);
      expect(res.pixelSizeUm).toBe(0.07245);
      expect(res.frameIntervalMs).toBe(400);
    });

    it('passes the bright outlier flag through from the ML response', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ pixelSizeUm: 0.07245, frameIntervalMs: 400 })
      );
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          ...ML_WITH_TRACKS.data,
          tracks: [{ ...ML_WITH_TRACKS.data.tracks[0], bright: true }],
        },
      });
      const res = await call(true);
      expect(res.tracks?.[0].bright).toBe(true);
    });

    it('returns null µm/s + null run totals but keeps px/frame & intensity when uncalibrated', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ pixelSizeUm: null, frameIntervalMs: null })
      );
      const res = await call(true);

      expect(res.tracks?.[0].netVelocityUmPerSec).toBeNull();
      expect(res.tracks?.[0].netVelocityPxPerFrame).toBe(0.5);
      expect(res.tracks?.[0].totalRunLengthUm).toBeNull();
      expect(res.tracks?.[0].totalRunTimeS).toBeNull();
      // Intensity + edge are still reported (they don't need calibration).
      expect(res.tracks?.[0].intensityMinusBackground).toBe(700);
      expect(res.tracks?.[0].edge).toBe('right');
      // Without calibration the µm/s cut-off can't be applied → no
      // pixel_size_um / frame_interval_ms forwarded to the ML service.
      expect(mockAxios.post.mock.calls[0][1]).not.toHaveProperty(
        'pixel_size_um'
      );
      expect(mockAxios.post.mock.calls[0][1]).not.toHaveProperty(
        'frame_interval_ms'
      );
      expect(res.pixelSizeUm).toBeNull();
    });

    it('treats frameIntervalMs=0 as uncalibrated for time/velocity (no divide-by-zero)', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ pixelSizeUm: 0.07245, frameIntervalMs: 0 })
      );
      const res = await call(true);
      // No frame interval → velocity µm/s and run time s are null...
      expect(res.tracks?.[0].netVelocityUmPerSec).toBeNull();
      expect(res.tracks?.[0].totalRunTimeS).toBeNull();
      // ...but pixel size is valid, so run LENGTH stays calibrated.
      expect(res.tracks?.[0].totalRunLengthUm).toBeCloseTo(2 * 0.07245, 9);
      // frame_interval_ms=0 must NOT be forwarded (ML field is gt=0 → 422).
      expect(mockAxios.post.mock.calls[0][1]).not.toHaveProperty(
        'frame_interval_ms'
      );
    });

    it('treats pixelSizeUm=0 as uncalibrated for length (consistent with the >0 forwarding guard)', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ pixelSizeUm: 0, frameIntervalMs: 400 })
      );
      const res = await call(true);
      // pixelSizeUm=0 means no length/velocity calibration → null, NOT 0 µm.
      expect(res.tracks?.[0].totalRunLengthUm).toBeNull();
      expect(res.tracks?.[0].netVelocityUmPerSec).toBeNull();
      expect(res.tracks?.[0].totalRunTimeS).toBeCloseTo(4 * (400 / 1000), 9);
      // pixel_size_um=0 must NOT be forwarded (ML field is gt=0).
      expect(mockAxios.post.mock.calls[0][1]).not.toHaveProperty(
        'pixel_size_um'
      );
    });

    it('scales run length + velocity by px_per_column (long MT, compressed column axis)', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ pixelSizeUm: 0.07245, frameIntervalMs: 400 })
      );
      mockAxios.post = vi.fn().mockResolvedValue({
        data: { ...ML_WITH_TRACKS.data, px_per_column: 2.5 },
      });
      const res = await call(true);
      // 1 column now spans 2.5 px → µm-per-column = 0.07245 × 2.5.
      const umPerCol = 0.07245 * 2.5;
      expect(res.tracks?.[0].totalRunLengthUm).toBeCloseTo(2 * umPerCol, 9);
      expect(res.tracks?.[0].netVelocityUmPerSec).toBeCloseTo(
        (0.5 * umPerCol) / (400 / 1000),
        9
      );
      // Run time is unaffected by px_per_column (purely temporal).
      expect(res.tracks?.[0].totalRunTimeS).toBeCloseTo(4 * (400 / 1000), 9);
    });

    it('surfaces velocity_error and filtered_track_count from the ML response', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ pixelSizeUm: 0.07245, frameIntervalMs: 400 })
      );
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          ...ML_WITH_TRACKS.data,
          tracks: [],
          velocity_error: 'boom',
          filtered_track_count: 3,
        },
      });
      const res = await call(true);
      expect(res.velocityError).toBe('boom');
      expect(res.filteredTrackCount).toBe(3);
    });

    it('omits tracks and the detect_velocity flag when not requested', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(makeContainer());
      mockAxios.post = vi.fn().mockResolvedValue(ML_RESPONSE);
      const res = await call(false);

      expect(mockAxios.post.mock.calls[0][1]).not.toHaveProperty(
        'detect_velocity'
      );
      expect(res.tracks).toBeUndefined();
    });
  });

  // ── Response cache ─────────────────────────────────────────────────────────
  describe('response cache', () => {
    // The cache is opt-IN; the kymograph route is the caller that opts in.
    const INPUT = {
      videoContainerId: 'container-1',
      polylineId: 'poly-1',
      frameIndex: 0,
      sourceChannel: 'IRM',
      useCache: true,
    };

    beforeEach(() => {
      mockPrisma.image.findUnique.mockResolvedValue(makeContainer());
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
        makeFrame(1, [POLYLINE_STATIC]),
      ]);
    });

    /** The key `buildKymograph` looked up on its Nth call. */
    const lookupKey = (call: number): string =>
      cacheMocks.get.mock.calls[call][0] as string;

    it('serves a repeat request from cache without calling the ML service', async () => {
      const cold = await buildKymograph(INPUT);
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(cacheMocks.set).toHaveBeenCalledTimes(1);

      const warm = await buildKymograph(INPUT);
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(warm).toEqual(cold);
      expect(lookupKey(1)).toBe(lookupKey(0));
    });

    it('a warm hit does not read any frame polygons', async () => {
      await buildKymograph(INPUT);
      mockPrisma.image.findMany.mockClear();

      await buildKymograph(INPUT);
      // Exactly one query: the frame metadata. No polygons are fetched.
      expect(mockPrisma.image.findMany).toHaveBeenCalledTimes(1);
      const select = mockPrisma.image.findMany.mock.calls[0][0].select;
      expect(select.segmentation.select).not.toHaveProperty('polygons');
    });

    it('MISSES the cache after an edit bumps Segmentation.updatedAt', async () => {
      const cold = await buildKymograph(INPUT);
      expect(cold.pngBase64).toBe('iVBOR');

      // Same container, same frames, same polyline id — the user moved a
      // vertex, so only the geometry and Prisma's @updatedAt change.
      const edited = {
        ...POLYLINE_STATIC,
        points: [
          { x: 11, y: 21 },
          { x: 31, y: 41 },
        ],
      };
      const bumped = new Date(SEG_UPDATED_AT.getTime() + 1000);
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, null, {
          segmentation: {
            polygons: JSON.stringify([edited]),
            updatedAt: bumped,
          },
        }),
        makeFrame(1, null, {
          segmentation: {
            polygons: JSON.stringify([edited]),
            updatedAt: bumped,
          },
        }),
      ]);
      mockAxios.post = vi.fn().mockResolvedValue({
        data: { ...ML_RESPONSE.data, png_base64: 'AFTER_EDIT' },
      });

      const warm = await buildKymograph(INPUT);
      expect(lookupKey(1)).not.toBe(lookupKey(0));
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      // The re-render sampled the MOVED polyline, and the caller got it.
      expect(mockAxios.post.mock.calls[0][1].frames[0].polyline_rc).toEqual([
        [21, 11],
        [41, 31],
      ]);
      expect(warm.pngBase64).toBe('AFTER_EDIT');
    });

    it('MISSES the cache when the intensity floor changes', async () => {
      // The floor is applied by the ML service (so the overlay stays in step
      // with the table), which means a different floor is a different response
      // and has to be a different key. Without it the modal would serve the
      // previous threshold's tracks and the control would look inert — the
      // failure mode is silent, which is why it is pinned here.
      // The two calls differ in the floor and NOTHING else — including
      // `detectVelocity`, which would otherwise change the key on its own and
      // let this test pass with the floor missing from it.
      const withVelocity = { ...INPUT, detectVelocity: true };
      const cold = await buildKymograph(withVelocity);
      expect(cold.pngBase64).toBe('iVBOR');

      mockAxios.post = vi.fn().mockResolvedValue({
        data: { ...ML_RESPONSE.data, png_base64: 'FILTERED' },
      });
      const warm = await buildKymograph({
        ...withVelocity,
        minIntensityMinusBg: 20,
      });

      expect(lookupKey(1)).not.toBe(lookupKey(0));
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxios.post.mock.calls[0][1].min_intensity_minus_bg).toBe(20);
      expect(warm.pngBase64).toBe('FILTERED');
    });

    it('MISSES the cache when a frame image row is rewritten', async () => {
      await buildKymograph(INPUT);
      // A re-extracted channel PNG changes the pixels the kymograph samples
      // while leaving the segmentation untouched.
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC], {
          updatedAt: new Date(IMAGE_UPDATED_AT.getTime() + 1000),
        }),
        makeFrame(1, [POLYLINE_STATIC]),
      ]);

      await buildKymograph(INPUT);
      expect(lookupKey(1)).not.toBe(lookupKey(0));
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });

    it('MISSES the cache when a frame is added to the container', async () => {
      await buildKymograph(INPUT);
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
        makeFrame(1, [POLYLINE_STATIC]),
        makeFrame(2, [POLYLINE_STATIC]),
      ]);

      await buildKymograph(INPUT);
      expect(lookupKey(1)).not.toBe(lookupKey(0));
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });

    it('never touches Redis for a caller that did not opt in', async () => {
      // The export fan-out's shape: renders every polyline once and never
      // re-reads the result, so it must not fill a noeviction Redis.
      const exportInput = { ...INPUT, useCache: undefined };
      await buildKymograph(exportInput);
      await buildKymograph(exportInput);

      expect(cacheMocks.get).not.toHaveBeenCalled();
      expect(cacheMocks.set).not.toHaveBeenCalled();
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });

    it('MISSES the cache when the seed frame is edited outside the frameFilter', async () => {
      // The seed polyline is the geometry every frame falls back to, so an
      // edit to it must invalidate even though its own frame is not rendered.
      const filtered = { ...INPUT, frameFilter: [1, 2] };
      const frames = (seedUpdatedAt: Date) => [
        makeFrame(0, [POLYLINE_STATIC], {
          segmentation: {
            polygons: JSON.stringify([POLYLINE_STATIC]),
            updatedAt: seedUpdatedAt,
          },
        }),
        makeFrame(1, [POLYLINE_STATIC]),
        makeFrame(2, [POLYLINE_STATIC]),
      ];
      mockPrisma.image.findMany.mockResolvedValue(frames(SEG_UPDATED_AT));
      await buildKymograph(filtered);

      mockPrisma.image.findMany.mockResolvedValue(
        frames(new Date(SEG_UPDATED_AT.getTime() + 1000))
      );
      await buildKymograph(filtered);

      expect(lookupKey(1)).not.toBe(lookupKey(0));
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });

    it('MISSES the cache when the frame SET changes but its size does not', async () => {
      await buildKymograph(INPUT);
      // Frame 1 deleted, frame 5 present: same count, different frames, so a
      // key that carried only the frame count would wrongly hit.
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
        makeFrame(5, [POLYLINE_STATIC]),
      ]);

      await buildKymograph(INPUT);
      expect(lookupKey(1)).not.toBe(lookupKey(0));
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });

    it('MISSES the cache when the container row changes', async () => {
      await buildKymograph(INPUT);
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({
          updatedAt: new Date(CONTAINER_UPDATED_AT.getTime() + 1000),
        })
      );

      await buildKymograph(INPUT);
      expect(lookupKey(1)).not.toBe(lookupKey(0));
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });

    it('keys separately on every render parameter', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC, { ...POLYLINE_STATIC, id: 'poly-2' }]),
        makeFrame(1, [POLYLINE_STATIC, { ...POLYLINE_STATIC, id: 'poly-2' }]),
      ]);
      const variants = [
        INPUT,
        { ...INPUT, polylineId: 'poly-2' },
        { ...INPUT, frameIndex: 1 },
        { ...INPUT, sourceChannel: 'TIRF' },
        { ...INPUT, channelColor: '#ff0000' },
        { ...INPUT, detectVelocity: true },
        { ...INPUT, detectVelocity: true, renderOverlay: true },
        { ...INPUT, renderProfiles: true },
        { ...INPUT, intensityWidth: 7 },
        // The line width changes the sampled matrix itself, so two widths must
        // never share an entry — a hit would show the user the same picture
        // after they moved the control.
        { ...INPUT, lineWidth: 5 },
        { ...INPUT, lineWidth: 5, lineReduce: 'max' as const },
        { ...INPUT, frameFilter: [0] },
        { ...INPUT, videoContainerId: 'container-2' },
      ];
      for (const variant of variants) {
        await buildKymograph(variant);
      }

      const keys = cacheMocks.get.mock.calls.map(c => c[0]);
      expect(new Set(keys).size).toBe(variants.length);
      // Every one of them was a miss, so every one reached the ML service.
      expect(mockAxios.post).toHaveBeenCalledTimes(variants.length);
    });

    it('caches calibration alongside the container timestamp', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ pixelSizeUm: 0.07245 })
      );
      await buildKymograph(INPUT);
      // Same updatedAt (a raw-SQL backfill does not bump it), new calibration.
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ pixelSizeUm: 0.1 })
      );
      await buildKymograph(INPUT);

      expect(lookupKey(1)).not.toBe(lookupKey(0));
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });

    it('does not cache a response whose velocity detection crashed', async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: { ...ML_RESPONSE.data, velocity_error: 'blob detector blew up' },
      });
      await buildKymograph({ ...INPUT, detectVelocity: true });
      expect(cacheMocks.set).not.toHaveBeenCalled();

      // The next request retries the ML service instead of replaying the error.
      await buildKymograph({ ...INPUT, detectVelocity: true });
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });

    it('does not cache a response the ML service returned without a PNG', async () => {
      mockAxios.post = vi
        .fn()
        .mockResolvedValue({ data: { ...ML_RESPONSE.data, png_base64: '' } });
      await buildKymograph(INPUT);
      expect(cacheMocks.set).not.toHaveBeenCalled();
    });

    it('does not cache a response over the 4 MB entry limit', async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: { ...ML_RESPONSE.data, csv_base64: 'x'.repeat(5 * 1024 * 1024) },
      });
      const result = await buildKymograph(INPUT);
      // Still returned to the caller — only the store is skipped.
      expect(result.csvBase64).toHaveLength(5 * 1024 * 1024);
      expect(cacheMocks.set).not.toHaveBeenCalled();
    });

    it('renders normally when Redis is unavailable', async () => {
      // executeRedisCommand swallows a dead client: get resolves null, set false.
      cacheMocks.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      cacheMocks.set.mockResolvedValueOnce(false).mockResolvedValueOnce(false);

      const first = await buildKymograph(INPUT);
      const second = await buildKymograph(INPUT);
      expect(first).toEqual(second);
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });
  });

  // ── Polygon fetch cost ─────────────────────────────────────────────────────
  describe('polygon fetch cost', () => {
    beforeEach(() => {
      mockPrisma.image.findUnique.mockResolvedValue(makeContainer());
    });

    /** `where` of the Nth image.findMany call. */
    const whereOf = (call: number) =>
      mockPrisma.image.findMany.mock.calls[call][0].where;

    it('reads frame metadata without the polygons column', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
        makeFrame(1, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      const select = mockPrisma.image.findMany.mock.calls[0][0].select;
      expect(select).not.toHaveProperty('polygons');
      expect(select.segmentation.select).toEqual({ updatedAt: true });
    });

    it('reads only the seed frame polygons in static-line mode', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
        makeFrame(1, [POLYLINE_STATIC]),
        makeFrame(2, [POLYLINE_STATIC]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 1,
        sourceChannel: 'IRM',
      });

      // Metadata, then the seed frame's polygons. Nothing else: the other
      // frames reuse the seed geometry, so their polygons are never read.
      expect(mockPrisma.image.findMany).toHaveBeenCalledTimes(2);
      expect(whereOf(1).frameIndex).toEqual({ in: [1] });
    });

    it('reads sibling polygons for every other frame in tracked mode', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_TRACKED]),
        makeFrame(1, [POLYLINE_TRACKED]),
        makeFrame(2, [POLYLINE_TRACKED]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      });

      expect(mockPrisma.image.findMany).toHaveBeenCalledTimes(3);
      expect(whereOf(1).frameIndex).toEqual({ in: [0] });
      // The seed frame is excluded — its polygons were parsed once already.
      expect(whereOf(2).frameIndex).toEqual({ in: [1, 2] });
      // Asserted structurally: a mocked Prisma cannot reproduce the duplicate
      // (parentVideoId, frameIndex) rows this ordering exists to disambiguate,
      // but dropping it would silently let one cache key back two renders.
      expect(mockPrisma.image.findMany.mock.calls[2][0].orderBy).toEqual([
        { frameIndex: 'asc' },
        { id: 'asc' },
      ]);
    });

    it('narrows the tracked-mode fetch to the frameFilter selection', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_TRACKED]),
        makeFrame(1, [POLYLINE_TRACKED]),
        makeFrame(2, [POLYLINE_TRACKED]),
        makeFrame(3, [POLYLINE_TRACKED]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
        frameFilter: [0, 2],
      });

      expect(whereOf(2).frameIndex).toEqual({ in: [2] });
      const body = mockAxios.post.mock.calls[0][1];
      expect(body.frames.map((f: { frame: number }) => f.frame)).toEqual([
        0, 2,
      ]);
    });

    it('skips the second query entirely when the selection is the seed alone', async () => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_TRACKED]),
        makeFrame(1, [POLYLINE_TRACKED]),
      ]);
      await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
        frameFilter: [0],
      });

      expect(mockPrisma.image.findMany).toHaveBeenCalledTimes(2);
    });
  });

  // ── Prefetched per-container rows ────────────────────────────────────────
  //
  // Every kymograph of one container reads the identical container + frame
  // rows, so a caller building many of them (the MT export: up to 60
  // microtubules x every channel) loads them once and passes them in. These
  // guard that the shortcut is real (no queries at all) AND that it does not
  // change the request that reaches the ML service.
  describe('prefetched containerContext', () => {
    const CONTEXT = {
      container: {
        id: 'container-1',
        projectId: 'project-1',
        channels: [{ name: 'IRM' }, { name: 'GFP' }],
        pixelSizeUm: 0.5,
        frameIntervalMs: 200,
        updatedAt: CONTAINER_UPDATED_AT,
      },
      frames: [
        {
          id: 'frame-0',
          frameIndex: 0,
          updatedAt: IMAGE_UPDATED_AT,
          segmentationUpdatedAt: SEG_UPDATED_AT,
          polygonsJson: JSON.stringify([POLYLINE_STATIC]),
        },
        {
          id: 'frame-1',
          frameIndex: 1,
          updatedAt: IMAGE_UPDATED_AT,
          segmentationUpdatedAt: SEG_UPDATED_AT,
          polygonsJson: JSON.stringify([POLYLINE_STATIC]),
        },
      ],
    };

    it('issues NO database queries when the rows are supplied', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(makeContainer());
      mockPrisma.image.findMany.mockResolvedValue([]);

      const res = await buildKymograph({
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
        containerContext: structuredClone(CONTEXT),
      });

      expect(mockPrisma.image.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.image.findMany).not.toHaveBeenCalled();
      expect(res.pixelSizeUm).toBe(0.5);
      expect(res.frameIntervalMs).toBe(200);
    });

    it('builds the identical ML request it would have built from the DB', async () => {
      // Same rows, once through the DB and once prefetched: the POSTed body
      // must be byte-identical, or the export would silently drift from the
      // editor modal.
      mockPrisma.image.findUnique.mockResolvedValue(
        makeContainer({ channels: CONTEXT.container.channels })
      );
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [POLYLINE_STATIC]),
        makeFrame(1, [POLYLINE_STATIC]),
      ]);
      const args = {
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
      };
      await buildKymograph(args);
      const fromDb = JSON.stringify(mockAxios.post.mock.calls[0][1]);

      mockAxios.post = vi.fn().mockResolvedValue(ML_RESPONSE);
      await buildKymograph({
        ...args,
        containerContext: {
          ...structuredClone(CONTEXT),
          // pixelSize/frameInterval are absent from makeContainer(), so match
          // it here: the payload, not the calibration, is what is compared.
          container: {
            ...CONTEXT.container,
            pixelSizeUm: null,
            frameIntervalMs: null,
          },
        },
      });
      expect(JSON.stringify(mockAxios.post.mock.calls[0][1])).toBe(fromDb);
    });

    it('rejects a context belonging to a different container', async () => {
      // Silent-and-plausible otherwise: frame paths are built from the
      // context's projectId and the input's container id, so the mismatch
      // would render another container's frames under this one's calibration.
      await expect(
        buildKymograph({
          videoContainerId: 'container-2',
          polylineId: 'poly-1',
          frameIndex: 0,
          sourceChannel: 'IRM',
          containerContext: structuredClone(CONTEXT),
        })
      ).rejects.toThrow('containerContext is for container-1, not container-2');
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it('still whitelists the channel against the prefetched container', async () => {
      // A context is channel-agnostic — one load serves every channel — so the
      // per-call check cannot be skipped just because the rows came in ready.
      await expect(
        buildKymograph({
          videoContainerId: 'container-1',
          polylineId: 'poly-1',
          frameIndex: 0,
          sourceChannel: 'RFP',
          containerContext: structuredClone(CONTEXT),
        })
      ).rejects.toThrow('Unknown source channel: RFP');
    });

    it('parses each frame ONCE across repeated tracked-mode builds', async () => {
      // The reuse that matters for a 300-frame container: without memoisation
      // every build re-parses every frame's polygon JSON (~30 MB per build,
      // on the single Node event loop).
      const context = {
        ...structuredClone(CONTEXT),
        frames: [
          {
            id: 'frame-0',
            frameIndex: 0,
            updatedAt: IMAGE_UPDATED_AT,
            segmentationUpdatedAt: SEG_UPDATED_AT,
            polygonsJson: JSON.stringify([POLYLINE_TRACKED]),
          },
          {
            id: 'frame-1',
            frameIndex: 1,
            updatedAt: IMAGE_UPDATED_AT,
            segmentationUpdatedAt: SEG_UPDATED_AT,
            polygonsJson: JSON.stringify([POLYLINE_TRACKED]),
          },
        ],
      };
      const parseSpy = vi.spyOn(JSON, 'parse');
      const before = parseSpy.mock.calls.length;
      for (let i = 0; i < 5; i++) {
        mockAxios.post = vi.fn().mockResolvedValue(ML_RESPONSE);
        await buildKymograph({
          videoContainerId: 'container-1',
          polylineId: 'poly-1',
          frameIndex: 0,
          sourceChannel: 'IRM',
          containerContext: context,
        });
      }
      const polygonParses = parseSpy.mock.calls
        .slice(before)
        .filter(c => String(c[0]).includes('"poly-1"')).length;
      parseSpy.mockRestore();
      // 2 frames, 5 builds: 2 parses, not 10.
      expect(polygonParses).toBe(2);
    });

    it('still uses the response cache when the rows are prefetched', async () => {
      // The two optimisations compose: a context removes the queries, the
      // cache removes the ML render. A context is stamped with the same
      // updatedAt tokens the metadata query supplies, so the key is built the
      // same way on both paths.
      const cached = {
        videoContainerId: 'container-1',
        polylineId: 'poly-1',
        frameIndex: 0,
        sourceChannel: 'IRM',
        useCache: true,
        containerContext: structuredClone(CONTEXT),
      };
      await buildKymograph(cached);
      expect(mockAxios.post).toHaveBeenCalledTimes(1);

      await buildKymograph({ ...cached, containerContext: structuredClone(CONTEXT) });
      expect(mockAxios.post).toHaveBeenCalledTimes(1);

      // And an edit to a frame still invalidates it, exactly as on the DB path.
      const edited = structuredClone(CONTEXT);
      edited.frames[1].segmentationUpdatedAt = new Date(
        SEG_UPDATED_AT.getTime() + 1000
      );
      await buildKymograph({ ...cached, containerContext: edited });
      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });
  });
});

// ---------------------------------------------------------------------------
// buildKymographBatch
// ---------------------------------------------------------------------------

describe('buildKymographBatch', () => {
  const POLY_A = {
    id: 'poly-a',
    points: [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ],
    geometry: 'polyline',
  };
  const POLY_B = {
    id: 'poly-b',
    points: [
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ],
    geometry: 'polyline',
  };

  const inputFor = (polylineId: string, overrides?: object) => ({
    videoContainerId: 'container-1',
    polylineId,
    frameIndex: 0,
    sourceChannel: 'IRM',
    ...overrides,
  });

  const item = (overrides?: object) => ({
    kymograph: {
      png_base64: 'iVBOR',
      csv_base64: 'ZnJhbW',
      frame_count: 2,
      length_px: 55,
      ...overrides,
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    cacheMocks.store.clear();
    mockPrisma.image.findUnique.mockResolvedValue(
      makeContainer({ projectId: 'proj-42' })
    );
    mockPrisma.image.findMany.mockResolvedValue([
      makeFrame(0, [POLY_A, POLY_B]),
      makeFrame(1, [POLY_A, POLY_B]),
    ]);
  });

  it('carries exactly the bodies the single endpoint would have posted', async () => {
    // The claim the whole change rests on. If these ever diverge, the batch is
    // no longer a transport for the same render and the exported numbers are
    // free to move — so compare the bodies, not the results.
    mockAxios.post = vi.fn().mockResolvedValue({ data: ML_RESPONSE.data });
    await buildKymograph(inputFor('poly-a'));
    await buildKymograph(inputFor('poly-b'));
    const single = mockAxios.post.mock.calls.map(c => c[1]);

    mockAxios.post = vi.fn().mockResolvedValue({
      data: { results: [item(), item()] },
    });
    await buildKymographBatch([inputFor('poly-a'), inputFor('poly-b')]);

    expect(mockAxios.post).toHaveBeenCalledTimes(1);
    expect(mockAxios.post.mock.calls[0][0]).toBe(
      'http://ml:8000/api/v1/kymograph/batch'
    );
    expect(mockAxios.post.mock.calls[0][1]).toEqual({ items: single });
  });

  it('returns one outcome per input, in input order', async () => {
    mockAxios.post = vi.fn().mockResolvedValue({
      data: {
        results: [item({ length_px: 11 }), item({ length_px: 22 })],
      },
    });
    const out = await buildKymographBatch([
      inputFor('poly-a'),
      inputFor('poly-b'),
    ]);
    expect(out.map(o => o.result?.lengthPx)).toEqual([11, 22]);
  });

  it('turns a per-item ML error into that item only', async () => {
    mockAxios.post = vi.fn().mockResolvedValue({
      data: {
        results: [{ error: 'Seed-frame polyline has 1 vertex(es)' }, item()],
      },
    });
    const out = await buildKymographBatch([
      inputFor('poly-a'),
      inputFor('poly-b'),
    ]);
    expect(out[0].result).toBeUndefined();
    expect(out[0].error?.message).toContain('1 vertex(es)');
    expect(out[1].result?.pngBase64).toBe('iVBOR');
  });

  it('does not send an input whose body could not be built, and keeps the rest aligned', async () => {
    // A missing polyline throws in Node, before the request. The surviving
    // items must still map back to THEIR inputs — an off-by-one here would
    // publish one microtubule's velocities under another's name.
    mockAxios.post = vi.fn().mockResolvedValue({
      data: { results: [item({ length_px: 99 })] },
    });
    const out = await buildKymographBatch([
      inputFor('poly-missing'),
      inputFor('poly-b'),
    ]);
    expect(mockAxios.post.mock.calls[0][1].items).toHaveLength(1);
    expect(out[0].error?.message).toContain('poly-missing');
    expect(out[1].result?.lengthPx).toBe(99);
  });

  it('never posts at all when every input failed to build', async () => {
    mockAxios.post = vi.fn();
    const out = await buildKymographBatch([inputFor('poly-missing')]);
    expect(mockAxios.post).not.toHaveBeenCalled();
    expect(out[0].error).toBeInstanceOf(Error);
  });

  it('fails every item of a request whose result count does not match', async () => {
    // Without this the k-th result would be read as the k-th item's kymograph
    // and one microtubule's numbers would ship under another's name. Reported
    // per item rather than thrown, because a batch may now travel as several
    // requests and the ones that succeeded are still valid.
    mockAxios.post = vi.fn().mockResolvedValue({ data: { results: [item()] } });
    const out = await buildKymographBatch([
      inputFor('poly-a'),
      inputFor('poly-b'),
    ]);
    expect(out.map(o => o.result)).toEqual([undefined, undefined]);
    expect(out[0].error?.message).toContain('1 result(s) for 2 item(s)');
    expect(out[1].error?.message).toContain('1 result(s) for 2 item(s)');
  });

  it('reports an ML request failure against its own items only', async () => {
    // e.g. an ml container old enough not to have /kymograph/batch, or a
    // network drop. Every item of that request fails; none is misattributed.
    mockAxios.post = vi
      .fn()
      .mockRejectedValue(new Error('Request failed with status code 404'));
    const out = await buildKymographBatch([
      inputFor('poly-a'),
      inputFor('poly-b'),
    ]);
    expect(out.map(o => o.error?.message)).toEqual([
      'Request failed with status code 404',
      'Request failed with status code 404',
    ]);
  });

  describe('output-size budget', () => {
    /** A polyline of a known arc length, so the item's output size (frames x
     *  columns) is arithmetic rather than a guess. The ML column rule is one
     *  column per pixel of the seed frame's arc length. */
    const longPoly = (id: string, arcPx: number) => ({
      id,
      points: [
        { x: 0, y: 0 },
        { x: 0, y: arcPx },
      ],
      geometry: 'polyline',
    });

    /** 2 frames x (arc + 1) columns per item. At 2 000 000 px of arc that is
     *  4 000 002 output pixels, so ONE item already exceeds the 3 840 000
     *  budget and two can never share a request. */
    const ARC = 2_000_000;

    beforeEach(() => {
      mockPrisma.image.findMany.mockResolvedValue([
        makeFrame(0, [longPoly('poly-a', ARC), longPoly('poly-b', ARC)]),
        makeFrame(1, [longPoly('poly-a', ARC), longPoly('poly-b', ARC)]),
      ]);
    });

    it('splits into as many ML requests as the budget allows', async () => {
      // The ML service refuses an oversized batch (413). Before the column cap
      // was removed this could not arise: 64 items of 200 columns was the
      // budget, so the item cap and the size bound were the same statement.
      mockAxios.post = vi
        .fn()
        .mockResolvedValue({ data: { results: [item()] } });
      const out = await buildKymographBatch([
        inputFor('poly-a'),
        inputFor('poly-b'),
      ]);

      expect(mockAxios.post).toHaveBeenCalledTimes(2);
      expect(mockAxios.post.mock.calls[0][1].items).toHaveLength(1);
      expect(mockAxios.post.mock.calls[1][1].items).toHaveLength(1);
      expect(out.map(o => o.result?.lengthPx)).toEqual([55, 55]);
    });

    it('keeps the results of a request that already succeeded', async () => {
      // The reason a failure is per item and not a throw: discarding a whole
      // channel's finished kymographs because a later request dropped would be
      // strictly worse than what the un-split batch did.
      mockAxios.post = vi
        .fn()
        .mockResolvedValueOnce({ data: { results: [item({ length_px: 7 })] } })
        .mockRejectedValueOnce(new Error('socket hang up'));
      const out = await buildKymographBatch([
        inputFor('poly-a'),
        inputFor('poly-b'),
      ]);

      expect(out[0].result?.lengthPx).toBe(7);
      expect(out[1].error?.message).toBe('socket hang up');
    });

    it('sends a single oversized item on its own rather than refusing it', async () => {
      // `/kymograph` renders any one kymograph regardless of size, and the ML
      // batch endpoint exempts a one-item batch for that reason. A 621-frame
      // movie of a 2000 px microtubule must not become unexportable.
      mockAxios.post = vi
        .fn()
        .mockResolvedValue({ data: { results: [item()] } });
      const out = await buildKymographBatch([inputFor('poly-a')]);

      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxios.post.mock.calls[0][1].items).toHaveLength(1);
      expect(out[0].result?.lengthPx).toBe(55);
    });
  });

  it('forwards include_csv:false and maps the null back', async () => {
    mockAxios.post = vi.fn().mockResolvedValue({
      data: { results: [item({ csv_base64: null })] },
    });
    const out = await buildKymographBatch([
      inputFor('poly-a', { includeCsv: false }),
    ]);
    expect(mockAxios.post.mock.calls[0][1].items[0].include_csv).toBe(false);
    expect(out[0].result?.csvBase64).toBeNull();
  });

  it('omits include_csv entirely when the caller did not opt out', async () => {
    // So a caller that never heard of the field posts byte-for-byte the body
    // it posted before the field existed.
    mockAxios.post = vi.fn().mockResolvedValue({ data: { results: [item()] } });
    await buildKymographBatch([inputFor('poly-a')]);
    expect(mockAxios.post.mock.calls[0][1].items[0]).not.toHaveProperty(
      'include_csv'
    );
  });

  it('never touches the response cache', async () => {
    // The export renders every polyline exactly once; caching them would fill
    // a `noeviction` Redis with entries nothing will read.
    mockAxios.post = vi.fn().mockResolvedValue({ data: { results: [item()] } });
    await buildKymographBatch([inputFor('poly-a', { useCache: true })]);
    expect(cacheMocks.get).not.toHaveBeenCalled();
    expect(cacheMocks.set).not.toHaveBeenCalled();
  });
});
