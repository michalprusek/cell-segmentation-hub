/**
 * Reads the µm-per-pixel calibration that Olympus cellSens writes into a JPEG
 * or a TIFF.
 *
 * ── JPEG ──────────────────────────────────────────────────────────────────
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
 *
 * ── TIFF ──────────────────────────────────────────────────────────────────
 *
 * cellSens XV writes the calibration TWICE: in the proprietary `OlympusSIS`
 * block (tag 33560; layout from tifffile 2025.5.10 `read_sis`, the only
 * reader there is — "No specification is available. Only few fields are
 * known.") and as OME-XML `PhysicalSizeX/Y` in `ImageDescription`, whose
 * `<Pixels>` element also carries `SizeX`/`SizeY`. Both are required and must
 * agree, and the OME size must equal the decoded size — the TIFF counterpart
 * of the JPEG's calibration `length` check. Measured 2026-10-14 on every TIFF
 * in production (1 148 files): 141 carry both and every one agrees — 2052x1086
 * and 4096x3000 at 0.1725 µm/px, 4104x2174 at 0.08625 (one of those with its
 * OME in nm). 211 more carry the SIS block alone, written by analySIS 5.0;
 * with no OME there is nothing that ties their scale to the pixel grid, so
 * they are refused (`no-ome`) rather than trusted.
 *
 * Deliberately NOT a source: TIFF `XResolution`/`ResolutionUnit`. Nearly every
 * TIFF carries one, usually a display resolution (96 or 72 dpi on most files
 * here), and 72 dpi reads as 352.8 µm/px — inside the accepted range, so no
 * bound would catch it. (The video stack extractor's `_detect_pixel_size_um`
 * does fall back to it; a still image does not.)
 */
import { inflateSync } from 'zlib';

export type CellSensScaleResult =
  | { pixelSizeUm: number; reason?: undefined }
  | { pixelSizeUm: null; reason: CellSensRejectReason };

export type CellSensRejectReason =
  | 'unsupported-format'
  | 'no-exif'
  | 'no-makernote'
  | 'not-cellsens'
  | 'unsupported-version'
  | 'bad-payload'
  | 'bad-unit'
  | 'anisotropic'
  | 'no-calibration'
  | 'size-mismatch'
  | 'out-of-range'
  | 'no-sis'
  | 'no-ome'
  | 'sources-disagree';

const MAKERNOTE_TAG = 0x927c;
const IMAGE_DESCRIPTION_TAG = 270;
const OLYMPUS_SIS_TAG = 33560;
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

const inRange = (v: number): boolean =>
  v >= MIN_PIXEL_SIZE_UM && v <= MAX_PIXEL_SIZE_UM;

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

/** An IFD entry. `valueOffset` is where the value's bytes are (the entry
 *  itself when they fit in 4); `field` is the raw 4-byte value field. */
interface IfdEntry {
  type: number;
  count: number;
  valueOffset: number;
  field: number;
}

/** One IFD entry's value bytes, or null when out of bounds. Offsets are
 *  relative to the start of the TIFF header, per TIFF 6.0 / Exif 2.3. */
