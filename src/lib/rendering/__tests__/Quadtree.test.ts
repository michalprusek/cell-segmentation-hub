import { describe, expect, it } from 'vitest';
import { Quadtree } from '../Quadtree';

interface BrutePoint {
  x: number;
  y: number;
  item: number;
}

function bruteNearest(
  points: BrutePoint[],
  qx: number,
  qy: number,
  maxDistance: number
): { item: number; distance: number } | null {
  let bestDsq = maxDistance * maxDistance;
  let best: BrutePoint | null = null;
  for (const p of points) {
    const dx = p.x - qx;
    const dy = p.y - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDsq) {
      bestDsq = d2;
      best = p;
    }
  }
  return best ? { item: best.item, distance: Math.sqrt(bestDsq) } : null;
}

describe('Quadtree.findNearest', () => {
  it('returns null when no point is within maxDistance', () => {
    const tree = new Quadtree<number>({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    });
    tree.insert(10, 10, 0);
    expect(tree.findNearest(90, 90, 5)).toBeNull();
  });

  it('matches brute-force nearest for a large random point set', () => {
    const rng = mulberry32(42);
    const N = 2000;
    const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    const tree = new Quadtree<number>(bounds);
    const brute: BrutePoint[] = [];
    for (let i = 0; i < N; i++) {
      const x = rng() * 1000;
      const y = rng() * 1000;
      tree.insert(x, y, i);
      brute.push({ x, y, item: i });
    }

    for (let q = 0; q < 50; q++) {
      const qx = rng() * 1000;
      const qy = rng() * 1000;
      const maxDistance = 20 + rng() * 200;
      const quad = tree.findNearest(qx, qy, maxDistance);
      const ref = bruteNearest(brute, qx, qy, maxDistance);

      if (ref === null) {
        expect(quad).toBeNull();
      } else {
        expect(quad).not.toBeNull();
        // Distances must match to within floating tolerance.
        expect(quad!.distance).toBeCloseTo(ref.distance, 6);
      }
    }
  });

  it('handles collinear points without infinite recursion', () => {
    const tree = new Quadtree<number>({
      minX: 0,
      minY: -1,
      maxX: 100,
      maxY: 1,
    });
    for (let i = 0; i < 50; i++) {
      tree.insert(i, 0, i);
    }
    const res = tree.findNearest(25.3, 0, 5);
    expect(res).not.toBeNull();
    expect(res!.item).toBe(25);
  });

  it('returns nearest neighbour on a query exactly at the root midline', () => {
    // minX=0, maxX=100 -> root midX=50. Vertices straddle the midline;
    // the one on the "west" side is slightly closer. Guards against
    // the primary-quadrant-first descent failing to visit the sibling
    // when the query sits exactly on the boundary.
    const tree = new Quadtree<string>({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    });
    tree.insert(49.9, 50, 'west');
    tree.insert(50.5, 50, 'east');
    const res = tree.findNearest(50, 50, 10);
    expect(res).not.toBeNull();
    expect(res!.item).toBe('west');
  });

  it('rejects invalid bounds at construction time', () => {
    expect(
      () => new Quadtree<number>({ minX: 10, minY: 0, maxX: 0, maxY: 100 })
    ).toThrow(/invalid bounds/);
    expect(
      () =>
        new Quadtree<number>({
          minX: NaN,
          minY: 0,
          maxX: 10,
          maxY: 10,
        })
    ).toThrow(/invalid bounds/);
  });
});

// Deterministic RNG for reproducible tests.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
