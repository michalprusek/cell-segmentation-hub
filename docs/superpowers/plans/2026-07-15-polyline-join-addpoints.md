# Polyline Join in Add-points Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the segmentation editor's Add-points mode, let the user click an endpoint of another same-class polyline to merge the two polylines into one on the current frame.

**Architecture:** A new pure utility module (`polylineJoin.ts`) holds the class gate, endpoint hit-test, and merge geometry. `handleAddPointsClick` calls it to perform the join; `handleMouseMove` calls it to drive a hover highlight (`hoveredJoinTarget`), rendered as a ring in `CanvasTemporaryGeometryLayer`. Merge writes only the current frame via `updatePolygons`; persistence is the existing explicit Save.

**Tech Stack:** React 18 + TypeScript, Vitest, existing segmentation-editor hooks (`useAdvancedInteractions`, `useEnhancedSegmentationEditor`), i18next (6 locales).

## Global Constraints

- Docker-first repo: run tests via `make ci-test` or the container; do NOT run app services on the host. Vitest for a single file may be run through the frontend container or `npx vitest run <path>` on host (host node is present but the app is Docker-only — tests are host-runnable per existing suites).
- ESLint strict: **0 warnings** (pre-commit blocks otherwise). No `console.log`/`debugger`.
- Conventional commits (`feat:`, `test:`, `docs:`); direct commits to `main` blocked — stay on `feat/polyline-join-addpoints`.
- i18n: every new user-facing string must exist in all 6 files `src/translations/{en,cs,es,de,fr,zh}.ts`; validate with `node scripts/check-i18n.cjs`.
- Class semantics come from `polylineSemanticsForProjectType(project.type)` — sperm→`partClass`, microtubule→`mtType`, else generic. Never re-sniff per-polygon.
- Survivor rule: the selected polyline **A** keeps `id`, `trackId`, `mtType`, `partClass`, `instanceId`, `name`, `class`, `type`; the clicked polyline **B** is removed from the current frame only.
- `EDITING_CONSTANTS.VERTEX_HIT_RADIUS = 8` (image px, divided by `transform.zoom`) is the hit tolerance — reuse it, don't invent a new constant.

---

### Task 1: Pure join utilities (`polylineJoin.ts`)

**Files:**

- Create: `src/pages/segmentation/utils/polylineJoin.ts`
- Test: `src/pages/segmentation/utils/polylineJoin.test.ts`

**Interfaces:**

- Consumes: `Point`, `Polygon` from `@/lib/segmentation`; `polylineSemanticsForProjectType` from `@/lib/polylineSemantics`.
- Produces (used by Tasks 2 & 3):
  - `type Endpoint = 'head' | 'tail'`
  - `endpointPoint(polygon: Polygon, endpoint: Endpoint): Point`
  - `nearestEndpoint(polygon: Polygon, point: Point): Endpoint`
  - `canJoinPolylines(a: Polygon, b: Polygon, projectType: string | undefined): boolean`
  - `interface JoinTarget { polygonId: string; endpoint: Endpoint; distanceSq: number }`
  - `findJoinTarget(polygons: Polygon[], source: Polygon, point: Point, maxDistance: number, projectType: string | undefined): JoinTarget | null`
  - `joinPolylinePoints(a: Polygon, aEnd: Endpoint, b: Polygon, bEnd: Endpoint, bridge: Point[]): Point[]`

- [ ] **Step 1: Write the failing test**

