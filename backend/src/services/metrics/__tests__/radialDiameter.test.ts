/**
 * The microcapsule "Diameter" column. Every case here is a number someone
 * reads off a spreadsheet and compares against a ruler.
 */
import { describe, it, expect } from 'vitest';

import {
  polygonCentroid,
  radialDiameter,
  RADIAL_DIAMETER_SPOKES,
  type Point,
} from '../radialDiameter';

/** A regular n-gon, which approximates a circle from the inside. */
function circle(cx: number, cy: number, r: number, n = 256): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function ellipse(cx: number, cy: number, rx: number, ry: number, n = 256) {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
}

describe('radialDiameter', () => {
  it('returns the true diameter of a circle', () => {
    // The measure is exact on the shape microcapsules actually are.
    expect(radialDiameter(circle(0, 0, 50))).toBeCloseTo(100, 1);
    expect(radialDiameter(circle(730, -12.5, 7.25))).toBeCloseTo(14.5, 2);
  });

  it('measures six chords, 30 degrees apart', () => {
    expect(RADIAL_DIAMETER_SPOKES).toBe(6);
    expect(180 / RADIAL_DIAMETER_SPOKES).toBe(30);
  });

  it('is orientation-independent on a circle', () => {
    // Chords through a centre are symmetric, so the six spokes cover the full
    // 180 degrees of distinct orientations.
    const a = radialDiameter(circle(0, 0, 40));
    const rotated = circle(0, 0, 40).map(p => {
      const t = 0.4;
      return {
        x: p.x * Math.cos(t) - p.y * Math.sin(t),
        y: p.x * Math.sin(t) + p.y * Math.cos(t),
      };
    });
    expect(radialDiameter(rotated)).toBeCloseTo(a, 2);
  });

  it('lands between the axes of an ellipse, not on either', () => {
    // The old definition — the mean of the two Ferets — reports (2rx + 2ry)/2
    // exactly. The star samples the whole outline, so it sits strictly inside
    // the two axes and BELOW their mean, because a chord at 30 degrees off the
    // major axis is shorter than the arithmetic midpoint of the two.
    const rx = 60;
    const ry = 30;
    const d = radialDiameter(ellipse(0, 0, rx, ry));
    expect(d).toBeGreaterThan(2 * ry);
    expect(d).toBeLessThan(2 * rx);
    expect(d).toBeLessThan(rx + ry); // = the Feret mean
  });

  it('uses the AREA centroid, not the average of the vertices', () => {
    // A real segmentation outline has uneven vertex density — more points
    // where the boundary curves. Averaging the vertices then pulls the centre
    // toward the dense side, and every chord through an off-centre point of a
    // circle is SHORTER than its diameter, so the capsule reads too small.
    const dense: Point[] = [];
    for (let i = 0; i < 240; i++) {
      const a = (Math.PI * i) / 240; // upper half only: 240 points
      dense.push({ x: 50 * Math.cos(a), y: 50 * Math.sin(a) });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.PI + (Math.PI * i) / 12; // lower half: 12 points
      dense.push({ x: 50 * Math.cos(a), y: 50 * Math.sin(a) });
    }
    // The premise: the two candidate centres really do differ here.
    const vertexMean = dense.reduce(
      (acc, p) => ({ x: acc.x + p.x / dense.length, y: acc.y + p.y / dense.length }),
      { x: 0, y: 0 }
    );
    expect(Math.abs(vertexMean.y)).toBeGreaterThan(5);
    const areaCentroid = polygonCentroid(dense);
    expect(Math.abs(areaCentroid.y)).toBeLessThan(1);

    expect(radialDiameter(dense)).toBeCloseTo(100, 0);
  });

  it('measures both directions, not twice one side', () => {
    // Pinned by SYMMETRY rather than a hand-computed length: a half-disc and
    // its mirror image are the same shape, so they must measure the same. A
    // spoke reporting `2 * forward` instead of `forward + backward` would swap
    // which side counts under reflection and the two would disagree — on a
    // half-disc the centroid sits 4r/3pi from the flat edge, so the sides
    // differ by about a third of the radius.
    const right = circle(0, 0, 50, 256).filter(p => p.x >= 0);
    const left = right.map(p => ({ x: -p.x, y: p.y }));
    const dRight = radialDiameter(right);
    expect(dRight).toBeGreaterThan(0);
    expect(dRight).toBeCloseTo(radialDiameter(left), 6);
  });

  /** A thick C: outer wall at r=50, inner at r=30, open over `gapDeg`. Its area
   *  centroid falls in the MOUTH — outside the polygon — which is the only
   *  situation where "first crossing" and "last crossing" differ. */
  function cRing(gapDeg: number): Point[] {
    const from = gapDeg / 2;
    const to = 360 - gapDeg / 2;
    const out: Point[] = [];
    for (let deg = from; deg <= to; deg += 2) {
      const a = (deg * Math.PI) / 180;
      out.push({ x: 50 * Math.cos(a), y: 50 * Math.sin(a) });
    }
    for (let deg = to; deg >= from; deg -= 2) {
      const a = (deg * Math.PI) / 180;
      out.push({ x: 30 * Math.cos(a), y: 30 * Math.sin(a) });
    }
    return out;
  }

  it('spans the far wall of a shape whose centroid is outside it', () => {
    const c = cRing(40);
    const centre = polygonCentroid(c);
    // The premise: the centroid really is in the hole, not on the ring.
    expect(Math.hypot(centre.x, centre.y)).toBeLessThan(30);

    // A spoke crosses the inner wall (r=30) and then the outer (r=50). Taking
    // the FIRST crossing would measure the hole, ~60; the last measures the
    // capsule, ~100.
    expect(radialDiameter(c)).toBeGreaterThan(85);
  });

  it('drops a spoke that leaves through the mouth instead of halving it', () => {
    // With a wide enough mouth one direction finds no boundary at all.
    // Averaging that half-chord in would report the ring a quarter smaller.
    expect(radialDiameter(cRing(70))).toBeGreaterThan(90);
  });

  it('returns 0 for a shape that cannot have a chord', () => {
    // 0 rather than NaN: `capsuleDiameter` tests for it and falls back.
    expect(radialDiameter([])).toBe(0);
    expect(radialDiameter([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });

  it('scales linearly, so a µm conversion is a multiplication', () => {
    const px = radialDiameter(circle(0, 0, 25));
    const scaled = radialDiameter(circle(0, 0, 25).map(p => ({
      x: p.x * 0.32,
      y: p.y * 0.32,
    })));
    expect(scaled).toBeCloseTo(px * 0.32, 4);
  });
});

describe('polygonCentroid', () => {
  it('finds the centre of a circle', () => {
    const c = polygonCentroid(circle(17, -4, 9));
    expect(c.x).toBeCloseTo(17, 4);
    expect(c.y).toBeCloseTo(-4, 4);
  });

  it('falls back to the vertex mean on a zero-area ring', () => {
    // A degenerate outline would otherwise divide by zero and hand every
    // downstream chord a NaN origin.
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    const c = polygonCentroid(line);
    expect(c.x).toBeCloseTo(10, 6);
    expect(c.y).toBeCloseTo(0, 6);
  });
});
