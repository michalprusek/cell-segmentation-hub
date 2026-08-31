/**
 * mtKymographExporter.test.ts
 *
 * 1. pickSourceChannels — the pure channel-selection helper. Regression guard
 *    for the bug (commit 488ca68) where the export sampled only the FIRST
 *    fluorescent channel and silently missed motion in the others.
 * 2. The fan-out itself: every (microtubule x channel) kymograph of a container
 *    reads the same rows and the same frame images, so the container's rows are
 *    loaded ONCE and the jobs are dispatched channel-major (consecutive jobs
 *    share their whole decode set). Neither may change what is exported, so the
 *    velocity sheets are asserted to follow job order rather than the order the
 *    concurrent workers happened to finish in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../../db/prismaClient', () => ({
  prisma: { image: { findMany: vi.fn() } },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// `buildKymograph` + `loadKymographContainerContext` are the two boundaries the
// exporter drives; `utils/concurrency` is deliberately NOT mocked — the
// dispatch order and the completion race are exactly what is under test.
vi.mock('../../kymographService', () => ({
  buildKymograph: vi.fn(),
  loadKymographContainerContext: vi.fn(),
}));

import {
  exportMicrotubuleKymographs,
  pickSourceChannels,
} from '../mtKymographExporter';
import { prisma } from '../../../db/prismaClient';
import {
  buildKymograph,
  loadKymographContainerContext,
} from '../../kymographService';

const mockFindMany = prisma.image.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockBuild = buildKymograph as unknown as ReturnType<typeof vi.fn>;
const mockLoadContext = loadKymographContainerContext as unknown as ReturnType<
  typeof vi.fn
>;

describe('pickSourceChannels', () => {
  it('returns ALL fluorescent channels (not just the first)', () => {
    const channels = [
      { name: 'IRM', type: 'irm', isSegmentationSource: true },
      { name: 'TIRF_640', type: 'fluorescent' },
      { name: 'TIRF_488', type: 'fluorescent' },
    ];
    // The regression: must include BOTH fluorescent channels.
    expect(pickSourceChannels(channels)).toEqual(['TIRF_640', 'TIRF_488']);
  });

  it('falls back to the segmentation source when no fluorescent channels', () => {
    const channels = [
      { name: 'ch0', type: 'irm', isSegmentationSource: true },
      { name: 'ch1', type: 'irm' },
    ];
    expect(pickSourceChannels(channels)).toEqual(['ch0']);
  });

  it('falls back to the first channel when no fluorescent and no source', () => {
    const channels = [{ name: 'ch0', type: 'irm' }, { name: 'ch1' }];
    expect(pickSourceChannels(channels)).toEqual(['ch0']);
  });

  it('returns an empty list for no channels', () => {
    expect(pickSourceChannels([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fan-out: per-container row reuse, dispatch order, deterministic sheets
// ---------------------------------------------------------------------------

interface FakeContainer {
  id: string;
  name: string;
  channels: Array<{ name: string; type?: string }>;
  frameCount: number;
  polylineIds: string[];
}

/** Wire `prisma.image.findMany` for both queries the exporter makes: the
 *  container list, and one container's segmented frames. */
function mockDb(containers: FakeContainer[]): void {
  mockFindMany.mockImplementation(
    async (args: {
      where: { isVideoContainer?: boolean; parentVideoId?: string };
    }) => {
      if (args.where.isVideoContainer) {
        return containers.map(c => ({
          id: c.id,
          name: c.name,
          channels: c.channels,
        }));
      }
      const c = containers.find(x => x.id === args.where.parentVideoId);
      if (!c) {
        return [];
      }
      const polygons = JSON.stringify(
        c.polylineIds.map(id => ({
          id,
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ],
        }))
      );
      return Array.from({ length: c.frameCount }, (_, i) => ({
        id: `${c.id}-f${i}`,
        frameIndex: i,
        segmentation: { polygons },
      }));
    }
  );
}

/** A minimal stand-in for the object `loadKymographContainerContext` returns —
 *  the exporter only ever passes it straight through to `buildKymograph`. */
const fakeContext = (containerId: string): { marker: string } => ({
  marker: `ctx:${containerId}`,
});