Create `src/pages/segmentation/utils/polylineJoin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Polygon, Point } from '@/lib/segmentation';
import {
  canJoinPolylines,
  findJoinTarget,
  joinPolylinePoints,
  nearestEndpoint,
  endpointPoint,
} from './polylineJoin';

const line = (
  id: string,
  pts: Point[],
  extra: Partial<Polygon> = {}
): Polygon => ({
  id,
  points: pts,
  type: 'external',
  geometry: 'polyline',
  ...extra,
});

const A = line('a', [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
]);

describe('endpointPoint / nearestEndpoint', () => {
  it('resolves head and tail', () => {
    expect(endpointPoint(A, 'head')).toEqual({ x: 0, y: 0 });
    expect(endpointPoint(A, 'tail')).toEqual({ x: 10, y: 0 });
  });
  it('picks the nearer endpoint (ties → head)', () => {
    expect(nearestEndpoint(A, { x: 1, y: 0 })).toBe('head');
    expect(nearestEndpoint(A, { x: 9, y: 0 })).toBe('tail');
    expect(nearestEndpoint(A, { x: 5, y: 0 })).toBe('head'); // tie
  });
});

describe('canJoinPolylines', () => {
  const B = line('b', [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ]);
  it('rejects self, non-polyline, and <2 points', () => {
    expect(canJoinPolylines(A, A, 'microtubules')).toBe(false);
    const poly = line('p', A.points, { geometry: 'polygon' });
    expect(canJoinPolylines(A, poly, 'microtubules')).toBe(false);
    const short = line('s', [{ x: 0, y: 0 }]);
    expect(canJoinPolylines(A, short, 'microtubules')).toBe(false);
  });
  it('microtubule: joins same mtType incl. both untyped, rejects different', () => {
    expect(canJoinPolylines(A, B, 'microtubules')).toBe(true); // both undefined
    const at = line('a', A.points, { mtType: 't1' });
    const bt = line('b', B.points, { mtType: 't1' });
    const bx = line('b', B.points, { mtType: 't2' });
    expect(canJoinPolylines(at, bt, 'microtubules')).toBe(true);
    expect(canJoinPolylines(at, bx, 'microtubules')).toBe(false);
  });
  it('sperm: joins same partClass, rejects different', () => {
    const at = line('a', A.points, { partClass: 'tail' });
    const bt = line('b', B.points, { partClass: 'tail' });
    const bh = line('b', B.points, { partClass: 'head' });
    expect(canJoinPolylines(at, bt, 'sperm')).toBe(true);
    expect(canJoinPolylines(at, bh, 'sperm')).toBe(false);
  });
  it('generic: joins any two polylines regardless of fields', () => {
    const at = line('a', A.points, { partClass: 'tail' });
    const bh = line('b', B.points, { partClass: 'head' });
    expect(canJoinPolylines(at, bh, 'spheroid')).toBe(true);
  });
});

describe('findJoinTarget', () => {
  const B = line('b', [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ]);
  const polygons = [A, B];
  it('returns the nearest foreign endpoint within range', () => {
    const t = findJoinTarget(polygons, A, { x: 21, y: 0 }, 5, 'microtubules');
    expect(t).toEqual({ polygonId: 'b', endpoint: 'head', distanceSq: 1 });
  });
  it('returns null when nothing is in range', () => {
    expect(
      findJoinTarget(polygons, A, { x: 100, y: 100 }, 5, 'microtubules')
    ).toBeNull();
  });
  it('ignores the source polyline itself', () => {
    // click right on A's own tail — must not return A
    const t = findJoinTarget(polygons, A, { x: 10, y: 0 }, 5, 'microtubules');
    expect(t).toBeNull();
  });
  it('skips class-mismatched candidates', () => {
    const at = line('a', A.points, { mtType: 't1' });
    const bx = line('b', B.points, { mtType: 't2' });
    expect(
      findJoinTarget([at, bx], at, { x: 20, y: 0 }, 5, 'microtubules')
    ).toBeNull();
  });
});

describe('joinPolylinePoints', () => {
  const B = line('b', [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ]);
  it('tail→head: A as-is then B as-is', () => {
    expect(joinPolylinePoints(A, 'tail', B, 'head', [])).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });
  it('tail→tail: A as-is then B reversed', () => {
    expect(joinPolylinePoints(A, 'tail', B, 'tail', [])).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 30, y: 0 },
      { x: 20, y: 0 },
    ]);
  });
  it('head→head: A reversed then B as-is', () => {
    expect(joinPolylinePoints(A, 'head', B, 'head', [])).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });
  it('inserts bridge points between the two', () => {
    expect(joinPolylinePoints(A, 'tail', B, 'head', [{ x: 15, y: 5 }])).toEqual(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 15, y: 5 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ]
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/segmentation/utils/polylineJoin.test.ts`
Expected: FAIL — `Cannot find module './polylineJoin'`.

- [ ] **Step 3: Write the implementation**

Create `src/pages/segmentation/utils/polylineJoin.ts`:

