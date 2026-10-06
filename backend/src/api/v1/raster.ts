import type { Point, V1Object } from './objects';
import { ringArea } from './objects';

/**
 * Rasterise objects into a label image: pixel value = the object's `label`,
 * 0 = background.
 *
 * THE REFERENCE IS OPENCV, because that is where the polygons come from. The
 * ML service traces them with `cv2.findContours`, whose vertices are PIXEL
 * CENTRES of boundary pixels that belong to the region. So this is not an
 * antialiased or pixel-centre-sampled fill: a pixel is inside when it lies in
 * the polygon's interior OR ON ITS OUTLINE, which is what `cv2.drawContours(
 * ..., thickness=FILLED)` paints and what reproduces the model's mask exactly.
 * A conventional half-open fill would erode every object by half a pixel all
 * round — about 2 % of the area of a 100 px spheroid.
 *
 * A HOLE is the mirror image. OpenCV traces a hole along the foreground
 * pixels that border it, so the hole's outline is foreground and only its
 * strict interior is cleared.
 *
 * Objects overlap for some models (a microcapsule's membrane encloses the
 * capsule; a disintegration core lies inside the spheroid). Larger objects
 * are painted first so that a smaller one inside is not hidden.
 *
 * A polyline has no interior: it is drawn one pixel wide.
 */
export function rasterizeLabels(
  objects: V1Object[],
  width: number,
  height: number
): Uint16Array {
  const labels = new Uint16Array(width * height);

  const order = objects
    .map(object => ({
      object,
      area: object.geometry === 'polygon' ? ringArea(object.points) : 0,
    }))
    // Largest first; polylines (area 0) last, so they stay visible on top.
    .sort((a, b) => b.area - a.area || a.object.label - b.object.label);

  for (const { object } of order) {
    const value = object.label & 0xffff;
    if (object.geometry === 'polyline') {
      drawPath(labels, width, height, object.points, value, false);
      continue;
    }
    fillInterior(labels, width, height, object.points, value);
    drawPath(labels, width, height, object.points, value, true);
    for (const hole of object.holes ?? []) {
      fillInterior(labels, width, height, hole, 0);
      // The hole's outline is foreground; restore whatever the strict-interior
      // fill may have touched along it.
      drawPath(labels, width, height, hole, value, true);
    }
  }
  return labels;
}

/**
 * Scanline fill of a ring's STRICT interior, at integer rows.
 *
 * There is no "inclusive" variant, on purpose. Every caller draws the ring's
 * outline as well, and a crossing that falls exactly on a pixel is a lattice
 * point of that edge, which Bresenham always visits — so whether this fill
 * includes its end pixels cannot change the result. (Both variants once
 * existed behind a flag; mutating either into the other left all 104 OpenCV
 * fixture contours reproducing their masks exactly.)
 */
function fillInterior(
  labels: Uint16Array,
  width: number,
  height: number,
  ring: Point[],
  value: number,
): void {
  const n = ring.length;
  if (n < 3) {
    return;
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of ring) {
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  const yStart = Math.max(0, Math.ceil(minY));
  const yEnd = Math.min(height - 1, Math.floor(maxY));
  const crossings: number[] = [];

  for (let y = yStart; y <= yEnd; y++) {
    crossings.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [x0, y0] = ring[j];
      const [x1, y1] = ring[i];
      // Half-open in y, so a vertex shared by two edges is counted once and a
      // horizontal edge not at all (the outline pass draws those).
      if (y0 <= y !== y1 <= y) {
        crossings.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.floor(crossings[k]) + 1);
      const to = Math.min(width - 1, Math.ceil(crossings[k + 1]) - 1);
      const row = y * width;
      for (let x = from; x <= to; x++) {
        labels[row + x] = value;
      }
    }
  }
}

/** Bresenham between consecutive vertices, optionally closing the path. */
function drawPath(
  labels: Uint16Array,
  width: number,
  height: number,
  points: Point[],
  value: number,
  closed: boolean
): void {
  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % n];
    let x = Math.round(ax);
    let y = Math.round(ay);
    const x1 = Math.round(bx);
    const y1 = Math.round(by);
    const dx = Math.abs(x1 - x);
    const dy = -Math.abs(y1 - y);
    const sx = x < x1 ? 1 : -1;
    const sy = y < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        labels[y * width + x] = value;
      }
      if (x === x1 && y === y1) {
        break;
      }
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
}
