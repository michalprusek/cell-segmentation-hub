/*
 * Builds Olympus cellSens JPEGs byte by byte, in the layout measured on the
 * 1 739 real cellSens JPEGs in production (2026-10-14): `OLYXV\0` + 02 00 +
 * zlib(JSON) as the Exif MakerNote. Real user images are not committed — this
 * repository is public.
 */
import { deflateSync } from 'zlib';

export type Json = Record<string, unknown>;

export const um = (value: number, unit = '10^-6m^1') => ({ unit, value });

/** The JSON cellSens writes, trimmed to the fields the reader looks at plus a
 *  couple it must ignore. Values are the DP28 / 40x ones. */
export function cellSensJson(
  opts: {
    sx?: unknown;
    sy?: unknown;
    lengths?: [number, number];
    calScale?: unknown;
    layer?: unknown;
  } = {}
): Json {
  const sx = opts.sx ?? um(0.08625000000000002);
  const sy = opts.sy ?? um(0.08625000000000002);
  const [lx, ly] = opts.lengths ?? [4104, 2174];
  return {
    canvas: {
      origin: { x: um(0), y: um(0) },
      scale: { x: sx, y: sy },
    },
    layer: opts.layer ?? [
      {
        calibratedMagnification: 40.0,
        calibration: [
          { length: lx, origin: um(0), scale: opts.calScale ?? sx },
          { length: ly, origin: um(0), scale: opts.calScale ?? sy },
        ],
      },
    ],
    version: '1.0.0',
  };
}

export function makerNote(
  json: Json | Buffer,
  { magic = 'OLYXV\0', version = 2 } = {}
): Buffer {
  const head = Buffer.alloc(8);
  head.write(magic, 0, 'latin1');
  head.writeUInt16LE(version, 6);
  const body = Buffer.isBuffer(json)
    ? json
    : deflateSync(Buffer.from(JSON.stringify(json)));
  return Buffer.concat([head, body]);
}

/** TIFF block: IFD0 -> Exif sub-IFD -> MakerNote, in either byte order. */
export function exifTiff(note: Buffer, le = true, makerNoteTag = 0x927c): Buffer {
  const b = Buffer.alloc(44 + note.length);
  const u16 = (v: number, o: number) =>
    le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o);
  const u32 = (v: number, o: number) =>
    le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o);
  b.write(le ? 'II' : 'MM', 0, 'latin1');
  u16(42, 2);
  u32(8, 4);
  // IFD0 @8: one entry, ExifIFD pointer (LONG, inline value 26)
  u16(1, 8);
  u16(0x8769, 10);
  u16(4, 12);
  u32(1, 14);
  u32(26, 18);
  u32(0, 22);
  // Exif IFD @26: one entry, MakerNote (UNDEFINED, count, offset 44)
  u16(1, 26);
  u16(makerNoteTag, 28);
  u16(7, 30);
  u32(note.length, 32);
  u32(44, 36);
  u32(0, 40);
  note.copy(b, 44);
  return b;
}

function segment(marker: number, payload: Buffer): Buffer {
  const h = Buffer.alloc(4);
  h[0] = 0xff;
  h[1] = marker;
  h.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([h, payload]);
}

/** SOI, an APP0 (JFIF, as real files have before Exif), APP1 Exif, then a
 *  start of scan whose "entropy data" is caller-controlled. */
export function jpeg(
  tiff: Buffer | null,
  scanData: Buffer = Buffer.from([1, 2, 3])
): Buffer {
  const parts = [
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
  ];
  if (tiff) {
    parts.push(
      segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]))
    );
  }
  parts.push(
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    scanData,
    Buffer.from([0xff, 0xd9])
  );
  return Buffer.concat(parts);
}

/** A DP28 / 40x file: 4104x2174 at 0.08625 µm/px. */
export const cellSensJpeg = (json: Json = cellSensJson(), le = true): Buffer =>
  jpeg(exifTiff(makerNote(json), le));
