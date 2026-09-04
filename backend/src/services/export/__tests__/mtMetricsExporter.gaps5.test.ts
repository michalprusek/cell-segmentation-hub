/**
 * mtMetricsExporter.gaps5.test.ts
 *
 * Covers branches still uncovered after mtMetricsExporter.test.ts:
 *
 *  A. csvCell (private, exercised via writeMTMetrics → rowsToCSV)
 *     - null / undefined → empty string
 *     - Infinity / NaN → empty string
 *     - integer number → no decimal places
 *     - non-integer number → fixed 6, trailing zeros stripped
 *     - string with comma → quoted
 *     - string with double quote → quote-escaped
 *     - string with newline → quoted
 *     - plain string → as-is
 *
 *  B. writeMTMetrics
 *     - empty rows → returns without writing
 *     - empty formats → returns without writing
 *     - csv format → writes metrics.csv
 *     - json format → writes metrics.json
 *     - excel format → calls writeXLSX (mocked exceljs)
 *     - multiple formats in one call
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const { mockFsWriteFile, mockFsMkdir } = vi.hoisted(() => ({
  mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
  mockFsMkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs/promises', () => ({
  writeFile: mockFsWriteFile,
  mkdir: mockFsMkdir,
}));

// Mock exceljs for writeXLSX
const mockAddRow = vi.fn();
const mockGetRow = vi.fn(() => ({ font: undefined }));
const mockWriteXlsxFile = vi.fn().mockResolvedValue(undefined);
const mockAddWorksheet = vi.fn(() => ({
  columns: [],
  addRow: mockAddRow,
  getRow: mockGetRow,
}));

vi.mock('exceljs', () => ({
  default: {
    Workbook: vi.fn().mockImplementation(function (this: unknown) {
      return {
        addWorksheet: mockAddWorksheet,
        xlsx: { writeFile: mockWriteXlsxFile },
      };
    }),
  },
}));

import { writeMTMetrics, type MTMetricsRow } from '../mtMetricsExporter';

/**
 * A row with the REAL column names.
 *
 * The previous fixture spelled them `frame` / `length_px` / `length_um`, none
 * of which are in `MTMetricsRow` — it was cast through `as unknown` so nothing
 * complained — and `rowsToCSV` maps over `CSV_HEADERS`, so every cell it
 * produced was empty. That is why the two escaping tests below could only
 * manage `expect(csvContent).toBeDefined()`: on that fixture there was no cell
 * to look at, and null, Infinity, a comma and a plain string all rendered the
 * same empty output.
 */
function makeRow(overrides: Partial<MTMetricsRow> = {}): MTMetricsRow {
  return {
    frameIndex: 1,
    imageName: 'frame_0001.png',
    label: 'MT1',
    mtType: 'plus-end',
    instanceId: 'inst-1',
    trackId: 'track-1',
    channel: '488_nm',
    channelFrameSource: 1,
    lengthPx: 100.5,
    lengthUm: null,
    areaPx: 500,
    areaUm2: null,
    pixelCount: 500,
    sumIntensity: 12345,
    meanIntensity: 24.69,
    medianIntensity: 24,
    stdIntensity: 3.5,
    medianBackground: 10,
    meanBackground: 10.25,
    signalMinusBackground: 14.44,
    ...overrides,
  };
}

/** Split one CSV line into cells, honouring RFC4180 quoting. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/** The written metrics.csv as { header: cell } for its single data row. */
function csvRow(): Record<string, string> {
  const call = mockFsWriteFile.mock.calls.find(c =>
    String(c[0]).endsWith('metrics.csv')
  );
  if (!call) {
    throw new Error('metrics.csv was never written');
  }
  const lines = String(call[1]).split('\n').filter(Boolean);
  const headers = lines[0].split(',');
  const cells = splitCsvLine(lines[1]);
  expect(cells).toHaveLength(headers.length);
  return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFsWriteFile.mockResolvedValue(undefined);
  mockFsMkdir.mockResolvedValue(undefined);
  mockWriteXlsxFile.mockResolvedValue(undefined);
});

// ─── B. writeMTMetrics ────────────────────────────────────────────────────────

describe('writeMTMetrics', () => {
  it('returns without writing when rows is empty', async () => {
    await writeMTMetrics([], '/tmp/out', ['csv']);
    expect(mockFsWriteFile).not.toHaveBeenCalled();
  });

  it('returns without writing when formats is empty', async () => {
    await writeMTMetrics([makeRow()], '/tmp/out', []);
    expect(mockFsWriteFile).not.toHaveBeenCalled();
  });

  it('writes metrics.csv when format includes csv', async () => {
    await writeMTMetrics([makeRow()], '/tmp/out', ['csv']);
    expect(mockFsMkdir).toHaveBeenCalledWith('/tmp/out', { recursive: true });
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('metrics.csv'),
      expect.any(String),
      'utf8'
    );
  });

  it('writes metrics.json when format includes json', async () => {
    await writeMTMetrics([makeRow()], '/tmp/out', ['json']);
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('metrics.json'),
      expect.any(String),
      'utf8'
    );
  });

  it('writes metrics.xlsx when format includes excel', async () => {
    await writeMTMetrics([makeRow()], '/tmp/out', ['excel']);
    expect(mockWriteXlsxFile).toHaveBeenCalledWith(
      expect.stringContaining('metrics.xlsx')
    );
  });

  it('writes multiple formats in one call, wide CSV included', async () => {
    await writeMTMetrics([makeRow()], '/tmp/out', ['csv', 'json', 'excel']);
    // Named rather than counted. The old assertion was `toHaveBeenCalledTimes(2)`
    // — "csv + json" — and held only because the fixture's row carried no
    // `channel`, so `pivotMTMetricsWide` found no channels and the
    // metrics_wide.csv branch never ran. A realistic row has one.
    expect(
      mockFsWriteFile.mock.calls.map(c => String(c[0]).split('/').pop()).sort()
    ).toEqual([
      'metrics.csv',
      'metrics.json',
      'metrics_wide.csv',
      'metrics_wide.json',
    ]);
    expect(mockWriteXlsxFile).toHaveBeenCalledTimes(1);
  });

  it('omits the wide CSV when no row names a channel', async () => {
    // Geometry-only export: nothing was measured, so there is no per-channel
    // view to pivot into.
    await writeMTMetrics(
      [makeRow({ channel: '', channelFrameSource: null })],
      '/tmp/out',
      ['csv']
    );
    expect(
      mockFsWriteFile.mock.calls.map(c => String(c[0]).split('/').pop())
    ).toEqual(['metrics.csv']);
  });
});

