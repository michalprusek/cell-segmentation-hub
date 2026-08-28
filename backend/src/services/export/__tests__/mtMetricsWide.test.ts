/**
 * Tests for the WIDE (pivoted) microtubule metrics output.
 *
 * The rows in `fixtures/mt_metrics_real_rows.json` are REAL: captured from the
 * live ML service (`POST /api/v1/mt-metrics`) for two frames of the production
 * container `bce2e86f-92bc-480c-893e-9210bf79365e`
 * ("B_txMT_KIF14-1kx-2nM_SMYD2_004.nd2", channels IRM + TIRF_488, 23
 * microtubules per frame), then mapped to the camelCase `MTMetricsRow` shape
 * `computeMTMetrics` emits (µm columns at the 0.07245 µm/px ND2 calibration).
 * Synthetic numbers would not have exercised the thing that matters here — the
 * two channels of one microtubule differ by two orders of magnitude
 * (IRM mean ≈ 20 699, TIRF_488 mean ≈ 109) and IRM's background-corrected
 * signal is NEGATIVE, because a microtubule is darker than its surround in IRM.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

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
vi.mock('../../../db/prismaClient', () => ({
  prisma: { image: { findMany: vi.fn() } },
}));
vi.mock('axios', () => ({ default: { post: vi.fn() } }));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// The global backend test setup stubs every `fs/promises` call, which would
// make `writeMTMetrics` silently write nothing. This suite's whole point is to
// open the files it produces, so restore the real module for this file only.
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>(
    'fs/promises'
  );
  return { ...actual, default: actual };
});

import {
  pivotMTMetricsWide,
  writeMTMetrics,
  WIDE_CHANNEL_MEASURES,
  WIDE_SHARED_HEADERS,
  type MTMetricsRow,
  type MTChannelSummaryRow,
} from '../mtMetricsExporter';
import { logger } from '../../../utils/logger';

// ---------------------------------------------------------------------------
// Real captured rows
// ---------------------------------------------------------------------------

const REAL_ROWS: MTMetricsRow[] = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'mt_metrics_real_rows.json'),
    'utf8'
  )
) as MTMetricsRow[];

/** Fresh deep copy per test — the pivot must never mutate its input. */
const rows = (): MTMetricsRow[] =>
  JSON.parse(JSON.stringify(REAL_ROWS)) as MTMetricsRow[];

const sortKey = (r: MTMetricsRow): string =>
  `${r.imageName}\u0000${r.frameIndex}\u0000${r.channel}\u0000${r.instanceId}`;

const sorted = (rs: MTMetricsRow[]): MTMetricsRow[] =>
  [...rs].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));

/**
 * Inverse of {@link pivotMTMetricsWide}. A channel's cells are absent from a
 * wide row exactly when that channel produced no long row for that microtubule,
 * so the reconstruction is total.
 */
