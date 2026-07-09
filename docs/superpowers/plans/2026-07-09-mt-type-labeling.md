# Microtubule type (class) labeling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users label individual microtubules with a user-defined "tubulin code" class in the segmentation editor (single + bulk, via right-click), propagate the class across the whole track, switch the canvas between instance- and label-colouring, and project the class into metrics + ImageJ/COCO/YOLO exports.

**Architecture:** A per-polygon `mtType` field holds a stable label **id**; a per-project `mtTypeLabels` JSON palette (`[{id,name,color}]`) is the SSOT for name+colour. Assignment is a whole-track backend mutation (`setTrackTypeAcrossVideo`) modeled on the existing `deleteTrackAcrossVideo`. The editor resolves `id → {name,color}` from the palette for display and export; a localStorage view-toggle switches canvas colouring.

**Tech Stack:** React 18 + TS + Vite (FE), Node/Express + Prisma (BE), PostgreSQL, exceljs, custom ImageJ `.roi` encoder. Docker-first (`make` targets / container shells; never host npm).

## Global Constraints

- **Docker-first:** never run host `npm`/`node`; use `make shell-be` / `make shell-fe` / `make ci`. Migrations run in the backend container.
- **Pre-commit is strict:** 0 ESLint warnings, Prettier-clean, no `console.log`/`debugger`, conventional commits (`feat:`/`fix:`/`test:`/`docs:`), no direct commits to `main` (work on `feat/mt-type-labeling`).
- **i18n:** every user-facing string in all 6 files `src/translations/{en,cs,es,de,fr,zh}.ts`; validate `node scripts/check-i18n.cjs`.
- **Feature gating:** every new UI/behaviour is gated to `projectType === 'microtubules'`.
- **Polygon field strip:** a new optional polygon field survives the DB→editor round-trip ONLY if registered in `OPTIONAL_POLYGON_FIELDS` (`backend/src/utils/polygonValidation.ts`).
- **React.memo comparators:** any new prop that affects `CanvasPolygon` rendering MUST be added to its custom comparator (~`CanvasPolygon.tsx:480-520`) or it won't re-render.
- **Verification:** "done" requires observed runtime behaviour (Playwright on `https://spherosegapp.utia.cas.cz`, `curl`, real export files) — not just green TS/lint.

---

## File Structure

**Backend**

- `backend/prisma/schema.prisma` — add `mtTypeLabels Json?` to `Project`.
- `backend/prisma/migrations/<ts>_add_mt_type_labels/migration.sql` — generated.
- `backend/src/utils/polygonValidation.ts` — register `mtType` in the SSOT table + `Polygon` interface.
- `backend/src/services/segmentationService.ts` — `setTrackTypeAcrossVideo`; add `mtType` to `SegmentationPolygon` + response mappers; export helper `setPolygonsTrackType`.
- `backend/src/services/mtTypeLabelService.ts` (new) — palette get/upsert/delete + reference cleanup.
- `backend/src/api/controllers/segmentationController.ts` — `setTrackType` handler.
- `backend/src/api/controllers/projectController.ts` (or its module) — palette handlers.
- `backend/src/api/routes/segmentationRoutes.ts` — `PATCH …/tracks/type`.
- `backend/src/api/routes/projectRoutes.ts` — palette routes.
- `backend/src/services/export/mtMetricsExporter.ts` — `mtType` column.
- `backend/src/services/export/imagejRoiEncoder.ts` + `imagejColor.ts` — class name/colour/group.
- `backend/src/services/export/formatConverter.ts` — COCO/YOLO category from `mtType`.

**Frontend**

- `src/lib/segmentation.ts` — `mtType?: string` on `Polygon`; palette types.
- `src/lib/api.ts` — `mtType` on `SegmentationPolygon`; `setTrackType`, palette CRUD methods.
- `src/pages/segmentation/utils/instanceColors.ts` — `resolveMtColor` helper.
- `src/pages/segmentation/hooks/usePolygonHandlers.ts` — `handleChangeMtType` (bulk).
- `src/pages/segmentation/hooks/useMtTypeLabels.ts` (new) — palette state + CRUD.
- `src/pages/segmentation/components/context-menu/PolygonContextMenu.tsx` — "Set type" submenu.
- `src/pages/segmentation/components/context-menu/MtTypeLabelDialog.tsx` (new) — name+colour dialog.
- `src/pages/segmentation/components/MicrotubuleInstancePanel.tsx` — colour-mode toggle, per-row label, rename/delete.
- `src/pages/segmentation/components/canvas/CanvasPolygon.tsx` — semantic colour + comparator.
- `src/pages/segmentation/components/canvas/*` (polygon layer that maps `CanvasPolygon`) — pass `colorMode` + `semanticColor`.
- `src/pages/segmentation/SegmentationEditor.tsx` + `components/SegmentationEditorLayout.tsx` — own palette + colorMode; thread props.
- `src/translations/{en,cs,es,de,fr,zh}.ts` — strings.

---

## Task 1: Thread `mtType` through the polygon contracts

**Files:**

- Modify: `backend/src/utils/polygonValidation.ts` (`Polygon` interface ~30-59; `OPTIONAL_POLYGON_FIELDS` ~97-117)
- Modify: `backend/src/services/segmentationService.ts` (`SegmentationPolygon` interface)
- Modify: `src/lib/segmentation.ts` (`Polygon` ~26-54)
- Modify: `src/lib/api.ts` (`SegmentationPolygon` ~99-124)
- Test: `backend/src/utils/__tests__/polygonValidation.mtType.test.ts` (new)

**Interfaces:**

- Produces: `Polygon.mtType?: string` (label id) present on all four contracts; validator preserves it.

- [ ] **Step 1: Write the failing test**

Create `backend/src/utils/__tests__/polygonValidation.mtType.test.ts`:

```ts
import { PolygonValidator } from '../polygonValidation';

describe('mtType field preservation', () => {
  it('preserves a non-empty mtType through validation', () => {
    const json = JSON.stringify([
      {
        id: 'p1',
        geometry: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        mtType: 'mt_type_abc123',
      },
    ]);
    const { polygons, isValid } = PolygonValidator.parsePolygonData(
      json,
      'test'
    );
    expect(isValid).toBe(true);
    expect(polygons[0].mtType).toBe('mt_type_abc123');
  });

  it('drops an empty-string mtType', () => {
    const json = JSON.stringify([
      {
        id: 'p1',
        geometry: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        mtType: '',
      },
    ]);
    const { polygons } = PolygonValidator.parsePolygonData(json, 'test');
    expect(polygons[0].mtType).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `make shell-be` then `npx jest src/utils/__tests__/polygonValidation.mtType.test.ts`
Expected: FAIL — `mtType` is `undefined` (field not yet whitelisted).

- [ ] **Step 3: Register the field + add to interfaces**

In `backend/src/utils/polygonValidation.ts`, add to the `Polygon` interface (after `trackId`):

```ts
  /** User-assigned microtubule type label id (references the project's
   *  mtTypeLabels palette). Preserved so the editor + exports can resolve the
   *  class name/colour. */
  mtType?: string;
