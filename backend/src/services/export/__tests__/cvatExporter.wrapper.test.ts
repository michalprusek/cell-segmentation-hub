import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getLabelsMock, fsMock } = vi.hoisted(() => ({
  getLabelsMock: vi.fn() as ReturnType<typeof vi.fn>,
  fsMock: {
    mkdir: vi.fn() as ReturnType<typeof vi.fn>,
    writeFile: vi.fn() as ReturnType<typeof vi.fn>,
  },
}));

vi.mock('../../mtTypeLabelService', () => ({ getLabels: getLabelsMock }));
vi.mock('fs', () => ({ promises: fsMock }));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { exportCvatAnnotations, type CvatFrameInput } from '../cvatExporter';

beforeEach(() => {
  vi.clearAllMocks();
  getLabelsMock.mockResolvedValue([
    { id: 'a', name: 'alpha', color: '#ff0000' },
  ]);
  fsMock.mkdir.mockResolvedValue(undefined);
  fsMock.writeFile.mockResolvedValue(undefined);
});

const container = (id: string, name: string): CvatFrameInput => ({
  id,
  name,
  isVideoContainer: true,
  parentVideoId: null,
  frameIndex: null,
  segmentation: null,
});
const frame = (over: Partial<CvatFrameInput>): CvatFrameInput => ({
  id: 'f0',
  name: 'v',
  width: 10,
  height: 10,
  parentVideoId: 'c1',
  frameIndex: 0,
  isVideoContainer: false,
  segmentation: null,
  ...over,
});
const pl = (extra: Record<string, unknown>) =>
  JSON.stringify([
    {
      geometry: 'polyline',
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      trackId: 't',
      ...extra,
    },
  ]);

describe('exportCvatAnnotations', () => {
  it('writes one xml per video containing polylines', async () => {
    const res = await exportCvatAnnotations(
      [
        container('c1', 'MyVideo.nd2'),
        frame({ segmentation: { polygons: pl({ mtType: 'a' }) } }),
      ],
      '/export',
      'proj1'
    );
    expect(res.files).toBe(1);
    expect(res.polylines).toBe(1);
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
    const [, xml] = fsMock.writeFile.mock.calls[0];
    expect(xml).toContain('<polyline label="alpha"');
  });

  it('skips videos with no polylines and writes nothing', async () => {
    const res = await exportCvatAnnotations(
      [frame({ segmentation: null })],
      '/export',
      'proj1'
    );
    expect(res.files).toBe(0);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('writes nothing for a video whose polygons yield no polylines', async () => {
    // Passes the byVideo filter (has a polygons string) but buildCvatXml
    // produces 0 polylines (only a closed polygon) → the video is skipped.
    const closed = JSON.stringify([
      {
        geometry: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 0 },
        ],
      },
    ]);
    const res = await exportCvatAnnotations(
      [frame({ segmentation: { polygons: closed } })],
      '/export',
      'proj1'
    );
    expect(res.files).toBe(0);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('throws when the export is aborted', async () => {
    await expect(
      exportCvatAnnotations(
        [frame({ segmentation: { polygons: pl({}) } })],
        '/export',
        'proj1',
        { shouldAbort: () => true }
      )
    ).rejects.toThrow(/cancelled/i);
  });

  it('falls back to video_<id> when no container name is present', async () => {
    const res = await exportCvatAnnotations(
      [frame({ parentVideoId: 'c9', segmentation: { polygons: pl({}) } })],
      '/export',
      'proj1'
    );
    expect(res.files).toBe(1);
    const name = String(fsMock.writeFile.mock.calls[0][0]).split('/').pop();
    expect(name).toMatch(/^video_c9/);
  });

  it('handles a frame with no parentVideoId (single "video" bucket)', async () => {
    const res = await exportCvatAnnotations(
      [frame({ parentVideoId: null, segmentation: { polygons: pl({}) } })],
      '/export',
      'proj1'
    );
    expect(res.files).toBe(1);
    const name = String(fsMock.writeFile.mock.calls[0][0]).split('/').pop();
    expect(name).toBe('video.xml');
  });

  it('names files by video and disambiguates collisions', async () => {
    // Two videos whose container names sanitize to the same base.
    const res = await exportCvatAnnotations(
      [
        container('c1', 'vid.nd2'),
        container('c2', 'vid.nd2'),
        frame({ id: 'a', parentVideoId: 'c1', segmentation: { polygons: pl({}) } }),
        frame({ id: 'b', parentVideoId: 'c2', segmentation: { polygons: pl({}) } }),
      ],
      '/export',
      'proj1'
    );
    expect(res.files).toBe(2);
    const names = fsMock.writeFile.mock.calls.map(c =>
      String(c[0]).split('/').pop()
    );
    expect(new Set(names).size).toBe(2); // unique filenames
  });
});
