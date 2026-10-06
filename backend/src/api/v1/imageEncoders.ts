import { deflateSync } from 'zlib';
import { crc32 } from '../../utils/crc32';

/**
 * 16-bit single-channel PNG and TIFF, written directly.
 *
 * Not through `sharp`: its handling of 16-bit greyscale is exactly what this
 * repo already had to route around (see the long note in
 * `imageService.getDisplayImage`), and a label image must come out bit for
 * bit. Both formats are simple enough at one sample per pixel that owning the
 * bytes is cheaper than proving a library's.
 *
 * Both are ALWAYS 16-bit, whatever the number of objects. A file whose pixel
 * type depends on how many objects happened to be found is a trap for the
 * code that reads it.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

export function encodePng16(
  pixels: Uint16Array,
  width: number,
  height: number
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  // compression, filter and interlace methods stay 0

  // Each scanline: one filter byte (0 = none), then big-endian samples.
  const stride = 1 + width * 2;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    let at = y * stride + 1;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      raw.writeUInt16BE(pixels[row + x], at);
      at += 2;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Baseline TIFF 6.0: little-endian, one uncompressed strip, min-is-black. */
export function encodeTiff16(
  pixels: Uint16Array,
  width: number,
  height: number
): Buffer {
  const SHORT = 3;
  const LONG = 4;
  // Tags must be in ascending order (TIFF 6.0, section 2).
  const entries: Array<[tag: number, type: number, value: number]> = [
    [256, LONG, width], // ImageWidth
    [257, LONG, height], // ImageLength
    [258, SHORT, 16], // BitsPerSample
    [259, SHORT, 1], // Compression: none
    [262, SHORT, 1], // PhotometricInterpretation: BlackIsZero
    [273, LONG, 0], // StripOffsets — patched below
    [277, SHORT, 1], // SamplesPerPixel
    [278, LONG, height], // RowsPerStrip
    [279, LONG, width * height * 2], // StripByteCounts
    [339, SHORT, 1], // SampleFormat: unsigned integer
  ];

  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const dataOffset = ifdOffset + ifdSize;
  const out = Buffer.alloc(dataOffset + width * height * 2);

  out.write('II', 0, 'latin1');
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(ifdOffset, 4);

  out.writeUInt16LE(entries.length, ifdOffset);
  let at = ifdOffset + 2;
  for (const [tag, type, value] of entries) {
    out.writeUInt16LE(tag, at);
    out.writeUInt16LE(type, at + 2);
    out.writeUInt32LE(1, at + 4);
    const resolved = tag === 273 ? dataOffset : value;
    if (type === SHORT) {
      out.writeUInt16LE(resolved, at + 8);
    } else {
      out.writeUInt32LE(resolved, at + 8);
    }
    at += 12;
  }
  out.writeUInt32LE(0, at); // no further IFD

  for (let i = 0; i < pixels.length; i++) {
    out.writeUInt16LE(pixels[i], dataOffset + i * 2);
  }
  return out;
}
