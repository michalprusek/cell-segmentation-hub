/**
 * mtKymographExporter.test.ts
 *
 * 1. pickSourceChannels — the pure channel-selection helper. Regression guard
 *    for the bug (commit 488ca68) where the export sampled only the FIRST
 *    fluorescent channel and silently missed motion in the others.
 * 2. The fan-out itself: every (microtubule x channel) kymograph of a container
 *    reads the same rows and the same frame images, so the container's rows are
 *    loaded ONCE and the jobs of one channel go to the ML service as ONE
 *    batched request (which is what lets it decode each frame once for all of
 *    them). Neither may change what is exported, so the velocity sheets are
 *    asserted to follow job order, and each batch result is asserted to land
 *    under its own microtubule.
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

import { logger } from '../../../utils/logger';
// `buildKymographBatch` + `loadKymographContainerContext` are the two
// boundaries the exporter drives; `utils/concurrency` is deliberately NOT
// mocked — the dispatch order and the batching are exactly what is under test.
vi.mock('../../kymographService', () => ({
  buildKymographBatch: vi.fn(),
  loadKymographContainerContext: vi.fn(),
}));

import {
  exportMicrotubuleKymographs,
  pickSourceChannels,
} from '../mtKymographExporter';
import { prisma } from '../../../db/prismaClient';
import {
  buildKymographBatch,
  loadKymographContainerContext,
} from '../../kymographService';

const mockFindMany = prisma.image.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockBatch = buildKymographBatch as unknown as ReturnType<typeof vi.fn>;
const mockLoadContext = loadKymographContainerContext as unknown as ReturnType<
  typeof vi.fn
>;

interface FakeInput {
  videoContainerId: string;
  polylineId: string;
  sourceChannel: string;
  containerContext: unknown;
  includeCsv?: boolean;
  renderProfiles?: boolean;
  lineWidth?: number;
  lineReduce?: string;
}

/** Every (microtubule x channel) input the exporter dispatched, flattened back
 *  into dispatch order — the batching must not change WHICH kymographs are
 *  built, only how many requests carry them. */
const dispatchedInputs = (): FakeInput[] =>
  mockBatch.mock.calls.flatMap(c => c[0] as FakeInput[]);

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

/** A minimal stand-in for the object `loadKymographContainerContext` returns.
 *  The exporter passes it straight through to the service, and reads only
 *  `frames.length` — to size a profiles-mode batch by how many matplotlib PNGs
 *  it would carry back. */