function unpivot(wide: ReturnType<typeof pivotMTMetricsWide>): MTMetricsRow[] {
  const out: MTMetricsRow[] = [];
  for (const channel of wide.channels) {
    for (const w of wide.rows) {
      const m = w.channels[channel];
      if (!m) continue;
      out.push({
        frameIndex: w.frameIndex,
        imageName: w.imageName,
        label: w.label,
        mtType: w.mtType,
        instanceId: w.instanceId,
        trackId: w.trackId,
        channel,
        lengthPx: w.lengthPx,
        lengthUm: w.lengthUm,
        areaPx: w.areaPx,
        areaUm2: w.areaUm2,
        pixelCount: w.pixelCount,
        ...m,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

describe('pivotMTMetricsWide — real two-channel rows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the fixture really is two channels of the same microtubules', () => {
    expect(REAL_ROWS).toHaveLength(92); // 2 frames x 23 MTs x 2 channels
    expect(new Set(REAL_ROWS.map(r => r.channel))).toEqual(
      new Set(['IRM', 'TIRF_488'])
    );
  });

  it('collapses each microtubule onto one row per frame', () => {
    const wide = pivotMTMetricsWide(rows());
    expect(wide.channels).toEqual(['IRM', 'TIRF_488']);
    expect(wide.rows).toHaveLength(46); // 2 frames x 23 MTs
    for (const w of wide.rows) {
      expect(Object.keys(w.channels).sort()).toEqual(['IRM', 'TIRF_488']);
    }
  });

  it('puts both channels of one microtubule side by side, values intact', () => {
    const wide = pivotMTMetricsWide(rows());
    const first = wide.rows[0];
    expect(first.instanceId).toBe('mt_6ee5ae2d');
    expect(first.frameIndex).toBe(0);
    // The whole point of the wide sheet: two very different channels, one row.
    expect(first.channels.IRM.meanIntensity).toBeCloseTo(20699.4876, 3);
    expect(first.channels.TIRF_488.meanIntensity).toBeCloseTo(108.7756, 3);
    // IRM microtubules are DARKER than background → negative corrected signal.
    expect(first.channels.IRM.signalMinusBackground).toBeLessThan(0);
    expect(first.channels.TIRF_488.signalMinusBackground).toBeGreaterThan(0);
    // Geometry is channel-independent and therefore stored once.
    expect(first.lengthPx).toBeCloseTo(412.3522, 3);
    expect(first.areaPx).toBe(2063);
    expect(first.pixelCount).toBe(2063);
  });

  it('round-trips: pivot then un-pivot reproduces every long row exactly', () => {
    const original = rows();
    const wide = pivotMTMetricsWide(original);
    expect(sorted(unpivot(wide))).toEqual(sorted(REAL_ROWS));
  });

  it('does not mutate the input rows', () => {
    const input = rows();
    pivotMTMetricsWide(input);
    expect(input).toEqual(REAL_ROWS);
  });

  it('keeps rows in frame-ascending reading order', () => {
    const wide = pivotMTMetricsWide(rows());
    const frames = wide.rows.map(r => r.frameIndex);
    expect(frames.slice(0, 23).every(f => f === 0)).toBe(true);
    expect(frames.slice(23).every(f => f === 1)).toBe(true);
  });

  it('carries trackId through, so a user can group the wide rows over time', () => {
    const wide = pivotMTMetricsWide(rows());
    // instanceId is regenerated per frame; trackId is the cross-frame identity.
    const f0 = wide.rows.filter(r => r.frameIndex === 0);
    const f1 = wide.rows.filter(r => r.frameIndex === 1);
    expect(new Set(f0.map(r => r.instanceId))).not.toEqual(
      new Set(f1.map(r => r.instanceId))
    );
    expect(new Set(f0.map(r => r.trackId))).toEqual(
      new Set(f1.map(r => r.trackId))
    );
  });

  it('leaves a channel absent when it produced no row for that microtubule', () => {
    // Drop TIRF_488 for exactly one microtubule (a PNG-backed channel with a
    // missing frame image behaves like this).
    const input = rows().filter(
      r => !(r.channel === 'TIRF_488' && r.instanceId === 'mt_6ee5ae2d')
    );
    const wide = pivotMTMetricsWide(input);
    expect(wide.channels).toEqual(['IRM', 'TIRF_488']);
    // instanceId is per-frame (only trackId is stable across frames), so this
    // id identifies exactly one microtubule-frame.
    const affected = wide.rows.filter(r => r.instanceId === 'mt_6ee5ae2d');
    expect(affected).toHaveLength(1);
    expect(affected[0].channels.IRM).toBeDefined();
    expect(affected[0].channels.TIRF_488).toBeUndefined();
    expect(wide.rows).toHaveLength(46); // the row survives, only the cells go
    // …and the round-trip still holds with the hole in place.
    expect(sorted(unpivot(wide))).toEqual(sorted(input));
  });

  it('keeps colliding instance ids as separate microtubules', () => {
    // Two polylines with no instanceId and the same point count synthesize the
    // same `mt_<frameId>_<n>` fallback id (see computeMTMetrics). They must not
    // merge into one wide row.
    const base = REAL_ROWS.filter(r => r.frameIndex === 0).slice(0, 2);
    const collided: MTMetricsRow[] = [
      { ...base[0], instanceId: 'mt_dup', channel: 'IRM' },
      { ...base[1], instanceId: 'mt_dup', channel: 'IRM' },
      { ...base[0], instanceId: 'mt_dup', channel: 'TIRF_488' },
      { ...base[1], instanceId: 'mt_dup', channel: 'TIRF_488' },
    ];
    const wide = pivotMTMetricsWide(collided);
    expect(wide.rows).toHaveLength(2);
    expect(wide.rows[0].channels.IRM.sumIntensity).toBe(base[0].sumIntensity);
    expect(wide.rows[1].channels.IRM.sumIntensity).toBe(base[1].sumIntensity);
    expect(sorted(unpivot(wide))).toEqual(sorted(collided));
  });

  it('warns when the supposedly channel-independent geometry disagrees', () => {
    const input = rows();
    const victim = input.find(
      r => r.channel === 'TIRF_488' && r.instanceId === 'mt_6ee5ae2d'
    )!;
    victim.areaPx = victim.areaPx! + 7;
    pivotMTMetricsWide(input);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('geometry columns differ'),
      'mtMetricsExporter',
      expect.objectContaining({ mismatches: expect.any(Number) })
    );
  });

  it('emits no channel columns for geometry-only rows', () => {
    // The no-raster fallback: channel '', every intensity/area column null.
    const geometryOnly: MTMetricsRow[] = REAL_ROWS.filter(
      r => r.channel === 'IRM'
    ).map(r => ({
      ...r,
      channel: '',
      areaPx: null,
      areaUm2: null,
      pixelCount: null,
      sumIntensity: null,
      meanIntensity: null,
      medianIntensity: null,
      stdIntensity: null,
      medianBackground: null,
      meanBackground: null,
      signalMinusBackground: null,
    }));
    const wide = pivotMTMetricsWide(geometryOnly);
    expect(wide.channels).toEqual([]);
    expect(wide.rows).toHaveLength(46);
    for (const w of wide.rows) expect(Object.keys(w.channels)).toEqual([]);
    expect(wide.rows[0].lengthPx).toBeCloseTo(412.3522, 3);
  });

  it('handles a channel literally named __proto__', () => {
    // CHANNEL_NAME_RE accepts it, and a user can name an added channel freely.
    // On a plain object the assignment would set the prototype, not a key.
    const input = rows().map(r =>
      r.channel === 'TIRF_488' ? { ...r, channel: '__proto__' } : r
    );
    const wide = pivotMTMetricsWide(input);
    expect(wide.channels).toEqual(['IRM', '__proto__']);
    // It must be a real OWN key, not a swapped-out prototype: on a plain `{}`
    // the write lands on the prototype and Object.keys/JSON.stringify lose it.
    expect(Object.keys(wide.rows[0].channels).sort()).toEqual([
      'IRM',
      '__proto__',
    ]);
    expect(
      Object.getPrototypeOf(wide.rows[0].channels) as unknown
    ).toBeNull();
    expect(sorted(unpivot(wide))).toEqual(sorted(input));
  });

  it('handles an empty input', () => {
    expect(pivotMTMetricsWide([])).toEqual({ channels: [], rows: [] });
  });
});

// ---------------------------------------------------------------------------

describe('writeMTMetrics — wide files alongside the long ones', () => {
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mt-wide-'));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const summaries: MTChannelSummaryRow[] = [
    {
      video: 'B_txMT_KIF14-1kx-2nM_SMYD2_004.nd2',
      channel: 'IRM',
      totalIntensity: 2393293564678,
      meanIntensity: 20980.634721950657,
      pixelCount: 114071552,
      frames: 109,
    },
    {
      video: 'B_txMT_KIF14-1kx-2nM_SMYD2_004.nd2',
      channel: 'TIRF_488',
      totalIntensity: 12031450987,
      meanIntensity: 105.47284380771816,
      pixelCount: 114071552,
      frames: 109,
    },
  ];

  const expectedWideHeader = [
    ...WIDE_SHARED_HEADERS,
    ...['IRM', 'TIRF_488'].flatMap(c =>
      WIDE_CHANNEL_MEASURES.map(m => `${c}_${m}`)
    ),
  ];

  it('writes metrics_wide.csv with one row per (frame, MT)', async () => {
    await writeMTMetrics(rows(), dir, ['csv'], summaries);
    const csv = await fsp.readFile(path.join(dir, 'metrics_wide.csv'), 'utf8');
    const lines = csv.trimEnd().split('\n');
    expect(lines[0].split(',')).toEqual(expectedWideHeader);
    expect(lines).toHaveLength(47); // header + 46 microtubule-frames

    const cols = lines[0].split(',');
    const cells = lines[1].split(',');
    const at = (name: string) => cells[cols.indexOf(name)];
    expect(at('instanceId')).toBe('mt_6ee5ae2d');
    expect(at('pixelCount')).toBe('2063');
    expect(Number(at('IRM_meanIntensity'))).toBeCloseTo(20699.4876, 3);
    expect(Number(at('TIRF_488_meanIntensity'))).toBeCloseTo(108.7756, 3);
  });

  it('leaves the long metrics.csv untouched', async () => {
    await writeMTMetrics(rows(), dir, ['csv'], summaries);
    const csv = await fsp.readFile(path.join(dir, 'metrics.csv'), 'utf8');
    const lines = csv.trimEnd().split('\n');
    // `channelFrameSource` is APPENDED, not slotted in beside `channel`: the
    // long format is the canonical file and is read by column number outside
    // this repo, so every pre-existing column keeps its position.
    expect(lines[0]).toBe(
      'frameIndex,imageName,label,mtType,instanceId,trackId,channel,lengthPx,' +
        'lengthUm,areaPx,areaUm2,pixelCount,sumIntensity,meanIntensity,' +
        'medianIntensity,stdIntensity,medianBackground,meanBackground,' +
        'signalMinusBackground,channelFrameSource'
    );
    expect(lines).toHaveLength(93); // header + all 92 long rows
  });

  it('writes metrics_wide.json with the same flat columns', async () => {
    await writeMTMetrics(rows(), dir, ['json'], summaries);
    const parsed = JSON.parse(
      await fsp.readFile(path.join(dir, 'metrics_wide.json'), 'utf8')
    ) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(46);
    expect(Object.keys(parsed[0])).toEqual(expectedWideHeader);
    expect(parsed[0].IRM_medianIntensity).toBe(20710);
    expect(parsed[0].TIRF_488_medianIntensity).toBe(108);
  });

  it('blanks the columns of a channel that produced no measurement', async () => {
    const input = rows().filter(
      r => !(r.channel === 'TIRF_488' && r.instanceId === 'mt_6ee5ae2d')
    );
    await writeMTMetrics(input, dir, ['csv', 'json'], summaries);
    const lines = (await fsp.readFile(path.join(dir, 'metrics_wide.csv'), 'utf8'))
      .trimEnd()
      .split('\n');
    const cols = lines[0].split(',');
    const cells = lines[1].split(',');
    expect(cells[cols.indexOf('instanceId')]).toBe('mt_6ee5ae2d');
    expect(cells[cols.indexOf('IRM_sumIntensity')]).not.toBe('');
    for (const m of WIDE_CHANNEL_MEASURES) {
      expect(cells[cols.indexOf(`TIRF_488_${m}`)]).toBe('');
    }
    const parsed = JSON.parse(
      await fsp.readFile(path.join(dir, 'metrics_wide.json'), 'utf8')
    ) as Array<Record<string, unknown>>;
    expect(parsed[0].TIRF_488_sumIntensity).toBeNull();
  });

  it('skips the wide output entirely on the geometry-only fallback', async () => {
    const geometryOnly: MTMetricsRow[] = REAL_ROWS.filter(
      r => r.channel === 'IRM'
    ).map(r => ({
      ...r,
      channel: '',
      areaPx: null,
      areaUm2: null,
      pixelCount: null,
      sumIntensity: null,
      meanIntensity: null,
      medianIntensity: null,
      stdIntensity: null,
      medianBackground: null,
      meanBackground: null,
      signalMinusBackground: null,
    }));
    await writeMTMetrics(geometryOnly, dir, ['csv', 'json', 'excel'], []);
    const written = await fsp.readdir(dir);
    expect(written.sort()).toEqual(['metrics.csv', 'metrics.json', 'metrics.xlsx']);

    const workbook = await readWorkbook(path.join(dir, 'metrics.xlsx'));
    expect(workbook.worksheets.map(w => w.name)).toEqual([
      'Microtubule Metrics',
    ]);
  });

  it('drops the sheet but keeps the numbers when the workbook would be too big', async () => {
    // Real budget is 2M cells (~80 000 microtubule-frames); shrink it rather
    // than building such a workbook in a unit test.
    process.env.MT_WIDE_XLSX_MAX_CELLS = '100';
    try {
      await writeMTMetrics(rows(), dir, ['excel'], summaries);
    } finally {
      delete process.env.MT_WIDE_XLSX_MAX_CELLS;
    }
    const workbook = await readWorkbook(path.join(dir, 'metrics.xlsx'));
    expect(workbook.worksheets.map(w => w.name)).toEqual([
      'Microtubule Metrics',
      'Channel Totals',
    ]);
    // …and the pivoted numbers are still there, next to the workbook.
    const lines = (
      await fsp.readFile(path.join(dir, 'metrics_wide.csv'), 'utf8')
    )
      .trimEnd()
      .split('\n');
    expect(lines[0].split(',')).toEqual(expectedWideHeader);
    expect(lines).toHaveLength(47);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('too large for an Excel sheet'),
      'mtMetricsExporter',
      // 47 rows (header + 46 microtubule-frames) x 27 columns
      // (11 shared + 8 measures x 2 channels).
      expect.objectContaining({ cells: 1269, budget: 100 })
    );
  });

  it('adds a "(wide)" sheet to metrics.xlsx with real headers and values', async () => {
    await writeMTMetrics(rows(), dir, ['excel'], summaries);
    const workbook = await readWorkbook(path.join(dir, 'metrics.xlsx'));
    expect(workbook.worksheets.map(w => w.name)).toEqual([
      'Microtubule Metrics',
      'Microtubule Metrics (wide)',
      'Channel Totals',
    ]);

    const sheet = workbook.getWorksheet('Microtubule Metrics (wide)')!;
    const header = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(expectedWideHeader);
    expect(sheet.rowCount).toBe(47); // header + 46 microtubule-frames

    const first = (sheet.getRow(2).values as unknown[]).slice(1);
    const col = (name: string) => first[expectedWideHeader.indexOf(name)];
    expect(col('instanceId')).toBe('mt_6ee5ae2d');
    expect(col('trackId')).toBe('track_98d97d0a0d');
    expect(col('areaPx')).toBe(2063);
    expect(col('IRM_meanIntensity')).toBeCloseTo(20699.4876, 3);
    expect(col('TIRF_488_meanIntensity')).toBeCloseTo(108.7756, 3);
    // The long sheet is still first and still long-format.
    const long = workbook.getWorksheet('Microtubule Metrics')!;
    expect(long.rowCount).toBe(93);
  });
});

