/**
 * imagejRoiEncoder.test.ts
 *
 * Behavioral tests for src/services/export/imagejRoiEncoder.ts.
 *
 *  encodeImageJRoi (pure binary encoder)
 *   - produces the ImageJ "Iout" magic + correct ROI type byte
 *   - sets the SUB_PIXEL_RESOLUTION option flag
 *   - round-trips sub-pixel float coordinates (absolute) exactly
 *   - writes the integer bbox + relative int16 block; float stays exact on wrap
 *   - round-trips the ROI name via UTF-16BE (incl. non-ASCII)
 *   - writes the optional slice position (@56) and ARGB stroke colour (@40)
 *   - leaves position/stroke at 0 when options are omitted (byte back-compat)
 *   - throws below the geometry minimum (polyline < 2 / polygon < 3)
 *
 *  buildVideoRoiEntries (pure zip-entry builder)
 *   - places each ROI on its 1-based slice position + per-track stroke colour
 *   - names entries <label>__frame_NNNN, MT-first + globally unique
 *   - keeps the same trackId's colour identical across frames
 *   - dedups colliding labels within a frame; drops degenerate / non-finite
 *   - counts corrupt-JSON frames + dropped polygons
 *
 *  exportImageJRoiSets (real temp-dir FS)
 *   - writes one <video>_RoiSet.zip per video container (valid PK zip)
 *   - separates videos that share a frameIndex (multi-position ND2)
 *   - the zip round-trips real ROI bytes (position + stroke survive deflate)
 *   - skips corrupt frames with a warning; warns when nothing was exported
 *   - rejects when the job is cancelled
 *
 * The inline decoder mirrors ImageJ's RoiDecoder layout so the test needs no
 * external tool. It was cross-checked against Christoph Gohlke's reference
 * `roifile` Python package during development.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';

// Mock only the axios default export so the ML `/mt-background-rois` fetch in
// `exportImageJRoiSets` is controllable. Tests that don't pass `thicknessPx`
// never call it, so the existing suites are unaffected.
const axiosPostMock = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { post: axiosPostMock } }));
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import {
  encodeImageJRoi,
  buildVideoRoiEntries,
  exportImageJRoiSets,
  type RoiFrameInput,
  type RoiZipEntry,
} from '../imagejRoiEncoder';
import { imageJColorFromHex } from '../imagejColor';

// ---------------------------------------------------------------------------
// Minimal ImageJ .roi decoder (subset: poly types with sub-pixel + name)
// ---------------------------------------------------------------------------

interface DecodedRoi {
  magic: string;
  type: number;
  nCoords: number;
  subPixel: boolean;
  bbox: { top: number; left: number; bottom: number; right: number };
  /** Integer coordinate block (int16, relative to left/top). */
  intCoords: Array<[number, number]>;
  /** Sub-pixel float coordinate block (absolute). */
  coords: Array<[number, number]>;
  /** 1-based stack slice (@56); 0 when unset. */
  position: number;
  /** ARGB stroke colour (@40, unsigned); 0 when unset. */
  strokeColor: number;
  /** int16 stroke width (@34); 0 when unset. */
  strokeWidth: number;
  /** float32 stroke width from header2 (+36); 0 when unset. */
  floatStrokeWidth: number;
  name: string;
}

/** Read an int16 the way ImageJ does — the encoder stores low 16 bits. */
function readShort(buf: Buffer, off: number): number {
  return buf.readInt16BE(off);
}

function decodeRoi(buf: Buffer): DecodedRoi {
  const magic = buf.toString('ascii', 0, 4);
  const type = buf.readUInt8(6);
  const bbox = {
    top: readShort(buf, 8),
    left: readShort(buf, 10),
    bottom: readShort(buf, 12),
    right: readShort(buf, 14),
  };
  const n = buf.readUInt16BE(16);
  const strokeWidth = readShort(buf, 34);
  const strokeColor = buf.readUInt32BE(40);
  const options = buf.readUInt16BE(50);
  const subPixel = (options & 128) !== 0;
  const position = buf.readInt32BE(56);

  const intCoords: Array<[number, number]> = [];
  const ix = 64;
  const iy = ix + n * 2;
  for (let i = 0; i < n; i++) {
    intCoords.push([readShort(buf, ix + i * 2), readShort(buf, iy + i * 2)]);
  }

  const coords: Array<[number, number]> = [];
  if (subPixel) {
    const fx = 64 + n * 4;
    const fy = fx + n * 4;
    for (let i = 0; i < n; i++) {
      coords.push([buf.readFloatBE(fx + i * 4), buf.readFloatBE(fy + i * 4)]);
    }
  }

  const header2Offset = buf.readInt32BE(60);
  const floatStrokeWidth = buf.readFloatBE(header2Offset + 36);
  const nameOffset = buf.readInt32BE(header2Offset + 16);
  const nameLength = buf.readInt32BE(header2Offset + 20);
  let name = '';
  if (nameOffset > 0 && nameLength > 0) {
    for (let i = 0; i < nameLength; i++) {
      name += String.fromCharCode(buf.readUInt16BE(nameOffset + i * 2));
    }
  }

  return {
    magic,
    type,
    nCoords: n,
    subPixel,
    bbox,
    intCoords,
    coords,
    position,
    strokeColor,
    strokeWidth,
    floatStrokeWidth,
    name,
  };
}

const ROI_TYPE_POLYGON = 0;
const ROI_TYPE_POLYLINE = 5;

// ---------------------------------------------------------------------------
// Minimal ZIP reader (central directory + local headers; deflate/stored)
// ---------------------------------------------------------------------------

