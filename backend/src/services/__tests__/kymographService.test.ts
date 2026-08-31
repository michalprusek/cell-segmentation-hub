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

import { buildKymograph } from '../kymographService';
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

    it('sets tracked=false and target_width=200 in static-line mode', async () => {
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
      expect(body.target_width).toBe(200);
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
        intensity_width: 3,
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
});
