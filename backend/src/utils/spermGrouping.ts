import type { SpermPartClass } from './polygonValidation';

export interface SpermPolylinePart {
  partClass?: SpermPartClass;
  instanceId?: string;
  points: { x: number; y: number }[];
}

export interface SpermInstanceGroup<P extends SpermPolylinePart> {
  instanceId: string;
  parts: P[];
}

export interface SpermGroupingResult<P extends SpermPolylinePart> {
  groups: SpermInstanceGroup<P>[];
  orphanCount: number;
}

/**
 * Groups polylines by `instanceId` for sperm-morphology aggregation.
 * Polylines without `instanceId` are counted as orphans (not grouped).
 * Pure function — caller decides whether/where to log the orphan count.
 */
export const groupPolylinesByInstanceId = <P extends SpermPolylinePart>(
  polylines: P[]
): SpermGroupingResult<P> => {
  const buckets = new Map<string, P[]>();
  let orphanCount = 0;
  for (const p of polylines) {
    if (!p.instanceId) {
      orphanCount += 1;
      continue;
    }
    const list = buckets.get(p.instanceId);
    if (list) {
      list.push(p);
    } else {
      buckets.set(p.instanceId, [p]);
    }
  }

  const groups: SpermInstanceGroup<P>[] = [];
  for (const [instanceId, parts] of buckets) {
    groups.push({ instanceId, parts });
  }

  return { groups, orphanCount };
};

/**
 * Locate the polyline for a given partClass within a group's parts.
 * Returns the first match (callers should ensure unique parts per group).
 */
export const findPart = <P extends SpermPolylinePart>(
  parts: P[],
  partClass: SpermPartClass
): P | undefined => parts.find(p => p.partClass === partClass);
