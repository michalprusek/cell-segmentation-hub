/**
 * Unit tests for png16.ts — the hand-rolled grayscale-PNG decoder that
 * preserves 16-bit sample depth (inflate + PNG scanline unfiltering +
 * big-endian 16-bit sample assembly), used so the editor's window/level tool
 * can operate on real microscopy sample values instead of the browser's
 * 8-bit `createImageBitmap` downcast.
 *
 * Environment note: vitest's jsdom environment's `Blob` implementation does
 * not implement `.stream()` (only Node's own `Blob` — from `node:buffer` —
 * does), but `png16.ts`'s `inflate()` needs `new Blob([...]).stream()` to
 * feed `DecompressionStream('deflate')`. We swap `global.Blob` to Node's
 * Blob for this file only (restored in `afterAll`) so the real inflate path
 * can be exercised end-to-end instead of only testing the null/fallback
 * paths.
 *
 * The decoder never validates chunk CRCs (it only skips the trailing 4
 * bytes), so test fixtures below use zeroed CRC placeholders.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import zlib from 'node:zlib';
import { Blob as NodeBlob } from 'node:buffer';
import { decodeGrayPng } from '../png16';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// jsdom Blob → Node Blob swap (see file header)
// ---------------------------------------------------------------------------

let OriginalBlob: typeof Blob;
beforeAll(() => {
  OriginalBlob = global.Blob;
  // @ts-expect-error -- Node's Blob implements .stream(); jsdom's does not.
  global.Blob = NodeBlob;
});
afterAll(() => {
  global.Blob = OriginalBlob;
});

// ---------------------------------------------------------------------------
// Synthetic PNG builder
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** Build a PNG chunk. CRC is zeroed — the decoder under test never checks it. */
function chunk(type: string, data: number[]): number[] {
  const typeBytes = Array.from(type).map(c => c.charCodeAt(0));
  return [...u32be(data.length), ...typeBytes, ...data, 0, 0, 0, 0];
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Encode one row of raw sample bytes into its PNG-filtered form (the
 * mathematical inverse of the decoder's unfiltering switch), given the
 * previous row's *raw* (unfiltered) sample bytes.
 */
function encodeFilterRow(
  filterType: number,
  row: number[],
  prevRow: number[] | null,
  bpp: number
): number[] {
  return row.map((value, x) => {
    const a = x >= bpp ? row[x - bpp] : 0;
    const b = prevRow ? prevRow[x] : 0;
    const c = prevRow && x >= bpp ? prevRow[x - bpp] : 0;
    let pred: number;
    switch (filterType) {
      case 0:
        pred = 0;
        break;
      case 1:
        pred = a;
        break;
      case 2:
        pred = b;
        break;
      case 3:
        pred = Math.floor((a + b) / 2);
        break;
      case 4:
        pred = paethPredictor(a, b, c);
        break;
      default:
        throw new Error(`test fixture: unsupported filter type ${filterType}`);
    }
    return (value - pred) & 0xff;
  });
}

interface BuildPngOptions {
  width: number;
  height: number;
  bitDepth: 8 | 16;
  /** One row of pixel VALUES (0-255 for 8-bit, 0-65535 for 16-bit). */
  pixelRows: number[][];
  /** PNG filter type per row (defaults to 0/None for every row). */
  filterTypes?: number[];
  colorType?: number;
  interlace?: number;
  bitDepthOverride?: number; // allows constructing invalid-bit-depth fixtures
}

function pixelRowToBytes(row: number[], bitDepth: 8 | 16): number[] {
  if (bitDepth === 8) return row.slice();
  const bytes: number[] = [];
  for (const v of row) {
    bytes.push((v >> 8) & 0xff, v & 0xff); // big-endian
  }
  return bytes;
}

function buildGrayPng(opts: BuildPngOptions): Uint8Array {
  const {
    width,
    height,
    bitDepth,
    pixelRows,
    colorType = 0,
    interlace = 0,
  } = opts;
  const bitDepthByte = opts.bitDepthOverride ?? bitDepth;
  const bpp = bitDepth === 16 ? 2 : 1;
  const filterTypes = opts.filterTypes ?? new Array(height).fill(0);

  const ihdrData = [
    ...u32be(width),
    ...u32be(height),
    bitDepthByte,
    colorType,
    0, // compression method
    0, // filter method
    interlace,
  ];

  const rawSampleRows = pixelRows.map(row => pixelRowToBytes(row, bitDepth));
  const raw: number[] = [];
  let prevRow: number[] | null = null;
  for (let y = 0; y < rawSampleRows.length; y++) {
    const filtered = encodeFilterRow(
      filterTypes[y],
      rawSampleRows[y],
      prevRow,
      bpp
    );
    raw.push(filterTypes[y], ...filtered);
    prevRow = rawSampleRows[y];
  }
  const compressed = Array.from(zlib.deflateSync(Buffer.from(raw)));

  const bytes = [
    ...PNG_SIGNATURE,
    ...chunk('IHDR', ihdrData),
    ...chunk('IDAT', compressed),
    ...chunk('IEND', []),
  ];
  return new Uint8Array(bytes);
}

function toBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('decodeGrayPng', () => {
  describe('successful decode', () => {
    it('decodes an 8-bit grayscale PNG (filter type 0/None) with exact samples', async () => {
      const png = buildGrayPng({
        width: 3,
        height: 2,
        bitDepth: 8,
        pixelRows: [
          [0, 128, 255],
          [10, 20, 30],
        ],
      });

      const result = await decodeGrayPng(toBlob(png));

      expect(result).not.toBeNull();
      expect(result!.width).toBe(3);
      expect(result!.height).toBe(2);
      expect(result!.bitDepth).toBe(8);
      expect(result!.data).toBeInstanceOf(Uint8Array);
      expect(Array.from(result!.data)).toEqual([0, 128, 255, 10, 20, 30]);
      expect(result!.min).toBe(0);
      expect(result!.max).toBe(255);
    });

    it('decodes a 16-bit grayscale PNG with exact big-endian samples', async () => {
      // Values chosen to exercise big-endian assembly (each needs both
      // bytes) and to echo the file's own docstring example (a real TIRF
      // frame decoding to min=640 max=23480).
      const png = buildGrayPng({
        width: 2,
        height: 2,
        bitDepth: 16,
        pixelRows: [
          [640, 23480],
          [5000, 12345],
        ],
      });

      const result = await decodeGrayPng(toBlob(png));

      expect(result).not.toBeNull();
      expect(result!.width).toBe(2);
      expect(result!.height).toBe(2);
      expect(result!.bitDepth).toBe(16);
      expect(result!.data).toBeInstanceOf(Uint16Array);
      expect(Array.from(result!.data)).toEqual([640, 23480, 5000, 12345]);
      expect(result!.min).toBe(640);
      expect(result!.max).toBe(23480);
    });

    it('unfilters all five PNG filter types (None/Sub/Up/Average/Paeth) correctly', async () => {
      // One 8-bit row per filter type, each with a distinct pattern, so a
      // bug in any single filter branch shows up as a wrong sample value.
      const pixelRows = [
        [10, 20, 30, 40], // filter 0: None
        [15, 90, 45, 200], // filter 1: Sub
        [12, 22, 250, 41], // filter 2: Up
        [100, 5, 60, 210], // filter 3: Average
        [0, 255, 128, 64], // filter 4: Paeth
      ];
      const png = buildGrayPng({
        width: 4,
        height: 5,
        bitDepth: 8,
        pixelRows,
        filterTypes: [0, 1, 2, 3, 4],
      });

      const result = await decodeGrayPng(toBlob(png));

      expect(result).not.toBeNull();
      expect(Array.from(result!.data)).toEqual(pixelRows.flat());
    });
  });

  describe('out-of-scope input (silent null, no logging — caller falls back to createImageBitmap)', () => {
    it('returns null for a non-PNG blob', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const result = await decodeGrayPng(toBlob(bytes));
      expect(result).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('returns null for a buffer shorter than the PNG signature', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const bytes = new Uint8Array([137, 80, 78]);
      const result = await decodeGrayPng(toBlob(bytes));
      expect(result).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('returns null for an RGB (colour type 2) PNG', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const png = buildGrayPng({
        width: 2,
        height: 1,
        bitDepth: 8,
        colorType: 2,
        pixelRows: [[1, 2, 3, 4, 5, 6]], // 3 bytes/pixel * 2 px, irrelevant content
      });
      const result = await decodeGrayPng(toBlob(png));
      expect(result).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('returns null for an unsupported bit depth (e.g. 4)', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const png = buildGrayPng({
        width: 2,
        height: 1,
        bitDepth: 8,
        bitDepthOverride: 4,
        pixelRows: [[1, 2]],
      });
      const result = await decodeGrayPng(toBlob(png));
      expect(result).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('returns null for an interlaced PNG', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const png = buildGrayPng({
        width: 2,
        height: 1,
        bitDepth: 8,
        interlace: 1,
        pixelRows: [[1, 2]],
      });
      const result = await decodeGrayPng(toBlob(png));
      expect(result).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('returns null silently when blob.arrayBuffer() itself rejects', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const brokenBlob = {
        arrayBuffer: () => Promise.reject(new Error('revoked blob')),
      } as unknown as Blob;
      const result = await decodeGrayPng(brokenBlob);
      expect(result).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('in-scope real decode failures (logged — a genuine regression, not a format mismatch)', () => {
    it('returns null and warns when the inflated data is shorter than the declared dimensions require', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      // IHDR declares a 4x4 8-bit image (needs 4 rows * (4+1) = 20 inflated
      // bytes), but the IDAT only deflates 2 rows' worth of raw data, so
      // inflate succeeds while the result is shorter than required.
      const truncatedRaw = [0, 1, 2, 3, 4, 0, 5, 6, 7, 8]; // 2 rows only
      const truncatedCompressed = Array.from(
        zlib.deflateSync(Buffer.from(truncatedRaw))
      );
      const truncatedPng = new Uint8Array([
        ...PNG_SIGNATURE,
        ...chunk('IHDR', [...u32be(4), ...u32be(4), 8, 0, 0, 0, 0]),
        ...chunk('IDAT', truncatedCompressed),
        ...chunk('IEND', []),
      ]);

      const result = await decodeGrayPng(toBlob(truncatedPng));

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      const messages = warnSpy.mock.calls.map(call => String(call[0]));
      expect(messages.some(m => m.includes('truncated'))).toBe(true);
      warnSpy.mockRestore();
    });

    it('returns null and warns on an unknown PNG filter byte', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      // Valid dimensions/length, but the first row's filter byte (5) is
      // outside the PNG spec's 0-4 range.
      const raw = [5, 1, 2, 3, 4]; // filter=5 (invalid), then 4 sample bytes
      const compressed = Array.from(zlib.deflateSync(Buffer.from(raw)));
      const png = new Uint8Array([
        ...PNG_SIGNATURE,
        ...chunk('IHDR', [...u32be(4), ...u32be(1), 8, 0, 0, 0, 0]),
        ...chunk('IDAT', compressed),
        ...chunk('IEND', []),
      ]);

      const result = await decodeGrayPng(toBlob(png));

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      const messages = warnSpy.mock.calls.map(call => String(call[0]));
      expect(messages.some(m => m.includes('unknown PNG filter byte 5'))).toBe(
        true
      );
      warnSpy.mockRestore();
    });
  });
});
