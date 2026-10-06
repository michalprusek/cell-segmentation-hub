import type { KnownModelId } from '../../constants/modelRegistry';
import { V1_MODELS } from './models';

/**
 * The public shape of a segmentation result.
 *
 * The ML service returns a FLAT list in which a hole is a sibling of the
 * polygon it belongs to, linked by `parent_id`, and typed `internal` — as is
 * an island inside that hole. That is faithful to OpenCV's contour hierarchy
 * and awkward for everything downstream: a consumer has to rebuild the tree
 * before it can compute an area or draw a mask.
 *
 * Here every object owns its holes, an island is an object of its own, and a
 * point is an `[x, y]` pair in pixels of the image as uploaded. `label` is
 * the object's 1-based position in the list AND its pixel value in the mask
 * outputs, so the two representations can be joined.
 */
export type Point = [number, number];

export interface V1Object {
  label: number;
  geometry: 'polygon' | 'polyline';
  class: string;
  /** Sperm only: which part of the cell this centerline is. */
  part?: string;
  /** Objects that are parts of one thing share an instance (sperm). */
  instance?: string;
  confidence?: number;
  /** Microcapsule: false when the capsule is cut by the image border. */
  complete?: boolean;
  points: Point[];
  /** Polygons only, and only when there are any. */
  holes?: Point[][];
}

export interface V1Warning {
  code: string;
  detail: string;
}

/** One item of the ML service's `polygons` / `polylines` arrays. */
export interface MlItem {
  id?: string;
  points?: Array<{ x: number; y: number }>;
  type?: string;
  parent_id?: string;
  class?: string;
  partClass?: string;
  instanceId?: string;
  confidence?: number;
  complete?: boolean;
  geometry?: string;
}

const toPoints = (item: MlItem): Point[] | null => {
  const points: Point[] = [];
  for (const p of item.points ?? []) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) {
      return null;
    }
    points.push([p.x, p.y]);
  }
  return points;
};

/** Even-odd test; a point exactly on an edge may land on either side. */
export function pointInRing(point: Point, ring: Point[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function ringArea(ring: Point[]): number {
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(twice) / 2;
}

/**
 * Turn the ML service's flat lists into objects that own their holes.
 *
 * Nesting comes from `parent_id` where the chain is intact: an item at even
 * depth is an object, at odd depth a hole in its parent. Where a hole's
 * parent is missing — the ML service drops contours under its minimum area,
 * and with them the link — the hole is given to the smallest object that
 * contains it, and dropped with a warning if none does.
 */
export function buildObjects(
  model: KnownModelId,
  polygons: MlItem[],
  polylines: MlItem[]
): { objects: V1Object[]; warnings: V1Warning[] } {
  const meta = V1_MODELS[model];
  const warnings: V1Warning[] = [];
  let invalid = 0;

  const classOf = (item: MlItem): string => {
    // A region class carried in `partClass` (disintegration's `core`,
    // neurite/soma) is the object's class; sperm's parts are not.
    if (item.partClass && meta.classes.includes(item.partClass)) {
      return item.partClass;
    }
    return item.class && meta.classes.includes(item.class)
      ? item.class
      : meta.classes[0];
  };

  const describe = (item: MlItem, points: Point[]): Omit<V1Object, 'label'> => {
    const isPolyline = item.geometry === 'polyline';
    const object: Omit<V1Object, 'label'> = {
      geometry: isPolyline ? 'polyline' : 'polygon',
      class: classOf(item),
      points,
    };
    if (item.partClass && meta.parts?.includes(item.partClass)) {
      object.part = item.partClass;
    }
    // Only where an instance GROUPS objects. The microtubule model mints a
    // random id per call; passing it on would suggest a stability it lacks.
    if (item.instanceId && meta.parts) {
      object.instance = item.instanceId;
    }
    if (typeof item.confidence === 'number' && Number.isFinite(item.confidence)) {
      object.confidence = item.confidence;
    }
    if (typeof item.complete === 'boolean') {
      object.complete = item.complete;
    }
    return object;
  };

  // --- closed polygons: resolve the hierarchy -----------------------------
  interface Node {
    item: MlItem;
    points: Point[];
    depth: number | null;
  }
  const nodes: Node[] = [];
  const byId = new Map<string, Node>();
  for (const item of polygons) {
    const points = toPoints(item);
    if (!points || points.length < 3) {
      invalid++;
      continue;
    }
    const node: Node = { item, points, depth: null };
    nodes.push(node);
    if (item.id) {
      byId.set(item.id, node);
    }
  }

  const depthOf = (node: Node, seen: Set<Node>): number | null => {
    if (node.depth !== null) {
      return node.depth;
    }
    if (node.item.type !== 'internal') {
      return (node.depth = 0);
    }
    const parent = node.item.parent_id ? byId.get(node.item.parent_id) : undefined;
    if (!parent || seen.has(parent)) {
      return null; // an orphan, or a cycle: placed by containment below
    }
    seen.add(node);
    const parentDepth = depthOf(parent, seen);
    return parentDepth === null ? null : (node.depth = parentDepth + 1);
  };

  const holesOf = new Map<Node, Point[][]>();
  const orphans: Node[] = [];
  const objectNodes: Node[] = [];
  for (const node of nodes) {
    const depth = depthOf(node, new Set());
    if (depth === null) {
      orphans.push(node);
    } else if (depth % 2 === 0) {
      objectNodes.push(node);
    } else {
      const parent = byId.get(node.item.parent_id as string) as Node;
      holesOf.set(parent, [...(holesOf.get(parent) ?? []), node.points]);
    }
  }

  let droppedHoles = 0;
  for (const orphan of orphans) {
    let best: Node | null = null;
    let bestArea = Infinity;
    for (const candidate of objectNodes) {
      if (!pointInRing(orphan.points[0], candidate.points)) {
        continue;
      }
      const area = ringArea(candidate.points);
      if (area < bestArea) {
        best = candidate;
        bestArea = area;
      }
    }
    if (best) {
      holesOf.set(best, [...(holesOf.get(best) ?? []), orphan.points]);
    } else {
      droppedHoles++;
    }
  }

  const objects: V1Object[] = [];
  for (const node of objectNodes) {
    const holes = holesOf.get(node);
    objects.push({
      label: objects.length + 1,
      ...describe(node.item, node.points),
      ...(holes ? { holes } : {}),
    });
  }

  // --- open polylines ------------------------------------------------------
  for (const item of polylines) {
    const points = toPoints(item);
    if (!points || points.length < 2) {
      invalid++;
      continue;
    }
    objects.push({
      label: objects.length + 1,
      ...describe({ ...item, geometry: 'polyline' }, points),
    });
  }

  if (invalid > 0) {
    warnings.push({
      code: 'invalid_geometry_dropped',
      detail: `${invalid} object(s) with too few or non-finite points were dropped.`,
    });
  }
  if (droppedHoles > 0) {
    warnings.push({
      code: 'orphan_holes_dropped',
      detail: `${droppedHoles} hole(s) could not be attached to any object and were dropped.`,
    });
  }
  return { objects, warnings };
}