function readIfd(
  tiff: Buffer,
  ifdOffset: number,
  le: boolean
): Map<number, IfdEntry> | null {
  if (ifdOffset + 2 > tiff.length) {
    return null;
  }
  const n = le ? tiff.readUInt16LE(ifdOffset) : tiff.readUInt16BE(ifdOffset);
  if (ifdOffset + 2 + n * 12 > tiff.length) {
    return null;
  }
  const entries = new Map<
    number,
    IfdEntry
  >();
  for (let i = 0; i < n; i++) {
    const e = ifdOffset + 2 + i * 12;
    const tag = le ? tiff.readUInt16LE(e) : tiff.readUInt16BE(e);
    const type = le ? tiff.readUInt16LE(e + 2) : tiff.readUInt16BE(e + 2);
    const count = le ? tiff.readUInt32LE(e + 4) : tiff.readUInt32BE(e + 4);
    // A value of at most 4 bytes is stored in the entry itself.
    const size = (TIFF_TYPE_BYTES[type] ?? 0) * count;
    const inline = size > 0 && size <= 4;
    const field = le ? tiff.readUInt32LE(e + 8) : tiff.readUInt32BE(e + 8);
    const valueOffset = inline ? e + 8 : field;
    entries.set(tag, { type, count, valueOffset, field });
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

type Dims = { width?: number | null; height?: number | null };

/**
 * The image's pixel size in µm, read from Olympus cellSens metadata in a JPEG
 * (Exif MakerNote) or a TIFF (OlympusSIS + OME-XML).
 *
 * `width`/`height` are the decoded pixel dimensions of the same bytes; without
 * them the calibration cannot be tied to this pixel grid and nothing is
 * returned.
 */
export function readCellSensPixelSizeUm(
  buf: Buffer,
  dims: Dims
): CellSensScaleResult {
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    return readJpeg(buf, dims);
  }
  if (
    buf.length >= 8 &&
    ((buf[0] === 0x49 && buf[1] === 0x49) ||
      (buf[0] === 0x4d && buf[1] === 0x4d))
  ) {
    return readTiff(buf, dims);
  }
  return reject('unsupported-format');
}

function readJpeg(buf: Buffer, dims: Dims): CellSensScaleResult {
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

  if (!inRange(sx)) {
    return reject('out-of-range');
  }
  // cellSens writes 0.08625 as 0.08625000000000002; 12 significant digits drop
  // that binary noise (which would otherwise surface verbatim in the export
  // dialog) and change no measurement.
  return { pixelSizeUm: Number(sx.toPrecision(12)) };
}


/** OlympusSIS pixel size in µm, per tifffile `read_sis`: a little-endian
 *  `SIS0` header of 60 bytes whose last int16 is the entry count, then 8-byte
 *  entries (int16 type, int16 count, uint32 absolute offset). Type 1 is
 *  "general data": int16 length exponent at +10, float64 x / y calibration at
 *  +12 / +20, in metres after `* 10^exponent`. */
function readSisUm(
  buf: Buffer,
  sisOffset: number
): { x: number; y: number } | null {
  if (
    sisOffset + 60 > buf.length ||
    buf.toString('latin1', sisOffset, sisOffset + 4) !== 'SIS0'
  ) {
    return null;
  }
  const count = buf.readInt16LE(sisOffset + 58);
  if (count <= 0 || sisOffset + 60 + count * 8 > buf.length) {
    return null;
  }
  for (let i = 0; i < count; i++) {
    const e = sisOffset + 60 + i * 8;
    if (buf.readInt16LE(e) !== 1) {
      continue;
    }
    const off = buf.readUInt32LE(e + 4);
    if (off + 28 > buf.length) {
      return null;
    }
    const scale = 10 ** buf.readInt16LE(off + 10) * 1e6; // metres -> µm
    return {
      x: buf.readDoubleLE(off + 12) * scale,
      y: buf.readDoubleLE(off + 20) * scale,
    };
  }
  return null;
}

/** `PhysicalSize*Unit` values of OME's UnitsLength that a pixel can sensibly
 *  have, in µm. OME's default when the attribute is absent is µm. Both the
 *  micro sign (U+00B5) and the Greek mu (U+03BC) occur in the wild. */
const OME_UNIT_UM = new Map<string, number>([
  ['µm', 1],
  ['μm', 1],
  ['um', 1],
  ['nm', 1e-3],
  ['mm', 1e3],
  ['m', 1e6],
]);

/** The longest ImageDescription that is parsed at all. Measured 2026-10-14:
 *  the 140 cellSens XV files in production have at most 2 213 characters, the
 *  `<Pixels>` element at most 277. The text is the uploader's, so this bound —
 *  ~30x headroom — is what keeps the regular expressions below on small
 *  input whatever a crafted file holds. */
const MAX_DESCRIPTION_BYTES = 64 * 1024;

/** The one OME `<Pixels>` element's size and µm pixel size, or a reason. A
 *  file describing several images is refused: which one is page 0 is not
 *  something to guess. */
function readOme(
  description: string
):
  | { sizeX: number; sizeY: number; x: number; y: number }
  | 'no-ome'
  | 'bad-unit' {
  const elements = description.match(/<(?:[\w-]+:)?Pixels\b[^>]*>/g);
  if (!elements || elements.length !== 1) {
    return 'no-ome';
  }
  // A Map, not an object: attribute names are the uploader's text, and one
  // called `__proto__` must not reach a prototype. Each match must start after
  // whitespace, so a long run of name characters is scanned once, not once
  // per start position.
  const attrs = new Map<string, string>();
  for (const m of elements[0].matchAll(/\s([A-Za-z_][\w:.-]*)="([^"]*)"/g)) {
    attrs.set(m[1], m[2]);
  }
  const sizeX = Number(attrs.get('SizeX'));
  const sizeY = Number(attrs.get('SizeY'));
  const axis = (v?: string, unit?: string): number | null => {
    const f = OME_UNIT_UM.get(unit ?? 'µm');
    const n = v === undefined ? NaN : Number(v);
    return f !== undefined && Number.isFinite(n) ? n * f : null;
  };
  const x = axis(attrs.get('PhysicalSizeX'), attrs.get('PhysicalSizeXUnit'));
  const y = axis(attrs.get('PhysicalSizeY'), attrs.get('PhysicalSizeYUnit'));
  if (!Number.isInteger(sizeX) || !Number.isInteger(sizeY)) {
    return 'no-ome';
  }
  if (x === null || y === null) {
    return 'bad-unit';
  }
  return { sizeX, sizeY, x, y };
}

