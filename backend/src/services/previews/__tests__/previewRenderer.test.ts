import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

// The global setup mocks sharp and the file system; this suite measures
// real pixels.
vi.unmock('sharp');
vi.unmock('fs/promises');
vi.unmock('fs');

import sharp from 'sharp';
import { renderPreview, PREVIEW_MAX_SIDE } from '../previewRenderer';
import type { Polygon } from '../../visualization/visualizationGenerator';

let dir: string;

/** CRC-32 as PNG chunks use it. */
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A horizontal ramp lo..hi as a genuine 16-bit grayscale PNG — the shape of
 * a microscopy frame that uses a fifth of the 16-bit range. Encoded by hand:
 * sharp rescales raw 16-bit input on the way out, so it cannot make this
 * fixture faithfully.
 */
async function grey16(
  file: string,
  width: number,
  height: number,
  lo: number,
  hi: number
): Promise<string> {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16; // bit depth
  ihdr[9] = 0; // grayscale
  const rows = Buffer.alloc(height * (1 + width * 2));
  for (let y = 0; y < height; y++) {
    const o = y * (1 + width * 2);
    rows[o] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      rows.writeUInt16BE(Math.round(lo + ((hi - lo) * x) / (width - 1)), o + 1 + x * 2);
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const abs = path.join(dir, file);
  await fs.writeFile(abs, png);
  // Assert the fixture really is what the test says it is.
  const meta = await sharp(abs).metadata();
  expect(meta.depth).toBe('ushort');
  const stats = await sharp(abs).stats();
  expect(stats.channels[0].min).toBe(lo);
  expect(stats.channels[0].max).toBe(hi);
  return abs;
}

async function grey8(file: string, width: number, height: number, value = 128) {
  const abs = path.join(dir, file);
  await sharp({
    create: { width, height, channels: 3, background: { r: value, g: value, b: value } },
  })
    .png()
    .toFile(abs);
  return abs;
}

async function pixel(jpeg: Buffer, x: number, y: number) {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const i = (Math.round(y) * info.width + Math.round(x)) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2], info };
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-render-'));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('renderPreview', () => {
  it('stretches a 16-bit source over its own range instead of greying it out', async () => {
    const src = await grey16('ramp16.png', 400, 100, 9103, 22669);

    const out = await renderPreview({ path: src }, []);

    const left = await pixel(out, 2, 50);
    const right = await pixel(out, left.info.width - 3, 50);
    // Unstretched, 9103..22669 is 35..88 of 255: a flat grey square.
    expect(left.r).toBeLessThan(15);
    expect(right.r).toBeGreaterThan(240);
  });

  it('keeps the aspect ratio and never enlarges', async () => {
    const big = await grey8('big.png', 2000, 1000);
    const small = await grey8('small.png', 200, 120);

    const bigInfo = (await pixel(await renderPreview({ path: big }, []), 0, 0)).info;
    const smallInfo = (await pixel(await renderPreview({ path: small }, []), 0, 0)).info;

    expect([bigInfo.width, bigInfo.height]).toEqual([PREVIEW_MAX_SIDE, PREVIEW_MAX_SIDE / 2]);
    expect([smallInfo.width, smallInfo.height]).toEqual([200, 120]);
  });

  it('draws a polygon where it is, scaled into preview space', async () => {
    const src = await grey8('scene.png', 2048, 1024, 20);
    // A filled square in the right half of the SOURCE frame.
    const square: Polygon = {
      id: 'p1',
      type: 'external',
      points: [
        { x: 1400, y: 300 },
        { x: 1800, y: 300 },
        { x: 1800, y: 700 },
        { x: 1400, y: 700 },
      ],
    } as Polygon;

    const out = await renderPreview({ path: src }, [square]);

    const scale = PREVIEW_MAX_SIDE / 2048;
    const inside = await pixel(out, 1600 * scale, 500 * scale);
    const outside = await pixel(out, 400 * scale, 500 * scale);
    expect(inside.r).toBeGreaterThan(inside.g + 40); // red fill
    expect(Math.abs(outside.r - outside.g)).toBeLessThan(10); // untouched grey
  });

  it('maps polygons from the frame of a smaller stand-in source (BMP thumbnail)', async () => {
    const thumb = await grey8('thumb.png', 300, 150, 20);
    const square: Polygon = {
      id: 'p1',
      type: 'external',
      points: [
        { x: 3000, y: 500 },
        { x: 3800, y: 500 },
        { x: 3800, y: 1300 },
        { x: 3000, y: 1300 },
      ],
    } as Polygon;

    const out = await renderPreview({ path: thumb, frameWidth: 4000 }, [square]);

    const s = 300 / 4000;
    const inside = await pixel(out, 3400 * s, 900 * s);
    expect(inside.r).toBeGreaterThan(inside.g + 40);
  });

  it('skips non-finite and degenerate geometry instead of failing the preview', async () => {
    const src = await grey8('bad.png', 100, 100);
    const polygons = [
      { id: 'a', type: 'external', points: [{ x: Infinity, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }] },
      { id: 'b', type: 'external', points: [{ x: 1, y: 1 }] },
      { id: 'c', geometry: 'polyline', points: [] },
    ] as unknown as Polygon[];

    await expect(renderPreview({ path: src }, polygons)).resolves.toBeInstanceOf(Buffer);
  });
});
