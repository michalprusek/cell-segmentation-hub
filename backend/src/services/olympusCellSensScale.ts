/**
 * Reads the µm-per-pixel calibration that Olympus cellSens writes into a JPEG.
 *
 * Where it lives. cellSens (Standard 4.2, measured on an Olympus DP28) puts an
 * EXIF MakerNote (tag 0x927C in the Exif sub-IFD) that starts with the 8 bytes
 * `OLYXV\0` + `02 00`, followed by a zlib stream of JSON:
 *
 *   { "canvas": { "scale": { "x": { "unit": "10^-6m^1", "value": 0.08625 }, … } },
 *     "layer":  [ { "calibration": [ { "length": 4104, "scale": {…} },
 *                                    { "length": 2174, "scale": {…} } ], … } ], … }
 *
 * There is no reference implementation to follow: ExifTool's MakerNotes.pm
 * recognises only `OLYMP\0`, `OLYMPUS\0` and `OM SYSTEM\0` and has no `OLYXV`
 * entry at all, and Bio-Formats' cellSens reader handles `.vsi`, not JPEG. The
 * layout above is therefore taken from the data — 2026-10-14, every one of the
 * 1 739 cellSens JPEGs stored in production at that date: all carry this exact
 * header and unit, x == y, canvas scale == layer calibration, and calibration
 * lengths == the decoded pixel size (4104x2174 and 3840x2160, both 0.08625
 * µm/px — 40x on a DP28, cross-checked earlier against a burned-in 20 µm scale
 * bar).
 *
 * The parser fails CLOSED. Anything that does not match that shape returns
 * `null` with a reason, never a best guess: a wrong scale here silently
 * rescales every exported length, which is worse than an export in pixels.
 * In particular a calibration whose `length` differs from the image's own size
 * means the file was resampled after cellSens wrote it, so its scale no longer
 * describes these pixels.
 */
import { inflateSync } from 'zlib';

export type CellSensScaleResult =
  | { pixelSizeUm: number; reason?: undefined }
  | { pixelSizeUm: null; reason: CellSensRejectReason };

export type CellSensRejectReason =
  | 'not-jpeg'
  | 'no-exif'
  | 'no-makernote'
  | 'not-cellsens'
  | 'unsupported-version'
  | 'bad-payload'
  | 'bad-unit'
  | 'anisotropic'
  | 'no-calibration'
  | 'size-mismatch'
  | 'out-of-range';

const MAKERNOTE_TAG = 0x927c;
const EXIF_IFD_POINTER_TAG = 0x8769;
const CELLSENS_MAGIC = Buffer.from('OLYXV\0', 'latin1');
/** The two bytes after the magic. Only 2 has been observed; another value may
 *  mean another payload layout, so it is refused rather than tried. */
const CELLSENS_VERSION = 2;
const CELLSENS_HEADER_BYTES = 8;
/** The inflated JSON is ~1.7 kB; this only bounds a hostile stream. */
const MAX_INFLATED_BYTES = 1 << 20;
/** Same bounds as the project setting and the export modal
 *  (`types/validation.ts`), so a value read here is always one the rest of the
 *  app accepts. */
export const MIN_PIXEL_SIZE_UM = 0.001;
export const MAX_PIXEL_SIZE_UM = 1000;
/** x and y must agree to this relative tolerance: `images.pixelSizeUm` is a
 *  single isotropic value. Observed difference on real files: exactly 0. */
const ISOTROPY_REL_TOL = 1e-6;

/** Bytes per value of each TIFF field type (TIFF 6.0 §2, plus IFD = 13). */
const TIFF_TYPE_BYTES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
  13: 4,
};

const reject = (reason: CellSensRejectReason): CellSensScaleResult => ({
  pixelSizeUm: null,
  reason,
});

/** The TIFF block inside the first `Exif\0\0` APP1 segment, or null. Walks the
 *  marker chain up to the start of scan; never searches the entropy-coded data. */
function findExifTiff(buf: Buffer): Buffer | null {
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) {
      return null;
    }
    const marker = buf[pos + 1];
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      return null; // start of scan / end of image: no Exif before the data
    }
    const segLen = buf.readUInt16BE(pos + 2);
    const segStart = pos + 4;
    const segEnd = pos + 2 + segLen;
    if (segLen < 2 || segEnd > buf.length) {
      return null;
    }
    if (
      marker === 0xe1 &&
      segLen >= 8 &&
      buf.toString('latin1', segStart, segStart + 6) === 'Exif\0\0'
    ) {
      return buf.subarray(segStart + 6, segEnd);
    }
    pos = segEnd;
  }
  return null;
}

/** One IFD entry's value bytes, or null when out of bounds. Offsets are
 *  relative to the start of the TIFF header, per TIFF 6.0 / Exif 2.3. */
function readIfd(
  tiff: Buffer,
  ifdOffset: number,
  le: boolean
): Map<number, { type: number; count: number; valueOffset: number }> | null {
  if (ifdOffset + 2 > tiff.length) {
    return null;
  }
  const n = le ? tiff.readUInt16LE(ifdOffset) : tiff.readUInt16BE(ifdOffset);
  if (ifdOffset + 2 + n * 12 > tiff.length) {
    return null;
  }
  const entries = new Map<
    number,
    { type: number; count: number; valueOffset: number }
  >();
  for (let i = 0; i < n; i++) {
    const e = ifdOffset + 2 + i * 12;
    const tag = le ? tiff.readUInt16LE(e) : tiff.readUInt16BE(e);
    const type = le ? tiff.readUInt16LE(e + 2) : tiff.readUInt16BE(e + 2);
    const count = le ? tiff.readUInt32LE(e + 4) : tiff.readUInt32BE(e + 4);
    // A value of at most 4 bytes is stored in the entry itself.
    const size = (TIFF_TYPE_BYTES[type] ?? 0) * count;
    const inline = size > 0 && size <= 4;
    const valueOffset = inline
      ? e + 8
      : le
        ? tiff.readUInt32LE(e + 8)
        : tiff.readUInt32BE(e + 8);
    entries.set(tag, { type, count, valueOffset });
  }
  return entries;
}

