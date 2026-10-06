/**
 * The label rasteriser against OpenCV.
 *
 * `fixtures/contours_*.json` hold masks and the contours `cv2.findContours`
 * traced from them with the ML service's own call and typing (see
 * `generate_contour_fixtures.py`). The claim under test is the round trip:
 * mask -> OpenCV contours -> `buildObjects` -> `rasterizeLabels` gives the
 * mask back, pixel for pixel. Nothing here was drawn by the code under test.
 */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { buildObjects, type MlItem, type V1Object } from '../objects';
import { rasterizeLabels } from '../raster';

interface Fixture {
  name: string;
  width: number;
  height: number;
  max_depth: number;
  polygons: MlItem[];
  mask_bits: string;
}

const DIR = path.join(__dirname, 'fixtures');
const fixtures: Fixture[] = readdirSync(DIR)
  .filter(f => /^contours_.*\.json$/.test(f))
  .sort()
  .map(f => JSON.parse(readFileSync(path.join(DIR, f), 'utf8')));

const unpack = (f: Fixture): Uint8Array => {
  const packed = Buffer.from(f.mask_bits, 'base64');
  const mask = new Uint8Array(f.width * f.height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = (packed[i >> 3] >> (7 - (i & 7))) & 1;
  }
  return mask;
};

/**
 * `buildObjects` drops rings of fewer than three points, as the app does. In
 * a mask those are single pixels and straight runs of pixels (OpenCV's
 * CHAIN_APPROX_SIMPLE keeps only a run's two ends), so remove exactly those
 * from the expectation: every pixel on the segment between the vertices.
 */
const withoutDegenerate = (f: Fixture, mask: Uint8Array): Uint8Array => {
  const out = mask.slice();
  for (const item of f.polygons) {
    const points = item.points ?? [];
    if (points.length < 3 && item.type !== 'internal') {
      const a = points[0];
      const b = points[points.length - 1];
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (let k = 0; k <= steps; k++) {
        const t = steps === 0 ? 0 : k / steps;
        const x = Math.round(a.x + (b.x - a.x) * t);
        const y = Math.round(a.y + (b.y - a.y) * t);
        out[y * f.width + x] = 0;
      }
    }
  }
  return out;
};

describe('fixtures', () => {
  it('cover holes, islands in holes, border contact and specks', () => {
    expect(fixtures.map(f => f.name)).toEqual([
      'blobs',
      'edges',
      'lace',
      'nested',
      'specks',
    ]);
    expect(Math.max(...fixtures.map(f => f.max_depth))).toBe(4);
    expect(fixtures.reduce((n, f) => n + f.polygons.length, 0)).toBe(104);
  });
});

describe.each(fixtures)('$name', fixture => {
  const expected = withoutDegenerate(fixture, unpack(fixture));
  const { objects } = buildObjects('hrnet', fixture.polygons, []);
  const labels = rasterizeLabels(objects, fixture.width, fixture.height);

  it('reproduces the OpenCV mask exactly', () => {
    let foreground = 0;
    const wrong: string[] = [];
    for (let i = 0; i < expected.length; i++) {
      foreground += expected[i];
      if ((labels[i] > 0 ? 1 : 0) !== expected[i]) {
        wrong.push(`(${i % fixture.width},${Math.floor(i / fixture.width)})`);
      }
    }
    expect(foreground).toBeGreaterThan(1000);
    expect(wrong).toEqual([]);
  });

  it('gives every object its own label and uses no other value', () => {
    const present = new Set(labels);
    present.delete(0);
    expect([...present].sort((a, b) => a - b)).toEqual(
      objects.map(o => o.label)
    );
  });

  it('labels each object where its own outline is', () => {
    for (const object of objects) {
      const [x, y] = object.points[0];
      expect(labels[y * fixture.width + x]).toBe(object.label);
    }
  });
});

describe('overlap and polylines', () => {
  const square = (label: number, a: number, b: number): V1Object => ({
    label,
    geometry: 'polygon',
    class: 'x',
    points: [
      [a, a],
      [b, a],
      [b, b],
      [a, b],
    ],
  });

  it('paints a smaller object over the larger one that contains it, in either list order', () => {
    for (const objects of [
      [square(1, 2, 17), square(2, 6, 10)],
      [square(1, 6, 10), square(2, 2, 17)],
    ]) {
      const labels = rasterizeLabels(objects, 20, 20);
      const inner = objects.find(o => o.points[0][0] === 6) as V1Object;
      const outer = objects.find(o => o.points[0][0] === 2) as V1Object;
      expect(labels[8 * 20 + 8]).toBe(inner.label);
      expect(labels[3 * 20 + 3]).toBe(outer.label);
      expect(labels[0]).toBe(0);
    }
  });

  it('includes the outline: a 4-vertex square from 2 to 5 covers 16 pixels', () => {
    const labels = rasterizeLabels([square(1, 2, 5)], 8, 8);
    expect(labels.reduce((n, v) => n + (v ? 1 : 0), 0)).toBe(16);
  });

  it('draws a polyline one pixel wide, on top of a polygon, and clips it to the frame', () => {
    const line: V1Object = {
      label: 2,
      geometry: 'polyline',
      class: 'x',
      points: [
        [-3, 4.4],
        [30, 4.4],
      ],
    };
    const labels = rasterizeLabels([square(1, 1, 8), line], 10, 10);
    for (let x = 0; x < 10; x++) {
      expect(labels[4 * 10 + x]).toBe(2);
    }
    expect(labels[3 * 10 + 4]).toBe(1);
    expect(labels[5 * 10 + 4]).toBe(1);
    expect(labels.filter(v => v === 2)).toHaveLength(10);
  });

  it('does not close an open polyline', () => {
    const labels = rasterizeLabels(
      [
        {
          label: 1,
          geometry: 'polyline',
          class: 'x',
          points: [
            [1, 1],
            [8, 1],
            [8, 8],
          ],
        },
      ],
      10,
      10
    );
    expect(labels[1 * 10 + 5]).toBe(1);
    expect(labels[5 * 10 + 8]).toBe(1);
    // The diagonal back to the start would pass through (4, 4)/(5, 5).
    expect(labels[4 * 10 + 4]).toBe(0);
    expect(labels[5 * 10 + 5]).toBe(0);
  });
});
