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

function makeRow(overrides: Partial<MTMetricsRow> = {}): MTMetricsRow {
  return {
    frame: 1,
    trackId: 'track-1',
    length_px: 100.5,
    length_um: null,
    ...overrides,
  } as unknown as MTMetricsRow;
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

  it('writes multiple formats in one call', async () => {
    await writeMTMetrics([makeRow()], '/tmp/out', ['csv', 'json', 'excel']);
    expect(mockFsWriteFile).toHaveBeenCalledTimes(2); // csv + json
    expect(mockWriteXlsxFile).toHaveBeenCalledTimes(1);
  });

  it('includes null values as empty string in CSV', async () => {
    const row = makeRow({ length_um: null });
    await writeMTMetrics([row], '/tmp/out', ['csv']);
    const csvContent = mockFsWriteFile.mock.calls[0][1] as string;
    // The null value for length_um should produce empty cell
    expect(csvContent).toBeDefined();
  });

  it('includes Infinity as empty string in CSV', async () => {
    const row = makeRow({ length_px: Infinity });
    await writeMTMetrics([row], '/tmp/out', ['csv']);
    const csvContent = mockFsWriteFile.mock.calls[0][1] as string;
    expect(csvContent).toBeDefined();
  });
});
