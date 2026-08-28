/**
 * imageService.tiffDecodeRegression.test.ts — regression test for a
 * production 500 on GET /api/images/:id/display for a real TIFF.
 *
 * Root cause (reproduced against production, 2026-08-28): sharp/libvips
 * decodes with `failOn: 'warning'` by default. Some TIFF writers emit an
 * ASCII tag (e.g. "Software") whose value is not null-terminated — a
 * cosmetic libtiff warning, not pixel corruption — and sharp's default
 * escalates that warning into a hard decode error:
 *
 *   Error: vips2png: unable to write to target target
 *     at Sharp.toBuffer (.../sharp/dist/output.mjs:159:17)
 *     at ImageService.getBrowserCompatibleImage (imageService.ts:1495)
 *
 * The fix passes `{ failOn: 'truncated' }` to the sharp() constructor in
 * getBrowserCompatibleImage, which tolerates that class of warning while
 * still failing on genuinely truncated/incomplete pixel data.
 *
 * This suite deliberately does NOT mock `sharp` (unlike the sibling
 * imageService.display.test.ts) — it exercises the real libvips decode
 * path against a hand-crafted TIFF buffer carrying the exact malformed tag,
 * so it fails before the fix and passes after it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The global src/test/setup.ts auto-mocks 'sharp' for every suite; undo
// that here so this test exercises the real libvips decode path.
vi.unmock('sharp');

const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    UPLOAD_DIR: '/tmp/uploads',
    STORAGE_TYPE: 'local',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../utils/getBaseUrl', () => ({
  getBaseUrl: vi.fn(() => 'http://api.test'),
}));

vi.mock('../../storage/index', async () => {
  const { LocalStorageProvider: RealLSP } = await vi.importActual<
    typeof import('../../storage/localStorage')
  >('../../storage/localStorage');

  // A real instance so `storage instanceof LocalStorageProvider` passes;
  // getImageBuffer then reads via the mocked `fs` below.
  const fakeLocalStorage = Object.create(RealLSP.prototype) as InstanceType<
    typeof RealLSP
  >;
  (fakeLocalStorage as Record<string, unknown>).upload = vi.fn();

  return {
    getStorageProvider: vi.fn(() => fakeLocalStorage),
    LocalStorageProvider: RealLSP,
  };
});

vi.mock('../websocketService', () => ({
  WebSocketService: {
    getInstance: vi.fn(() => ({
      emitToUser: vi.fn(),
      broadcastProjectUpdate: vi.fn(),
      emitDashboardUpdate: vi.fn(),
    })),
  },
}));

vi.mock('fs', () => ({
  promises: {
    access: vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    readFile: mockReadFile,
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ size: 100, mtimeMs: Date.now() }),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  },
  constants: { W_OK: 2, R_OK: 4 },
}));

import { ImageService } from '../imageService';

const prismaMock = {
  image: { findFirst: vi.fn() },
};

/**
 * Hand-crafts a minimal, valid, uncompressed 2x2 grayscale TIFF whose
 * Software (tag 305) ASCII value is exactly as long as its declared count —
 * i.e. it has no trailing null terminator. This is the exact malformation
 * libtiff warns about ("ASCII value for tag \"Software\" does not end in
 * null byte") on the real production file that triggered the 500. No real
 * user data is used or needed to reproduce the bug.
 */
function buildTiffWithUnterminatedAsciiTag(): Buffer {
  const width = 2;
  const height = 2;
  const tags: Array<{
    tag: number;
    type: number;
    count: number;
    value?: number;
    ascii?: string;
  }> = [
    { tag: 256, type: 3, count: 1, value: width }, // ImageWidth
    { tag: 257, type: 3, count: 1, value: height }, // ImageLength
    { tag: 258, type: 3, count: 1, value: 8 }, // BitsPerSample
    { tag: 259, type: 3, count: 1, value: 1 }, // Compression = none
    { tag: 262, type: 3, count: 1, value: 1 }, // PhotometricInterpretation = BlackIsZero
    { tag: 273, type: 4, count: 1, value: 0 }, // StripOffsets (patched below)
    { tag: 277, type: 3, count: 1, value: 1 }, // SamplesPerPixel
    { tag: 278, type: 4, count: 1, value: height }, // RowsPerStrip
    { tag: 279, type: 4, count: 1, value: 4 }, // StripByteCounts
    // Software tag: ASCII, count === string length (no null terminator).
    { tag: 305, type: 2, count: 4, ascii: 'V1.0' },
  ];

  const ifdOffset = 8;
  const ifdSize = 2 + tags.length * 12 + 4;
  const pixelDataOffset = ifdOffset + ifdSize;

  const stripOffsetsTag = tags.find(t => t.tag === 273);
  if (!stripOffsetsTag) {
    throw new Error('StripOffsets tag missing');
  }
  stripOffsetsTag.value = pixelDataOffset;

  const buf = Buffer.alloc(pixelDataOffset + 4);

  buf.write('II', 0, 'ascii');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifdOffset, 4);

  buf.writeUInt16LE(tags.length, ifdOffset);
  let entryOffset = ifdOffset + 2;
  for (const t of tags) {
    buf.writeUInt16LE(t.tag, entryOffset);
    buf.writeUInt16LE(t.type, entryOffset + 2);
    buf.writeUInt32LE(t.count, entryOffset + 4);
    if (t.ascii !== undefined) {
      buf.write(t.ascii, entryOffset + 8, 'ascii');
    } else {
      buf.writeUInt32LE(t.value ?? 0, entryOffset + 8);
    }
    entryOffset += 12;
  }
  buf.writeUInt32LE(0, entryOffset); // next IFD offset = none

  buf.writeUInt8(0x00, pixelDataOffset);
  buf.writeUInt8(0x40, pixelDataOffset + 1);
  buf.writeUInt8(0x80, pixelDataOffset + 2);
  buf.writeUInt8(0xff, pixelDataOffset + 3);

  return buf;
}

describe('ImageService — TIFF display 500 regression (real sharp/libvips)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockReset();
  });

  it('converts a TIFF with a non-null-terminated ASCII tag instead of throwing', async () => {
    const service = new ImageService(prismaMock as never);
    prismaMock.image.findFirst.mockResolvedValueOnce({
      id: 'img-1',
      name: 'weird.tiff',
      originalPath: 'projects/p/img-1/weird.tiff',
      mimeType: 'image/tiff',
      isVideoContainer: false,
      parentVideoId: null,
    });
    mockReadFile.mockResolvedValueOnce(buildTiffWithUnterminatedAsciiTag());

    const result = await service.getBrowserCompatibleImage('img-1');

    expect(result.mimeType).toBe('image/png');
    expect(result.buffer.length).toBeGreaterThan(0);

    // Round-trip the produced PNG through real sharp to confirm the pixel
    // data actually decoded (not just that no exception was thrown).
    const sharp = (await import('sharp')).default;
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(2);
    expect(meta.height).toBe(2);
  });
});
