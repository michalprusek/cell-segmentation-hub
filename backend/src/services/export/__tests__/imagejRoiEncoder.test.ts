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
 *   - throws below the geometry minimum (polyline < 2 / polygon < 3)
 *
 *  exportImageJRois (per-frame writer, real temp-dir FS)
 *   - skips video container rows + frames without polygons
 *   - drops polylines with < 2 points / polygons with < 3 points
 *   - separates videos that share a frameIndex (multi-position ND2)
 *   - names files by trackId and keeps the SAME name across frames
 *   - suffixes colliding filenames within a frame (no overwrite), incl.
 *     distinct labels that sanitize to the same name
 *   - falls back to a generated name for untracked / empty-trackId polygons
 *   - skips corrupt-JSON frames with a warning; drops non-finite polygons
 *   - rejects when the job is cancelled
 *   - returns a warning (not an error) when nothing was exported
 *
 * The inline decoder mirrors ImageJ's RoiDecoder layout so the test needs no
 * external tool. It was cross-checked against Christoph Gohlke's reference
 * `roifile` Python package during development.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  encodeImageJRoi,
  exportImageJRois,
  type RoiFrameInput,
} from '../imagejRoiEncoder';

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
  const options = buf.readUInt16BE(50);
  const subPixel = (options & 128) !== 0;

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
  const nameOffset = buf.readInt32BE(header2Offset + 16);
  const nameLength = buf.readInt32BE(header2Offset + 20);
  let name = '';
  if (nameOffset > 0 && nameLength > 0) {
    for (let i = 0; i < nameLength; i++) {
      name += String.fromCharCode(buf.readUInt16BE(nameOffset + i * 2));
    }
  }

  return { magic, type, nCoords: n, subPixel, bbox, intCoords, coords, name };
}

const ROI_TYPE_POLYGON = 0;
const ROI_TYPE_POLYLINE = 5;

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
// exportImageJRois (real temp-dir filesystem)
// ---------------------------------------------------------------------------

