/**
 * Point quadtree for 2D nearest-neighbor queries.
 *
 * Used by the segmentation editor's vertex hit test to avoid the O(n)
 * sweep over every vertex in a 4000-point polygon on every mousemove.
 * Build is O(n log n); `findNearest(x, y, maxDistance)` is O(log n)
 * amortized with best-first recursion that prunes subtrees whose
 * min-distance to the query exceeds the current best.
 *
 * Small and dependency-free on purpose: the API covers only what the
 * editor needs (point insertion + radius-bounded nearest query).
 */

export interface QuadtreeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface NearestResult<T> {
  item: T;
  x: number;
  y: number;
  distance: number;
}

interface QuadtreeEntry<T> {
  x: number;
  y: number;
  item: T;
}

const MAX_DEPTH = 12;
const POINTS_PER_LEAF = 8;

class QuadtreeNode<T> {
  bounds: QuadtreeBounds;
  depth: number;
  points: QuadtreeEntry<T>[] = [];
  children: QuadtreeNode<T>[] | null = null;

  constructor(bounds: QuadtreeBounds, depth: number) {
    this.bounds = bounds;
    this.depth = depth;
  }

  insert(entry: QuadtreeEntry<T>): void {
    if (this.children) {
      this.childForPoint(entry.x, entry.y).insert(entry);
      return;
    }
    this.points.push(entry);
    if (this.points.length > POINTS_PER_LEAF && this.depth < MAX_DEPTH) {
      this.subdivide();
    }
  }

  private subdivide(): void {
    const { minX, minY, maxX, maxY } = this.bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const d = this.depth + 1;
    this.children = [
      new QuadtreeNode<T>({ minX, minY, maxX: midX, maxY: midY }, d), // NW
      new QuadtreeNode<T>({ minX: midX, minY, maxX, maxY: midY }, d), // NE
      new QuadtreeNode<T>({ minX, minY: midY, maxX: midX, maxY }, d), // SW
      new QuadtreeNode<T>({ minX: midX, minY: midY, maxX, maxY }, d), // SE
    ];
    for (const p of this.points) {
      this.childForPoint(p.x, p.y).insert(p);
    }
    this.points = [];
  }

  private childForPoint(x: number, y: number): QuadtreeNode<T> {
    const { minX, minY, maxX, maxY } = this.bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const east = x >= midX;
    const south = y >= midY;
    // NW=0, NE=1, SW=2, SE=3
    return this.children![(east ? 1 : 0) + (south ? 2 : 0)];
  }
}

/** Squared distance from point (x,y) to an AABB. 0 if point is inside. */
function distanceSqToBounds(x: number, y: number, b: QuadtreeBounds): number {
  const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
  const dy = y < b.minY ? b.minY - y : y > b.maxY ? y - b.maxY : 0;
  return dx * dx + dy * dy;
}

export class Quadtree<T> {
  private root: QuadtreeNode<T>;

  constructor(bounds: QuadtreeBounds) {
    this.root = new QuadtreeNode<T>(bounds, 0);
  }

  insert(x: number, y: number, item: T): void {
    this.root.insert({ x, y, item });
  }

  /**
   * Returns the nearest stored point within `maxDistance` of (qx, qy),
   * or null if none exists. Uses best-first recursion with subtree
   * pruning — each subtree is entered only when its min-distance to
   * the query is smaller than the current best.
   */
  findNearest(
    qx: number,
    qy: number,
    maxDistance: number
  ): NearestResult<T> | null {
    let bestDistSq = maxDistance * maxDistance;
    let bestEntry: QuadtreeEntry<T> | null = null;

    const visit = (node: QuadtreeNode<T>): void => {
      if (distanceSqToBounds(qx, qy, node.bounds) > bestDistSq) return;

      if (!node.children) {
        for (const p of node.points) {
          const dx = p.x - qx;
          const dy = p.y - qy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestEntry = p;
          }
        }
        return;
      }

      // Enter the child containing the query first — its points are
      // the best prune candidates.
      const { minX, minY, maxX, maxY } = node.bounds;
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;
      const east = qx >= midX ? 1 : 0;
      const south = qy >= midY ? 2 : 0;
      const primary = east + south;
      visit(node.children[primary]);
      for (let i = 0; i < 4; i++) {
        if (i !== primary) visit(node.children[i]);
      }
    };

    visit(this.root);

    if (!bestEntry) return null;
    const entry = bestEntry as QuadtreeEntry<T>;
    return {
      item: entry.item,
      x: entry.x,
      y: entry.y,
      distance: Math.sqrt(bestDistSq),
    };
  }
}
