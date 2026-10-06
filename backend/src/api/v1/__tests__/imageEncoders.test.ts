/**
 * The 16-bit encoders, decoded here by INDEPENDENT readers: PNG by parsing
 * the chunks and inflating with zlib, TIFF by walking the IFD, and both again
 * by `sharp` (libpng / libtiff), which shares no code with the encoders.
 */
import { inflateSync } from 'zlib';
import { describe, it, expect, vi } from 'vitest';

// `src/test/setup.ts` blanket-mocks sharp. The point of using it here is that
// it is a REAL second decoder, so opt out for this file.
vi.unmock('sharp');

import sharp from 'sharp';
import { crc32 } from '../../../utils/crc32';
import { encodePng16, encodeTiff16 } from '../imageEncoders';

const W = 37;
const H = 23;
/** Every value distinct, crossing the byte boundary and reaching 65535. */
const pixels = Uint16Array.from({ length: W * H }, (_, i) =>
  i === 0 ? 65535 : i === 1 ? 256 : i === 2 ? 255 : (i * 77) % 65536
);

describe('crc32', () => {
  it('matches the standard check value for strings and bytes', () => {
    expect(crc32('123456789')).toBe(0xcbf43926);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('encodePng16', () => {
  const png = encodePng16(pixels, W, H);

  const chunks = () => {
    const out: Array<{ type: string; data: Buffer; crcOk: boolean }> = [];
    let at = 8;
    while (at < png.length) {
      const length = png.readUInt32BE(at);
      const type = png.toString('latin1', at + 4, at + 8);
      const data = png.subarray(at + 8, at + 8 + length);
      const crc = png.readUInt32BE(at + 8 + length);
      out.push({
        type,
        data,
        crcOk: crc === crc32(png.subarray(at + 4, at + 8 + length)),
      });
      at += 12 + length;
    }
    return out;
  };

  it('is a valid PNG container with correct chunk checksums', () => {
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const parsed = chunks();
    expect(parsed.map(c => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(parsed.every(c => c.crcOk)).toBe(true);
  });

  it('declares 16-bit greyscale at the right size', () => {
    const ihdr = chunks()[0].data;
    expect([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4)]).toEqual([W, H]);
    expect([ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]]).toEqual([
      16, 0, 0, 0, 0,
    ]);
  });

  it('stores every sample exactly, big-endian, behind a zero filter byte', () => {
    const raw = inflateSync(chunks()[1].data);
    expect(raw.length).toBe(H * (1 + W * 2));
    for (let y = 0; y < H; y++) {
      expect(raw[y * (1 + W * 2)]).toBe(0);
      for (let x = 0; x < W; x++) {
        expect(raw.readUInt16BE(y * (1 + W * 2) + 1 + x * 2)).toBe(
          pixels[y * W + x]
        );
      }
    }
  });

  it('is read back bit for bit by libpng', async () => {
    const { data, info } = await sharp(png)
      .toColourspace('grey16')
      .raw({ depth: 'ushort' })
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([W, H, 1]);
    const back = new Uint16Array(data.buffer, data.byteOffset, W * H);
    expect(Array.from(back)).toEqual(Array.from(pixels));
  });
});

describe('encodeTiff16', () => {
  const tiff = encodeTiff16(pixels, W, H);

  const tags = () => {
    const ifd = tiff.readUInt32LE(4);
    const count = tiff.readUInt16LE(ifd);
    const out = new Map<number, number>();
    const order: number[] = [];
    for (let i = 0; i < count; i++) {
      const at = ifd + 2 + i * 12;
      const tag = tiff.readUInt16LE(at);
      const type = tiff.readUInt16LE(at + 2);
      expect(tiff.readUInt32LE(at + 4)).toBe(1);
      out.set(tag, type === 3 ? tiff.readUInt16LE(at + 8) : tiff.readUInt32LE(at + 8));
      order.push(tag);
    }
    expect(tiff.readUInt32LE(ifd + 2 + count * 12)).toBe(0);
    return { out, order };
  };

  it('is a little-endian baseline TIFF with ascending tags', () => {
    expect(tiff.toString('latin1', 0, 2)).toBe('II');
    expect(tiff.readUInt16LE(2)).toBe(42);
    const { order } = tags();
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('declares one uncompressed 16-bit unsigned min-is-black strip', () => {
    const { out } = tags();
    expect(out.get(256)).toBe(W);
    expect(out.get(257)).toBe(H);
    expect(out.get(258)).toBe(16);
    expect(out.get(259)).toBe(1);
    expect(out.get(262)).toBe(1);
    expect(out.get(277)).toBe(1);
    expect(out.get(278)).toBe(H);
    expect(out.get(279)).toBe(W * H * 2);
    expect(out.get(339)).toBe(1);
    expect((out.get(273) as number) + W * H * 2).toBe(tiff.length);
  });

  it('stores every sample exactly at the strip offset', () => {
    const offset = tags().out.get(273) as number;
    for (let i = 0; i < pixels.length; i++) {
      expect(tiff.readUInt16LE(offset + i * 2)).toBe(pixels[i]);
    }
  });

  it('is opened by libtiff with the right geometry and depth', async () => {
    // Only the header is asserted through sharp: this repo has measured that
    // sharp mangles 16-bit TIFF SAMPLES on decode (see imageService), so the
    // sample check above reads the strip directly, and the end-to-end check
    // against tifffile/PIL runs on the deployed service.
    const meta = await sharp(tiff).metadata();
    expect([meta.format, meta.width, meta.height, meta.channels, meta.depth]).toEqual(
      ['tiff', W, H, 1, 'ushort']
    );
  });
});