```

And add to `OPTIONAL_POLYGON_FIELDS` (after the `trackId` entry):

```ts
  // Preserve the user-assigned microtubule type label id (resolved to a
  // class name/colour via the project's mtTypeLabels palette).
  { key: 'mtType', coerce: coerceNonEmptyString },
```

In `backend/src/services/segmentationService.ts`, add to the `SegmentationPolygon` interface (near `trackId`):

```ts
  /** Microtubule type label id (see Project.mtTypeLabels). */
  mtType?: string;
```

In `src/lib/segmentation.ts`, add to `Polygon` (after `trackId`):

```ts
  /** User-assigned microtubule type label id. Resolved to a class
   *  name/colour via the project's mtTypeLabels palette. MT projects only. */
  mtType?: string;
```

In `src/lib/api.ts`, add to `SegmentationPolygon` (after `trackId`):

```ts
  /** Microtubule type label id (references the project's mtTypeLabels
   *  palette). Set/cleared via the tracks/type endpoint. */
  mtType?: string;
```

- [ ] **Step 4: Run the test, verify it passes**

Run (in `make shell-be`): `npx jest src/utils/__tests__/polygonValidation.mtType.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Type-check both stacks**

Run: `make ci` (or `npx tsc --noEmit` for FE + BE)
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/polygonValidation.ts backend/src/services/segmentationService.ts src/lib/segmentation.ts src/lib/api.ts backend/src/utils/__tests__/polygonValidation.mtType.test.ts
git commit -m "feat(mt): thread mtType label id through polygon contracts"
```

---

## Task 2: Add the `mtTypeLabels` palette column (Prisma)

**Files:**

- Modify: `backend/prisma/schema.prisma` (`model Project`)
- Create: `backend/prisma/migrations/<ts>_add_mt_type_labels/migration.sql`

**Interfaces:**

- Produces: `Project.mtTypeLabels` (nullable JSON) readable/writable via Prisma.

- [ ] **Step 1: Add the field to the schema**

In `backend/prisma/schema.prisma`, inside `model Project { … }` add:

```prisma
  // Per-project microtubule type-label palette (SSOT for name + colour):
  // [{ id: string, name: string, color: string }]. MT projects only.
  mtTypeLabels           Json?
```

- [ ] **Step 2: Create the migration (dev container)**

Run: `make shell-be` then
`npx prisma migrate dev --name add_mt_type_labels`
Expected: a new migration dir is created and applied to `spheroseg_dev`.

- [ ] **Step 3: Verify the column exists**

Run: `docker exec spheroseg-postgres psql -U spheroseg -d spheroseg_dev -c "\d projects" | grep mtTypeLabels`
Expected: a `mtTypeLabels | jsonb` (nullable) row.

- [ ] **Step 4: Regenerate the client**

Run (in `make shell-be`): `npx prisma generate`
Expected: success; `project.mtTypeLabels` is typed `Prisma.JsonValue | null`.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(mt): add mtTypeLabels palette column to Project"
```

> **Production note (do NOT run here):** apply on prod via idempotent SQL, not `migrate deploy` blind (prod prisma history has drifted): `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "mtTypeLabels" jsonb;`

---

## Task 3: Backend — `setTrackTypeAcrossVideo` + pure helper

**Files:**

- Modify: `backend/src/services/segmentationService.ts` (new method + exported helper near `removePolygonsWithTrackId` ~252)
- Test: `backend/src/services/__tests__/setTrackType.test.ts` (new)

**Interfaces:**

- Consumes: `parsePolygonsJsonForDiff`, `this.prisma`, `this.imageService.getImageById`, `VideoAccessError` (all already in the file).
- Produces:
  - `export function setPolygonsTrackType(polys: unknown[], trackIds: Set<string>, mtType: string | null): { polygons: unknown[]; changed: number }`
  - `async setTrackTypeAcrossVideo(videoId: string, trackIds: string[], mtType: string | null, userId: string): Promise<{ framesAffected: number }>`

- [ ] **Step 1: Write the failing test for the pure helper**

Create `backend/src/services/__tests__/setTrackType.test.ts`:

```ts
import { setPolygonsTrackType } from '../segmentationService';

describe('setPolygonsTrackType', () => {
  const polys = () => [
    { id: 'a', trackId: 't1', geometry: 'polyline', points: [] },
    { id: 'b', trackId: 't2', geometry: 'polyline', points: [] },
    { id: 'c', geometry: 'polyline', points: [] }, // no trackId
  ];

  it('sets mtType on polygons whose trackId is selected', () => {
    const { polygons, changed } = setPolygonsTrackType(
      polys(),
      new Set(['t1']),
      'mt_type_x'
    );
    expect(changed).toBe(1);
    expect((polygons[0] as any).mtType).toBe('mt_type_x');
    expect((polygons[1] as any).mtType).toBeUndefined();
  });

  it('clears mtType when passed null', () => {
    const input = polys().map(p =>
      p.id === 'a' ? { ...p, mtType: 'mt_type_x' } : p
    );
    const { polygons, changed } = setPolygonsTrackType(
      input,
      new Set(['t1']),
      null
    );
    expect(changed).toBe(1);
    expect((polygons[0] as any).mtType).toBeUndefined();
  });

  it('does not count a no-op (already that value)', () => {
    const input = polys().map(p =>
      p.id === 'a' ? { ...p, mtType: 'mt_type_x' } : p
    );
    const { changed } = setPolygonsTrackType(
      input,
      new Set(['t1']),
      'mt_type_x'
    );
    expect(changed).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run (in `make shell-be`): `npx jest src/services/__tests__/setTrackType.test.ts`
Expected: FAIL — `setPolygonsTrackType` is not exported.

- [ ] **Step 3: Implement the pure helper**

In `backend/src/services/segmentationService.ts`, after `removePolygonsWithTrackId` (~265), add:

```ts
/**
 * Set (or clear, when `mtType` is null) the microtubule type-label id on every
 * polyline whose `trackId` is in `trackIds`. Returns the new array and how many
 * polygons actually changed (a no-op assignment is not counted, so callers can
 * skip a DB write for an unchanged frame). Pure — does not mutate its input.
 */
export function setPolygonsTrackType(
  polys: unknown[],
  trackIds: Set<string>,
  mtType: string | null
): { polygons: unknown[]; changed: number } {
  let changed = 0;
  const polygons = polys.map(p => {
    const rec = p as Record<string, unknown>;
    const tid = rec.trackId;
    if (typeof tid !== 'string' || !trackIds.has(tid)) return p;
    const current = typeof rec.mtType === 'string' ? rec.mtType : undefined;
    const next = mtType ?? undefined;
    if (current === next) return p; // no-op
    changed++;
    const copy = { ...rec };
    if (next === undefined) delete copy.mtType;
    else copy.mtType = next;
    return copy;
  });
  return { polygons, changed };
}
```

- [ ] **Step 4: Run the helper test, verify it passes**

Run (in `make shell-be`): `npx jest src/services/__tests__/setTrackType.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Add the service method**

In the `SegmentationService` class, after `deleteTrackAcrossVideo` (~2275), add:

