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
 * The fix passes `{ failOn: 'error' }` to the sharp() constructor in
 * getBrowserCompatibleImage, which tolerates that class of warning while
 * still throwing on real decode errors (including truncated pixel data).
 *
 * `failOn: 'truncated'` looks like the natural choice but is WRONG:
 * libvips orders severity none < truncated < error < warning, so
 * 'truncated' also disables the 'error' tier. Measured against this
 * repo's sharp/libvips: a TIFF whose StripByteCounts overstates the bytes
 * actually present decodes *successfully* under 'truncated' to a
 * silently-wrong (black) image instead of throwing — and that bad PNG
 * would get cached forever by the code a few lines below. Both cases are
 * covered here so a future "simplify this to 'truncated'" edit is caught.
 *
 * This suite deliberately does NOT mock `sharp` (unlike the sibling
 * imageService.display.test.ts) — it exercises the real libvips decode
 * path against hand-crafted TIFF buffers, so it fails before the fix and
 * passes after it, without needing any real user data.
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

interface TiffFixtureOptions {
  /** Declared StripByteCounts (279) value. */
  stripByteCountsValue: number;
  /** Bytes of strip data actually written after the IFD. */
  actualStripBytes: number;
  /**
   * When true, adds a Software (305) ASCII tag whose count equals the
   * string length — i.e. no null terminator — matching the real
   * production malformation.
   */
  asciiSoftwareBug: boolean;
}

/**
 * Hand-crafts a minimal, uncompressed 2x2 grayscale TIFF for exercising
 * the real sharp/libvips decode path. No real user data is used or needed.
 *
 * The 4 source pixel values are 0x00, 0x40, 0x80, 0xff (top-left to
 * bottom-right, row-major) when `actualStripBytes >= 4`; fewer bytes
 * simulate a genuinely truncated strip (data cut short mid-write).
 */
function buildTiffFixture({
  stripByteCountsValue,
  actualStripBytes,
  asciiSoftwareBug,
}: TiffFixtureOptions): Buffer {
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
    { tag: 279, type: 4, count: 1, value: stripByteCountsValue }, // StripByteCounts
  ];
  if (asciiSoftwareBug) {
    // Software tag: ASCII, count === string length (no null terminator).
    tags.push({ tag: 305, type: 2, count: 4, ascii: 'V1.0' });
  }

  const ifdOffset = 8;
  const ifdSize = 2 + tags.length * 12 + 4;
  const pixelDataOffset = ifdOffset + ifdSize;

  const stripOffsetsTag = tags.find(t => t.tag === 273);
  if (!stripOffsetsTag) {
    throw new Error('StripOffsets tag missing');
  }
  stripOffsetsTag.value = pixelDataOffset;

  const buf = Buffer.alloc(pixelDataOffset + actualStripBytes);

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

  const sourcePixels = [0x00, 0x40, 0x80, 0xff];
  for (let i = 0; i < actualStripBytes; i++) {
    buf.writeUInt8(sourcePixels[i] ?? 0, pixelDataOffset + i);
  }

  return buf;
}

function mockImageRow() {
  prismaMock.image.findFirst.mockResolvedValueOnce({
    id: 'img-1',
    name: 'weird.tiff',
    originalPath: 'projects/p/img-1/weird.tiff',
    mimeType: 'image/tiff',
    isVideoContainer: false,
    parentVideoId: null,
  });
}

describe('ImageService — TIFF display 500 regression (real sharp/libvips)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockReset();
  });

  it('converts a TIFF with a non-null-terminated ASCII tag, preserving the exact pixel data', async () => {
    const service = new ImageService(prismaMock as never);
    mockImageRow();
    mockReadFile.mockResolvedValueOnce(
      buildTiffFixture({
        stripByteCountsValue: 4,
        actualStripBytes: 4,
        asciiSoftwareBug: true,
      })
    );

    const result = await service.getBrowserCompatibleImage('img-1');

    expect(result.mimeType).toBe('image/png');
    expect(result.buffer.length).toBeGreaterThan(0);

    // Round-trip the produced PNG through real sharp and check the actual
    // pixel bytes — not just dimensions — so a decode option that
    // "succeeds" by silently producing wrong pixels (e.g. failOn:
    // 'truncated' on genuinely bad data, see the test below) can't pass
    // this test by accident.
    const sharp = (await import('sharp')).default;
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(2);
    expect(meta.height).toBe(2);
    const raw = await sharp(result.buffer).raw().toBuffer();
    // Grayscale source values, replicated across the palette's RGB
    // channels: 0x00, 0x40, 0x80, 0xff for the 4 pixels in row-major order.
    expect(Array.from(raw)).toEqual([
      0x00, 0x00, 0x00, 0x40, 0x40, 0x40, 0x80, 0x80, 0x80, 0xff, 0xff, 0xff,
    ]);
  });

  it('still rejects a genuinely truncated TIFF instead of silently producing a corrupted image', async () => {
    const service = new ImageService(prismaMock as never);
    mockImageRow();
    // StripByteCounts declares 4 bytes but only 1 is actually present —
    // a real interrupted-write truncation, not a cosmetic tag warning.
    mockReadFile.mockResolvedValueOnce(
      buildTiffFixture({
        stripByteCountsValue: 4,
        actualStripBytes: 1,
        asciiSoftwareBug: false,
      })
    );

    // Must throw — NOT resolve with a silently-black/wrong image that
    // would then get cached to converted/<id>.png and served forever.
    await expect(
      service.getBrowserCompatibleImage('img-1')
    ).rejects.toThrow(/Error converting image/);
  });
});
