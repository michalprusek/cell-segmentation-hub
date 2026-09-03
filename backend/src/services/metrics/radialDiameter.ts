/**
 * The microcapsule "Diameter": the mean of six chords through the centroid,
 * 30 degrees apart — a six-spoke star.
 *
 * WHY NOT THE PREVIOUS DEFINITION. It used to be `(FeretMax + FeretMin) / 2`.
 * Both Ferets are properties of the CONVEX HULL and both are extremes, so the
 * average of them is decided by the two most extreme directions of the shape
 * and by nothing in between: a capsule with one bulge reads larger everywhere,
 * and a dent between the two extremes is invisible. Six evenly spaced chords
 * through the centroid sample the whole outline instead, which is what someone
 * measuring a round capsule under a microscope with a ruler is approximating.
 *
 * WHY SIX. Chords through a centre are symmetric — the chord at 200 degrees is
 * the chord at 20 — so orientations only span 180 degrees, and six of them land
 * exactly 30 degrees apart. On a perfect circle every chord equals the
 * diameter, so the measure is exact there and degrades gracefully with
 * ovality: on an ellipse of aspect ratio r it returns the mean chord rather
 * than either axis.
 *
 * WHAT IT IS NOT. It is not rotation-invariant the way a Feret is: rotating the
 * capsule by 15 degrees samples different points of the outline and can move
 * the result by a little. On the real production capsules that spread is small
 * (they are near-circular by construction) and it is the price of measuring
 * the whole outline rather than its two extremes.
 */

export interface Point {
  x: number;
  y: number;
}

/** Spokes through the centroid. Six is 30 degrees apart over the 180 degrees
 *  of distinct chord orientations. */
export const RADIAL_DIAMETER_SPOKES = 6;

/** Area centroid of a simple polygon, falling back to the vertex mean for a
 *  degenerate (zero-area) ring so the caller always gets a point inside-ish. */
export function polygonCentroid(points: readonly Point[]): Point {
  const n = points.length;
  if (n === 0) {
    return { x: 0, y: 0 };
  }
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    const sum = points.reduce(
      (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
      { x: 0, y: 0 }
    );
    return { x: sum.x / n, y: sum.y / n };
  }
  return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
}

/**
 * Distance from `origin` to the FARTHEST boundary crossing along `(dx, dy)`.
 *
 * Farthest, not nearest, so a ragged or self-shadowing outline is measured at
 * its outer edge — the same thing an eye following the capsule's rim would do.
 * Returns 0 when the ray misses the outline entirely, which can only happen if
 * the centroid fell outside a strongly non-convex polygon.
 */
export function farthestCrossing(
  points: readonly Point[],
  origin: Point,
  dx: number,
  dy: number
): number {
  let best = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    // Solve origin + t*(dx,dy) = a + u*(ex,ey) for t >= 0 and u in [0, 1].
    const denom = dx * ey - dy * ex;
    // Parallel: a collinear edge is covered by its neighbours' endpoints.
    if (Math.abs(denom) < 1e-12) {
      continue;
    }
    const rx = a.x - origin.x;
    const ry = a.y - origin.y;
    const t = (rx * ey - ry * ex) / denom;
    const u = (rx * dy - ry * dx) / denom;
    if (t >= 0 && u >= 0 && u <= 1 && t > best) {
      best = t;
    }
  }
  return best;
}

/**
 * Mean chord length through the centroid over `RADIAL_DIAMETER_SPOKES`
 * orientations, in the units of the input points.
 *
 * Each spoke contributes ONE chord — the two opposite rays summed — so a
 * centroid that is off-centre in an irregular capsule still measures the full
 * width rather than twice one side. Returns 0 for a polygon with fewer than
 * three points, which cannot have a chord.
 */
export function radialDiameter(points: readonly Point[]): number {
  if (points.length < 3) {
    return 0;
  }
  const centre = polygonCentroid(points);
  let total = 0;
  let counted = 0;
  for (let k = 0; k < RADIAL_DIAMETER_SPOKES; k++) {
    const angle = (Math.PI * k) / RADIAL_DIAMETER_SPOKES;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const forward = farthestCrossing(points, centre, dx, dy);
    const backward = farthestCrossing(points, centre, -dx, -dy);
    const chord = forward + backward;
    // A spoke that finds no boundary on one side is dropped rather than
    // averaged in as a half-chord, which would drag the mean down on exactly
    // the malformed outlines where the number matters least.
    if (forward > 0 && backward > 0) {
      total += chord;
      counted++;
    }
  }
  return counted > 0 ? total / counted : 0;
}


/**
 * Mean radial gap between a microcapsule's wall and the membrane inside it —
 * the average width of the annulus, in the units of the input points.
 *
 * Measured on the SAME six-spoke star as {@link radialDiameter}, from the
 * capsule's area centroid, so the two numbers describe the same geometry and a
 * reader can put them side by side. Each spoke contributes two rays (forward
 * and backward), giving twelve samples of the gap around the capsule.
 *
 * Per ray the gap is `outer crossing − membrane crossing`. Both use
 * {@link farthestCrossing}, so a ragged outline is read at its outer edge on
 * both boundaries and the difference stays a like-for-like radial distance.
 *
 * ONE centroid, the capsule's, for both boundaries. The membrane is not
 * concentric with the wall — the upstream method says so explicitly, and it is
 * why that method aligns everything to a per-angle guide — so measuring each
 * from its own centre would compare radii taken along different lines and
 * report a gap that exists nowhere on the image.
 *
 * A ray is dropped when it finds no membrane crossing (the membrane does not
 * span that direction) or when the membrane lies outside the wall along it,
 * which means the two outlines are not nested and no annulus is defined there.
 * Returns null when no ray survives — "not measurable" rather than a zero that
 * would average into a dataset as a real, very thin annulus.
 */
export function annulusWidth(
  capsulePoints: readonly Point[],
  membranePoints: readonly Point[]
): number | null {
  if (capsulePoints.length < 3 || membranePoints.length < 3) {
    return null;
  }
  const centre = polygonCentroid(capsulePoints);
  let total = 0;
  let counted = 0;
  for (let k = 0; k < RADIAL_DIAMETER_SPOKES; k++) {
    const angle = (Math.PI * k) / RADIAL_DIAMETER_SPOKES;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    // Both directions of the spoke are separate samples of the gap: on an
    // off-centre membrane the two sides genuinely differ, and averaging them
    // is the point.
    for (const [ux, uy] of [
      [dx, dy],
      [-dx, -dy],
    ]) {
      const outer = farthestCrossing(capsulePoints, centre, ux, uy);
      const inner = farthestCrossing(membranePoints, centre, ux, uy);
      if (outer > 0 && inner > 0 && outer > inner) {
        total += outer - inner;
        counted++;
      }
    }
  }
  return counted > 0 ? total / counted : null;
}
