/**
 * imagejRoiEncoder.test.ts
 *
 * Behavioral tests for src/services/export/imagejRoiEncoder.ts.
 *
 *  encodeImageJRoi (pure binary encoder)
 *   - produces the ImageJ "Iout" magic + correct ROI type byte
 *   - sets the SUB_PIXEL_RESOLUTION option flag
 *   - round-trips sub-pixel float coordinates (absolute) exactly
 *   - round-trips the ROI name via UTF-16BE (incl. non-ASCII)
 *   - throws on < 2 points
 *
 *  exportImageJRois (per-frame writer, real temp-dir FS)
 *   - skips video container rows + frames without polygons
 *   - drops polylines with < 2 points / polygons with < 3 points
 *   - names files by trackId and keeps the SAME name across frames
 *   - suffixes colliding filenames within a frame (no overwrite)
 *   - falls back to a generated name for untracked polygons
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
  coords: Array<[number, number]>;
  name: string;
}

function decodeRoi(buf: Buffer): DecodedRoi {
  const magic = buf.toString('ascii', 0, 4);
  const type = buf.readUInt8(6);
  const n = buf.readUInt16BE(16);
  const options = buf.readUInt16BE(50);
  const subPixel = (options & 128) !== 0;

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

  return { magic, type, nCoords: n, subPixel, coords, name };
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

  it('throws when given fewer than 2 points', () => {
    expect(() => encodeImageJRoi([{ x: 1, y: 1 }], 'polyline')).toThrow();
    expect(() => encodeImageJRoi([], 'polygon')).toThrow();
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
});