/** Total entry count from the End Of Central Directory record. */
function zipEntryCount(buf: Buffer): number {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      return buf.readUInt16LE(i + 10);
    }
  }
  throw new Error('EOCD not found');
}

/** All entry names, read from the central directory (no inflation needed). */
function zipEntryNames(buf: Buffer): string[] {
  const names: string[] = [];
  let i = 0;
  while (i <= buf.length - 4) {
    if (buf.readUInt32LE(i) === 0x02014b50) {
      const nameLen = buf.readUInt16LE(i + 28);
      const extraLen = buf.readUInt16LE(i + 30);
      const commentLen = buf.readUInt16LE(i + 32);
      names.push(buf.toString('utf8', i + 46, i + 46 + nameLen));
      i += 46 + nameLen + extraLen + commentLen;
    } else {
      i++;
    }
  }
  return names;
}

/** Extract one entry's bytes by name (handles stored + deflate). */
function zipExtract(buf: Buffer, name: string): Buffer {
  let i = 0;
  while (i <= buf.length - 4) {
    if (buf.readUInt32LE(i) === 0x02014b50) {
      const nameLen = buf.readUInt16LE(i + 28);
      const extraLen = buf.readUInt16LE(i + 30);
      const commentLen = buf.readUInt16LE(i + 32);
      const entryName = buf.toString('utf8', i + 46, i + 46 + nameLen);
      if (entryName === name) {
        const method = buf.readUInt16LE(i + 10);
        const compSize = buf.readUInt32LE(i + 20);
        const localOff = buf.readUInt32LE(i + 42);
        const lNameLen = buf.readUInt16LE(localOff + 26);
        const lExtraLen = buf.readUInt16LE(localOff + 28);
        const dataStart = localOff + 30 + lNameLen + lExtraLen;
        const data = buf.subarray(dataStart, dataStart + compSize);
        return method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
      }
      i += 46 + nameLen + extraLen + commentLen;
    } else {
      i++;
    }
  }
  throw new Error(`entry not found: ${name}`);
}

// ---------------------------------------------------------------------------
// encodeImageJRoi
// ---------------------------------------------------------------------------

describe('encodeImageJRoi', () => {
  it('encodes a polyline with the correct magic, type and sub-pixel flag', () => {
    const buf = encodeImageJRoi(
      [
        { x: 10.5, y: 20.25 },
        { x: 30.75, y: 40 },
        { x: 55.5, y: 12.5 },
      ],
      'polyline',
      '42'
    );
    const d = decodeRoi(buf);
    expect(d.magic).toBe('Iout');
    expect(d.type).toBe(ROI_TYPE_POLYLINE);
    expect(d.subPixel).toBe(true);
    expect(d.nCoords).toBe(3);
  });

  it('round-trips sub-pixel coordinates exactly (float32 precision)', () => {
    const pts = [
      { x: 10.5, y: 20.25 },
      { x: 30.75, y: 40 },
      { x: 80.125, y: 90.875 },
    ];
    const d = decodeRoi(encodeImageJRoi(pts, 'polyline', 'x'));
    expect(d.coords).toEqual(pts.map(p => [p.x, p.y]));
  });

  it('encodes a closed polygon as ROI type POLYGON', () => {
    const d = decodeRoi(
      encodeImageJRoi(
        [
          { x: 100, y: 100 },
          { x: 200, y: 105.5 },
          { x: 180.25, y: 220.75 },
        ],
        'polygon',
        'poly1'
      )
    );
    expect(d.type).toBe(ROI_TYPE_POLYGON);
    expect(d.name).toBe('poly1');
  });

  it('round-trips a non-ASCII name via UTF-16BE', () => {
    const name = 'µtub_αβ_7';
    const d = decodeRoi(
      encodeImageJRoi(
        [
          { x: 5, y: 5 },
          { x: 512.9, y: 768.1 },
        ],
        'polyline',
        name
      )
    );
    expect(d.name).toBe(name);
  });

  it('omits the name block when no name is given', () => {
    const d = decodeRoi(
      encodeImageJRoi(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        'polyline'
      )
    );
    expect(d.name).toBe('');
  });

  it('writes the integer bounding box + relative int16 coordinate block', () => {
    // Rounded points → bbox {top:21,left:10,bottom:40,right:31}; int coords are
    // stored relative to left/top. This locks the legacy int block that old
    // ImageJ readers + Roi.getBounds() depend on (the float block is separate).
    const d = decodeRoi(
      encodeImageJRoi(
        [
          { x: 10.4, y: 20.6 },
          { x: 30.5, y: 40.2 },
        ],
        'polyline',
        'b'
      )
    );
    expect(d.bbox).toEqual({ top: 21, left: 10, bottom: 40, right: 31 });
    expect(d.intCoords).toEqual([
      [0, 0],
      [21, 19],
    ]);
  });

  it('keeps float coords exact even when int coords wrap (huge values)', () => {
    // int16 wraps by design (cosmetic); the float block stays authoritative.
    const pts = [
      { x: 70000.5, y: 40000.25 },
      { x: 1.5, y: 2.5 },
    ];
    const d = decodeRoi(encodeImageJRoi(pts, 'polyline', 'big'));
    expect(d.coords).toEqual(pts.map(p => [p.x, p.y]));
  });

  it('writes the optional slice position and ARGB stroke colour', () => {
    const argb = 0xff00ff00; // opaque green
    const d = decodeRoi(
      encodeImageJRoi(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        'polyline',
        'mt',
        { position: 7, strokeColor: argb }
      )
    );
    expect(d.position).toBe(7);
    expect(d.strokeColor).toBe(argb);
  });

  it('leaves position + stroke at 0 when options are omitted (byte back-compat)', () => {
    const d = decodeRoi(
      encodeImageJRoi(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        'polyline',
        'mt'
      )
    );
    expect(d.position).toBe(0);
    expect(d.strokeColor).toBe(0);
  });

  it('ignores a zero / non-positive position (stays unset)', () => {
    const d = decodeRoi(
      encodeImageJRoi(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        'polyline',
        'mt',
        { position: 0 }
      )
    );
    expect(d.position).toBe(0);
  });

  it('writes the MT thickness to BOTH the int16 (@34) and header2 float32 fields', () => {
    // ImageJ stores stroke width twice for reader compatibility; both must
    // carry the thickness so the polyline draws as a band, not a hairline.
    const d = decodeRoi(
      encodeImageJRoi(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        'polyline',
        'mt',
        { strokeWidth: 7 }
      )
    );
    expect(d.strokeWidth).toBe(7);
    expect(d.floatStrokeWidth).toBeCloseTo(7, 5);
  });

  it('leaves both stroke-width fields at 0 when thickness is omitted (byte back-compat)', () => {
    const d = decodeRoi(
      encodeImageJRoi(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        'polyline',
        'mt'
      )
    );
    expect(d.strokeWidth).toBe(0);
    expect(d.floatStrokeWidth).toBe(0);
  });

  it('rounds a fractional thickness for the int16 field but keeps the float exact', () => {
    // thicknessPx is an integer in practice; this guards the rounding path so
    // the legacy int16 and the authoritative float never disagree by surprise.
    const d = decodeRoi(
      encodeImageJRoi(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        'polyline',
        'mt',
        { strokeWidth: 3.6 }
      )
    );
    expect(d.strokeWidth).toBe(4); // Math.round(3.6)
    expect(d.floatStrokeWidth).toBeCloseTo(3.6, 5);
  });

  it('ignores a non-positive / non-finite thickness (stays unset)', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const d = decodeRoi(
        encodeImageJRoi(
          [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
          'polyline',
          'mt',
          { strokeWidth: bad }
        )
      );
      expect(d.strokeWidth).toBe(0);
      expect(d.floatStrokeWidth).toBe(0);
    }
  });

  it('throws when given fewer than the geometry minimum points', () => {
    expect(() => encodeImageJRoi([{ x: 1, y: 1 }], 'polyline')).toThrow();
    expect(() => encodeImageJRoi([], 'polygon')).toThrow();
    // a 2-point "polygon" is degenerate (needs >= 3)
    expect(() =>
      encodeImageJRoi(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        'polygon'
      )
    ).toThrow(/at least 3/);
  });
});