describe('exportImageJRois', () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(
      tmpDirs.map(d => fs.rm(d, { recursive: true, force: true }))
    );
  });

  async function mkTmp(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roi-test-'));
    tmpDirs.push(dir);
    return dir;
  }

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

  it('writes loose per-frame files named by trackId, skipping containers and empty frames', async () => {
    const out = await mkTmp();
    // Real MT frame names look like "<original>.nd2 (frame N)" — path.parse
    // would mangle them, so folders must key on (container, frameIndex).
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
            line('bad', [[5, 5]]), // < 2 points → dropped
          ]),
        },
      },
      {
        id: 'f1',
        name: 'sample_60x.nd2 (frame 2)',
        parentVideoId: 'c1',
        frameIndex: 1,
        segmentation: { polygons: JSON.stringify([]) }, // no folder
      },
    ];

    const result = await exportImageJRois(frames, out, 'proj');
    expect(result).toEqual({ frames: 1, rois: 2, warnings: [] });

    const base = path.join(out, 'annotations', 'imagej');
    // Grouped under the clean container name, then numeric frame index.
    expect(await fs.readdir(base)).toEqual(['sample_60x']);
    expect(await fs.readdir(path.join(base, 'sample_60x'))).toEqual([
      'frame_0000',
    ]); // empty frame 1 produced no folder
    const frame0 = await fs.readdir(
      path.join(base, 'sample_60x', 'frame_0000')
    );
    expect(frame0.sort()).toEqual(['1.roi', '2.roi']);
  });

  it('separates frames from different videos that share a frameIndex (multi-position ND2)', async () => {
    const out = await mkTmp();
    const frames: RoiFrameInput[] = [
      { id: 'cA', name: 'D03_0000.nd2', isVideoContainer: true, segmentation: null },
      { id: 'cB', name: 'D05_0000.nd2', isVideoContainer: true, segmentation: null },
      {
        id: 'a0',
        name: 'D03_0000.nd2 (frame 1)',
        parentVideoId: 'cA',
        frameIndex: 0,
        segmentation: {
          polygons: JSON.stringify([line('1', [[1, 1], [2, 2]])]),
        },
      },
      {
        id: 'b0',
        name: 'D05_0000.nd2 (frame 1)',
        parentVideoId: 'cB',
        frameIndex: 0, // SAME frameIndex as a0, different video
        segmentation: {
          polygons: JSON.stringify([line('1', [[3, 3], [4, 4]])]),
        },
      },
    ];

    const result = await exportImageJRois(frames, out, 'proj');
    expect(result.rois).toBe(2);

    const base = path.join(out, 'annotations', 'imagej');
    expect((await fs.readdir(base)).sort()).toEqual(['D03_0000', 'D05_0000']);
    expect(await fs.readdir(path.join(base, 'D03_0000', 'frame_0000'))).toEqual([
      '1.roi',
    ]);
    expect(await fs.readdir(path.join(base, 'D05_0000', 'frame_0000'))).toEqual([
      '1.roi',
    ]);
  });

  it('keeps the same trackId name across frames and suffixes collisions', async () => {
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
            line('7', [
              [10, 10],
              [20, 25],
            ]),
          ]),
        },
      },
      {
        id: 'f1',
        name: 'v.nd2 (frame 2)',
        parentVideoId: 'c1',
        frameIndex: 1,
        segmentation: {
          polygons: JSON.stringify([
            line('7', [
              [12, 12],
              [22, 27],
            ]),
            line('7', [
              [99, 99],
              [88, 88],
            ]), // duplicate trackId in the same frame
            line(null, [
              [1, 1],
              [2, 2],
              [3, 3],
            ], 'polygon'), // untracked → generated fallback name
          ]),
        },
      },
    ];

    const result = await exportImageJRois(frames, out, 'proj');
    expect(result.rois).toBe(4);

    const base = path.join(out, 'annotations', 'imagej', 'v');
    // trackId 7 present in both frames under the identical filename
    const f0 = await fs.readdir(path.join(base, 'frame_0000'));
    expect(f0).toEqual(['7.roi']);
    const f1 = (await fs.readdir(path.join(base, 'frame_0001'))).sort();
    expect(f1).toContain('7.roi');
    expect(f1).toContain('7_2.roi'); // collision-suffixed, no overwrite
    expect(f1.some(n => n.startsWith('roi_'))).toBe(true); // untracked fallback

    // internal ROI name is stable across frames
    const roiF0 = decodeRoi(
      await fs.readFile(path.join(base, 'frame_0000', '7.roi'))
    );
    const roiF1 = decodeRoi(
      await fs.readFile(path.join(base, 'frame_0001', '7.roi'))
    );
    expect(roiF0.name).toBe('7');
    expect(roiF1.name).toBe('7');
  });

  it('returns a warning (not an error) when there is nothing to export', async () => {
    const out = await mkTmp();
    const result = await exportImageJRois(
      [{ id: 'c1', name: 'v.nd2', isVideoContainer: true, segmentation: null }],
      out,
      'proj'
    );
    expect(result.rois).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/no microtubule polylines/i);
  });

  it('falls through empty-string trackId to a generated name (no identity collapse)', async () => {
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
            line('', [[10, 10], [20, 25]]), // empty trackId
            line('', [[30, 30], [40, 45]]), // empty trackId again
          ]),
        },
      },
    ];
    const result = await exportImageJRois(frames, out, 'proj');
    expect(result.rois).toBe(2);
    const dir = path.join(out, 'annotations', 'imagej', 'v', 'frame_0000');
    const files = (await fs.readdir(dir)).sort();
    // Distinct generated names, NOT a collapsed "export.roi"/"export_2.roi".
    expect(files).toEqual(['roi_0001.roi', 'roi_0002.roi']);
    const names = await Promise.all(
      files.map(async f => decodeRoi(await fs.readFile(path.join(dir, f))).name)
    );
    expect(new Set(names).size).toBe(2); // distinct internal names
  });

  it('suffixes distinct labels that sanitize to the same filename (no overwrite)', async () => {
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
            line('a/b', [[10, 10], [20, 25]]), // sanitizes to a_b
            line('a:b', [[30, 30], [40, 45]]), // also sanitizes to a_b
          ]),
        },
      },
    ];
    const result = await exportImageJRois(frames, out, 'proj');
    expect(result.rois).toBe(2); // both written, neither overwritten
    const dir = path.join(out, 'annotations', 'imagej', 'v', 'frame_0000');
    const files = (await fs.readdir(dir)).sort();
    expect(files).toEqual(['a_b.roi', 'a_b_2.roi']);
  });

  it('skips a corrupt-JSON frame with a user-facing warning while exporting valid frames', async () => {
    const out = await mkTmp();
    const frames: RoiFrameInput[] = [
      { id: 'c1', name: 'v.nd2', isVideoContainer: true, segmentation: null },
      {
        id: 'good',
        name: 'v.nd2 (frame 1)',
        parentVideoId: 'c1',
        frameIndex: 0,
        segmentation: { polygons: JSON.stringify([line('1', [[1, 1], [2, 2]])]) },
      },
      {
        id: 'bad',
        name: 'v.nd2 (frame 2)',
        parentVideoId: 'c1',
        frameIndex: 1,
        segmentation: { polygons: '{not valid json' },
      },
    ];
    const result = await exportImageJRois(frames, out, 'proj');
    expect(result.rois).toBe(1); // valid frame still exported
    expect(result.warnings.some(w => /corrupt/i.test(w))).toBe(true);
    const base = path.join(out, 'annotations', 'imagej', 'v');
    expect(await fs.readdir(base)).toEqual(['frame_0000']); // no folder for bad
  });

  it('drops polygons with non-finite coordinates instead of emitting NaN ROIs', async () => {
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
            line('ok', [[1, 1], [2, 2]]),
            line('nan', [[Number.NaN, 5], [1, 2]]), // dropped
          ]),
        },
      },
    ];
    const result = await exportImageJRois(frames, out, 'proj');
    expect(result.rois).toBe(1);
    const dir = path.join(out, 'annotations', 'imagej', 'v', 'frame_0000');
    expect(await fs.readdir(dir)).toEqual(['ok.roi']);
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
        segmentation: { polygons: JSON.stringify([line('1', [[1, 1], [2, 2]])]) },
      },
    ];
    await expect(
      exportImageJRois(frames, out, 'proj', { shouldAbort: () => true })
    ).rejects.toThrow(/cancel/i);
  });
});
