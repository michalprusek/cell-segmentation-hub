import type { SegmenterClass } from '@/lib/segmenterApi';

/** Neutral gray shown for polygons with no `classId` (or a `classId` whose
 *  class was since deleted) — generic analogue of the microtubule editor's
 *  `NEUTRAL_COLOR` untyped fallback. */
export const UNCLASSIFIED_COLOR = '#9ca3af';

/** Resolve a polygon's stroke/fill colour from its `classId` against the
 *  dataset's class palette (the SSOT — `useSegmenterClasses`). Generalises
 *  `resolveMtColor` from the microtubule editor for an arbitrary,
 *  user-defined class registry instead of a fixed type-label set. */
export function resolveClassColor(
  classId: string | null | undefined,
  classes: SegmenterClass[]
): string {
  if (!classId) return UNCLASSIFIED_COLOR;
  return classes.find(c => c.id === classId)?.color ?? UNCLASSIFIED_COLOR;
}

/** Minimal shape of `useLanguage()`'s `t` needed here — kept local (rather
 *  than importing `useLanguage`'s hook type) since this is a plain utility
 *  function, not a hook: it can't call `useLanguage()` itself (would break
 *  the rules of hooks), so the caller — always a component that already has
 *  `t` — passes it in. */
type TranslateFn = (key: string, options?: Record<string, unknown>) => unknown;

export function resolveClassName(
  classId: string | null | undefined,
  classes: SegmenterClass[],
  t: TranslateFn
): string {
  if (!classId) return t('segmenter.classes.unclassified') as string;
  const found = classes.find(c => c.id === classId)?.name;
  return found ?? (t('segmenter.classes.unknown') as string);
}

/** `#rrggbb` -> `rgba(r,g,b,alpha)` for translucent polygon fills. Falls
 *  back to a neutral fill if `hex` isn't a well-formed 6-digit hex colour
 *  (defensive — a class colour is user-entered via `<input type="color">`
 *  but could in principle come from stale/hand-edited data). */
export function hexToRgba(hex: string, alpha: number): string {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return `rgba(156, 163, 175, ${alpha})`;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
