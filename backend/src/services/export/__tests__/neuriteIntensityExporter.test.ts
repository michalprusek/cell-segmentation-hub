/**
 * The Node half of the per-class intensity table.
 *
 * The statistics are the ML service's and are tested there. What can go wrong
 * HERE is which file is named for which channel, what counts as a hole, and
 * whether a frame that cannot be measured says why.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The suite-wide setup mocks the filesystem; the last two tests here read
// back what the writer put on disk, so they need the real one.
vi.unmock('fs/promises');
vi.unmock('fs');

vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    SEGMENTATION_SERVICE_URL: 'http://ml-mock:8000',
    UPLOAD_DIR: '/app/uploads',
  },
}));

vi.mock('axios', () => {
  const post = vi.fn();
  const isAxiosError = (e: unknown) =>
    Boolean((e as { isAxiosError?: boolean })?.isAxiosError);
  return { default: { post, isAxiosError }, post, isAxiosError };
});

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../../db/prismaClient', () => ({
  prisma: { image: { findMany } },
}));

import axios from 'axios';
import {
  computeNeuriteIntensity,
  type NeuriteIntensityImage,
} from '../neuriteIntensityExporter';
import {
  computeNeuriteMetrics,
  splitNeuritePolygons,
  writeNeuriteMetrics,
  INTENSITY_HEADERS,
} from '../neuriteMetricsExporter';

const post = axios.post as unknown as ReturnType<typeof vi.fn>;

const square = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

const POLYGONS = JSON.stringify([
  { id: 's1', type: 'external', partClass: 'soma', points: square(10, 10, 30) },
  {
    id: 'n1',
    type: 'external',
    partClass: 'neurite',
    points: square(50, 10, 60),
  },
  // The inside of a neurite loop. No class of its own.
  { id: 'h1', type: 'internal', parent_id: 'n1', points: square(60, 20, 20) },
]);

function frame(
  overrides: Partial<NeuriteIntensityImage> = {}
): NeuriteIntensityImage {
  return {
    id: 'frame-7',
    name: 'stack.tif (frame 7)',
    width: 512,
    height: 512,
    originalPath: 'projects/p1/images/v1/frames/0007/Channel_1.png',
    parentVideoId: 'v1',
    isVideoContainer: false,
    segmentation: { polygons: POLYGONS },
    ...overrides,
  };
}

const row = (channel: string, cls: string) => ({
  frame: 'stack.tif (frame 7)',
  ...mlRow(channel, cls),
});

/** A row exactly as the ML service sends it: it does NOT carry the frame. */
const mlRow = (channel: string, cls: string) => ({
  channel,
  class: cls,
  area_px: 10,
  mean_intensity: 5,
  median_intensity: 5,
  std_intensity: 0,
  sum_intensity: 50,
  background_median: 1,
  background_area_px: 100,
  mean_minus_background: 4,
});

beforeEach(() => {
  post.mockReset();
  findMany.mockReset();
  findMany.mockResolvedValue([
    {
      id: 'v1',
      channels: [
        { name: 'Channel_1', displayName: 'MAP7', sparseFill: { '7': 5 } },
        { name: 'Channel_2', displayName: 'tau' },
      ],
    },
  ]);
  post.mockResolvedValue({
    data: { frame: 'x', rows: [mlRow('MAP7', 'soma'), mlRow('tau', 'soma')] },
  });
});