function kymoResult(tracks: number, seed: number): unknown {
  return {
    pngBase64: 'p',
    csvBase64: 'c',
    frameCount: 3,
    lengthPx: 200,
    tracked: false,
    sourceChannel: 'x',
    pixelSizeUm: 0.1,
    frameIntervalMs: 100,
    filteredTrackCount: 0,
    overlayPngBase64: 'b3Y=',
    tracks: Array.from({ length: tracks }, (_, t) => ({
      points: [[0, 0]],
      netVelocityPxPerFrame: seed + t,
      netVelocityUmPerSec: seed + t,
      snr: 1,
      totalRunLengthUm: 1,
      totalRunTimeS: 1,
      intensitySignal: 1,
      intensityBackground: 1,
      intensityMinusBackground: 1,
      edge: 'none',
      bright: false,
    })),
  };
}

describe('exportMicrotubuleKymographs fan-out', () => {
  let outDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mtkymo-test-'));
    mockLoadContext.mockImplementation(async (id: string) => fakeContext(id));
    mockBuild.mockResolvedValue(kymoResult(0, 0));
  });

  afterEach(async () => {
    await fs.rm(outDir, { recursive: true, force: true });
  });

  const OPTS = {
    enabled: true,
    mode: 'kymograph' as const,
    includeVelocityMetrics: true,
    includeSegmentedImages: true,
  };

  it('loads a container\'s rows ONCE and hands them to every job', async () => {
    mockDb([
      {
        id: 'vidA',
        name: 'A',
        channels: [
          { name: 'g', type: 'fluorescent' },
          { name: 'r', type: 'fluorescent' },
        ],
        frameCount: 3,
        polylineIds: ['p1', 'p2', 'p3'],
      },
    ]);

    await exportMicrotubuleKymographs('proj', outDir, OPTS);

    // 3 microtubules x 2 channels = 6 kymographs from ONE context load.
    expect(mockBuild).toHaveBeenCalledTimes(6);
    expect(mockLoadContext).toHaveBeenCalledTimes(1);
    expect(mockLoadContext).toHaveBeenCalledWith('vidA');
    // ...and every job must actually receive it: the whole point is that
    // buildKymograph does not go back to the database per call.
    const ctx = await mockLoadContext.mock.results[0].value;
    for (const call of mockBuild.mock.calls) {
      expect(call[0].containerContext).toBe(ctx);
    }
  });

  it('loads rows once PER CONTAINER, never shared across containers', async () => {
    mockDb([
      {
        id: 'vidA',
        name: 'A',
        channels: [{ name: 'g', type: 'fluorescent' }],
        frameCount: 2,
        polylineIds: ['p1', 'p2'],
      },
      {
        id: 'vidB',
        name: 'B',
        channels: [{ name: 'g', type: 'fluorescent' }],
        frameCount: 2,
        polylineIds: ['q1'],
      },
    ]);

    await exportMicrotubuleKymographs('proj', outDir, OPTS);

    expect(mockLoadContext).toHaveBeenCalledTimes(2);
    expect(mockLoadContext.mock.calls.map(c => c[0])).toEqual(['vidA', 'vidB']);
    const byContainer = new Map(
      mockBuild.mock.calls.map(c => [
        c[0].videoContainerId,
        c[0].containerContext,
      ])
    );
    expect(byContainer.get('vidA')).toEqual({ marker: 'ctx:vidA' });
    expect(byContainer.get('vidB')).toEqual({ marker: 'ctx:vidB' });
  });

  it('dispatches CHANNEL-major so consecutive jobs share their decode set', async () => {
    mockDb([
      {
        id: 'vidA',
        name: 'A',
        channels: [
          { name: 'g', type: 'fluorescent' },
          { name: 'r', type: 'fluorescent' },
        ],
        frameCount: 2,
        polylineIds: ['p1', 'p2', 'p3'],
      },
    ]);

    await exportMicrotubuleKymographs('proj', outDir, OPTS);

    // All of channel g, then all of channel r — NOT g,r,g,r,g,r (which would
    // rotate the frame set on every microtubule and defeat any frame cache).
    expect(
      mockBuild.mock.calls.map(c => `${c[0].sourceChannel}/${c[0].polylineId}`)
    ).toEqual(['g/p1', 'g/p2', 'g/p3', 'r/p1', 'r/p2', 'r/p3']);
  });

  it('keeps velocity rows in job order even when jobs finish out of order', async () => {
    mockDb([
      {
        id: 'vidA',
        name: 'A',
        channels: [{ name: 'g', type: 'fluorescent' }],
        frameCount: 2,
        polylineIds: ['p1', 'p2', 'p3'],
      },
    ]);
    // Reverse the completion order inside the concurrency window: p3 resolves
    // first, p1 last. Appending on completion would write the sheet as p3,p2,p1.
    const delayFor: Record<string, number> = { p1: 40, p2: 20, p3: 0 };
    mockBuild.mockImplementation(async (input: { polylineId: string }) => {
      await new Promise(r => setTimeout(r, delayFor[input.polylineId] ?? 0));
      return kymoResult(1, Number(input.polylineId.slice(1)));
    });

    await exportMicrotubuleKymographs('proj', outDir, OPTS);

    type ExcelJsDefault = typeof import('exceljs');
    const ExcelJS = (
      (await import('exceljs')) as unknown as { default: ExcelJsDefault }
    ).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(outDir, 'kymographs/velocity_metrics.xlsx'));
    const sheet = wb.getWorksheet('g');
    const microtubuleColumn: string[] = [];
    sheet?.eachRow((row, i) => {
      if (i > 1) {
        microtubuleColumn.push(String((row.values as unknown[])[2]));
      }
    });
    expect(microtubuleColumn).toEqual(['p1', 'p2', 'p3']);
  });

  it('gives a channel a header-only sheet when every job detected nothing', async () => {
    mockDb([
      {
        id: 'vidA',
        name: 'A',
        channels: [{ name: 'g', type: 'fluorescent' }],
        frameCount: 2,
        polylineIds: ['p1'],
      },
      {
        id: 'vidB',
        name: 'B',
        channels: [{ name: 'r', type: 'fluorescent' }],
        frameCount: 2,
        polylineIds: ['q1'],
      },
    ]);
    mockBuild.mockImplementation(async (input: { sourceChannel: string }) =>
      kymoResult(input.sourceChannel === 'g' ? 2 : 0, 1)
    );

    await exportMicrotubuleKymographs('proj', outDir, OPTS);

    type ExcelJsDefault = typeof import('exceljs');
    const ExcelJS = (
      (await import('exceljs')) as unknown as { default: ExcelJsDefault }
    ).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(outDir, 'kymographs/velocity_metrics.xlsx'));
    // 'r' detected nothing but still ran: it keeps its (header-only) worksheet.
    expect(wb.worksheets.map(w => w.name)).toEqual(['g', 'r']);
    expect(wb.getWorksheet('r')?.rowCount).toBe(1);
    expect(wb.getWorksheet('g')?.rowCount).toBe(3);
  });

  it('skips a container whose rows fail to load, still finishing the rest', async () => {
    mockDb([
      {
        id: 'vidA',
        name: 'A',
        channels: [{ name: 'g', type: 'fluorescent' }],
        frameCount: 2,
        polylineIds: ['p1', 'p2'],
      },
      {
        id: 'vidB',
        name: 'B',
        channels: [{ name: 'g', type: 'fluorescent' }],
        frameCount: 2,
        polylineIds: ['q1'],
      },
    ]);
    mockLoadContext.mockImplementation(async (id: string) => {
      if (id === 'vidA') {
        throw new Error('frames vanished');
      }
      return fakeContext(id);
    });
    const progress: Array<[number, number]> = [];

    await exportMicrotubuleKymographs('proj', outDir, OPTS, null, (d, t) =>
      progress.push([d, t])
    );

    // vidA contributed no ML calls...
    expect(mockBuild.mock.calls.map(c => c[0].polylineId)).toEqual(['q1']);
    // ...but its 2 jobs still count as done, so the bar reaches 100 %.
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('reports progress once per job against the whole-project total', async () => {
    mockDb([
      {
        id: 'vidA',
        name: 'A',
        channels: [
          { name: 'g', type: 'fluorescent' },
          { name: 'r', type: 'fluorescent' },
        ],
        frameCount: 2,
        polylineIds: ['p1', 'p2'],
      },
    ]);
    const progress: Array<[number, number]> = [];

    await exportMicrotubuleKymographs('proj', outDir, OPTS, null, (d, t) =>
      progress.push([d, t])
    );

    expect(progress.map(p => p[1])).toEqual([4, 4, 4, 4]);
    expect(progress.map(p => p[0]).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });
});