```ts
import type { Point, Polygon } from '@/lib/segmentation';
import { polylineSemanticsForProjectType } from '@/lib/polylineSemantics';

/** A polyline endpoint: `head` = points[0], `tail` = points[last]. */
export type Endpoint = 'head' | 'tail';

/** The point at the given endpoint of a polyline. */
export const endpointPoint = (polygon: Polygon, endpoint: Endpoint): Point =>
  endpoint === 'head'
    ? polygon.points[0]
    : polygon.points[polygon.points.length - 1];

/** Which endpoint of `polygon` is nearer to `point` (ties resolve to head). */
export const nearestEndpoint = (polygon: Polygon, point: Point): Endpoint => {
  const head = polygon.points[0];
  const tail = polygon.points[polygon.points.length - 1];
  const dHead = (point.x - head.x) ** 2 + (point.y - head.y) ** 2;
  const dTail = (point.x - tail.x) ** 2 + (point.y - tail.y) ** 2;
  return dHead <= dTail ? 'head' : 'tail';
};

const isJoinablePolyline = (p: Polygon): boolean =>
  p.geometry === 'polyline' && p.points.length >= 2;

/**
 * Can polyline `b` be merged into `a`? They must be distinct joinable
 * polylines that share the class relevant to the project type:
 *  - sperm → same `partClass`
 *  - microtubule → same `mtType` (both `undefined` = both untyped = joinable)
 *  - generic → no class field applies, always allowed
 */
export const canJoinPolylines = (
  a: Polygon,
  b: Polygon,
  projectType: string | undefined
): boolean => {
  if (a.id === b.id) return false;
  if (!isJoinablePolyline(a) || !isJoinablePolyline(b)) return false;
  const { kind } = polylineSemanticsForProjectType(projectType);
  if (kind === 'sperm') return a.partClass === b.partClass;
  if (kind === 'microtubule') return a.mtType === b.mtType;
  return true;
};

export interface JoinTarget {
  polygonId: string;
  endpoint: Endpoint;
  distanceSq: number;
}

/**
 * Nearest joinable foreign endpoint to `point`, within `maxDistance`
 * (image-space units). Scans both endpoints of every candidate that passes
 * `canJoinPolylines(source, candidate, projectType)`. `null` if none in range.
 */
export const findJoinTarget = (
  polygons: Polygon[],
  source: Polygon,
  point: Point,
  maxDistance: number,
  projectType: string | undefined
): JoinTarget | null => {
  const maxSq = maxDistance * maxDistance;
  let best: JoinTarget | null = null;
  for (const candidate of polygons) {
    if (!canJoinPolylines(source, candidate, projectType)) continue;
    for (const endpoint of ['head', 'tail'] as const) {
      const ep = endpointPoint(candidate, endpoint);
      const dSq = (point.x - ep.x) ** 2 + (point.y - ep.y) ** 2;
      if (dSq <= maxSq && (best === null || dSq < best.distanceSq)) {
        best = { polygonId: candidate.id, endpoint, distanceSq: dSq };
      }
    }
  }
  return best;
};

/**
 * Merge B into A at the chosen endpoints. A survives (caller keeps A's
 * fields and drops B). Returns A's new `points`:
 *   orient(A so `aEnd` is last) ++ bridge ++ orient(B so `bEnd` is first)
 */
export const joinPolylinePoints = (
  a: Polygon,
  aEnd: Endpoint,
  b: Polygon,
  bEnd: Endpoint,
  bridge: Point[]
): Point[] => {
  const aOriented = aEnd === 'tail' ? a.points : [...a.points].reverse();
  const bOriented = bEnd === 'head' ? b.points : [...b.points].reverse();
  return [...aOriented, ...bridge, ...bOriented];
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/segmentation/utils/polylineJoin.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/pages/segmentation/utils/polylineJoin.ts src/pages/segmentation/utils/polylineJoin.test.ts
git commit -m "feat(editor): pure polyline-join utilities (gate, endpoint hit-test, merge)"
```

---

### Task 2: Perform the join on click in `handleAddPointsClick`

**Files:**

- Modify: `src/pages/segmentation/hooks/useAdvancedInteractions.tsx` (`handleAddPointsClick`, ~lines 240-353; imports; deps)

**Interfaces:**

- Consumes from Task 1: `findJoinTarget`, `joinPolylinePoints`, `nearestEndpoint`, `endpointPoint`, `type Endpoint`.
- `projectType` is already a hook prop (line 76/81). `updatePolygons`, `setEditMode`, `setTempPoints`, `setInteractionState`, `getPolygons`, `tempPoints`, `interactionState`, `selectedPolygonId`, `transform` already in scope.