```ts
  /**
   * Set (or clear) the microtubule type-label id on every polyline carrying one
   * of `trackIds`, across ALL frames of the video. Mirrors deleteTrackAcrossVideo:
   * frame-scan + single $transaction of only the frames that changed. Passing
   * `mtType: null` clears the label. Returns the number of frames written.
   *
   * @throws {VideoAccessError} if the video is not owned.
   */
  async setTrackTypeAcrossVideo(
    videoId: string,
    trackIds: string[],
    mtType: string | null,
    userId: string
  ): Promise<{ framesAffected: number }> {
    const container = await this.imageService.getImageById(videoId, userId);
    if (!container) {
      throw new VideoAccessError();
    }
    const trackSet = new Set(trackIds.filter(t => typeof t === 'string' && t));
    if (trackSet.size === 0) return { framesAffected: 0 };

    const frames = await this.prisma.image.findMany({
      where: { parentVideoId: videoId },
      select: {
        id: true,
        segmentation: { select: { id: true, polygons: true } },
      },
    });

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    let framesAffected = 0;
    for (const frame of frames) {
      if (!frame.segmentation) continue;
      const parsed = parsePolygonsJsonForDiff(frame.segmentation.polygons, {
        currentImageId: frame.id,
        parentVideoId: videoId,
      });
      const { polygons, changed } = setPolygonsTrackType(
        parsed,
        trackSet,
        mtType
      );
      if (changed > 0) {
        framesAffected++;
        ops.push(
          this.prisma.segmentation.update({
            where: { id: frame.segmentation.id },
            data: { polygons: JSON.stringify(polygons), updatedAt: new Date() },
          })
        );
      }
    }

    if (ops.length > 0) {
      await this.prisma.$transaction(ops);
    }

    logger.info('Set microtubule track type across video', 'SegmentationService', {
      videoId,
      trackCount: trackSet.size,
      mtType,
      framesAffected,
    });
    return { framesAffected };
  }
```

- [ ] **Step 6: Type-check + re-run tests**

Run (in `make shell-be`): `npx tsc --noEmit && npx jest src/services/__tests__/setTrackType.test.ts`
Expected: 0 TS errors; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/segmentationService.ts backend/src/services/__tests__/setTrackType.test.ts
git commit -m "feat(mt): setTrackTypeAcrossVideo service + pure helper"
```

---

## Task 4: Backend — palette service (get/upsert/delete + cleanup)

**Files:**

- Create: `backend/src/services/mtTypeLabelService.ts`
- Test: `backend/src/services/__tests__/mtTypeLabelService.test.ts`

**Interfaces:**

- Produces:
  - `interface MTTypeLabel { id: string; name: string; color: string }`
  - `export function sanitizeLabels(raw: unknown): MTTypeLabel[]` — coerce/validate palette JSON.
  - `export function diffRemovedIds(prev: MTTypeLabel[], next: MTTypeLabel[]): string[]`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/mtTypeLabelService.test.ts`:

```ts
import { sanitizeLabels, diffRemovedIds } from '../mtTypeLabelService';

describe('sanitizeLabels', () => {
  it('keeps valid entries and drops malformed ones', () => {
    const out = sanitizeLabels([
      { id: 'a', name: 'alpha', color: '#ff0000' },
      { id: '', name: 'bad', color: '#000' }, // empty id dropped
      { id: 'b', name: '', color: '#00ff00' }, // empty name dropped
      { id: 'c', name: 'gamma', color: 'notacolor' }, // bad colour dropped
      'garbage',
    ]);
    expect(out).toEqual([{ id: 'a', name: 'alpha', color: '#ff0000' }]);
  });

  it('dedupes by id (last wins) and by name (case-insensitive)', () => {
    const out = sanitizeLabels([
      { id: 'a', name: 'alpha', color: '#111111' },
      { id: 'a', name: 'alpha2', color: '#222222' },
    ]);
    expect(out).toEqual([{ id: 'a', name: 'alpha2', color: '#222222' }]);
  });
});

describe('diffRemovedIds', () => {
  it('returns ids present in prev but absent in next', () => {
    expect(
      diffRemovedIds(
        [
          { id: 'a', name: 'x', color: '#000000' },
          { id: 'b', name: 'y', color: '#000000' },
        ],
        [{ id: 'a', name: 'x', color: '#000000' }]
      )
    ).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run (in `make shell-be`): `npx jest src/services/__tests__/mtTypeLabelService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/mtTypeLabelService.ts`:

```ts
import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import { setPolygonsTrackType } from './segmentationService';
import { parsePolygonsJsonForDiff } from './segmentationService';

export interface MTTypeLabel {
  id: string;
  name: string;
  color: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Coerce untrusted palette JSON into a clean MTTypeLabel[]. Drops entries with
 *  an empty id/name or a non-#RRGGBB colour; dedupes by id (last wins) and by
 *  case-insensitive name (first wins after id-dedup). */
export function sanitizeLabels(raw: unknown): MTTypeLabel[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, MTTypeLabel>();
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const color = typeof r.color === 'string' ? r.color.trim() : '';
    if (!id || !name || !HEX.test(color)) continue;
    byId.set(id, { id, name, color });
  }
  const seenNames = new Set<string>();
  const out: MTTypeLabel[] = [];
  for (const label of byId.values()) {
    const key = label.name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    out.push(label);
  }
  return out;
}

export function diffRemovedIds(
  prev: MTTypeLabel[],
  next: MTTypeLabel[]
): string[] {
  const nextIds = new Set(next.map(l => l.id));
  return prev.filter(l => !nextIds.has(l.id)).map(l => l.id);
}

export class MtTypeLabelService {
  constructor(private prisma: PrismaClient) {}

