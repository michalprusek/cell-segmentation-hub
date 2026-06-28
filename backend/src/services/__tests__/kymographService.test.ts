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

function makeContainer(overrides?: object) {
  return {
    id: 'container-1',
    projectId: 'project-1',
    isVideoContainer: true,
    channels: [] as Array<{ name: string }>,
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
    segmentation: polygons ? { polygons: JSON.stringify(polygons) } : null,
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

    it('falls back to static seed when a frame has invalid JSON polygons', async () => {
      const frames = [
        makeFrame(0, [POLYLINE_STATIC]),
        {
          id: 'frame-1',
          frameIndex: 1,
          segmentation: { polygons: 'NOT_JSON' },
        },
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
      expect(mockAxios.post.mock.calls[0][1]).not.toHaveProperty('pixel_size_um');
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
      expect(mockAxios.post.mock.calls[0][1]).not.toHaveProperty('pixel_size_um');
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
});
