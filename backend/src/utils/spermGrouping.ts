import type { SpermPartClass } from './polygonValidation';

export interface SpermPolylinePart {
  partClass?: SpermPartClass;
  instanceId?: string;
  points: { x: number; y: number }[];
}

// After grouping, every part has both fields by construction (orphans are
// excluded). Narrowing the result type removes false confidence at call sites.
export type GroupedPart<P extends SpermPolylinePart> = P & {
  instanceId: string;
};

export interface SpermInstanceGroup<P extends SpermPolylinePart> {
  instanceId: string;
  // Non-empty by construction: a bucket is created on first push.
  parts: readonly [GroupedPart<P>, ...GroupedPart<P>[]];
}

export interface SpermGroupingResult<P extends SpermPolylinePart> {
  groups: SpermInstanceGroup<P>[];
  orphanCount: number;
}

// Polylines missing instanceId are returned as `orphanCount`, not grouped.
export const groupPolylinesByInstanceId = <P extends SpermPolylinePart>(
  polylines: P[]
): SpermGroupingResult<P> => {
  const buckets = new Map<string, GroupedPart<P>[]>();
  let orphanCount = 0;
  for (const p of polylines) {
    if (!p.instanceId) {
      orphanCount += 1;
      continue;
    }
    const grouped = p as GroupedPart<P>;
    const list = buckets.get(p.instanceId);
    if (list) {
      list.push(grouped);
    } else {
      buckets.set(p.instanceId, [grouped]);
    }
  }

  const groups: SpermInstanceGroup<P>[] = [];
  for (const [instanceId, parts] of buckets) {
    groups.push({
      instanceId,
      parts: parts as [GroupedPart<P>, ...GroupedPart<P>[]],
    });
  }

  return { groups, orphanCount };
};

export const findPart = <P extends SpermPolylinePart>(
  parts: readonly P[],
  partClass: SpermPartClass
): P | undefined => parts.find(p => p.partClass === partClass);