  async getLabels(projectId: string): Promise<MTTypeLabel[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { mtTypeLabels: true },
    });
    return sanitizeLabels(project?.mtTypeLabels ?? []);
  }

  /** Replace the whole palette (create/rename/reorder). Returns the sanitized
   *  set actually stored + the ids removed vs the previous palette. */
  async putLabels(
    projectId: string,
    labels: unknown
  ): Promise<{ labels: MTTypeLabel[]; removedIds: string[] }> {
    const prev = await this.getLabels(projectId);
    const next = sanitizeLabels(labels);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { mtTypeLabels: next as unknown as Prisma.InputJsonValue },
    });
    return { labels: next, removedIds: diffRemovedIds(prev, next) };
  }

  /** Delete one label and null its references on every polyline of the
   *  project's MT videos. Returns the frames cleaned. */
  async deleteLabel(
    projectId: string,
    labelId: string
  ): Promise<{ labels: MTTypeLabel[]; framesCleaned: number }> {
    const prev = await this.getLabels(projectId);
    const next = prev.filter(l => l.id !== labelId);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { mtTypeLabels: next as unknown as Prisma.InputJsonValue },
    });

    // Null references: scan every frame of every image in the project.
    const frames = await this.prisma.image.findMany({
      where: { projectId },
      select: {
        id: true,
        parentVideoId: true,
        segmentation: { select: { id: true, polygons: true } },
      },
    });
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    let framesCleaned = 0;
    for (const frame of frames) {
      if (!frame.segmentation) continue;
      const parsed = parsePolygonsJsonForDiff(frame.segmentation.polygons, {
        currentImageId: frame.id,
        parentVideoId: frame.parentVideoId,
      });
      // Clear mtType wherever it equals the deleted id (match by mtType, not
      // trackId): reuse setPolygonsTrackType by first collecting affected tracks.
      const affectedTracks = new Set<string>();
      let hasOrphanNonTrack = false;
      for (const p of parsed) {
        const rec = p as Record<string, unknown>;
        if (rec.mtType !== labelId) continue;
        if (typeof rec.trackId === 'string' && rec.trackId)
          affectedTracks.add(rec.trackId);
        else hasOrphanNonTrack = true;
      }
      let polygons = parsed;
      let changed = 0;
      if (affectedTracks.size > 0) {
        const res = setPolygonsTrackType(parsed, affectedTracks, null);
        polygons = res.polygons;
        changed += res.changed;
      }
      if (hasOrphanNonTrack) {
        polygons = polygons.map(p => {
          const rec = p as Record<string, unknown>;
          if (rec.mtType === labelId) {
            changed++;
            const copy = { ...rec };
            delete copy.mtType;
            return copy;
          }
          return p;
        });
      }
      if (changed > 0) {
        framesCleaned++;
        ops.push(
          this.prisma.segmentation.update({
            where: { id: frame.segmentation.id },
            data: { polygons: JSON.stringify(polygons), updatedAt: new Date() },
          })
        );
      }
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);
    logger.info('Deleted MT type label', 'MtTypeLabelService', {
      projectId,
      labelId,
      framesCleaned,
    });
    return { labels: next, framesCleaned };
  }
}
```

> NOTE: confirm `parsePolygonsJsonForDiff` is exported from `segmentationService.ts`; if not, export it (it is already used across the file). If a circular-import warning appears, move the two pure helpers (`setPolygonsTrackType`, `parsePolygonsJsonForDiff`) into a small `segmentationPolygonOps.ts` and import from there in both files.

- [ ] **Step 4: Run the test, verify it passes**

Run (in `make shell-be`): `npx jest src/services/__tests__/mtTypeLabelService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/mtTypeLabelService.ts backend/src/services/__tests__/mtTypeLabelService.test.ts backend/src/services/segmentationService.ts
git commit -m "feat(mt): palette service (sanitize/put/delete + reference cleanup)"
```

---

## Task 5: Backend — routes + controllers

**Files:**

- Modify: `backend/src/api/controllers/segmentationController.ts` (add `setTrackType`)
- Modify: `backend/src/api/routes/segmentationRoutes.ts` (add `PATCH …/tracks/type`)
- Modify: `backend/src/api/controllers/projectController.ts` (palette handlers) + `projectRoutes.ts`

**Interfaces:**

- Produces:
  - `PATCH /api/segmentation/videos/:videoId/tracks/type` body `{ trackIds: string[], mtType: string | null }` → `{ framesAffected }`
  - `GET /api/projects/:id/mt-type-labels` → `{ labels }`
  - `PUT /api/projects/:id/mt-type-labels` body `{ labels }` → `{ labels, removedIds }`
  - `DELETE /api/projects/:id/mt-type-labels/:labelId` → `{ labels, framesCleaned }`

- [ ] **Step 1: Add the segmentation controller handler**

In `segmentationController.ts`, after `deleteTrack` (~360):

```ts
/**
 * Set (or clear) the microtubule type-label id on one or more tracks across a
 * whole video. body: { trackIds: string[]; mtType: string | null }.
 */
setTrackType = async (req: Request, res: Response): Promise<void> => {
  try {
    const { videoId } = req.params;
    const { trackIds, mtType } = req.body as {
      trackIds: string[];
      mtType: string | null;
    };
    const userId = this.validateUser(req, res);
    if (!userId) return;
    if (!this.validateParams(req.params, ['videoId'], res)) return;

    const result = await this.segmentationService.setTrackTypeAcrossVideo(
      videoId as string,
      Array.isArray(trackIds) ? trackIds : [],
      typeof mtType === 'string' && mtType.length > 0 ? mtType : null,
      userId
    );
    ResponseHelper.success(res, result, 'Typ mikrotubulu nastaven');
  } catch (error) {
    logger.error(
      'Failed to set microtubule track type',
      error instanceof Error ? error : undefined,
      'SegmentationController',
      { videoId: req.params.videoId, userId: req.user?.id }
    );
    this.handleTrackOpError(error, res, 'Chyba při nastavení typu mikrotubulu');
  }
};
```

- [ ] **Step 2: Add the segmentation route**

In `segmentationRoutes.ts`, after the delete-track route (~171):

```ts
/**
 * @route PATCH /api/segmentation/videos/:videoId/tracks/type
 * @description Set/clear the microtubule type-label id on one or more tracks
 * @access Private
 */
router.patch(
  '/videos/:videoId/tracks/type',
  [
    param('videoId').isUUID().withMessage('ID videa musí být platné UUID'),
    body('trackIds').isArray({ min: 1 }).withMessage('trackIds musí být pole'),
    body('trackIds.*').isString().withMessage('trackId musí být řetězec'),
    body('mtType')
      .optional({ nullable: true })
      .isString()
      .isLength({ max: 100 })
      .withMessage('mtType musí být řetězec'),
  ],
  handleValidation,
  segmentationController.setTrackType
);
```

- [ ] **Step 3: Add the palette handlers**

In `projectController.ts`, import and instantiate `MtTypeLabelService` (follow the file's existing service-instantiation pattern with the shared `prisma`), then add three exported handlers `getMtTypeLabels`, `putMtTypeLabels`, `deleteMtTypeLabel`. Example for one (mirror ownership checks used by `getProject`):

```ts
export const putMtTypeLabels = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.id;
  if (!userId) return ResponseHelper.unauthorized(res);
  await assertProjectOwnership(id, userId); // reuse the file's ownership guard
  const { labels } = await mtTypeLabelService.putLabels(id, req.body?.labels);
  const removed = // from putLabels
    ResponseHelper.success(res, { labels }, 'Palette uložena');
};
```

> Follow the exact ownership-guard + response helpers already used in `projectController.ts`; do not invent new ones.

- [ ] **Step 4: Add the palette routes**

In `projectRoutes.ts`, after `/:id/stats`:

```ts
router.get(
  '/:id/mt-type-labels',
  validateParams(projectIdSchema),
  getMtTypeLabels
);
router.put(
  '/:id/mt-type-labels',
  validateParams(projectIdSchema),
  putMtTypeLabels
);
router.delete(
  '/:id/mt-type-labels/:labelId',
  validateParams(projectIdSchema),
  deleteMtTypeLabel
);
```

- [ ] **Step 5: Type-check**

Run (in `make shell-be`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: curl-verify against dev**

Start dev (`make up`), obtain a token, then:

```bash
curl -s -X PATCH "http://localhost:3001/api/segmentation/videos/$VIDEO/tracks/type" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"trackIds":["'$TRACK'"],"mtType":"mt_type_test"}' | jq
# then read the frame back and confirm mtType is on the polyline
curl -s "http://localhost:3001/api/segmentation/images/$FRAME" \
  -H "Authorization: Bearer $TOKEN" | jq '.segmentation.polygons[] | select(.trackId=="'$TRACK'") | .mtType'