describe('splitNeuritePolygons', () => {
  it('folds an internal polygon into the holes of its parent', () => {
    const split = splitNeuritePolygons(POLYGONS);
    expect(split?.soma.map(p => p.polygon_id)).toEqual(['s1']);
    expect(split?.neurite.map(p => p.polygon_id)).toEqual(['n1']);
    // The hole is not a neurite of its own ...
    expect(split?.neurite).toHaveLength(1);
    // ... it is subtracted from the one it belongs to.
    expect(split?.neurite[0]?.holes).toEqual([
      [
        [60, 20],
        [80, 20],
        [80, 40],
        [60, 40],
      ],
    ]);
    expect(split?.soma[0]?.holes).toBeUndefined();
  });

  it('never reads a hole as a region, even one that carries a class', () => {
    const split = splitNeuritePolygons(
      JSON.stringify([
        { id: 'n1', partClass: 'neurite', points: square(0, 0, 50) },
        {
          id: 'h1',
          type: 'internal',
          parent_id: 'n1',
          partClass: 'neurite',
          points: square(10, 10, 10),
        },
      ])
    );
    expect(split?.neurite).toHaveLength(1);
    expect(split?.neurite[0]?.holes).toHaveLength(1);
  });

  describe('a polygon with no class, nested in a region, is a hole of it', () => {
    const neurite = (id: string, x: number, y: number, size: number) => ({
      id,
      partClass: 'neurite',
      points: square(x, y, size),
    });
    const split = (polygons: unknown[]) =>
      splitNeuritePolygons(JSON.stringify(polygons));

    it('cuts the hole out of the region that contains it', () => {
      const out = split([
        neurite('n1', 0, 0, 100),
        { id: 'drawn', points: square(30, 30, 20) },
      ]);
      expect(out?.neurite).toHaveLength(1);
      expect(out?.neurite[0]?.holes).toEqual([
        [
          [30, 30],
          [50, 30],
          [50, 50],
          [30, 50],
        ],
      ]);
    });

    it('gives it to the SMALLEST region around it', () => {
      // Two regions contain it; the hole is in the inner one.
      const out = split([
        neurite('big', 0, 0, 200),
        { id: 's', partClass: 'soma', points: square(40, 40, 60) },
        { id: 'drawn', points: square(60, 60, 10) },
      ]);
      expect(out?.soma[0]?.holes).toHaveLength(1);
      expect(out?.neurite[0]?.holes).toBeUndefined();
    });

    it('never reads a nested polygon that HAS a class as a hole', () => {
      // A soma inside the outline of a neurite network, and a neurite island
      // inside a loop: real structure, not background.
      const out = split([
        neurite('net', 0, 0, 200),
        { id: 's', partClass: 'soma', points: square(20, 20, 30) },
        neurite('island', 100, 100, 30),
      ]);
      expect(out?.soma.map(p => p.polygon_id)).toEqual(['s']);
      expect(out?.neurite.map(p => p.polygon_id)).toEqual(['net', 'island']);
      expect(out?.neurite[0]?.holes).toBeUndefined();
    });

    it('ignores one that only partly overlaps, or lies outside everything', () => {
      const out = split([
        neurite('n1', 0, 0, 100),
        { id: 'straddles', points: square(90, 90, 40) },
        { id: 'elsewhere', points: square(300, 300, 20) },
      ]);
      expect(out?.neurite).toHaveLength(1);
      expect(out?.neurite[0]?.holes).toBeUndefined();
    });

    it('works for a region that has no id', () => {
      const out = split([
        { partClass: 'neurite', points: square(0, 0, 100) },
        { points: square(30, 30, 20) },
      ]);
      expect(out?.neurite[0]?.holes).toHaveLength(1);
    });

    it('keeps a stored hole and a drawn one side by side', () => {
      const out = split([
        neurite('n1', 0, 0, 200),
        { id: 'h', type: 'internal', parent_id: 'n1', points: square(10, 10, 20) },
        { id: 'drawn', points: square(100, 100, 20) },
      ]);
      expect(out?.neurite[0]?.holes).toHaveLength(2);
    });
  });

  it('answers null for JSON it cannot read', () => {
    expect(splitNeuritePolygons('{not json')).toBeNull();
  });
});