function readTiff(buf: Buffer, dims: Dims): CellSensScaleResult {
  const le = buf[0] === 0x49;
  if ((le ? buf.readUInt16LE(2) : buf.readUInt16BE(2)) !== 42) {
    return reject('unsupported-format'); // BigTIFF (43) or not a TIFF
  }
  const ifd0 = readIfd(
    buf,
    le ? buf.readUInt32LE(4) : buf.readUInt32BE(4),
    le
  );
  const sisEntry = ifd0?.get(OLYMPUS_SIS_TAG);
  if (!ifd0 || !sisEntry) {
    return reject('not-cellsens');
  }
  // The value FIELD is the absolute offset of the block, whatever the tag's
  // type and count say — tifffile reads every tag with a custom reader that
  // way (`TiffTag.fromfile`: `code in TIFF.TAG_READERS` forces the field to be
  // an offset). cellSens writes a LONG of count 1; following `valueOffset`
  // would differ the moment a writer declared the block's own byte count.
  const sis = readSisUm(buf, sisEntry.field);
  if (!sis) {
    return reject('no-sis');
  }

  const desc = ifd0.get(IMAGE_DESCRIPTION_TAG);
  if (
    !desc ||
    desc.count > MAX_DESCRIPTION_BYTES ||
    desc.valueOffset + desc.count > buf.length
  ) {
    return reject('no-ome');
  }
  // An ASCII tag ends at its first NUL; nothing after it is part of the text.
  const text = buf.toString(
    'utf8',
    desc.valueOffset,
    desc.valueOffset + desc.count
  );
  const nul = text.indexOf('\0');
  const ome = readOme(nul >= 0 ? text.slice(0, nul) : text);
  if (typeof ome === 'string') {
    return reject(ome);
  }

  if (!sameScale(sis.x, sis.y) || !sameScale(ome.x, ome.y)) {
    return reject('anisotropic');
  }
  if (!sameScale(sis.x, ome.x)) {
    return reject('sources-disagree');
  }
  if (
    !dims.width ||
    !dims.height ||
    ome.sizeX !== dims.width ||
    ome.sizeY !== dims.height
  ) {
    return reject('size-mismatch');
  }
  if (!inRange(ome.x)) {
    return reject('out-of-range');
  }
  return { pixelSizeUm: Number(ome.x.toPrecision(12)) };
}