- [ ] **Step 1: Add the import**

At the top of `useAdvancedInteractions.tsx`, after the existing `polylineSemanticsForProjectType` import (line 17), add:

```ts
import {
  findJoinTarget,
  joinPolylinePoints,
  nearestEndpoint,
  endpointPoint,
  type Endpoint,
} from '../utils/polylineJoin';
```

- [ ] **Step 2: Insert the join branch at the top of `handleAddPointsClick`**

In `handleAddPointsClick`, immediately AFTER the existing `closestVertex` computation (currently line 253, the `findClosestVertex(...)` call) and BEFORE `if (!interactionState.isAddingPoints) {`, insert:

```ts
// Join: clicking a same-class foreign polyline's endpoint merges it
// into the selected polyline (A survives, B is dropped from this frame).
// Prefer the join only when the foreign endpoint is at least as close
// as A's own nearest vertex, so existing splice/extend keeps priority.
const joinTarget = findJoinTarget(
  polygons,
  selectedPolygon,
  imagePoint,
  hitRadius,
  projectType
);
const ownVertexDistSq = closestVertex ? closestVertex.distance ** 2 : Infinity;
if (joinTarget && joinTarget.distanceSq <= ownVertexDistSq) {
  const targetPolygon = polygons.find(p => p.id === joinTarget.polygonId);
  if (targetPolygon) {
    const anchor = interactionState.addPointStartVertex;
    const lastIdx = selectedPolygon.points.length - 1;
    let aEnd: Endpoint;
    let bridge: Point[];
    if (
      interactionState.isAddingPoints &&
      anchor &&
      anchor.polygonId === selectedPolygonId
    ) {
      // Phase 2: connect at the anchored end; drawn points form a bridge.
      aEnd =
        anchor.vertexIndex === 0
          ? 'head'
          : anchor.vertexIndex === lastIdx
            ? 'tail'
            : nearestEndpoint(
                selectedPolygon,
                endpointPoint(targetPolygon, joinTarget.endpoint)
              );
      bridge = tempPoints;
    } else {
      // Phase 1: direct join at A's end nearer to the clicked endpoint.
      aEnd = nearestEndpoint(
        selectedPolygon,
        endpointPoint(targetPolygon, joinTarget.endpoint)
      );
      bridge = [];
    }
    const merged = joinPolylinePoints(
      selectedPolygon,
      aEnd,
      targetPolygon,
      joinTarget.endpoint,
      bridge
    );
    updatePolygons(
      polygons
        .filter(p => p.id !== targetPolygon.id)
        .map(p => (p.id === selectedPolygonId ? { ...p, points: merged } : p))
    );
    setTempPoints([]);
    setInteractionState({
      ...interactionState,
      isAddingPoints: false,
      addPointStartVertex: null,
      addPointEndVertex: null,
    });
    setEditMode(EditMode.EditVertices);
    return;
  }
}
```

- [ ] **Step 3: Add `projectType` to the `handleAddPointsClick` dependency array**

The `useCallback` deps for `handleAddPointsClick` (currently lines 342-352) must include `projectType`. Add it:

```ts
[
  selectedPolygonId,
  interactionState,
  tempPoints,
  transform.zoom,
  getPolygons,
  updatePolygons,
  setTempPoints,
  setInteractionState,
  setEditMode,
  projectType,
];
```

- [ ] **Step 4: Verify type-check and lint pass**