const fakeContext = (
  containerId: string,
  frameCount = 3
): { marker: string; frames: unknown[] } => ({
  marker: `ctx:${containerId}`,
  frames: Array.from({ length: frameCount }, (_, i) => ({ frameIndex: i })),
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
    // Default: every item of every batch succeeds with no detected tracks.
    mockBatch.mockImplementation(async (inputs: FakeInput[]) =>
      inputs.map(() => ({ result: kymoResult(0, 0) }))
    );
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

  // The log is the only signal an operator has for this stage, and it used to
  // report `kymographs: jobs.length` under the word "exported" — so an export
  // that wrote nothing at all looked identical to one that wrote 63 files.
  // With `includeSegmentedImages` off, every kymograph is still rendered (the
  // velocity metrics come from it) and then discarded; if nothing else lands
  // either, the archive gets no kymograph output whatsoever.
  describe('reports what it WROTE, not what it dispatched', () => {
    const oneVideo = () =>
      mockDb([
        {
          id: 'vidA',
          name: 'A',
          channels: [{ name: 'g', type: 'fluorescent' }],
          frameCount: 3,
          polylineIds: ['p1', 'p2'],
        },
      ]);

    it('warns, and does not say "exported", when it wrote no file', async () => {
      oneVideo();
      // Rendered but discarded: no images asked for, and no motility found so
      // the workbook is skipped too.
      await exportMicrotubuleKymographs('proj', outDir, {
        ...OPTS,
        includeSegmentedImages: false,
      });

      expect(await fs.readdir(path.join(outDir, 'kymographs'))).toEqual([]);
      expect(logger.info).not.toHaveBeenCalledWith(
        'Microtubule kymographs exported',
        expect.anything(),
        expect.anything()
      );
      const warn = vi.mocked(logger.warn).mock.calls.at(-1);
      expect(warn?.[0]).toContain('rendered 2 but wrote no file');
      expect(warn?.[2]).toMatchObject({ rendered: 2, images: 0, workbook: false });
    });

    it('counts the images it actually wrote', async () => {
      oneVideo();
      await exportMicrotubuleKymographs('proj', outDir, OPTS);

      const info = vi
        .mocked(logger.info)
        .mock.calls.find(c => c[0] === 'Microtubule kymographs exported');
      expect(info?.[2]).toMatchObject({ rendered: 2, images: 2 });
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('wrote no file'),
        expect.anything(),
        expect.anything()
      );
    });
  });

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

    // 3 microtubules x 2 channels = 6 kymographs, from ONE context load and --
    // the point of the batching -- only TWO ML requests, one per channel.
    expect(dispatchedInputs()).toHaveLength(6);
    expect(mockBatch).toHaveBeenCalledTimes(2);
    expect(mockLoadContext).toHaveBeenCalledTimes(1);
    expect(mockLoadContext).toHaveBeenCalledWith('vidA');
    // ...and every job must actually receive the context: the whole point is
    // that the service does not go back to the database per kymograph.
    const ctx = await mockLoadContext.mock.results[0].value;
    for (const input of dispatchedInputs()) {
      expect(input.containerContext).toBe(ctx);
    }
  });

  it('sends one request per channel, never mixing channels', async () => {
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

    // A batch that straddled the channel boundary would make the ML service
    // decode one channel's frames in two requests -- the exact waste batching
    // exists to remove.
    expect(
      mockBatch.mock.calls.map(c =>
        (c[0] as FakeInput[]).map(i => `${i.sourceChannel}/${i.polylineId}`)
      )
    ).toEqual([
      ['g/p1', 'g/p2', 'g/p3'],
      ['r/p1', 'r/p2', 'r/p3'],
    ]);
  });

  it('does not ask for the intensity CSV it never writes in kymograph mode', async () => {
    mockDb([
      {
        id: 'vidA',
        name: 'A',
        channels: [{ name: 'g', type: 'fluorescent' }],
        frameCount: 2,
        polylineIds: ['p1'],
      },
    ]);

    await exportMicrotubuleKymographs('proj', outDir, OPTS);

    // 483 KB of base64 per microtubule on a real 300-frame container, built,
    // shipped and dropped on the floor.
    expect(dispatchedInputs().map(i => i.includeCsv)).toEqual([false]);
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
      dispatchedInputs().map(i => [
        i.videoContainerId,
        (i.containerContext as { marker: string }).marker,
      ])
    );
    expect(byContainer.get('vidA')).toBe('ctx:vidA');
    expect(byContainer.get('vidB')).toBe('ctx:vidB');
  });

  it('lands each batch result under its own microtubule', async () => {
    mockDb([
      {
        id: 'vidA',
        name: 'A',
        channels: [{ name: 'g', type: 'fluorescent' }],
        frameCount: 2,
        polylineIds: ['p1', 'p2', 'p3'],
      },
    ]);
    // One batch now carries every microtubule of the channel, so the ONLY
    // thing tying a velocity row to a polyline is the position of the result
    // in the returned array. Give each item a distinguishable velocity and
    // check it comes back under the right name — an off-by-one here would
    // silently publish p2's motility as p1's.
    mockBatch.mockImplementation(async (inputs: FakeInput[]) =>
      inputs.map(i => ({
        result: kymoResult(1, Number(i.polylineId.slice(1)) * 10),
      }))
    );

    await exportMicrotubuleKymographs('proj', outDir, OPTS);

    type ExcelJsDefault = typeof import('exceljs');
    const ExcelJS = (
      (await import('exceljs')) as unknown as { default: ExcelJsDefault }
    ).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(outDir, 'kymographs/velocity_metrics.xlsx'));
    const rows: Array<[string, number]> = [];
    wb.getWorksheet('g')?.eachRow((row, i) => {
      if (i > 1) {
        const values = row.values as unknown[];
        rows.push([String(values[2]), Number(values[5])]);
      }
    });
    // Column 5 is net_velocity_px_frame = the seed, i.e. 10x the MT number.
    expect(rows).toEqual([
      ['p1', 10],
      ['p2', 20],
      ['p3', 30],
    ]);
  });

  it('costs one microtubule, not the batch, when a single item fails', async () => {
    mockDb([
      {
        id: 'vidA',
        name: 'A',
        channels: [{ name: 'g', type: 'fluorescent' }],
        frameCount: 2,
        polylineIds: ['p1', 'p2', 'p3'],
      },
    ]);
    // The un-batched export ran one request per microtubule with its own
    // try/catch, so one unusable polyline cost exactly one kymograph. Batching
    // must not turn that into "the whole channel exported nothing".
    mockBatch.mockImplementation(async (inputs: FakeInput[]) =>
      inputs.map(i =>
        i.polylineId === 'p2'
          ? { error: new Error('Seed-frame polyline has 1 vertex(es)') }
          : { result: kymoResult(1, Number(i.polylineId.slice(1)) * 10) }
      )
    );

    await exportMicrotubuleKymographs('proj', outDir, OPTS);

    type ExcelJsDefault = typeof import('exceljs');
    const ExcelJS = (
      (await import('exceljs')) as unknown as { default: ExcelJsDefault }
    ).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(outDir, 'kymographs/velocity_metrics.xlsx'));
    const names: string[] = [];
    wb.getWorksheet('g')?.eachRow((row, i) => {
      if (i > 1) {
        names.push(String((row.values as unknown[])[2]));
      }
    });
    expect(names).toEqual(['p1', 'p3']);
    // The two survivors still got their overlay PNGs written.
    expect((await fs.readdir(path.join(outDir, 'kymographs'))).sort()).toEqual([
      'A__p1__g.png',
      'A__p3__g.png',
      'velocity_metrics.xlsx',
    ]);
  });

  it('loses only its own jobs when a whole batch request fails', async () => {
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
    // e.g. an ml container old enough not to have /kymograph/batch, or a
    // network drop. The other channel — and the workbook — must survive.
    mockBatch.mockImplementation(async (inputs: FakeInput[]) => {
      if (inputs[0].sourceChannel === 'g') {
        throw new Error('Request failed with status code 404');
      }
      return inputs.map(i => ({
        result: kymoResult(1, Number(i.polylineId.slice(1))),
      }));
    });
    const progress: Array<[number, number]> = [];

    await exportMicrotubuleKymographs('proj', outDir, OPTS, null, (d, t) =>
      progress.push([d, t])
    );

    type ExcelJsDefault = typeof import('exceljs');
    const ExcelJS = (
      (await import('exceljs')) as unknown as { default: ExcelJsDefault }
    ).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(outDir, 'kymographs/velocity_metrics.xlsx'));
    expect(wb.worksheets.map(w => w.name)).toEqual(['r']);
    // All four jobs still count as done, so the bar reaches 100 %.
    expect(progress).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
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
    mockBatch.mockImplementation(async (inputs: FakeInput[]) =>
      inputs.map(i => ({
        result: kymoResult(i.sourceChannel === 'g' ? 2 : 0, 1),
      }))
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
    expect(dispatchedInputs().map(i => i.polylineId)).toEqual(['q1']);
    // ...but its 2 jobs still count as done, so the bar reaches 100 %.
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('keeps the CSV in profiles mode and bounds a batch by rendered images', async () => {
    // A profiles response is O(items x frames) — one matplotlib PNG per frame
    // per microtubule — so unlike kymograph mode it cannot put the whole
    // channel in one request. 4 frames x 60 microtubules would be 240 images;
    // the exporter's own bound (PROFILE_BATCH_MAX_IMAGES / frames) is what
    // decides. With 4 frames that is 75, clamped to the 60-microtubule cap, so
    // these 3 still travel together.
    mockDb([
      {
        id: 'vidA',
        name: 'A',
        channels: [{ name: 'g', type: 'fluorescent' }],
        frameCount: 4,
        polylineIds: ['p1', 'p2', 'p3'],
      },
    ]);
    mockLoadContext.mockImplementation(async (id: string) => fakeContext(id, 4));
    mockBatch.mockImplementation(async (inputs: FakeInput[]) =>
      inputs.map(() => ({
        result: {
          ...(kymoResult(0, 0) as Record<string, unknown>),
          profiles: [{ frame: 0, pngBase64: 'cA==' }],
        },
      }))
    );

    await exportMicrotubuleKymographs('proj', outDir, {
      ...OPTS,
      mode: 'profiles',
    });

    expect(mockBatch).toHaveBeenCalledTimes(1);
    // profiles mode DOES write the intensity CSV, so it must not opt out of it.
    expect(dispatchedInputs().map(i => i.includeCsv)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(dispatchedInputs().every(i => i.renderProfiles === true)).toBe(true);
    expect((await fs.readdir(path.join(outDir, 'profiles'))).sort()).toEqual([
      'A__p1__g.csv',
      'A__p1__g__f0000.png',
      'A__p2__g.csv',
      'A__p2__g__f0000.png',
      'A__p3__g.csv',
      'A__p3__g__f0000.png',
    ]);
  });

  // -------------------------------------------------------------------------
  // Line width: the export's own control, forwarded to every kymograph it
  // builds. The editor modal has the same setting on a separate surface; these
  // assert the EXPORT's value travels, not that the two are coupled.
  // -------------------------------------------------------------------------

  const oneChannelDb = (): void =>
    mockDb([
      {
        id: 'vidA',
        name: 'A',
        channels: [{ name: 'g', type: 'fluorescent' }],
        frameCount: 2,
        polylineIds: ['p1', 'p2'],
      },
    ]);

  it('forwards lineWidth / lineReduce to every kymograph of the batch', async () => {
    oneChannelDb();

    await exportMicrotubuleKymographs('proj', outDir, {
      ...OPTS,
      lineWidth: 5,
      lineReduce: 'max',
    });

    expect(dispatchedInputs().map(i => [i.lineWidth, i.lineReduce])).toEqual([
      [5, 'max'],
      [5, 'max'],
    ]);
  });

  it('forwards them in profiles mode too — a profile is a row of that picture', async () => {
    oneChannelDb();
    mockBatch.mockImplementation(async (inputs: FakeInput[]) =>
      inputs.map(() => ({
        result: {
          ...(kymoResult(0, 0) as Record<string, unknown>),
          profiles: [{ frame: 0, pngBase64: 'cA==' }],
        },
      }))
    );

    await exportMicrotubuleKymographs('proj', outDir, {
      ...OPTS,
      mode: 'profiles',
      lineWidth: 9,
      lineReduce: 'max',
    });

    // The ML service renders the profile plots from the same sampled matrix as
    // the kymograph, so a width that changed one and not the other would make
    // the two exports of the same data disagree.
    expect(dispatchedInputs().map(i => [i.lineWidth, i.lineReduce])).toEqual([
      [9, 'max'],
      [9, 'max'],
    ]);
  });

  it('sends neither when the export did not ask for a band', async () => {
    oneChannelDb();

    await exportMicrotubuleKymographs('proj', outDir, OPTS);

    // Absent, not 1: the service omits the ML fields at the default, so an
    // export run without the option posts byte-for-byte the body it posted
    // before the option existed.
    for (const input of dispatchedInputs()) {
      expect(input.lineWidth).toBeUndefined();
      expect(input.lineReduce).toBeUndefined();
    }
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
