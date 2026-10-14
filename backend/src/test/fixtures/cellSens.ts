/*
 * Builds Olympus cellSens JPEGs and TIFFs byte by byte, in the layouts measured
 * on the real cellSens files in production (2026-10-14): for JPEG `OLYXV\0` +
 * 02 00 + zlib(JSON) as the Exif MakerNote (1 739 files); for TIFF an
 * OlympusSIS block plus OME-XML (140 files). Real user images are not
 * committed — this repository is public.
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

// ── cellSens XV TIFF ─────────────────────────────────────────────────────────
// IFD0 with ImageDescription (OME-XML) and OlympusSIS (tag 33560, a LONG
// holding the absolute offset of a little-endian `SIS0` block), in the layout
// tifffile's `read_sis` reads. Values are the lab's new-PC ones.

export interface OmePixels {
  sizeX?: number;
  sizeY?: number;
  x?: string;
  y?: string;
  unit?: string;
}

export const omeXml = (
  p: OmePixels = {},
  { prefix = 'OME:', count = 1 } = {}
): string => {
  const px = `<${prefix}Pixels ID="Pixels:0" DimensionOrder="XYCZT" Type="uint8" SizeX="${p.sizeX ?? 2052}" SizeY="${p.sizeY ?? 1086}" SizeC="3" SizeZ="1" SizeT="1" PhysicalSizeX="${p.x ?? '0.17250000000000004'}" PhysicalSizeXUnit="${p.unit ?? 'µm'}" PhysicalSizeY="${p.y ?? p.x ?? '0.17250000000000004'}" PhysicalSizeYUnit="${p.unit ?? 'µm'}"></${prefix}Pixels>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06"><${prefix}Image ID="Image:0">${px.repeat(count)}</${prefix}Image></OME>`;
};

/** A SIS0 block placed at `base` (absolute), one type-1 entry. */
export function sisBlock(
  base: number,
  { xCal = 0.1725, yCal = xCal, lenExp = -6 } = {}
): Buffer {
  const b = Buffer.alloc(60 + 8 + 112);
  b.write('SIS0', 0, 'latin1');
  b.writeInt16LE(1, 58); // entry count
  b.writeInt16LE(1, 60); // type 1: general data
  b.writeInt16LE(1, 62);
  b.writeUInt32LE(base + 68, 64);
  const g = 68;
  b.writeInt16LE(lenExp, g + 10);
  b.writeDoubleLE(xCal, g + 12);
  b.writeDoubleLE(yCal, g + 20);
  b.writeDoubleLE(40, g + 36); // magnification
  return b;
}

export function cellSensTiff(
  opts: {
    description?: string | null;
    sis?: { xCal?: number; yCal?: number; lenExp?: number } | null;
    le?: boolean;
    magic?: number;
    extraTags?: Array<[number, number, number, number]>;
  } = {}
): Buffer {
  const le = opts.le ?? true;
  const desc =
    opts.description === null
      ? null
      : Buffer.from((opts.description ?? omeXml()) + '\0', 'utf8');
  const tags: Array<[number, number, number, number]> = [
    ...(opts.extraTags ?? []),
  ];
  const n = 2 + tags.length;
  const ifdSize = 2 + n * 12 + 4;
  const descOff = 8 + ifdSize;
  const sisOff = descOff + (desc?.length ?? 0);
  const sis = opts.sis === null ? null : sisBlock(sisOff, opts.sis ?? {});
  const head = Buffer.alloc(8 + ifdSize);
  const u16 = (v: number, o: number) =>
    le ? head.writeUInt16LE(v, o) : head.writeUInt16BE(v, o);
  const u32 = (v: number, o: number) =>
    le ? head.writeUInt32LE(v, o) : head.writeUInt32BE(v, o);
  head.write(le ? 'II' : 'MM', 0, 'latin1');
  u16(opts.magic ?? 42, 2);
  u32(8, 4);
  const entries: Array<[number, number, number, number]> = [
    ...tags,
    desc ? [270, 2, desc.length, descOff] : [270, 2, 0, 0],
    sis ? [33560, 4, 1, sisOff] : [305, 2, 0, 0],
  ];
  u16(entries.length, 8);
  entries
    .sort((a, b) => a[0] - b[0])
    .forEach(([tag, type, count, value], i) => {
      const e = 10 + i * 12;
      u16(tag, e);
      u16(type, e + 2);
      u32(count, e + 4);
      u32(value, e + 8);
    });
  return Buffer.concat([head, desc ?? Buffer.alloc(0), sis ?? Buffer.alloc(0)]);
}