```

Expected: `{ framesAffected: N }`, and the frame read prints `"mt_type_test"`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/api/
git commit -m "feat(mt): routes+controllers for track-type + palette CRUD"
```

---

## Task 6: Frontend API client methods

**Files:**

- Modify: `src/lib/api.ts` (near `deleteTrack` ~1808)
- Test: `src/lib/__tests__/api.mtType.test.ts` (new, mock axios instance)

**Interfaces:**

- Produces on `apiClient`:
  - `setTrackType(videoId: string, trackIds: string[], mtType: string | null): Promise<{ framesAffected: number }>`
  - `getMtTypeLabels(projectId: string): Promise<MTTypeLabel[]>`
  - `putMtTypeLabels(projectId: string, labels: MTTypeLabel[]): Promise<MTTypeLabel[]>`
  - `deleteMtTypeLabel(projectId: string, labelId: string): Promise<MTTypeLabel[]>`
  - `export interface MTTypeLabel { id: string; name: string; color: string }`

- [ ] **Step 1: Add the type + methods**

In `src/lib/api.ts`, add near the other exported interfaces:

```ts
export interface MTTypeLabel {
  id: string;
  name: string;
  color: string;
}
```

After `deleteTrack` (~1808):

```ts
  /** Set/clear the microtubule type-label id on one or more whole tracks. */
  async setTrackType(
    videoId: string,
    trackIds: string[],
    mtType: string | null
  ): Promise<{ framesAffected: number }> {
    const response = await this.instance.patch(
      `/segmentation/videos/${videoId}/tracks/type`,
      { trackIds, mtType }
    );
    const data = this.extractData(response);
    return { framesAffected: Number(data?.framesAffected ?? 0) };
  }

  async getMtTypeLabels(projectId: string): Promise<MTTypeLabel[]> {
    const response = await this.instance.get(
      `/projects/${projectId}/mt-type-labels`
    );
    const data = this.extractData(response);
    return Array.isArray(data?.labels) ? (data.labels as MTTypeLabel[]) : [];
  }

  async putMtTypeLabels(
    projectId: string,
    labels: MTTypeLabel[]
  ): Promise<MTTypeLabel[]> {
    const response = await this.instance.put(
      `/projects/${projectId}/mt-type-labels`,
      { labels }
    );
    const data = this.extractData(response);
    return Array.isArray(data?.labels) ? (data.labels as MTTypeLabel[]) : [];
  }

  async deleteMtTypeLabel(
    projectId: string,
    labelId: string
  ): Promise<MTTypeLabel[]> {
    const response = await this.instance.delete(
      `/projects/${projectId}/mt-type-labels/${encodeURIComponent(labelId)}`
    );
    const data = this.extractData(response);
    return Array.isArray(data?.labels) ? (data.labels as MTTypeLabel[]) : [];
  }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(mt): api client methods for track-type + palette CRUD"
```

---

## Task 7: Frontend — palette state hook + colour resolver

**Files:**

- Create: `src/pages/segmentation/hooks/useMtTypeLabels.ts`
- Modify: `src/pages/segmentation/utils/instanceColors.ts` (add `resolveMtColor`)
- Test: `src/pages/segmentation/utils/__tests__/resolveMtColor.test.ts` (new)

**Interfaces:**

- Produces:
  - `resolveMtColor(mtType: string | undefined, palette: Map<string,string>, opts?: {selected?: boolean}): string` — label colour, or neutral gray for untyped.
  - `useMtTypeLabels(projectId, enabled)` → `{ labels, labelById, colorById, createLabel, renameLabel, deleteLabel, assign }`

- [ ] **Step 1: Write the failing resolver test**

Create `src/pages/segmentation/utils/__tests__/resolveMtColor.test.ts`:

```ts
import { resolveMtColor, NEUTRAL_COLOR } from '../instanceColors';

describe('resolveMtColor', () => {
  const palette = new Map([['mt_type_a', '#ff0000']]);
  it('returns the label colour for a typed MT', () => {
    expect(resolveMtColor('mt_type_a', palette)).toBe('#ff0000');
  });
  it('returns neutral gray for an untyped MT', () => {
    expect(resolveMtColor(undefined, palette)).toBe(NEUTRAL_COLOR);
  });
  it('returns neutral gray for an unknown id', () => {
    expect(resolveMtColor('mt_type_missing', palette)).toBe(NEUTRAL_COLOR);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `make ci-test` scoped, or `npx vitest run src/pages/segmentation/utils/__tests__/resolveMtColor.test.ts`
Expected: FAIL — `resolveMtColor`/`NEUTRAL_COLOR` not exported.

- [ ] **Step 3: Implement the resolver**

In `src/pages/segmentation/utils/instanceColors.ts`, export the existing neutral constant and add:

```ts
export const NEUTRAL_COLOR = 'hsl(0, 0%, 60%)';

/** Darken a #RRGGBB hex by `amount` (0..1) for the selected state. */
function darkenHex(hex: string, amount = 0.15): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Semantic (by-label) colour for a microtubule. Untyped / unknown id → neutral
 *  gray so unclassified MTs read as "not yet labelled". */
export function resolveMtColor(
  mtType: string | undefined,
  palette: Map<string, string>,
  { selected = false }: { selected?: boolean } = {}
): string {
  const color = mtType ? palette.get(mtType) : undefined;
  if (!color) return NEUTRAL_COLOR;
  return selected ? darkenHex(color) : color;
}
```

(Replace the file-local `const NEUTRAL_COLOR` usage so there's a single exported constant.)

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/pages/segmentation/utils/__tests__/resolveMtColor.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the palette hook**

Create `src/pages/segmentation/hooks/useMtTypeLabels.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient, type MTTypeLabel } from '@/lib/api';
import { logger } from '@/lib/logger';

/** Loads + mutates the project's MT type-label palette. `enabled` gates it to
 *  microtubule projects so other project types never fetch it. */