// ---------------------------------------------------------------------------
// Golden-file test — external reference validation
// ---------------------------------------------------------------------------
//
// The `encodeImageJRoi` tests above pair the encoder with our own `decodeRoi`,
// so a *shared* wrong offset would round-trip cleanly and pass. This test pins
// the on-disk bytes to a reference `.roi` produced by an INDEPENDENT
// implementation — Christoph Gohlke's `roifile` (Python) — closing that gap.
// It passes NO options, so position/stroke stay 0 and the layout is unchanged
// from before this feature (guarding the back-compat path).
//
// fixtures/golden_polyline.roi was generated once with roifile 2026.2.10:
//
//   import roifile, numpy as np
//   roi = roifile.ImagejRoi.frompoints(
//       np.array([(12.5, 8.25), (40.0, 33.75), (88.5, 20.0), (150.25, 95.5)],
//                dtype=np.float32))
//   roi.roitype = roifile.ROI_TYPE.POLYLINE
//   roi.name = 'MT7'
//   open('golden_polyline.roi', 'wb').write(roi.tobytes())
//
// Both encoders agree byte-for-byte on everything that carries geometry: the
// "Iout" magic, the ROI type, the coordinate count, the absolute float32
// x[]/y[] block, the UTF-16BE name, and the total file size. They differ on
// exactly 7 bytes — header version (@4-5: 227 vs 229), the options flag (@50-
// 51), the integer bbox (@11/13/15) and the int16 relative-coord fallback
// (@67/71) — because those depend on rounding convention: our encoder uses JS
// Math.round (half-up, matching ImageJ's Java Math.round), while roifile uses
// NumPy banker's rounding. For sub-pixel ROIs ImageJ reads the float block and
// ignores the int fallback, so the geometry ImageJ actually loads is identical.
// ---------------------------------------------------------------------------

describe('encodeImageJRoi — golden file (roifile reference)', () => {
  const GOLDEN_POINTS = [
    { x: 12.5, y: 8.25 },
    { x: 40.0, y: 33.75 },
    { x: 88.5, y: 20.0 },
    { x: 150.25, y: 95.5 },
  ];

  it('matches roifile bytes on magic, type, count, float geometry, name and size', async () => {
    const golden = await fs.readFile(
      path.join(__dirname, 'fixtures', 'golden_polyline.roi')
    );
    const ours = encodeImageJRoi(GOLDEN_POINTS, 'polyline', 'MT7');

    // Same total file size (header + int16 pairs + float32 pairs + header2 + name).
    expect(ours.length).toBe(golden.length);

    // Header fields both implementations (and ImageJ) must agree on.
    expect(ours.subarray(0, 4)).toEqual(golden.subarray(0, 4)); // "Iout"
    expect(ours[6]).toBe(golden[6]); // ROI type byte (polyline = 5)
    expect(ours.readInt16BE(16)).toBe(golden.readInt16BE(16)); // nCoords = 4

    // The authoritative sub-pixel geometry: float32 x[n] then y[n] at 64 + 4n.
    const n = GOLDEN_POINTS.length;
    const floatStart = 64 + n * 4;
    const floatEnd = floatStart + n * 8;
    expect(ours.subarray(floatStart, floatEnd)).toEqual(
      golden.subarray(floatStart, floatEnd)
    );

    // Name is stored as UTF-16BE at the tail of the file ("MT7").
    const nameBE = Buffer.from('MT7', 'utf16le').swap16();
    expect(ours.subarray(ours.length - nameBE.length)).toEqual(nameBE);
    expect(golden.subarray(golden.length - nameBE.length)).toEqual(nameBE);

    // Lock the full byte layout against the reference: the ONLY allowed
    // divergences are the 7 rounding/metadata bytes documented above. A drift
    // in any geometry byte would add an offset here and fail loudly rather than
    // being silently absorbed by a self-consistent round-trip.
    const diffs: number[] = [];
    for (let i = 0; i < golden.length; i++) {
      if (ours[i] !== golden[i]) diffs.push(i);
    }
    expect(diffs).toEqual([5, 11, 13, 15, 51, 67, 71]);
  });
});