describe('the morphology tables get the holes too', () => {
  it('sends a neurite loop with its hole, not as a filled outline', async () => {
    post.mockResolvedValue({
      data: {
        neurites: [],
        somas: [],
        qc: {},
        soma_polygon_ids: {},
        neurite_owners: {},
      },
    });
    await computeNeuriteMetrics(
      [
        {
          id: 'i',
          name: 'f',
          width: 512,
          height: 512,
          pixelSizeUm: 0.2,
          originalPath: 'a.png',
          segmentation: { polygons: POLYGONS },
        },
      ],
      { formats: ['csv'], classify: false }
    );
    const body = post.mock.calls[0]?.[1];
    expect(body.neurite_polygons).toHaveLength(1);
    expect(body.neurite_polygons[0].holes).toHaveLength(1);
  });
});

describe('computeNeuriteIntensity', () => {
  it('names every channel of the frame, following a sparse channel to its anchor', async () => {
    const result = await computeNeuriteIntensity([frame()]);

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0] ?? [];
    expect(url).toBe('http://ml-mock:8000/api/v1/neurite-intensity');
    expect(body.channels).toEqual([
      // Frame 7 was not acquired on Channel_1; frame 5 stands in for it.
      {
        name: 'MAP7',
        path: '/app/uploads/projects/p1/images/v1/frames/0005/Channel_1.png',
      },
      {
        name: 'tau',
        path: '/app/uploads/projects/p1/images/v1/frames/0007/Channel_2.png',
      },
    ]);
    expect(body.soma_polygons).toHaveLength(1);
    expect(body.neurite_polygons[0].holes).toHaveLength(1);
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toEqual([]);
  });

  it('stamps every row with its frame', async () => {
    // The service's rows carry no frame. The first real export had an empty
    // `frame` column: two frames' rows, indistinguishable.
    post
      .mockResolvedValueOnce({ data: { rows: [mlRow('MAP7', 'soma')] } })
      .mockResolvedValueOnce({ data: { rows: [mlRow('MAP7', 'soma')] } });
    const result = await computeNeuriteIntensity([
      frame({ name: 'stack.tif (frame 7)' }),
      frame({ id: 'frame-8', name: 'stack.tif (frame 8)' }),
    ]);
    expect(result.rows.map(r => r.frame)).toEqual([
      'stack.tif (frame 7)',
      'stack.tif (frame 8)',
    ]);
  });

  it('needs no pixel size and no soma', async () => {
    // Either would make the morphology tables skip the frame.
    const result = await computeNeuriteIntensity([
      frame({
        segmentation: {
          polygons: JSON.stringify([
            { id: 'n1', partClass: 'neurite', points: square(0, 0, 40) },
          ]),
        },
      }),
    ]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(result.skipped).toEqual([]);
  });

  it('measures a still as its own single channel', async () => {
    await computeNeuriteIntensity([
      frame({
        parentVideoId: null,
        originalPath: 'u1/p1/originals/merged_bw.jpg',
      }),
    ]);
    expect(findMany).not.toHaveBeenCalled();
    expect(post.mock.calls[0]?.[1].channels).toEqual([
      { name: 'image', path: '/app/uploads/u1/p1/originals/merged_bw.jpg' },
    ]);
  });

  it('leaves out a channel that does not cover the frame', async () => {
    findMany.mockResolvedValue([
      {
        id: 'v1',
        channels: [
          { name: 'Channel_1' },
          { name: 'added', frameIds: ['some-other-frame'] },
        ],
      },
    ]);
    await computeNeuriteIntensity([frame()]);
    expect(
      post.mock.calls[0]?.[1].channels.map((c: { name: string }) => c.name)
    ).toEqual(['Channel_1']);
  });

  it('skips the container row itself and says why a frame was skipped', async () => {
    const result = await computeNeuriteIntensity([
      frame({ id: 'v1', isVideoContainer: true, parentVideoId: null }),
      frame({ name: 'unsegmented', segmentation: null }),
      frame({ name: 'no-size', width: null }),
      frame({ name: 'broken', segmentation: { polygons: '{' } }),
      frame({
        name: 'spheroid-only',
        segmentation: {
          polygons: JSON.stringify([{ id: 'x', points: square(0, 0, 9) }]),
        },
      }),
    ]);
    expect(post).not.toHaveBeenCalled();
    expect(result.skipped).toEqual([
      { image: 'unsegmented', reason: 'not segmented' },
      { image: 'no-size', reason: 'frame dimensions unknown' },
      { image: 'broken', reason: 'segmentation JSON unreadable' },
      { image: 'spheroid-only', reason: 'no soma or neurite polygons' },
    ]);
  });

  it("records the service's own reason when a frame fails, and carries on", async () => {
    post
      .mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Request failed',
        response: { data: { detail: 'Channel file not found: tau' } },
      })
      .mockResolvedValueOnce({ data: { rows: [mlRow('MAP7', 'neurite')] } });

    const result = await computeNeuriteIntensity([
      frame({ name: 'first' }),
      frame({ id: 'frame-8', name: 'second' }),
    ]);

    expect(result.skipped).toEqual([
      { image: 'first', reason: 'Channel file not found: tau' },
    ]);
    expect(result.rows).toHaveLength(1);
  });

  it('refuses a response that is not the table', async () => {
    post.mockResolvedValue({ data: { frame: 'x' } });
    const result = await computeNeuriteIntensity([frame()]);
    expect(result.rows).toEqual([]);
    expect(result.skipped[0]?.reason).toMatch(/rows was not an array/);
  });
});