export function useMtTypeLabels(
  projectId: string | undefined,
  enabled: boolean
) {
  const [labels, setLabels] = useState<MTTypeLabel[]>([]);

  useEffect(() => {
    if (!enabled || !projectId) return;
    let alive = true;
    apiClient
      .getMtTypeLabels(projectId)
      .then(l => alive && setLabels(l))
      .catch(err => logger.error('Failed to load MT type labels', err));
    return () => {
      alive = false;
    };
  }, [projectId, enabled]);

  const colorById = useMemo(
    () => new Map(labels.map(l => [l.id, l.color])),
    [labels]
  );
  const labelById = useMemo(
    () => new Map(labels.map(l => [l.id, l])),
    [labels]
  );

  const persist = useCallback(
    async (next: MTTypeLabel[]) => {
      if (!projectId) return;
      const saved = await apiClient.putMtTypeLabels(projectId, next);
      setLabels(saved);
    },
    [projectId]
  );

  const createLabel = useCallback(
    async (name: string, color: string): Promise<MTTypeLabel | null> => {
      const id = `mt_type_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const label = { id, name: name.trim(), color };
      await persist([...labels, label]);
      return label;
    },
    [labels, persist]
  );

  const renameLabel = useCallback(
    async (id: string, name: string, color: string) => {
      await persist(
        labels.map(l => (l.id === id ? { ...l, name: name.trim(), color } : l))
      );
    },
    [labels, persist]
  );

  const deleteLabel = useCallback(
    async (id: string) => {
      if (!projectId) return;
      const saved = await apiClient.deleteMtTypeLabel(projectId, id);
      setLabels(saved);
    },
    [projectId]
  );

  return {
    labels,
    labelById,
    colorById,
    createLabel,
    renameLabel,
    deleteLabel,
  };
}
```

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit`

```bash
git add src/pages/segmentation/hooks/useMtTypeLabels.ts src/pages/segmentation/utils/instanceColors.ts src/pages/segmentation/utils/__tests__/resolveMtColor.test.ts
git commit -m "feat(mt): palette hook + semantic colour resolver"
```

---

## Task 8: Frontend — assignment handler (single + bulk)

**Files:**

- Modify: `src/pages/segmentation/hooks/usePolygonHandlers.ts` (near `handleChangePartClass` ~244)
- Modify: `src/pages/segmentation/SegmentationEditor.tsx` (wire selection + videoId + palette into the handler)

**Interfaces:**

- Consumes: `apiClient.setTrackType`, the MT multi-selection `selectedPolygonIds`, `editor.getPolygons()`.
- Produces: `handleChangeMtType(polygonId: string, mtType: string | null): Promise<void>` — resolves the target track ids (the right-clicked polygon's track, OR every selected polygon's track when ≥2 selected), calls `setTrackType`, then reloads segmentation so the editor re-renders with the new `mtType`.

- [ ] **Step 1: Implement the handler**

In `SegmentationEditor.tsx` (where other MT handlers like propagate/delete-track live), add a `handleChangeMtType` using the same reload mechanism the propagate/delete-track handlers already use (they call `apiClient` then trigger a segmentation reload — mirror that exact reload call). Sketch:

```ts
const handleChangeMtType = useCallback(
  async (polygonId: string, mtType: string | null) => {
    if (!videoId) return;
    const polys = editor.getPolygons();
    const clicked = polys.find(p => p.id === polygonId);
    // Bulk when ≥2 are multi-selected; else just the clicked polyline's track.
    const targetIds =
      selectedPolygonIds.size >= 2 ? [...selectedPolygonIds] : [polygonId];
    const trackIds = Array.from(
      new Set(
        targetIds
          .map(id => polys.find(p => p.id === id)?.trackId)
          .filter((t): t is string => typeof t === 'string' && t.length > 0)
      )
    );
    if (trackIds.length === 0) {
      toast.error(t('microtubule.type.noTrack'));
      return;
    }
    try {
      await apiClient.setTrackType(videoId, trackIds, mtType);
      await reloadSegmentation(); // the SAME reload used by delete-track
      toast.success(t('microtubule.type.updated'));
    } catch (e) {
      logger.error('setTrackType failed', e);
      toast.error(t('microtubule.type.updateFailed'));
    }
  },
  [videoId, editor, selectedPolygonIds, reloadSegmentation, t]
);
```

> Use the exact `reloadSegmentation`/reload-nonce mechanism already wired for `deleteTrack` in this file (search for the delete-track handler and copy its reload call) so a same-count reload actually refreshes the canvas (see CLAUDE.md failure #13).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/segmentation/SegmentationEditor.tsx src/pages/segmentation/hooks/usePolygonHandlers.ts
git commit -m "feat(mt): assign type handler (single + bulk over selection)"
```

---

## Task 9: Frontend — context menu "Set type" submenu + label dialog

**Files:**

- Create: `src/pages/segmentation/components/context-menu/MtTypeLabelDialog.tsx`
- Modify: `src/pages/segmentation/components/context-menu/PolygonContextMenu.tsx`
- Modify: `src/pages/segmentation/components/canvas/CanvasPolygon.tsx` (plumb new props through, like `onChangePartClass`)
- Modify: `src/pages/segmentation/components/SegmentationEditorLayout.tsx` (pass props down)

**Interfaces:**

- Consumes: `MTTypeLabel[]`, `currentMtType`, `handleChangeMtType`, `createLabel`.
- Produces: MT-gated submenu with existing labels (swatch + check), "None", "+ New label…". New `PolygonContextMenu` props: `mtTypeLabels?: MTTypeLabel[]`, `currentMtType?: string`, `onChangeMtType?: (mtType: string|null)=>void`, `onCreateMtLabel?: (name:string,color:string)=>Promise<MTTypeLabel|null>`, `multiSelectCount`.

- [ ] **Step 1: Build the dialog**

Create `MtTypeLabelDialog.tsx` — a controlled dialog (reuse the `AlertDialog`/`Dialog` shadcn primitives already imported in the context menu) with a text input (name, trimmed, non-empty) and an `<input type="color">`. On confirm calls `onConfirm(name, color)`. Default colour e.g. `#e11d48`.

- [ ] **Step 2: Add the submenu to `PolygonContextMenu`**

Add the new props to `PolygonContextMenuProps`, then render (gated `isPolyline && isMicrotubules`, using `ContextMenuSub`/`ContextMenuSubTrigger`/`ContextMenuSubContent` from `@/components/ui/context-menu`):

```tsx
{
  isPolyline && isMicrotubules && onChangeMtType && (
    <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Tag className="mr-2 h-4 w-4" />
          <span>
            {multiSelectCount >= 2
              ? t('microtubule.type.setForSelected', {
                  count: multiSelectCount,
                })
              : t('microtubule.type.set')}
          </span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-56">
          <ContextMenuItem onClick={() => onChangeMtType(null)}>
            <span className="mr-2 h-3 w-3 rounded-full border" />
            <span>{t('microtubule.type.none')}</span>
            {!currentMtType && <span className="ml-auto text-xs">✓</span>}
          </ContextMenuItem>
          {(mtTypeLabels ?? []).map(label => (
            <ContextMenuItem
              key={label.id}
              onClick={() => onChangeMtType(label.id)}
            >
              <span
                className="mr-2 h-3 w-3 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              <span className="truncate">{label.name}</span>
              {currentMtType === label.id && (
                <span className="ml-auto text-xs">✓</span>
              )}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setShowNewLabelDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            <span>{t('microtubule.type.newLabel')}</span>
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
}
```

Wire the `MtTypeLabelDialog` (state `showNewLabelDialog`) so confirming creates the label and immediately assigns it: `const created = await onCreateMtLabel(name, color); if (created) onChangeMtType(created.id);`. Import `Tag`, `Plus` from `lucide-react`.

- [ ] **Step 3: Plumb props through `CanvasPolygon` + layout**

In `CanvasPolygon.tsx`, add the new props to the interface and pass them to `PolygonContextMenu` (mirror how `onChangePartClass` is wired ~304). In `SegmentationEditorLayout.tsx`, thread `mtTypeLabels`, `currentMtType` (per selected polygon), `onChangeMtType`, `onCreateMtLabel` from the editor down (mirror `handleChangePartClass` at ~426).

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit`
Expected: 0 errors. (Full Playwright verification happens in Task 14.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/segmentation/components/context-menu/ src/pages/segmentation/components/canvas/CanvasPolygon.tsx src/pages/segmentation/components/SegmentationEditorLayout.tsx
git commit -m "feat(mt): right-click Set type submenu + new-label dialog"
```

---

## Task 10: Frontend — canvas semantic colouring + memo comparator

**Files:**

- Modify: `src/pages/segmentation/components/canvas/CanvasPolygon.tsx` (pathColor ~163-209; comparator ~480-520)
- Modify: the polygon layer that maps `CanvasPolygon` (grep for `<CanvasPolygon`) — pass `colorMode` + resolved `semanticColor`
- Modify: `src/pages/segmentation/SegmentationEditor.tsx` — own `mtColorMode` (localStorage-persisted)

**Interfaces:**

- Consumes: `resolveMtColor`, `colorById` map, `mtColorMode`.
- Produces: `CanvasPolygon` new props `colorMode?: 'instance'|'semantic'`, `semanticColor?: string`.

- [ ] **Step 1: Add the props + pathColor branch**

In `CanvasPolygon.tsx` interface add `colorMode?: 'instance' | 'semantic'` and `semanticColor?: string`. In the `pathColor` `useMemo`, inside `if (isPolyline)` AFTER the sperm `switch (polygon.partClass)` and BEFORE the instance `colorKey` block:

```ts
if (colorMode === 'semantic') {
  // Semantic (by-label) mode: typed → label colour, untyped → gray.
  return semanticColor ?? 'hsl(0, 0%, 60%)';
}
```

Add `colorMode` and `semanticColor` to the `useMemo` deps array.

- [ ] **Step 2: Update the memo comparator**

In the `React.memo` comparator (~480-520), add:

```ts
      prevProps.colorMode === nextProps.colorMode &&
      prevProps.semanticColor === nextProps.semanticColor &&
```

- [ ] **Step 3: Resolve `semanticColor` in the layer**

Where `<CanvasPolygon>` is mapped, compute per-polygon and pass:

```tsx
colorMode={projectType === 'microtubules' ? mtColorMode : 'instance'}
semanticColor={
  projectType === 'microtubules'
    ? resolveMtColor(polygon.mtType, colorById, { selected: isSelected })
    : undefined
}
```

- [ ] **Step 4: Own the toggle state in the editor**

In `SegmentationEditor.tsx`, add `const [mtColorMode, setMtColorMode] = useState<'instance'|'semantic'>(() => (localStorage.getItem('mtColorMode') as 'instance'|'semantic') || 'instance')` and persist on change; thread `mtColorMode` to the canvas layer and `setMtColorMode` to the panel (Task 11).

- [ ] **Step 5: Type-check + commit**

Run: `npx tsc --noEmit`

```bash
git add src/pages/segmentation/components/canvas/ src/pages/segmentation/SegmentationEditor.tsx
git commit -m "feat(mt): semantic (by-label) canvas colouring + comparator"
```

---

## Task 11: Frontend — MT panel toggle + per-row label + rename/delete

**Files:**

- Modify: `src/pages/segmentation/components/MicrotubuleInstancePanel.tsx`

**Interfaces:**

- Consumes: `mtColorMode`, `setMtColorMode`, `labelById`, `colorById`, `labels`, `renameLabel`, `deleteLabel`, each MT's `mtType`.

- [ ] **Step 1: Add the colour-mode segmented control**

In the panel header, add a two-button segmented control bound to `mtColorMode`/`setMtColorMode`, labelled `t('microtubule.color.byInstance')` / `t('microtubule.color.byLabel')`.

- [ ] **Step 2: Show each MT's label**

In each row, when `mt.mtType` resolves in `labelById`, render a small swatch (`colorById.get(mt.mtType)`) + the label name next to the length.

- [ ] **Step 3: Add a labels-management section**

Add a collapsible "Type labels" list: each label row shows swatch + name + an edit button (opens `MtTypeLabelDialog` in rename mode → `renameLabel`) + a trash button (confirm → `deleteLabel`) and a "+" that opens the dialog in create mode. Reuse `MtTypeLabelDialog` from Task 9.

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit`

```bash
git add src/pages/segmentation/components/MicrotubuleInstancePanel.tsx
git commit -m "feat(mt): panel colour-mode toggle + label rows + rename/delete"
```

---

## Task 12: Export — metrics `mtType` column

**Files:**

- Modify: `backend/src/services/export/mtMetricsExporter.ts` (`MTMetricsRow` ~51-77; `CSV_HEADERS` ~731-750; row construction; add palette resolution)
- Test: extend `backend/src/services/export/__tests__/` (add an mtType-column assertion to the existing mt metrics test, or a new file)

**Interfaces:**

- Consumes: the project palette (`MtTypeLabelService.getLabels` or the raw `project.mtTypeLabels`) → `Map<id,name>`.
- Produces: `MTMetricsRow.mtType: string` (resolved class name, `''` when untyped) as a new CSV/XLSX/JSON column.

- [ ] **Step 1: Add the field + header**

In `MTMetricsRow` add `mtType: string;` (after `label`). In `CSV_HEADERS` insert `'mtType'` right after `'label'`.

- [ ] **Step 2: Resolve and populate**

Where the exporter builds rows, obtain a `Map<labelId, name>` from the project palette once, and set `mtType: nameById.get(poly.mtType ?? '') ?? ''` on each row (carry the polyline's `mtType` alongside `instanceId`/`trackId` into row construction).

- [ ] **Step 3: Test the column appears**

Add an assertion that a polyline carrying `mtType: 'mt_type_a'` with palette `[{id:'mt_type_a',name:'alpha'}]` yields a row with `mtType: 'alpha'`, and an untyped polyline yields `mtType: ''`.

Run (in `make shell-be`): `npx jest src/services/export/__tests__/` (the mt metrics test file)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/export/mtMetricsExporter.ts backend/src/services/export/__tests__/
git commit -m "feat(mt): mtType (class name) column in MT metrics export"
```

---

## Task 13: Export — ImageJ ROI carries the class (name + colour + group)

**Files:**

- Modify: `backend/src/services/export/imagejColor.ts` (add `imageJColorFromHex`)
- Modify: `backend/src/services/export/imagejRoiEncoder.ts` (`RawPolygon` gets `mtType`; `roiLabel` prepends class; stroke colour = label colour; optional group)
- Test: `backend/src/services/export/__tests__/imagejRoiEncoder.mtType.test.ts` (new)

**Interfaces:**

- Consumes: palette `Map<id,{name,color}>` passed into the ImageJ export entry.
- Produces: ROI name prefixed with the class; stroke colour = the label's colour; (optional) group number = class index.

- [ ] **Step 1: Hex → ImageJ ARGB helper**

In `imagejColor.ts` add:

```ts
/** ARGB int (opaque) from a #RRGGBB label colour, for a ROI whose class is a
 *  user label. Alpha forced 0xFF so ImageJ treats it as "colour set". */
export function imageJColorFromHex(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return imageJStrokeColor('');
  const n = parseInt(m[1], 16);
  return ((0xff << 24) | n) >>> 0;
}
```

- [ ] **Step 2: Thread `mtType` + palette into naming/colour**

In `imagejRoiEncoder.ts`: add `mtType?: string` to `RawPolygon`; accept a `labelById: Map<string,{name:string;color:string}>` in the export entry function; in `roiLabel`, when the polyline has an `mtType` resolvable in `labelById`, prepend the sanitized class name: `` `${sanitize(name)}__${base}` ``; set the ROI `strokeColor` to `imageJColorFromHex(color)` instead of the trackId hash when a class colour exists.

- [ ] **Step 3: (Optional) group number**

Verify the ImageJ ROI group byte offset against `ij.io.RoiDecoder`/`RoiEncoder`. If confirmed, write a stable group index (labels sorted by name → 1..N) at that offset in the encoder and add a `group?: number` to `RoiEncodeOptions`. If it does NOT verify cleanly, SKIP this step and `logger.debug` that group encoding was omitted — ship name + colour only.

- [ ] **Step 4: Test naming + colour**

Create `imagejRoiEncoder.mtType.test.ts`: encode a polyline with `mtType:'mt_type_a'` + palette `{mt_type_a:{name:'alpha',color:'#ff0000'}}`; assert the ROI entry name contains `alpha__` and the stroke-colour bytes equal `imageJColorFromHex('#ff0000')`.

Run (in `make shell-be`): `npx jest src/services/export/__tests__/imagejRoiEncoder.mtType.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/export/imagejColor.ts backend/src/services/export/imagejRoiEncoder.ts backend/src/services/export/__tests__/imagejRoiEncoder.mtType.test.ts
git commit -m "feat(mt): ImageJ ROI carries the tubulin class (name+colour[+group])"
```

---

## Task 14: Export — COCO / YOLO category from `mtType`

**Files:**

- Modify: `backend/src/services/export/formatConverter.ts`
- Test: extend `backend/src/services/export/__tests__/formatConverter.test.ts`

**Interfaces:**

- Consumes: palette `Map<id,name>`; each polyline's `mtType`.
- Produces: COCO `categories[]` + `category_id` and YOLO class index derived from the resolved class name; untyped MTs → default `microtubule` category.

- [ ] **Step 1: Map class → category**

In the COCO/YOLO builders, when `projectType === 'microtubules'`, use the resolved class name (via palette) as the category; untyped → `microtubule`. Build the category list from the distinct resolved names (stable sorted) and assign contiguous ids/indices.

- [ ] **Step 2: Test**

Assert a typed MT ends up under its class category and an untyped one under `microtubule`.

Run (in `make shell-be`): `npx jest src/services/export/__tests__/formatConverter.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/export/formatConverter.ts backend/src/services/export/__tests__/formatConverter.test.ts
git commit -m "feat(mt): COCO/YOLO category from tubulin class"
```

---

## Task 15: i18n — all strings across 6 locales

**Files:**

- Modify: `src/translations/{en,cs,es,de,fr,zh}.ts`

**Keys to add** (under a `microtubule.type` / `microtubule.color` group; provide real translations, not placeholders):

- `microtubule.type.set` = "Set type" / cs "Nastavit typ"
- `microtubule.type.setForSelected` = "Set type for {{count}} selected"
- `microtubule.type.none` = "None"
- `microtubule.type.newLabel` = "New label…"
- `microtubule.type.updated` / `updateFailed` / `noTrack`
- `microtubule.type.labelName` / `labelColor` / `manageLabels` / `renameLabel` / `deleteLabel` / `confirmDeleteLabel`
- `microtubule.color.byInstance` = "By instance" / cs "Podle instance"
- `microtubule.color.byLabel` = "By label" / cs "Podle labelu"

- [ ] **Step 1: Add keys to all 6 files** (mirror an existing `microtubule.*` block's structure).

- [ ] **Step 2: Validate**

Run: `node scripts/check-i18n.cjs`
Expected: no missing keys across the 6 locales.

- [ ] **Step 3: Commit**

```bash
git add src/translations/
git commit -m "feat(mt): i18n for MT type labeling (6 locales)"
```

---

## Task 16: Build, deploy to dev, and end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Local CI gate**

Run: `make ci`
Expected: TS + ESLint(0) + i18n all green.

- [ ] **Step 2: Production build (catches minify/chunk breakage)**

Run: `make build-service SERVICE=frontend` and `make build-service SERVICE=backend`
Expected: both succeed.

- [ ] **Step 3: Bring up dev + seed data**

Use the `12bprusek` MT project (has a 3-frame TIFF + 621-frame ND2 — see memory `project_test_video_fixture`).

- [ ] **Step 4: Playwright walk-through (gate A/F)** — inject JWT (React form input is ignored; see memory), then on `https://spherosegapp.utia.cas.cz`:
  1. Open an MT video editor frame; `browser_snapshot` + `browser_console_messages` (must be 0 errors).
  2. Right-click an MT → "Set type" → "+ New label…" → type name + pick colour → confirm. Assert (screenshot) the polyline recolours (semantic mode) and the panel shows the label.
  3. Multi-select ≥2 MTs (panel checkboxes) → right-click → assign an existing label → assert all recolour.
  4. Scrub to another frame → assert the same MT keeps the class (track scope).
  5. Toggle panel colour mode Instance↔Label → assert canvas recolours both ways.
  6. Rename the label → assert panel + canvas update. Delete a label → assert references cleared (MT reverts to gray in semantic mode).
  7. `browser_console_messages` again → 0 errors.

- [ ] **Step 5: Export verification (gate B + files)**
  1. Run an export including metrics + ImageJ (+ COCO) for the MT project.
  2. Open `metrics.xlsx` (or CSV) → confirm the `mtType` column holds the class names.
  3. Open `RoiSet.zip` in ImageJ (or cross-check with Python `roifile`) → ROI names carry the class, stroke colour matches the label colour, (if shipped) group = class index.

- [ ] **Step 6: Final commit (docs/verification notes if any)** and open the PR.

```bash
git push -u origin feat/mt-type-labeling
gh pr create --title "feat(mt): microtubule type (class) labeling" --body "…"
```

---

## Self-review notes

- **Spec coverage:** D1 (user labels) → Tasks 7,9; D2 (whole-track) → Tasks 3,8; D3 (ImageJ) → Task 13; D4 (colour toggle) → Tasks 10,11; D5 (rename/delete) → Tasks 4,11; D6 (id-based model) → Tasks 1,2; D7 (bulk) → Task 8. Metrics column → Task 12; COCO/YOLO → Task 14; i18n → Task 15; verification → Task 16.
- **Type consistency:** `mtType` (label id, string) is used identically across polygon contracts, service, API client, exporters; `MTTypeLabel {id,name,color}` identical FE/BE; `setTrackType`/`setTrackTypeAcrossVideo`/`setPolygonsTrackType` names consistent.
- **Known soft spots (flagged inline for the implementer):** exact `reloadSegmentation` call in Task 8 must be copied from the existing delete-track handler; the ImageJ group byte offset (Task 13 Step 3) is conditional on verification; palette handler ownership guards (Task 5 Step 3) must reuse the project controller's existing guard rather than a new one.