// ---------------------------------------------------------------------------
// buildVideoRoiEntries (pure zip-entry builder)
// ---------------------------------------------------------------------------

function line(
  trackId: string | null,
  pts: Array<[number, number]>,
  geometry: 'polyline' | 'polygon' = 'polyline'
) {
  return {
    trackId,
    geometry,
    points: pts.map(([x, y]) => ({ x, y })),
  };
}

/** Index built entries by name for convenient assertions. */
function byName(entries: RoiZipEntry[]): Map<string, RoiZipEntry> {
  return new Map(entries.map(e => [e.name, e]));
}

describe('buildVideoRoiEntries', () => {
  it('places each ROI on its 1-based slice with a per-track stroke colour', () => {
    const frames: RoiFrameInput[] = [
      {
        id: 'f0',
        name: 'v.nd2 (frame 1)',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([
            line('7', [
              [10, 10],
              [20, 25],
            ]),
          ]),
        },
      },
      {
        id: 'f2',
        name: 'v.nd2 (frame 3)',
        parentVideoId: 'c1',
        frameIndex: 2,
        segmentation: {
          polygons: JSON.stringify([
            line('7', [
              [12, 12],
              [22, 27],
            ]),
          ]),
        },
      },
    ];

    const build = buildVideoRoiEntries(frames);
    // Untyped MT (trackId '7') → `untyped_1`, stable across its frames.
    expect(build.entries.map(e => e.name)).toEqual([
      'untyped_1__frame_0000.roi',
      'untyped_1__frame_0002.roi',
    ]);

    const map = byName(build.entries);
    const f0 = decodeRoi(map.get('untyped_1__frame_0000.roi')!.buffer);
    const f2 = decodeRoi(map.get('untyped_1__frame_0002.roi')!.buffer);
    expect(f0.position).toBe(1); // frameIndex 0 → slice 1
    expect(f2.position).toBe(3); // frameIndex 2 → slice 3
    // Same track ⇒ identical colour across frames, and it must be a real
    // opaque colour (alpha 0xFF), not the unset 0.
    expect(f0.strokeColor).toBe(f2.strokeColor);
    expect((f0.strokeColor >>> 24) & 0xff).toBe(0xff);
  });

  it('gives distinct tracks distinct colours', () => {
    const build = buildVideoRoiEntries([
      {
        id: 'f0',
        name: 'v',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([
            line('a', [
              [1, 1],
              [2, 2],
            ]),
            line('b', [
              [3, 3],
              [4, 4],
            ]),
          ]),
        },
      },
    ]);
    const [a, b] = build.entries.map(e => decodeRoi(e.buffer));
    expect(a.strokeColor).not.toBe(b.strokeColor);
  });

  it('encodes the tubulin class into the ROI name + stroke colour when typed', () => {
    const build = buildVideoRoiEntries(
      [
        {
          id: 'f0',
          name: 'v',
          parentVideoId: 'c1',
          frameIndex: 0,
          segmentation: {
            polygons: JSON.stringify([
              {
                trackId: 't1',
                geometry: 'polyline',
                mtType: 'lbl',
                points: [
                  { x: 1, y: 1 },
                  { x: 2, y: 2 },
                ],
              },
            ]),
          },
        },
      ],
      undefined,
      new Map([['lbl', { name: 'alpha', color: '#ff0000' }]])
    );
    expect(build.entries).toHaveLength(1);
    const d = decodeRoi(build.entries[0].buffer);
    // Class name + per-type counter is the ROI name (first alpha ⇒ alpha_1)…
    expect(d.name).toBe('alpha_1');
    // …and the stroke colour is the label's colour (not the per-track hue).
    expect(d.strokeColor).toBe(imageJColorFromHex('#ff0000'));
    // The zip entry filename also carries the class name.
    expect(build.entries[0].name.startsWith('alpha_1__')).toBe(true);
  });

  it('keeps the per-track hue for an untyped polyline (no palette match)', () => {
    const build = buildVideoRoiEntries(
      [
        {
          id: 'f0',
          name: 'v',
          parentVideoId: 'c1',
          frameIndex: 0,
          segmentation: {
            polygons: JSON.stringify([
              {
                trackId: 't1',
                geometry: 'polyline',
                points: [
                  { x: 1, y: 1 },
                  { x: 2, y: 2 },
                ],
              },
            ]),
          },
        },
      ],
      undefined,
      new Map([['lbl', { name: 'alpha', color: '#ff0000' }]])
    );
    const d = decodeRoi(build.entries[0].buffer);
    expect(d.name.startsWith('alpha__')).toBe(false);
    expect(d.strokeColor).not.toBe(imageJColorFromHex('#ff0000'));
  });

  it('ignores mtType when no palette is supplied (uses per-track hue)', () => {
    // A polyline carrying mtType but buildVideoRoiEntries called WITHOUT a
    // palette (labelById undefined) — the class cannot resolve, so the ROI
    // keeps the trackId-hash name/colour.
    const build = buildVideoRoiEntries([
      {
        id: 'f0',
        name: 'v',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([
            {
              trackId: 't1',
              geometry: 'polyline',
              mtType: 'lbl',
              points: [
                { x: 1, y: 1 },
                { x: 2, y: 2 },
              ],
            },
          ]),
        },
      },
    ]);
    const d = decodeRoi(build.entries[0].buffer);
    // No palette ⇒ the class can't resolve, so the MT is named as untyped.
    expect(d.name.startsWith('alpha')).toBe(false);
    expect(d.name).toBe('untyped_1');
  });

  it('processes frames in frameIndex order regardless of input order', () => {
    const build = buildVideoRoiEntries([
      {
        id: 'f2',
        name: 'v',
        parentVideoId: 'c1',
        frameIndex: 2,
        segmentation: {
          polygons: JSON.stringify([
            line('7', [
              [1, 1],
              [2, 2],
            ]),
          ]),
        },
      },
      {
        id: 'f0',
        name: 'v',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([
            line('7', [
              [1, 1],
              [2, 2],
            ]),
          ]),
        },
      },
    ]);
    expect(build.entries.map(e => e.name)).toEqual([
      'untyped_1__frame_0000.roi',
      'untyped_1__frame_0002.roi',
    ]);
  });

  it('dedups colliding labels within a frame and drops degenerate geometry', () => {
    const build = buildVideoRoiEntries([
      {
        id: 'f0',
        name: 'v',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([
            line('7', [
              [1, 1],
              [2, 2],
            ]),
            line('7', [
              [9, 9],
              [8, 8],
            ]), // duplicate trackId same frame → suffixed
            line('bad', [[5, 5]]), // < 2 points → dropped
          ]),
        },
      },
    ]);
    const names = build.entries.map(e => e.name).sort();
    // Both share trackId '7' ⇒ both resolve to 'untyped_1'; the in-frame dedup
    // suffixes the second. Sorted: '2' (0x32) < '_' (0x5F), so the _2 precedes.
    expect(names).toEqual([
      'untyped_1_2__frame_0000.roi',
      'untyped_1__frame_0000.roi',
    ]);
    expect(build.droppedPolygons).toBe(1);
    expect(build.framesWithRois).toBe(1);
  });

  it('counts corrupt-JSON frames and drops non-finite polygons', () => {
    const build = buildVideoRoiEntries([
      {
        id: 'bad',
        name: 'v',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: { polygons: '{not json' },
      },
      {
        id: 'f1',
        name: 'v',
        parentVideoId: 'c1',
        frameIndex: 1,
        segmentation: {
          polygons: JSON.stringify([
            line('ok', [
              [1, 1],
              [2, 2],
            ]),
            line('nan', [
              [Number.NaN, 5],
              [1, 2],
            ]),
          ]),
        },
      },
    ]);
    expect(build.corruptFrames).toBe(1);
    expect(build.droppedPolygons).toBe(1);
    expect(build.entries.map(e => e.name)).toEqual([
      'untyped_1__frame_0001.roi',
    ]);
  });

  it('falls back to a generated label for untracked / empty-trackId polylines', () => {
    const build = buildVideoRoiEntries([
      {
        id: 'f0',
        name: 'v',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([
            line('', [
              [1, 1],
              [2, 2],
            ]),
            line('', [
              [3, 3],
              [4, 4],
            ]),
          ]),
        },
      },
    ]);
    const names = build.entries.map(e => e.name).sort();
    expect(names).toEqual([
      'roi_0001__frame_0000.roi',
      'roi_0002__frame_0000.roi',
    ]);
  });

  it('numbers each tubulin type from 1 (HeLa_1, HeLa_2, brain_1, brain_2)', () => {
    const palette = new Map([
      ['h', { name: 'HeLa', color: '#ff0000' }],
      ['b', { name: 'brain', color: '#00ff00' }],
    ]);
    const mt = (trackId: string, type: string, x: number) => ({
      trackId,
      geometry: 'polyline' as const,
      mtType: type,
      points: [
        { x: 0, y: 0 },
        { x, y: x },
      ],
    });
    const build = buildVideoRoiEntries(
      [
        {
          id: 'f0',
          name: 'v',
          parentVideoId: 'c1',
          frameIndex: 0,
          segmentation: {
            polygons: JSON.stringify([
              mt('t1', 'h', 1),
              mt('t2', 'b', 2),
              mt('t3', 'h', 3),
              mt('t4', 'b', 4),
            ]),
          },
        },
      ],
      undefined,
      palette
    );
    expect(build.entries.map(e => decodeRoi(e.buffer).name)).toEqual([
      'HeLa_1',
      'brain_1',
      'HeLa_2',
      'brain_2',
    ]);
  });

  it('keeps one microtubule identically named across frames (trackId-keyed)', () => {
    const palette = new Map([['h', { name: 'HeLa', color: '#ff0000' }]]);
    const mk = (idx: number) => ({
      id: `f${idx}`,
      name: 'v',
      parentVideoId: 'c1',
      frameIndex: idx,
      segmentation: {
        polygons: JSON.stringify([
          {
            trackId: 't9',
            geometry: 'polyline',
            mtType: 'h',
            points: [
              { x: 0, y: idx },
              { x: 5, y: idx },
            ],
          },
        ]),
      },
    });
    const build = buildVideoRoiEntries([mk(0), mk(1)], undefined, palette);
    expect(build.entries.map(e => decodeRoi(e.buffer).name)).toEqual([
      'HeLa_1',
      'HeLa_1',
    ]);
  });

  it('lets a manual rename override the <type>_<counter> scheme', () => {
    const palette = new Map([['h', { name: 'HeLa', color: '#ff0000' }]]);
    const build = buildVideoRoiEntries(
      [
        {
          id: 'f0',
          name: 'v',
          parentVideoId: 'c1',
          frameIndex: 0,
          segmentation: {
            polygons: JSON.stringify([
              {
                trackId: 't1',
                geometry: 'polyline',
                mtType: 'h',
                name: 'spindle-pole',
                points: [
                  { x: 0, y: 0 },
                  { x: 1, y: 1 },
                ],
              },
              {
                trackId: 't2',
                geometry: 'polyline',
                mtType: 'h',
                points: [
                  { x: 0, y: 0 },
                  { x: 2, y: 2 },
                ],
              },
            ]),
          },
        },
      ],
      undefined,
      palette
    );
    // The renamed MT uses its name verbatim and does NOT consume a HeLa counter,
    // so the next HeLa is HeLa_1.
    expect(build.entries.map(e => decodeRoi(e.buffer).name)).toEqual([
      'spindle-pole',
      'HeLa_1',
    ]);
  });

  it('emits a wider <name>_bg background band ROI when backgroundStrokeWidth is set', () => {
    const palette = new Map([['h', { name: 'HeLa', color: '#ff0000' }]]);
    const build = buildVideoRoiEntries(
      [
        {
          id: 'f0',
          name: 'v',
          parentVideoId: 'c1',
          frameIndex: 0,
          segmentation: {
            polygons: JSON.stringify([
              {
                trackId: 't1',
                geometry: 'polyline',
                mtType: 'h',
                points: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                ],
              },
            ]),
          },
        },
      ],
      5, // signal thickness
      palette,
      13 // background band width = thickness(5) + 2*margin(4)
    );
    expect(build.entries.map(e => e.name).sort()).toEqual([
      'HeLa_1__frame_0000.roi',
      'HeLa_1_bg__frame_0000.roi',
    ]);
    const map = byName(build.entries);
    const sig = decodeRoi(map.get('HeLa_1__frame_0000.roi')!.buffer);
    const bg = decodeRoi(map.get('HeLa_1_bg__frame_0000.roi')!.buffer);
    // Signal band is the thickness; the background band is the wider vicinity.
    expect(sig.strokeWidth).toBe(5);
    expect(bg.strokeWidth).toBe(13);
    // Same geometry (a wide-stroke polyline), same slice + colour.
    expect(bg.type).toBe(ROI_TYPE_POLYLINE);
    expect(bg.strokeColor).toBe(sig.strokeColor);
    expect(bg.position).toBe(sig.position);
  });

  const onePolylineFrame = () => [
    {
      id: 'f0',
      name: 'v',
      parentVideoId: 'c1',
      frameIndex: 0,
      segmentation: {
        polygons: JSON.stringify([
          {
            trackId: 't1',
            geometry: 'polyline',
            mtType: 'h',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
          },
        ]),
      },
    },
  ];

  it('uses the pre-fetched composite buffer for <name>_bg when bgRoiBytes is provided', () => {
    const palette = new Map([['h', { name: 'HeLa', color: '#ff0000' }]]);
    const composite = Buffer.from('COMPOSITE_BG_BYTES_FROM_ML');
    // key = `${frameIndex}:${itemIndex}` = '0:0'.
    const bgMap = new Map<string, Buffer>([['0:0', composite]]);
    const build = buildVideoRoiEntries(
      onePolylineFrame(),
      5,
      palette,
      13, // stroke-band fallback width — must be IGNORED when the map is present
      bgMap
    );
    expect(build.entries.map(e => e.name).sort()).toEqual([
      'HeLa_1__frame_0000.roi',
      'HeLa_1_bg__frame_0000.roi',
    ]);
    const map = byName(build.entries);
    // The _bg entry is the exact ML composite bytes, not a re-encoded stroke band.
    expect(map.get('HeLa_1_bg__frame_0000.roi')!.buffer).toBe(composite);
  });

  it('omits <name>_bg when a present bgRoiBytes map has no key (empty vicinity ring)', () => {
    const palette = new Map([['h', { name: 'HeLa', color: '#ff0000' }]]);
    // Present-but-empty map is authoritative: no background ROI AND no stroke
    // fallback (an empty ring = null background on the metrics side).
    const build = buildVideoRoiEntries(
      onePolylineFrame(),
      5,
      palette,
      13,
      new Map<string, Buffer>()
    );
    expect(build.entries.map(e => e.name)).toEqual(['HeLa_1__frame_0000.roi']);
  });

  it('skips the background band when it is not wider than the signal (margin 0)', () => {
    const build = buildVideoRoiEntries(
      [
        {
          id: 'f0',
          name: 'v',
          parentVideoId: 'c1',
          frameIndex: 0,
          segmentation: {
            polygons: JSON.stringify([
              line('t1', [
                [0, 0],
                [10, 0],
              ]),
            ]),
          },
        },
      ],
      5,
      undefined,
      5 // background width == signal width → no bg ROI
    );
    expect(build.entries.map(e => e.name)).toEqual([
      'untyped_1__frame_0000.roi',
    ]);
  });

  it('stamps the given thickness as EVERY ROI stroke width', () => {
    const build = buildVideoRoiEntries(
      [
        {
          id: 'f0',
          name: 'v',
          parentVideoId: 'c1',
          frameIndex: 0,
          segmentation: {
            polygons: JSON.stringify([
              line('a', [
                [1, 1],
                [2, 2],
              ]),
              line('b', [
                [3, 3],
                [4, 4],
              ]),
            ]),
          },
        },
      ],
      6
    );
    expect(build.entries).toHaveLength(2);
    for (const e of build.entries) {
      const d = decodeRoi(e.buffer);
      expect(d.strokeWidth).toBe(6);
      expect(d.floatStrokeWidth).toBeCloseTo(6, 5);
    }
  });

  it('leaves stroke width unset when no thickness is passed', () => {
    const build = buildVideoRoiEntries([
      {
        id: 'f0',
        name: 'v',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([
            line('a', [
              [1, 1],
              [2, 2],
            ]),
          ]),
        },
      },
    ]);
    expect(decodeRoi(build.entries[0].buffer).strokeWidth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// exportImageJRoiSets (real temp-dir filesystem)
// ---------------------------------------------------------------------------

describe('exportImageJRoiSets', () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(
      tmpDirs.map(d => fs.rm(d, { recursive: true, force: true }))
    );
  });

  async function mkTmp(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roizip-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  const oneVideoFrame = (): RoiFrameInput[] => [
    { id: 'c1', name: 'vid.nd2', isVideoContainer: true, segmentation: null },
    {
      id: 'f0',
      name: 'vid.nd2 (frame 1)',
      parentVideoId: 'c1',
      frameIndex: 0,
      segmentation: {
        polygons: JSON.stringify([
          line('1', [
            [10, 10],
            [20, 25],
          ]),
        ]),
      },
    },
  ];

  it('fetches composite _bg ROIs from ML and inserts them by the aligned key', async () => {
    const out = await mkTmp();
    axiosPostMock.mockReset();
    // A real ImageJ ROI buffer (starts with the `Iout` magic the fetch validates).
    const fakeComposite = encodeImageJRoi(
      [
        { x: 1, y: 1 },
        { x: 9, y: 1 },
      ],
      'polyline',
      'bg'
    );
    axiosPostMock.mockResolvedValueOnce({
      data: {
        frames: [
          {
            frame_index: 0,
            rois: [{ instance_id: '0', roi_b64: fakeComposite.toString('base64') }],
          },
        ],
      },
    });

    const result = await exportImageJRoiSets(oneVideoFrame(), out, 'proj', {
      thicknessPx: 5,
      marginMultiplier: 2,
    });

    // The request carries the join fields the encoder looks up: frame_index +
    // instance_id (= itemIndex) + the `<label>_bg` name + 1-based position.
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
    const body = axiosPostMock.mock.calls[0][1] as {
      frames: Array<{
        frame_index: number;
        polylines: Array<{
          instance_id: string;
          roi_name: string;
          position: number;
        }>;
      }>;
    };
    expect(body.frames[0].frame_index).toBe(0);
    expect(body.frames[0].polylines[0].instance_id).toBe('0');
    expect(body.frames[0].polylines[0].roi_name).toBe('untyped_1_bg');
    expect(body.frames[0].polylines[0].position).toBe(1);

    // The composite _bg entry landed in the zip → the key `0:0` matched.
    const zip = await fs.readFile(
      path.join(out, 'annotations', 'imagej', 'vid_RoiSet.zip')
    );
    const names = zipEntryNames(zip);
    expect(names).toContain('untyped_1__frame_0000.roi');
    expect(names).toContain('untyped_1_bg__frame_0000.roi');
    expect(result.warnings).toEqual([]);
  });

  it('falls back to the stroke _bg band and warns the user when the ML fetch fails', async () => {
    const out = await mkTmp();
    axiosPostMock.mockReset();
    axiosPostMock.mockRejectedValueOnce(new Error('ML unavailable'));

    const result = await exportImageJRoiSets(oneVideoFrame(), out, 'proj', {
      thicknessPx: 5,
      marginMultiplier: 2,
      backgroundStrokeWidth: 13,
    });

    // Non-fatal: the export still ships a (coarser) stroke-band _bg…
    const zip = await fs.readFile(
      path.join(out, 'annotations', 'imagej', 'vid_RoiSet.zip')
    );
    expect(zipEntryNames(zip)).toContain('untyped_1_bg__frame_0000.roi');
    // …and the degradation is surfaced to the user, not just the server log.
    expect(result.warnings.some(w => /approximate/i.test(w))).toBe(true);
  });

  it('writes one <video>_RoiSet.zip per container, skipping empty frames', async () => {
    const out = await mkTmp();
    const frames: RoiFrameInput[] = [
      {
        id: 'c1',
        name: 'sample_60x.nd2',
        isVideoContainer: true,
        segmentation: null,
      },
      {
        id: 'f0',
        name: 'sample_60x.nd2 (frame 1)',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([
            line('1', [
              [10, 10],
              [20, 25],
            ]),
            line('2', [
              [50, 60],
              [70, 80],
            ]),
          ]),
        },
      },
      {
        id: 'f1',
        name: 'sample_60x.nd2 (frame 2)',
        parentVideoId: 'c1',
        frameIndex: 1,
        segmentation: { polygons: JSON.stringify([]) }, // no ROIs
      },
    ];

    const result = await exportImageJRoiSets(frames, out, 'proj');
    expect(result).toEqual({ frames: 1, rois: 2, warnings: [] });

    const base = path.join(out, 'annotations', 'imagej');
    expect(await fs.readdir(base)).toEqual(['sample_60x_RoiSet.zip']);

    const zip = await fs.readFile(path.join(base, 'sample_60x_RoiSet.zip'));
    expect(zip.subarray(0, 2).toString('ascii')).toBe('PK'); // local file header
    expect(zipEntryCount(zip)).toBe(2);
    expect(zipEntryNames(zip).sort()).toEqual([
      'untyped_1__frame_0000.roi',
      'untyped_2__frame_0000.roi',
    ]);
  });

  it('separates videos that share a frameIndex (multi-position ND2)', async () => {
    const out = await mkTmp();
    const frames: RoiFrameInput[] = [
      {
        id: 'cA',
        name: 'D03_0000.nd2',
        isVideoContainer: true,
        segmentation: null,
      },
      {
        id: 'cB',
        name: 'D05_0000.nd2',
        isVideoContainer: true,
        segmentation: null,
      },
      {
        id: 'a0',
        name: 'D03_0000.nd2 (frame 1)',
        parentVideoId: 'cA',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([
            line('1', [
              [1, 1],
              [2, 2],
            ]),
          ]),
        },
      },
      {
        id: 'b0',
        name: 'D05_0000.nd2 (frame 1)',
        parentVideoId: 'cB',
        frameIndex: 0, // SAME frameIndex as a0, different video
        segmentation: {
          polygons: JSON.stringify([
            line('1', [
              [3, 3],
              [4, 4],
            ]),
          ]),
        },
      },
    ];

    const result = await exportImageJRoiSets(frames, out, 'proj');
    expect(result.rois).toBe(2);
    const base = path.join(out, 'annotations', 'imagej');
    expect((await fs.readdir(base)).sort()).toEqual([
      'D03_0000_RoiSet.zip',
      'D05_0000_RoiSet.zip',
    ]);
  });

  it('the zip round-trips real ROI bytes (position + colour survive deflate)', async () => {
    const out = await mkTmp();
    const frames: RoiFrameInput[] = [
      { id: 'c1', name: 'v.nd2', isVideoContainer: true, segmentation: null },
      {
        id: 'f4',
        name: 'v.nd2 (frame 5)',
        parentVideoId: 'c1',
        frameIndex: 4,
        segmentation: {
          polygons: JSON.stringify([
            line('mt_42', [
              [10.5, 20.25],
              [30.75, 40],
              [55.5, 12.5],
            ]),
          ]),
        },
      },
    ];
    await exportImageJRoiSets(frames, out, 'proj');
    const zip = await fs.readFile(
      path.join(out, 'annotations', 'imagej', 'v_RoiSet.zip')
    );
    const roi = decodeRoi(zipExtract(zip, 'untyped_1__frame_0004.roi'));
    expect(roi.type).toBe(ROI_TYPE_POLYLINE);
    expect(roi.position).toBe(5); // frameIndex 4 → slice 5
    expect(roi.coords).toEqual([
      [10.5, 20.25],
      [30.75, 40],
      [55.5, 12.5],
    ]);
    // Colour is still keyed on trackId: mt_42 → hsl(62,70%,55%) → rgb(215,221,60).
    expect(roi.strokeColor).toBe(
      ((0xff << 24) | (215 << 16) | (221 << 8) | 60) >>> 0
    );
    // Untyped MT (no palette) is named untyped_1, not its raw trackId.
    expect(roi.name).toBe('untyped_1');
  });

  it('threads the MT thickness through to the zipped ROIs (stroke width survives deflate)', async () => {
    const out = await mkTmp();
    const frames: RoiFrameInput[] = [
      { id: 'c1', name: 'v.nd2', isVideoContainer: true, segmentation: null },
      {
        id: 'f0',
        name: 'v.nd2 (frame 1)',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([
            line('mt_1', [
              [1, 1],
              [2, 2],
            ]),
          ]),
        },
      },
    ];
    await exportImageJRoiSets(frames, out, 'proj', { strokeWidth: 8 });
    const zip = await fs.readFile(
      path.join(out, 'annotations', 'imagej', 'v_RoiSet.zip')
    );
    const roi = decodeRoi(zipExtract(zip, 'untyped_1__frame_0000.roi'));
    expect(roi.strokeWidth).toBe(8);
    expect(roi.floatStrokeWidth).toBeCloseTo(8, 5);
  });

  it('skips a corrupt-JSON frame with a warning while exporting valid frames', async () => {
    const out = await mkTmp();
    const frames: RoiFrameInput[] = [
      { id: 'c1', name: 'v.nd2', isVideoContainer: true, segmentation: null },
      {
        id: 'good',
        name: 'v.nd2 (frame 1)',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([
            line('1', [
              [1, 1],
              [2, 2],
            ]),
          ]),
        },
      },
      {
        id: 'bad',
        name: 'v.nd2 (frame 2)',
        parentVideoId: 'c1',
        frameIndex: 1,
        segmentation: { polygons: '{not valid json' },
      },
    ];
    const result = await exportImageJRoiSets(frames, out, 'proj');
    expect(result.rois).toBe(1);
    expect(result.warnings.some(w => /corrupt/i.test(w))).toBe(true);
  });

  it('returns a warning (not an error) when there is nothing to export', async () => {
    const out = await mkTmp();
    const result = await exportImageJRoiSets(
      [{ id: 'c1', name: 'v.nd2', isVideoContainer: true, segmentation: null }],
      out,
      'proj'
    );
    expect(result.rois).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/no microtubule polylines/i);
    // No zip written for an empty export.
    await expect(
      fs.readdir(path.join(out, 'annotations', 'imagej'))
    ).rejects.toThrow();
  });

  it('rejects when the job is cancelled mid-export', async () => {
    const out = await mkTmp();
    const frames: RoiFrameInput[] = [
      { id: 'c1', name: 'v.nd2', isVideoContainer: true, segmentation: null },
      {
        id: 'f0',
        name: 'v.nd2 (frame 1)',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([
            line('1', [
              [1, 1],
              [2, 2],
            ]),
          ]),
        },
      },
    ];
    await expect(
      exportImageJRoiSets(frames, out, 'proj', { shouldAbort: () => true })
    ).rejects.toThrow(/cancel/i);
  });
});