// ─── A. csvCell, through writeMTMetrics → rowsToCSV ──────────────────────────
//
// This is what a biologist opens in Excel, so a stray comma or quote in a
// user-typed name is a corrupted file, not a cosmetic problem: `mtType` is the
// project's own label text and `imageName` is an uploaded file name, both free
// text. The header of this file has always advertised these eight cases; the
// two tests that existed asserted `expect(csvContent).toBeDefined()`.

describe('csvCell', () => {
  it('writes null and undefined as an empty cell, not "null"', async () => {
    await writeMTMetrics(
      [
        makeRow({
          lengthUm: null,
          areaUm2: undefined as unknown as number | null,
        }),
      ],
      '/tmp/out',
      ['csv']
    );
    const row = csvRow();
    expect(row.lengthUm).toBe('');
    expect(row.areaUm2).toBe('');
  });

  it('writes a non-finite number as an empty cell', async () => {
    await writeMTMetrics(
      [
        makeRow({
          lengthPx: Infinity,
          meanIntensity: NaN,
          stdIntensity: -Infinity,
        }),
      ],
      '/tmp/out',
      ['csv']
    );
    const row = csvRow();
    // Not 'Infinity' / 'NaN', which is what String(v) would give and what a
    // spreadsheet would import as text into a numeric column.
    expect(row.lengthPx).toBe('');
    expect(row.meanIntensity).toBe('');
    expect(row.stdIntensity).toBe('');
  });

  it('writes an integer with no decimal point and keeps its trailing zeros', async () => {
    await writeMTMetrics(
      [makeRow({ pixelCount: 500, sumIntensity: 1000 })],
      '/tmp/out',
      ['csv']
    );
    const row = csvRow();
    expect(row.pixelCount).toBe('500');
    expect(row.sumIntensity).toBe('1000'); // not '1' — the strip is decimals only
  });

  it('writes a fraction at six decimals with trailing zeros removed', async () => {
    await writeMTMetrics(
      [
        makeRow({
          lengthPx: 100.5,
          meanIntensity: 24.6912345678, // more precision than six places
          stdIntensity: 1e-9, // rounds away entirely at six places
        }),
      ],
      '/tmp/out',
      ['csv']
    );
    const row = csvRow();
    expect(row.lengthPx).toBe('100.5');
    expect(row.meanIntensity).toBe('24.691235'); // toFixed rounds, not truncates
    expect(row.stdIntensity).toBe('0');
  });

  it('quotes a value containing a comma so the column count survives', async () => {
    await writeMTMetrics(
      [makeRow({ mtType: 'plus-end, growing' })],
      '/tmp/out',
      ['csv']
    );
    const written = String(
      mockFsWriteFile.mock.calls.find(c =>
        String(c[0]).endsWith('metrics.csv')
      )?.[1]
    );
    expect(written).toContain('"plus-end, growing"');
    // And the row still parses to exactly as many cells as there are headers
    // (csvRow asserts that), with the comma intact inside one of them.
    expect(csvRow().mtType).toBe('plus-end, growing');
  });

  it('doubles an embedded double quote and wraps the cell', async () => {
    await writeMTMetrics(
      [makeRow({ imageName: 'frame "01".png' })],
      '/tmp/out',
      ['csv']
    );
    const written = String(
      mockFsWriteFile.mock.calls.find(c =>
        String(c[0]).endsWith('metrics.csv')
      )?.[1]
    );
    expect(written).toContain('"frame ""01"".png"');
    expect(csvRow().imageName).toBe('frame "01".png');
  });

  it('quotes a value containing a newline so the row count survives', async () => {
    await writeMTMetrics([makeRow({ label: 'MT1\nMT2' })], '/tmp/out', ['csv']);
    const written = String(
      mockFsWriteFile.mock.calls.find(c =>
        String(c[0]).endsWith('metrics.csv')
      )?.[1]
    );
    expect(written).toContain('"MT1\nMT2"');
  });

  it('leaves an ordinary string untouched — no gratuitous quoting', async () => {
    await writeMTMetrics([makeRow({ mtType: 'plus-end' })], '/tmp/out', [
      'csv',
    ]);
    const written = String(
      mockFsWriteFile.mock.calls.find(c =>
        String(c[0]).endsWith('metrics.csv')
      )?.[1]
    );
    expect(written).toContain(',plus-end,');
    expect(written).not.toContain('"plus-end"');
  });
});
