/**
 * Unit tests for mtMetricsExporter.ts
 *
 * Exercises the pure-logic helpers that can run without a real ML service:
 *   - resolveChannelIndices (name / displayName matching, skipped channels)
 *   - detectFileKind       (extension + MIME fallback)
 *   - safeParsePolygons    (valid JSON, bad JSON, non-array)
 *   - CHANNEL_NAME_RE      validation inside computeMTMetrics
 *   - computeMTGeometry    (geometry-only, px→µm conversion)
 *   - computeMTMetrics     (grouping, empty-channels early exit, ML payload
 *                           shape, px→µm conversion on ML response)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock config FIRST — it process.exit(1)s when env is incomplete.
// ---------------------------------------------------------------------------
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    SEGMENTATION_SERVICE_URL: 'http://ml-mock:8000',
    UPLOAD_DIR: '/app/uploads',
  },
}));

// ---------------------------------------------------------------------------
// Hoist prisma + axios mocks so they're available in factory closures.
// ---------------------------------------------------------------------------
const { prismaMock, axiosPostMock } = vi.hoisted(() => ({
  prismaMock: {
    image: {
      findMany: vi.fn() as ReturnType<typeof vi.fn>,
    },
  },
  axiosPostMock: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock('../../../db/prismaClient', () => ({ prisma: prismaMock }));
vi.mock('axios', () => ({
  default: { post: axiosPostMock },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import after mocks are in place.
// ---------------------------------------------------------------------------
import {
  computeMTMetrics,
  computeMTGeometry,
  type MTMetricsOptions,
  type MTMetricsRow,
} from '../mtMetricsExporter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrame(
  overrides: Partial<{
    id: string;
    parentVideoId: string | null;
    frameIndex: number | null;
    isVideoContainer: boolean;
    segmentation: { polygons: string | null } | null;
  }> = {}
) {
  return {
    id: 'frame-1',
    parentVideoId: 'video-1',
    frameIndex: 0,
    isVideoContainer: false,
    segmentation: null,
    ...overrides,
  };
}

function polylineJson(
  points: Array<{ x: number; y: number }>,
  extra: Record<string, unknown> = {}
) {
  return JSON.stringify([
    {
      geometry: 'polyline',
      points,
      instanceId: 'inst-abc',
      trackId: 'track-42',
      ...extra,
    },
  ]);
}

const BASE_OPTIONS: MTMetricsOptions = {
  thicknessPx: 3,
  marginMultiplier: 1.5,
  channels: ['DAPI'],
  pixelToMicrometerScale: 0.1,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeMTGeometry', () => {
  it('returns empty array when there are no frames', () => {
    expect(computeMTGeometry([], null)).toEqual([]);
  });

  it('skips video containers and frames without parentVideoId / frameIndex', () => {
    const rows = computeMTGeometry(
      [
        makeFrame({ isVideoContainer: true }),
        makeFrame({ parentVideoId: null }),
        makeFrame({ frameIndex: null }),
      ],
      null
    );
    expect(rows).toHaveLength(0);
  });

  it('skips frames with no segmentation data', () => {
    const rows = computeMTGeometry([makeFrame({ segmentation: null })], 0.5);
    expect(rows).toHaveLength(0);
  });

  it('skips polygons (closed geometry) and only emits polylines', () => {
    const polygons = JSON.stringify([
      {
        geometry: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 0 },
        ],
      },
      {
        geometry: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 3, y: 4 },
        ],
      },
    ]);
    const rows = computeMTGeometry(
      [makeFrame({ segmentation: { polygons } })],
      null
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe('');
  });

  it('skips polylines with fewer than 2 points', () => {
    const bad = JSON.stringify([
      { geometry: 'polyline', points: [{ x: 0, y: 0 }] },
    ]);
    const rows = computeMTGeometry(
      [makeFrame({ segmentation: { polygons: bad } })],
      null
    );
    expect(rows).toHaveLength(0);
  });

  it('computes arc-length correctly for a 3-4-5 right triangle polyline', () => {
    // (0,0)→(3,0)→(3,4): segments = 3 + 4 = 7 px
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    const rows = computeMTGeometry(
      [makeFrame({ segmentation: { polygons: polylineJson(pts) } })],
      null
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lengthPx).toBeCloseTo(7, 5);
  });

  it('converts px→µm when scale is provided', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const scale = 0.25;
    const rows = computeMTGeometry(
      [makeFrame({ segmentation: { polygons: polylineJson(pts) } })],
      scale
    );
    expect(rows[0].lengthPx).toBeCloseTo(10, 5);
    expect(rows[0].lengthUm).toBeCloseTo(2.5, 5);
  });

  it('leaves lengthUm as null when scale is null', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ];
    const rows = computeMTGeometry(
      [makeFrame({ segmentation: { polygons: polylineJson(pts) } })],
      null
    );
    expect(rows[0].lengthUm).toBeNull();
  });

  it('sets intensity columns to null (geometry-only row)', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    const rows = computeMTGeometry(
      [makeFrame({ segmentation: { polygons: polylineJson(pts) } })],
      null
    );
    const r = rows[0];
    expect(r.areaPx).toBeNull();
    expect(r.areaUm2).toBeNull();
    expect(r.pixelCount).toBeNull();
    expect(r.sumIntensity).toBeNull();
    expect(r.meanIntensity).toBeNull();
    expect(r.stdIntensity).toBeNull();
    expect(r.medianBackground).toBeNull();
    expect(r.signalMinusBackground).toBeNull();
  });

  it('uses trackId / instanceId from the polygon, falling back to generated id', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    const withIds = JSON.stringify([
      {
        geometry: 'polyline',
        points: pts,
        instanceId: 'my-inst',
        trackId: 'my-track',
      },
    ]);
    const withoutIds = JSON.stringify([{ geometry: 'polyline', points: pts }]);

    const [r1] = computeMTGeometry(
      [makeFrame({ segmentation: { polygons: withIds } })],
      null
    );
    expect(r1.instanceId).toBe('my-inst');
    expect(r1.trackId).toBe('my-track');

    const [r2] = computeMTGeometry(
      [makeFrame({ id: 'abcd1234', segmentation: { polygons: withoutIds } })],
      null
    );
    expect(r2.instanceId).toMatch(/^mt_abcd1234/);
    expect(r2.trackId).toBeNull();
  });

  it('emits one row per polyline across multiple frames', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    const seg = { polygons: polylineJson(pts) };
    const frames = [
      makeFrame({ id: 'f1', frameIndex: 0, segmentation: seg }),
      makeFrame({ id: 'f2', frameIndex: 1, segmentation: seg }),
    ];
    const rows = computeMTGeometry(frames, null);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.frameIndex)).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// computeMTMetrics — logic paths that do NOT hit the real ML service
// ---------------------------------------------------------------------------

describe('computeMTMetrics — early-exit paths (no ML call)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array immediately when channels is empty', async () => {
    const result = await computeMTMetrics([], 'proj-1', {
      ...BASE_OPTIONS,
      channels: [],
    });
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('throws on invalid channel name (special chars)', async () => {
    await expect(
      computeMTMetrics([makeFrame()], 'proj-1', {
        ...BASE_OPTIONS,
        channels: ['bad channel!'],
      })
    ).rejects.toThrow(/Invalid channel name/);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('throws on channel name exceeding 64 characters', async () => {
    const tooLong = 'a'.repeat(65);
    await expect(
      computeMTMetrics([makeFrame()], 'proj-1', {
        ...BASE_OPTIONS,
        channels: [tooLong],
      })
    ).rejects.toThrow(/Invalid channel name/);
  });

  it('returns empty array when all images are video containers', async () => {
    const result = await computeMTMetrics(
      [makeFrame({ isVideoContainer: true })],
      'proj-1',
      BASE_OPTIONS
    );
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('returns empty array when no image has a parentVideoId', async () => {
    const result = await computeMTMetrics(
      [makeFrame({ parentVideoId: null })],
      'proj-1',
      BASE_OPTIONS
    );
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('returns empty array when container DB row is missing', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([]);
    const result = await computeMTMetrics(
      [makeFrame()],
      'proj-1',
      BASE_OPTIONS
    );
    expect(result.rows).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('skips container when fileKind cannot be detected', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([
      {
        id: 'video-1',
        originalPath: 'projects/p1/images/video-1/original.avi',
        mimeType: 'video/avi',
        channels: [{ name: 'DAPI' }],
      },
    ]);
    const result = await computeMTMetrics(
      [makeFrame()],
      'proj-1',
      BASE_OPTIONS
    );
    expect(result.rows).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('skips container when channels JSON is empty', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([
      {
        id: 'video-1',
        originalPath: 'projects/p1/video.nd2',
        mimeType: 'image/nd2',
        channels: [],
      },
    ]);
    const result = await computeMTMetrics(
      [makeFrame()],
      'proj-1',
      BASE_OPTIONS
    );
    expect(result.rows).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('skips container when selected channels do not overlap container channels', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([
      {
        id: 'video-1',
        originalPath: 'projects/p1/video.nd2',
        mimeType: null,
        channels: [{ name: 'GFP', displayName: 'Green' }],
      },
    ]);
    // 'DAPI' not in the container's channel list
    const result = await computeMTMetrics(
      [makeFrame()],
      'proj-1',
      BASE_OPTIONS
    );
    expect(result.rows).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('skips video when all frames have no polylines', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([
      {
        id: 'video-1',
        originalPath: 'projects/p1/video.nd2',
        mimeType: null,
        channels: [{ name: 'DAPI' }],
      },
    ]);
    // Frame with polygon (not polyline)
    const polygonOnly = JSON.stringify([
      {
        geometry: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 0 },
        ],
      },
    ]);
    const result = await computeMTMetrics(
      [makeFrame({ segmentation: { polygons: polygonOnly } })],
      'proj-1',
      BASE_OPTIONS
    );
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// computeMTMetrics — successful ML call and response mapping
// ---------------------------------------------------------------------------

describe('computeMTMetrics — ML request payload and response mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const containerRow = {
    id: 'video-1',
    originalPath: 'projects/p1/video.nd2',
    mimeType: null,
    channels: [{ name: 'BF' }, { name: 'DAPI' }],
  };

  const frameSeg = polylineJson(
    [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ],
    { instanceId: 'inst-1', trackId: 'track-7' }
  );

  const mlResponse = {
    data: {
      rows: [
        {
          frame_index: 0,
          image_id: 'frame-1',
          instance_id: 'inst-1',
          track_id: 'track-7',
          channel: 'DAPI',
          length_px: 28.28,
          area_px: 56.56,
          pixel_count: 100,
          sum_intensity: 5000,
          mean_intensity: 50,
          std_intensity: 5,
          median_background: 10,
          signal_minus_background: 40,
        },
      ],
      frames_processed: 1,
      frame_height: 512,
      frame_width: 512,
    },
  };

  it('sends correct ML request payload (path, fileKind, channelIndices, frames)', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([containerRow]);
    axiosPostMock.mockResolvedValueOnce(mlResponse);

    await computeMTMetrics(
      [makeFrame({ segmentation: { polygons: frameSeg } })],
      'proj-1',
      { ...BASE_OPTIONS, channels: ['DAPI'] }
    );

    expect(axiosPostMock).toHaveBeenCalledOnce();
    const [url, body] = axiosPostMock.mock.calls[0];

    expect(url).toBe('http://ml-mock:8000/api/v1/mt-metrics');
    expect(body.file_kind).toBe('nd2');
    // 'DAPI' is at index 1 in the container channels array
    expect(body.channel_indices).toEqual([1]);
    expect(body.channel_names).toEqual(['DAPI']);
    expect(body.original_path).toContain('/app/uploads');
    expect(body.original_path).toContain('projects/p1/video.nd2');
    expect(body.thickness_px).toBe(3);
    expect(body.margin_multiplier).toBe(1.5);
  });

  it('maps ML response rows to MTMetricsRow with px→µm conversion', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([containerRow]);
    axiosPostMock.mockResolvedValueOnce(mlResponse);

    const scale = 0.1;
    const { rows } = await computeMTMetrics(
      [makeFrame({ segmentation: { polygons: frameSeg } })],
      'proj-1',
      { ...BASE_OPTIONS, pixelToMicrometerScale: scale, channels: ['DAPI'] }
    );

    expect(rows).toHaveLength(1);
    const r = rows[0];

    expect(r.frameIndex).toBe(0);
    expect(r.imageId).toBe('frame-1');
    expect(r.instanceId).toBe('inst-1');
    expect(r.trackId).toBe('track-7');
    expect(r.channel).toBe('DAPI');
    expect(r.lengthPx).toBeCloseTo(28.28, 3);
    expect(r.lengthUm).toBeCloseTo(28.28 * scale, 6);
    expect(r.areaPx).toBeCloseTo(56.56, 3);
    expect(r.areaUm2).toBeCloseTo(56.56 * scale * scale, 6);
    expect(r.pixelCount).toBe(100);
    expect(r.sumIntensity).toBe(5000);
    expect(r.meanIntensity).toBe(50);
    expect(r.stdIntensity).toBe(5);
    expect(r.medianBackground).toBe(10);
    expect(r.signalMinusBackground).toBe(40);
  });

  it('sets lengthUm and areaUm2 to null when scale is null', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([containerRow]);
    axiosPostMock.mockResolvedValueOnce(mlResponse);

    const { rows } = await computeMTMetrics(
      [makeFrame({ segmentation: { polygons: frameSeg } })],
      'proj-1',
      { ...BASE_OPTIONS, pixelToMicrometerScale: null, channels: ['DAPI'] }
    );

    expect(rows[0].lengthUm).toBeNull();
    expect(rows[0].areaUm2).toBeNull();
  });

  it('re-throws when ML request fails', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([containerRow]);
    axiosPostMock.mockRejectedValueOnce(new Error('ML timeout'));

    await expect(
      computeMTMetrics(
        [makeFrame({ segmentation: { polygons: frameSeg } })],
        'proj-1',
        { ...BASE_OPTIONS, channels: ['DAPI'] }
      )
    ).rejects.toThrow('ML timeout');
  });

  it('resolves channel by displayName when name does not match', async () => {
    const containerWithDisplayNames = {
      ...containerRow,
      channels: [
        { name: 'ch0', displayName: 'Blue' },
        { name: 'ch1', displayName: 'DAPI' },
      ],
    };
    prismaMock.image.findMany.mockResolvedValueOnce([
      containerWithDisplayNames,
    ]);
    axiosPostMock.mockResolvedValueOnce(mlResponse);

    await computeMTMetrics(
      [makeFrame({ segmentation: { polygons: frameSeg } })],
      'proj-1',
      // Select by displayName
      { ...BASE_OPTIONS, channels: ['DAPI'] }
    );

    const [, body] = axiosPostMock.mock.calls[0];
    // 'DAPI' matches displayName of ch1 → index 1; canonical name is 'ch1'
    expect(body.channel_indices).toEqual([1]);
    expect(body.channel_names).toEqual(['ch1']);
  });

  it('detects TIFF file kind from extension', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([
      {
        ...containerRow,
        originalPath: 'projects/p1/video.tiff',
        mimeType: null,
      },
    ]);
    axiosPostMock.mockResolvedValueOnce(mlResponse);

    await computeMTMetrics(
      [makeFrame({ segmentation: { polygons: frameSeg } })],
      'proj-1',
      { ...BASE_OPTIONS, channels: ['DAPI'] }
    );

    const [, body] = axiosPostMock.mock.calls[0];
    expect(body.file_kind).toBe('tiff');
  });

  it('detects ND2 file kind from mimeType when extension is ambiguous', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([
      {
        ...containerRow,
        originalPath: 'projects/p1/video.dat',
        mimeType: 'image/nd2',
      },
    ]);
    axiosPostMock.mockResolvedValueOnce(mlResponse);

    await computeMTMetrics(
      [makeFrame({ segmentation: { polygons: frameSeg } })],
      'proj-1',
      { ...BASE_OPTIONS, channels: ['DAPI'] }
    );

    const [, body] = axiosPostMock.mock.calls[0];
    expect(body.file_kind).toBe('nd2');
  });

  it('includes only frames that have polylines in the payload', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([containerRow]);
    axiosPostMock.mockResolvedValueOnce({
      data: {
        rows: [],
        frames_processed: 1,
        frame_height: 512,
        frame_width: 512,
      },
    });

    const polygonOnly = JSON.stringify([
      {
        geometry: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 0 },
        ],
      },
    ]);

    await computeMTMetrics(
      [
        makeFrame({
          id: 'f1',
          frameIndex: 0,
          segmentation: { polygons: frameSeg },
        }),
        // Frame with only a closed polygon — should NOT appear in payload
        makeFrame({
          id: 'f2',
          frameIndex: 1,
          segmentation: { polygons: polygonOnly },
        }),
      ],
      'proj-1',
      { ...BASE_OPTIONS, channels: ['DAPI'] }
    );

    const [, body] = axiosPostMock.mock.calls[0];
    expect(body.frames).toHaveLength(1);
    expect(body.frames[0].image_id).toBe('f1');
  });

  it('flattens rows from multiple videos into a single result array', async () => {
    prismaMock.image.findMany.mockResolvedValueOnce([
      { ...containerRow, id: 'video-1' },
      { ...containerRow, id: 'video-2' },
    ]);

    const singleRow = (imageId: string) => ({
      data: {
        rows: [{ ...mlResponse.data.rows[0], image_id: imageId }],
        frames_processed: 1,
        frame_height: 512,
        frame_width: 512,
      },
    });

    axiosPostMock
      .mockResolvedValueOnce(singleRow('frame-a'))
      .mockResolvedValueOnce(singleRow('frame-b'));

    const { rows } = await computeMTMetrics(
      [
        makeFrame({
          id: 'frame-a',
          parentVideoId: 'video-1',
          segmentation: { polygons: frameSeg },
        }),
        makeFrame({
          id: 'frame-b',
          parentVideoId: 'video-2',
          segmentation: { polygons: frameSeg },
        }),
      ],
      'proj-1',
      { ...BASE_OPTIONS, channels: ['DAPI'] }
    );

    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.imageId)).toEqual(['frame-a', 'frame-b']);
  });
});

// ---------------------------------------------------------------------------
// safeParsePolygons — accessed indirectly via computeMTGeometry
// ---------------------------------------------------------------------------

describe('safeParsePolygons (via computeMTGeometry)', () => {
  it('handles null segmentation gracefully', () => {
    expect(() =>
      computeMTGeometry([makeFrame({ segmentation: null })], null)
    ).not.toThrow();
  });

  it('handles malformed JSON gracefully', () => {
    const rows = computeMTGeometry(
      [makeFrame({ segmentation: { polygons: '{not: valid json' } })],
      null
    );
    expect(rows).toEqual([]);
  });

  it('handles non-array JSON gracefully', () => {
    const rows = computeMTGeometry(
      [makeFrame({ segmentation: { polygons: '"just a string"' } })],
      null
    );
    expect(rows).toEqual([]);
  });

  it('handles empty array', () => {
    const rows = computeMTGeometry(
      [makeFrame({ segmentation: { polygons: '[]' } })],
      null
    );
    expect(rows).toEqual([]);
  });
});
