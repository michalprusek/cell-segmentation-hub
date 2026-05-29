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
});