function findMakerNote(tiff: Buffer): Buffer | null {
  if (tiff.length < 8) {
    return null;
  }
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') {
    return null;
  }
  const le = order === 'II';
  const magic = le ? tiff.readUInt16LE(2) : tiff.readUInt16BE(2);
  if (magic !== 42) {
    return null;
  }
  const ifd0 = readIfd(tiff, le ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4), le);
  const exifPtr = ifd0?.get(EXIF_IFD_POINTER_TAG);
  if (!exifPtr) {
    return null;
  }
  // The pointer is a LONG, so its value is inline and IS the offset.
  const exifOffset = le
    ? tiff.readUInt32LE(exifPtr.valueOffset)
    : tiff.readUInt32BE(exifPtr.valueOffset);
  const mn = readIfd(tiff, exifOffset, le)?.get(MAKERNOTE_TAG);
  if (!mn || mn.valueOffset + mn.count > tiff.length) {
    return null;
  }
  return tiff.subarray(mn.valueOffset, mn.valueOffset + mn.count);
}

interface Quantity {
  unit?: unknown;
  value?: unknown;
}

/** A cellSens length quantity in µm. Units are written `10^<e>m^1`; only
 *  `10^-6m^1` has been seen, and the general form is accepted because it is
 *  self-describing, not because another one is known to occur. */
function toMicrometres(q: Quantity | undefined): number | null {
  if (!q || typeof q.value !== 'number' || typeof q.unit !== 'string') {
    return null;
  }
  const m = /^10\^(-?\d+)m\^1$/.exec(q.unit);
  if (!m) {
    return null;
  }
  const v = q.value * 10 ** (Number(m[1]) + 6);
  return Number.isFinite(v) ? v : null;
}

const sameScale = (a: number, b: number): boolean =>
  Math.abs(a - b) <= ISOTROPY_REL_TOL * Math.max(Math.abs(a), Math.abs(b));

/**
 * The image's pixel size in µm, read from an Olympus cellSens MakerNote.
 *
 * `width`/`height` are the decoded pixel dimensions of the same bytes; without
 * them the calibration cannot be tied to this pixel grid and nothing is
 * returned.
 */
export function readCellSensPixelSizeUm(
  buf: Buffer,
  dims: { width?: number | null; height?: number | null }
): CellSensScaleResult {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return reject('not-jpeg');
  }
  const tiff = findExifTiff(buf);
  if (!tiff) {
    return reject('no-exif');
  }
  const note = findMakerNote(tiff);
  if (!note) {
    return reject('no-makernote');
  }
  if (
    note.length < CELLSENS_HEADER_BYTES ||
    !note.subarray(0, CELLSENS_MAGIC.length).equals(CELLSENS_MAGIC)
  ) {
    return reject('not-cellsens');
  }
  if (note.readUInt16LE(CELLSENS_MAGIC.length) !== CELLSENS_VERSION) {
    return reject('unsupported-version');
  }

  let doc: {
    canvas?: { scale?: { x?: Quantity; y?: Quantity } };
    layer?: Array<{ calibration?: Array<{ length?: unknown; scale?: Quantity }> }>;
  };
  try {
    const json = inflateSync(note.subarray(CELLSENS_HEADER_BYTES), {
      maxOutputLength: MAX_INFLATED_BYTES,
    });
    doc = JSON.parse(json.toString('utf8'));
  } catch {
    return reject('bad-payload');
  }
  if (!doc || typeof doc !== 'object') {
    return reject('bad-payload');
  }

  const sx = toMicrometres(doc.canvas?.scale?.x);
  const sy = toMicrometres(doc.canvas?.scale?.y);
  if (sx === null || sy === null) {
    return reject('bad-unit');
  }
  if (!sameScale(sx, sy)) {
    return reject('anisotropic');
  }

  // The calibration of the image layer carries how many pixels each axis had
  // when the scale was written. That is the only thing tying the scale to THIS
  // pixel grid, so it is required, not optional.
  const cal = Array.isArray(doc.layer) ? doc.layer[0]?.calibration : undefined;
  if (!Array.isArray(cal) || cal.length < 2) {
    return reject('no-calibration');
  }
  const [cx, cy] = cal;
  const lx = toMicrometres(cx?.scale);
  const ly = toMicrometres(cy?.scale);
  if (lx === null || ly === null || !sameScale(lx, sx) || !sameScale(ly, sy)) {
    return reject('no-calibration');
  }
  if (
    !dims.width ||
    !dims.height ||
    cx.length !== dims.width ||
    cy.length !== dims.height
  ) {
    return reject('size-mismatch');
  }

  if (!(sx >= MIN_PIXEL_SIZE_UM && sx <= MAX_PIXEL_SIZE_UM)) {
    return reject('out-of-range');
  }
  // cellSens writes 0.08625 as 0.08625000000000002; 12 significant digits drop
  // that binary noise (which would otherwise surface verbatim in the export
  // dialog) and change no measurement.
  return { pixelSizeUm: Number(sx.toPrecision(12)) };
}