// ---------------------------------------------------------------------------
// Sparse channels in the wide view.
//
// Sparseness is a property of ONE channel: on a video whose IRM is refreshed
// every third frame, the IRM columns of the frames in between repeat the last
// real measurement while the TIRF columns beside them are genuine. A single
// per-row flag could not say that, which is why the provenance column is
// per-channel.
// ---------------------------------------------------------------------------

describe('pivotMTMetricsWide — a sparse channel beside a dense one', () => {
  beforeEach(() => vi.clearAllMocks());

  /** The real rows with frame 1's IRM re-pointed at frame 0, i.e. the shape
   *  the ML service returns for a container whose IRM was not re-exposed. */
  const sparseRows = (): MTMetricsRow[] =>
    rows().map(r =>
      r.frameIndex === 1 && r.channel === 'IRM'
        ? { ...r, channelFrameSource: 0 }
        : r
    );

  it('marks only the sparse channel as propagated, per row', () => {
    const wide = pivotMTMetricsWide(sparseRows());
    const frame1 = wide.rows.filter(r => r.frameIndex === 1);
    expect(frame1).toHaveLength(23);
    for (const w of frame1) {
      expect(w.channels.IRM.channelFrameSource).toBe(0);
      expect(w.channels.TIRF_488.channelFrameSource).toBe(1);
    }
    for (const w of wide.rows.filter(r => r.frameIndex === 0)) {
      expect(w.channels.IRM.channelFrameSource).toBe(0);
      expect(w.channels.TIRF_488.channelFrameSource).toBe(0);
    }
  });

  it('writes the per-channel provenance into metrics_wide.csv', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mt-wide-sparse-'));
    try {
      await writeMTMetrics(sparseRows(), dir, ['csv'], []);
      const lines = (
        await fsp.readFile(path.join(dir, 'metrics_wide.csv'), 'utf8')
      )
        .trimEnd()
        .split('\n');
      const header = lines[0].split(',');
      const irmSrc = header.indexOf('IRM_channelFrameSource');
      const tirfSrc = header.indexOf('TIRF_488_channelFrameSource');
      const frameIdx = header.indexOf('frameIndex');
      expect(irmSrc).toBeGreaterThan(-1);
      expect(tirfSrc).toBeGreaterThan(-1);

      // Every frame-1 row must disagree with its own frameIndex on IRM and
      // agree on TIRF — that difference is the whole readable signal.
      const body = lines.slice(1).map(l => l.split(','));
      const frame1 = body.filter(c => c[frameIdx] === '1');
      expect(frame1).toHaveLength(23);
      expect(frame1.every(c => c[irmSrc] === '0')).toBe(true);
      expect(frame1.every(c => c[tirfSrc] === '1')).toBe(true);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

/** exceljs is CJS; mirror the dynamic-import idiom the exporter uses. */
async function readWorkbook(
  filePath: string
): Promise<import('exceljs').Workbook> {
  const mod = (await import('exceljs')) as unknown as {
    default?: typeof import('exceljs');
    Workbook?: typeof import('exceljs').Workbook;
  };
  const ExcelJS = mod.default ?? mod;
  const workbook = new ExcelJS.Workbook!();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}