describe('the Intensity table on disk', () => {
  it('is written beside the others, with a blank for an unmeasured class', async () => {
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'intensity-'));
    try {
      await writeNeuriteMetrics(
        {
          neurites: [],
          somas: [],
          skipped: [],
          qc: {},
          intensity: {
            rows: [
              row('MAP7', 'neurite'),
              {
                ...row('MAP7', 'soma'),
                area_px: 0,
                mean_intensity: null,
                median_intensity: null,
                std_intensity: null,
                sum_intensity: null,
                mean_minus_background: null,
              },
            ],
            skipped: [{ image: 'f9', reason: 'not segmented' }],
          },
        },
        dir,
        ['csv', 'json', 'excel']
      );

      const csv = (
        await fs.readFile(path.join(dir, 'intensity.csv'), 'utf-8')
      ).split('\n');
      expect(csv[0]).toBe(INTENSITY_HEADERS.join(','));
      expect(csv[1]).toBe('stack.tif (frame 7),MAP7,neurite,10,5,5,0,50,1,100,4');
      // An empty class is BLANK, not zero.
      expect(csv[2]).toBe('stack.tif (frame 7),MAP7,soma,0,,,,,1,100,');

      const json = JSON.parse(
        await fs.readFile(path.join(dir, 'neurite_metrics.json'), 'utf-8')
      );
      expect(json.intensity).toHaveLength(2);
      expect(json.intensity_skipped).toEqual([
        { image: 'f9', reason: 'not segmented' },
      ]);

      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(path.join(dir, 'neurite_metrics.xlsx'));
      const sheet = workbook.getWorksheet('Intensity');
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        ...INTENSITY_HEADERS,
      ]);
      expect(sheet?.rowCount).toBe(3);
      const skipped = workbook.getWorksheet('Skipped frames');
      expect(skipped?.getRow(2).values).toEqual([
        undefined,
        'f9',
        'Intensity',
        'not segmented',
      ]);
      const readme = workbook.getWorksheet('README');
      const points = (readme?.getColumn(1).values ?? []).map(String);
      expect(points).toContain('mean_minus_background');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('writes no Intensity file or sheet when the table was not computed', async () => {
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'intensity-'));
    try {
      await writeNeuriteMetrics(
        { neurites: [], somas: [], skipped: [], qc: {} },
        dir,
        ['csv', 'excel']
      );
      await expect(
        fs.access(path.join(dir, 'intensity.csv'))
      ).rejects.toBeTruthy();
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(path.join(dir, 'neurite_metrics.xlsx'));
      expect(workbook.getWorksheet('Intensity')).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