Run: `npx tsc --noEmit && make lint`
Expected: no errors, 0 ESLint warnings. (`Point` is already imported at line 2; `EditMode` already in scope.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/segmentation/hooks/useAdvancedInteractions.tsx
git commit -m "feat(editor): join same-class polyline on endpoint click in add-points mode"
```

---

### Task 3: `hoveredJoinTarget` state + hover detection

**Files:**

- Modify: `src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx` (state near line 118; pass to `useAdvancedInteractions` ~line 1070; export in the returned object ~lines 1180 & 1196)
- Modify: `src/pages/segmentation/hooks/useAdvancedInteractions.tsx` (props interface ~line 25; destructure ~line 81; `handleMouseMove` hover block ~lines 862-909; deps)

**Interfaces:**

- Produces: `editor.hoveredJoinTarget: { polygonId: string; endpoint: Endpoint } | null` (consumed by Task 4).
- New `useAdvancedInteractions` prop: `setHoveredJoinTarget: (v: { polygonId: string; endpoint: Endpoint } | null) => void`.

- [ ] **Step 1: Add the state in `useEnhancedSegmentationEditor.tsx`**

Immediately after the `hoveredVertex` state (line 118-…), add:

```ts
const [hoveredJoinTarget, setHoveredJoinTarget] = useState<{
  polygonId: string;
  endpoint: 'head' | 'tail';
} | null>(null);
```

- [ ] **Step 2: Pass the setter into `useAdvancedInteractions`**

In the `useAdvancedInteractions({ ... })` call (line 1070+), after `setHoveredVertex,` (line 1087) add:

```ts
    setHoveredJoinTarget,
```

- [ ] **Step 3: Export `hoveredJoinTarget` from the hook**

`hoveredVertex` appears twice in the returned object (lines ~1180 and ~1196 — a memo dep list and the returned object). Add `hoveredJoinTarget,` next to `hoveredVertex,` in BOTH places so the value is returned and the memo re-runs when it changes.

- [ ] **Step 4: Add the prop to `useAdvancedInteractions` interface + destructure**

In `UseAdvancedInteractionsProps` (line 25+), next to the existing `setHoveredVertex` prop (line 45), add:

```ts
  setHoveredJoinTarget: (
    value: { polygonId: string; endpoint: 'head' | 'tail' } | null
  ) => void;
```

In the destructured params (after `setHoveredVertex,` at line 81), add `setHoveredJoinTarget,`.

- [ ] **Step 5: Detect the join target in `handleMouseMove`**

In `handleMouseMove`, inside the hover block that runs for `EditVertices`/`AddPoints` with a selected polygon, AFTER the existing `setHoveredVertex(...)`/`setHoveredVertex(null)` branch (line ~907) and still inside `if (selectedPolygon) {`, add:

```ts
// Add-points join hover: highlight a same-class foreign endpoint.
if (editMode === EditMode.AddPoints) {
  const join = findJoinTarget(
    polygons,
    selectedPolygon,
    imagePoint,
    hitRadius,
    projectType
  );
  setHoveredJoinTarget(
    join ? { polygonId: join.polygonId, endpoint: join.endpoint } : null
  );
}
```

(`polygons`, `hitRadius`, `imagePoint`, `editMode`, `projectType` are all already in scope in this block; `findJoinTarget` is imported in Task 2 Step 1.)

- [ ] **Step 6: Clear `hoveredJoinTarget` when leaving AddPoints**

Still in `handleMouseMove`, the outer hover guard is `editMode === EditVertices || editMode === AddPoints`. When neither holds the block is skipped and stale highlight would persist. Add, right before that hover `if` block (line ~862), a reset:

```ts
if (editMode !== EditMode.AddPoints) {
  setHoveredJoinTarget(null);
}
```

- [ ] **Step 7: Add `projectType` and `setHoveredJoinTarget` to `handleMouseMove` deps**

Add `projectType` and `setHoveredJoinTarget` to the `handleMouseMove` `useCallback` dependency array (the array beginning at line ~911 with `editMode, interactionState, transform, ...`). Keep `setHoveredVertex` alongside.

- [ ] **Step 8: Verify type-check and lint pass**

Run: `npx tsc --noEmit && make lint`
Expected: no errors, 0 warnings.

- [ ] **Step 9: Commit**

```bash
git add src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx src/pages/segmentation/hooks/useAdvancedInteractions.tsx
git commit -m "feat(editor): track hovered join target for same-class polyline endpoints"
```

---

### Task 4: Render the join-target ring in `CanvasTemporaryGeometryLayer`

**Files:**

- Modify: `src/pages/segmentation/components/canvas/CanvasTemporaryGeometryLayer.tsx` (props + a `renderJoinTargetHighlight` + include it in the returned `<g>`)
- Modify: `src/pages/segmentation/components/SegmentationEditorLayout.tsx` (~line 515 — pass `hoveredJoinTarget`)
- Modify: `src/pages/segmentation/components/EnhancedSegmentationEditor.tsx` (~line 201 — pass `hoveredJoinTarget`)

**Interfaces:**

- Consumes: `editor.hoveredJoinTarget` (Task 3), `polygons`, `transform`, `editMode`.

- [ ] **Step 1: Extend the layer's props**

In `CanvasTemporaryGeometryLayer.tsx`, add to `CanvasTemporaryGeometryLayerProps` (after `polygons: Polygon[];`, line 13):

```ts
  hoveredJoinTarget: { polygonId: string; endpoint: 'head' | 'tail' } | null;
```

Add `hoveredJoinTarget,` to the destructured params (after `polygons,`, line 29).

- [ ] **Step 2: Add the ring renderer**

Before the component's `return (` (line 390), add:

```ts
  const renderJoinTargetHighlight = () => {
    if (editMode !== EditMode.AddPoints || !hoveredJoinTarget) {
      return null;
    }
    const target = polygons.find(p => p.id === hoveredJoinTarget.polygonId);
    if (!target || target.points.length < 2) {
      return null;
    }
    const p =
      hoveredJoinTarget.endpoint === 'head'
        ? target.points[0]
        : target.points[target.points.length - 1];
    return (
      <circle
        key="join-target-ring"
        cx={p.x}
        cy={p.y}
        r={vertexRadius * 1.6}
        fill="none"
        stroke="#f59e0b"
        strokeWidth={Math.max(1.5, 2.5 / transform.zoom)}
        style={{ opacity: 0.95 }}
      />
    );
  };
```

- [ ] **Step 3: Include it in the output**

In the returned JSX `<g className="temporary-geometry-layer">` (line 391-397), add `{renderJoinTargetHighlight()}` after `{renderAddPointsPreview()}`.

- [ ] **Step 4: Thread the prop at both render sites**

In `SegmentationEditorLayout.tsx` (the `<CanvasTemporaryGeometryLayer` at ~line 515), add after `polygons={editor.polygons}`:

```tsx
                        hoveredJoinTarget={editor.hoveredJoinTarget}
```

In `EnhancedSegmentationEditor.tsx` (the `<CanvasTemporaryGeometryLayer` at ~line 201), add after `polygons={editor.polygons}`:

```tsx
                hoveredJoinTarget={editor.hoveredJoinTarget}
```

- [ ] **Step 5: Update the existing layer test to supply the new required prop**

`src/pages/segmentation/components/canvas/__tests__/CanvasTemporaryGeometryLayer.test.tsx` renders the component (line ~63). Add `hoveredJoinTarget={null}` to that render (and any other render of the component in the file) so the required prop is satisfied.

- [ ] **Step 6: Verify type-check, lint, and the layer test**

Run: `npx tsc --noEmit && make lint && npx vitest run src/pages/segmentation/components/canvas/__tests__/CanvasTemporaryGeometryLayer.test.tsx`
Expected: no type/lint errors; layer test PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/segmentation/components/canvas/CanvasTemporaryGeometryLayer.tsx src/pages/segmentation/components/SegmentationEditorLayout.tsx src/pages/segmentation/components/EnhancedSegmentationEditor.tsx src/pages/segmentation/components/canvas/__tests__/CanvasTemporaryGeometryLayer.test.tsx
git commit -m "feat(editor): render ring highlight over joinable polyline endpoint"
```

---

### Task 5: Mode hint + i18n (×6)

**Files:**

- Modify: `src/pages/segmentation/components/canvas/ModeInstructions.tsx` (AddPoints case, ~lines 136-165)
- Modify: `src/translations/{en,cs,es,de,fr,zh}.ts` (add `segmentation.instructions.addPoints.joinHint`)

**Interfaces:**

- Consumes: `polylinePanelKind` from `@/lib/polylineSemantics` (to gate the hint to polyline projects — MT + sperm).

- [ ] **Step 1: Add the i18n key to all six locale files**

In each `src/translations/<lang>.ts`, inside the `segmentation.instructions.addPoints` object (the block containing `clickVertex`, `clickVertexMt`, `addPointsMt`, `addPoints`, `holdShift`, `cancel`), add a `joinHint` entry:

- `en.ts`: `joinHint: 'Click another polyline endpoint of the same class to join them',`
- `cs.ts`: `joinHint: 'Kliknutím na koncový bod jiné polylinie stejné třídy je spojíte',`
- `es.ts`: `joinHint: 'Haz clic en el extremo de otra polilínea de la misma clase para unirlas',`
- `de.ts`: `joinHint: 'Klicke auf den Endpunkt einer anderen Polylinie derselben Klasse, um sie zu verbinden',`
- `fr.ts`: `joinHint: 'Cliquez sur l’extrémité d’une autre polyligne de la même classe pour les joindre',`
- `zh.ts`: `joinHint: '点击同类另一条折线的端点即可将它们连接',`

- [ ] **Step 2: Show the hint in the AddPoints instructions**

In `ModeInstructions.tsx`, add the import near line 5:

```ts
import { isMicrotubuleProject, type ProjectType } from '@/types';
import { polylinePanelKind } from '@/lib/polylineSemantics';
```

(Keep the existing `isMicrotubuleProject` import; add the second line.)

Near `const isMicrotubule = ...` (line 34), add:

```ts
const supportsJoin = polylinePanelKind(projectType) !== null;
```

In BOTH AddPoints instruction arrays (the `!interactionState.isAddingPoints` branch, lines 141-148, and the `isAddingPoints` branch, lines 156-161), append the join hint when `supportsJoin`:

```ts
              ...(supportsJoin
                ? [t('segmentation.instructions.addPoints.joinHint')]
                : []),
```

Place the spread as the last element of each `instructions: [ ... ]` array (before the closing `]`).

- [ ] **Step 3: Validate i18n completeness**

Run: `node scripts/check-i18n.cjs`
Expected: no missing-key errors for `joinHint`.

- [ ] **Step 4: Verify type-check + lint**

Run: `npx tsc --noEmit && make lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/segmentation/components/canvas/ModeInstructions.tsx src/translations
git commit -m "feat(editor): add-points join hint + i18n across 6 locales"
```

---

### Task 6: Full-suite gate + browser verification

**Files:** none (verification only).

- [ ] **Step 1: Run the local CI gate**

Run: `make ci`
Expected: TypeScript + ESLint(0) + i18n all pass.

- [ ] **Step 2: Run the touched-area unit tests**

Run: `npx vitest run src/pages/segmentation/utils/polylineJoin.test.ts src/pages/segmentation/components/canvas/__tests__/CanvasTemporaryGeometryLayer.test.tsx`
Expected: PASS.

- [ ] **Step 3: Build the production frontend bundle**

Run: `make build-service SERVICE=frontend`
Expected: build succeeds (guards against minifier/chunk-split breakage — repo failure pattern #6/#14).

- [ ] **Step 4: Browser verification (CLAUDE.md gate A + F)**

Deploy the built frontend to the local production stack (or dev), then with Playwright MCP on `https://spherosegapp.utia.cas.cz`:

1. `browser_navigate` → a microtubule project editor frame with ≥2 MT polylines.
2. Select an MT; press `A` (or the Add-points toolbar button) → Add-points mode.
3. `browser_snapshot` + move the cursor near another same-class MT endpoint → `browser_take_screenshot` shows the amber ring.
4. Click the endpoint → the two fragments become one polyline; the clicked MT is gone; ring clears; mode returns to Edit-vertices.
5. `browser_console_messages` → length 0 (any error = blocker).
6. Save; reload the frame; confirm the merged polyline persisted and the second fragment is absent on this frame.
7. Repeat the hover/click on a **different-mtType** endpoint → no ring, click does not join (falls through to normal add-points).
8. On a sperm project, repeat with `partClass` mismatch (head vs tail) → no join; same `partClass` → joins.

Record results; if any step fails, fix root cause and re-run this task.

---

## Self-Review

- **Spec coverage:** Scope decisions 1 (class gate) → `canJoinPolylines` (Task 1) + hint gate (Task 5); 2 (current-frame, survivor keeps trackId) → `updatePolygons(filter B, map A.points)` (Task 2); 3 (click-to-join gesture + hover) → Tasks 2 & 3; ring highlight → Task 4; mode hint + i18n → Task 5; tests + browser verify → Tasks 1 & 6. All architecture sections and the files-touched table map to a task.
- **Placeholder scan:** No TBD/TODO; every code step shows full code; tests contain real assertions.
- **Type consistency:** `Endpoint`, `JoinTarget`, `findJoinTarget`, `joinPolylinePoints`, `nearestEndpoint`, `endpointPoint`, `canJoinPolylines` names/signatures identical across Tasks 1-4; `hoveredJoinTarget` shape `{ polygonId: string; endpoint: 'head' | 'tail' }` consistent in the state (Task 3), the layer prop (Task 4), and the two render sites.
