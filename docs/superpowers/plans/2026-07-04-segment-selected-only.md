# Segment Only Selected Images — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project-detail **Segment** button act strictly on the current image selection (all project types), disabled when nothing processable is selected.

**Architecture:** Extract one pure helper that partitions the _selected_ images into `toSegment` (unsegmented) vs `toResegment` (already segmented). Both the enqueue handler (`handleSegmentAll`) and the button-label panel (`QueueStatsPanel`) consume it, eliminating today's duplicated all-vs-selected logic. Backend is untouched — `POST /queue/batch` already segments exactly the `imageIds` list it receives.

**Tech Stack:** React 18 + TypeScript + Vite, i18next (6 locales), Vitest.

## Global Constraints

- Frontend only. No backend / ML / DB / Prisma changes.
- Applies to **all project types** — no project-type gating.
- Selected images that are `queued` / `processing` are skipped (already in flight).
- Unselected images are **never** enqueued.
- All user-facing strings exist in all 6 locales (`en, cs, es, de, fr, zh`); validate with `node scripts/check-i18n.cjs`.
- Pre-commit hook must pass (no `console.log`, ESLint 0 warnings, TS clean, conventional commits). Never `--no-verify`.
- Branch: `feat/segment-selected-only` (already created off `main`).
- Docker-first: run `make ci` / builds via `make`, never host `npm`.

---

### Task 1: Pure partition helper + unit test

**Files:**

- Create: `src/lib/segmentationSelection.ts`
- Test: `src/lib/segmentationSelection.test.ts`

**Interfaces:**

- Produces:
  - `interface SelectedSegmentationPartition { toSegment: ProjectImage[]; toResegment: ProjectImage[] }`
  - `function partitionSelectedForSegmentation(images: ProjectImage[], selectedImageIds: Set<string>): SelectedSegmentationPartition`

- [ ] **Step 1: Write the failing test**

`src/lib/segmentationSelection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { partitionSelectedForSegmentation } from './segmentationSelection';
import type { ProjectImage } from '@/types';

const img = (id: string, segmentationStatus?: string): ProjectImage =>
  ({ id, segmentationStatus }) as unknown as ProjectImage;

describe('partitionSelectedForSegmentation', () => {
  it('ignores unselected images entirely', () => {
    const images = [img('a', 'pending'), img('b', 'completed')];
    const { toSegment, toResegment } = partitionSelectedForSegmentation(
      images,
      new Set()
    );
    expect(toSegment).toEqual([]);
    expect(toResegment).toEqual([]);
  });

  it('routes selected unsegmented/failed/pending/none to toSegment', () => {
    const images = [
      img('a', 'pending'),
      img('b', 'failed'),
      img('c', 'no_segmentation'),
      img('d', undefined),
    ];
    const { toSegment, toResegment } = partitionSelectedForSegmentation(
      images,
      new Set(['a', 'b', 'c', 'd'])
    );
    expect(toSegment.map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(toResegment).toEqual([]);
  });

  it('routes selected completed/segmented to toResegment', () => {
    const images = [img('a', 'completed'), img('b', 'segmented')];
    const { toSegment, toResegment } = partitionSelectedForSegmentation(
      images,
      new Set(['a', 'b'])
    );
    expect(toSegment).toEqual([]);
    expect(toResegment.map(i => i.id)).toEqual(['a', 'b']);
  });

  it('skips selected images already queued/processing', () => {
    const images = [img('a', 'queued'), img('b', 'processing')];
    const { toSegment, toResegment } = partitionSelectedForSegmentation(
      images,
      new Set(['a', 'b'])
    );
    expect(toSegment).toEqual([]);
    expect(toResegment).toEqual([]);
  });

  it('partitions a mixed selection correctly', () => {
    const images = [
      img('a', 'pending'),
      img('b', 'completed'),
      img('c', 'processing'),
      img('d', 'segmented'),
    ];
    const { toSegment, toResegment } = partitionSelectedForSegmentation(
      images,
      new Set(['a', 'b', 'c', 'd'])
    );
    expect(toSegment.map(i => i.id)).toEqual(['a']);
    expect(toResegment.map(i => i.id)).toEqual(['b', 'd']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec frontend npx vitest run src/lib/segmentationSelection.test.ts` (or `make ci-test` scoped). Expected: FAIL — module not found / `partitionSelectedForSegmentation is not a function`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/segmentationSelection.ts`:

```ts
import type { ProjectImage } from '@/types';

export interface SelectedSegmentationPartition {
  /** Selected images not yet segmented (pending/failed/no_segmentation/none). */
  toSegment: ProjectImage[];
  /** Selected images already segmented (completed/segmented) — force re-run. */
  toResegment: ProjectImage[];
}

/**
 * Partition the SELECTED images into those to segment vs re-segment.
 *
 * - Unselected images are never included.
 * - Selected images currently `queued`/`processing` are skipped (in flight).
 *
 * Single source of truth for the "segment only the selected ones" decision,
 * shared by the enqueue handler and the queue button's label/counts.
 */
export function partitionSelectedForSegmentation(
  images: ProjectImage[],
  selectedImageIds: Set<string>
): SelectedSegmentationPartition {
  const toSegment: ProjectImage[] = [];
  const toResegment: ProjectImage[] = [];

  for (const image of images) {
    if (!selectedImageIds.has(image.id)) {
      continue;
    }
    const status = image.segmentationStatus;
    if (
      !status ||
      status === 'pending' ||
      status === 'failed' ||
      status === 'no_segmentation'
    ) {
      toSegment.push(image);
    } else if (status === 'completed' || status === 'segmented') {
      toResegment.push(image);
    }
    // queued / processing → skipped (already in flight)
  }

  return { toSegment, toResegment };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec frontend npx vitest run src/lib/segmentationSelection.test.ts`. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segmentationSelection.ts src/lib/segmentationSelection.test.ts
git commit -m "feat(project): add pure partitionSelectedForSegmentation helper"
```

---

### Task 2: Rewire `handleSegmentAll` to enqueue only the selection

**Files:**

- Modify: `src/pages/ProjectDetail.tsx` (`handleSegmentAll`, ~1304-1445; add import)

**Interfaces:**

- Consumes: `partitionSelectedForSegmentation` from Task 1.

- [ ] **Step 1: Add the import**

Near the other `@/lib` imports in `ProjectDetail.tsx`, add:

```ts
import { partitionSelectedForSegmentation } from '@/lib/segmentationSelection';
```

- [ ] **Step 2: Replace the two-group filter (lines 1304-1333)**

Replace:

```ts
    try {
      // Get images that don't have segmentation or have failed
      const imagesWithoutSegmentation = images.filter(
        img =>
          img.segmentationStatus === 'pending' ||
          img.segmentationStatus === 'failed' ||
          img.segmentationStatus === 'no_segmentation' ||
          !img.segmentationStatus
      );

      // Get selected images that have segmentation (will be re-segmented)
      const selectedImagesWithSegmentation = images.filter(
        img =>
          selectedImageIds.has(img.id) &&
          (img.segmentationStatus === 'completed' ||
            img.segmentationStatus === 'segmented')
      );

      // Combine both groups
      const allImagesToProcess = [
        ...imagesWithoutSegmentation,
        ...selectedImagesWithSegmentation,
      ];

      if (allImagesToProcess.length === 0) {
        toast.info(t('projects.allImagesAlreadySegmented'));
        // Reset batchSubmitted state since we're not actually processing anything
        setBatchSubmitted(false);
        return;
      }
```

with:

```ts
    try {
      // Segment ONLY the current selection. Unselected images are never
      // enqueued; selected images already queued/processing are skipped.
      const { toSegment, toResegment } = partitionSelectedForSegmentation(
        images,
        selectedImageIds
      );

      const allImagesToProcess = [...toSegment, ...toResegment];

      if (allImagesToProcess.length === 0) {
        // Defence-in-depth: the button is disabled when nothing processable is
        // selected, so this is only reachable via a stale click.
        toast.info(t('queue.selectNothingTooltip'));
        setBatchSubmitted(false);
        return;
      }
```

- [ ] **Step 3: Update the id-list variables (lines 1356-1362)**

Replace:

```ts
// Prepare image IDs for batch processing
const imageIdsWithoutSegmentation = imagesWithoutSegmentation.map(
  img => img.id
);
const imageIdsToResegment = selectedImagesWithSegmentation.map(img => img.id);
```

with:

```ts
// Prepare image IDs for batch processing
const imageIdsToSegment = toSegment.map(img => img.id);
const imageIdsToResegment = toResegment.map(img => img.id);
```

- [ ] **Step 4: Update remaining references to the renamed variable**

In the same function, replace the three remaining uses of `imageIdsWithoutSegmentation`:

- In the optimistic `updateImages` block (~line 1368):
  `imageIdsWithoutSegmentation.includes(img.id)` → `imageIdsToSegment.includes(img.id)`
- In the normal-segmentation dispatch (~lines 1433-1435):

  ```ts
  if (imageIdsToSegment.length > 0) {
    const queuedCount = await processImageChunks(imageIdsToSegment, false);
    _totalQueued += queuedCount;
  }
  ```

  (was `imageIdsWithoutSegmentation` in both the `.length` guard and the `processImageChunks` arg).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit` (host). Expected: no errors. Grep to confirm no stray references: `grep -n "imagesWithoutSegmentation\|selectedImagesWithSegmentation\|imageIdsWithoutSegmentation" src/pages/ProjectDetail.tsx` → no matches.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProjectDetail.tsx
git commit -m "feat(project): segment only selected images in handleSegmentAll"
```

---

### Task 3: Selection-based label/counts in `QueueStatsPanel`; drop the project-wide count

**Files:**

- Modify: `src/components/project/QueueStatsPanel.tsx` (props, label memo, button tooltip)
- Modify: `src/pages/ProjectDetail.tsx` (remove `imagesToSegmentCount` memo + prop)

**Interfaces:**

- Consumes: `partitionSelectedForSegmentation` from Task 1.

- [ ] **Step 1: Import helper, drop the `imagesToSegmentCount` prop**

In `QueueStatsPanel.tsx`:

- Add `import { partitionSelectedForSegmentation } from '@/lib/segmentationSelection';`
- Remove `imagesToSegmentCount?: number;` from `QueueStatsPanelProps` (line 30).
- Remove `imagesToSegmentCount = 0,` from the destructured props (line 47).

- [ ] **Step 2: Rewrite the label/counts `useMemo` (lines 63-105)**

Replace the whole `const { selectedWithSegmentationCount, totalToProcess, buttonLabel } = useMemo(...)` block with:

```ts
// Counts + button label derived from the SELECTION (single source of truth
// shared with handleSegmentAll via partitionSelectedForSegmentation).
const {
  selectedToSegmentCount,
  selectedToResegmentCount,
  totalToProcess,
  buttonLabel,
} = useMemo(() => {
  const { toSegment, toResegment } = partitionSelectedForSegmentation(
    images,
    selectedImageIds
  );
  const segCount = toSegment.length;
  const reCount = toResegment.length;
  const total = segCount + reCount;

  let label = t('queue.segmentSelected');
  if (total > 0) {
    if (segCount > 0 && reCount > 0) {
      label = t('queue.segmentMixed', {
        new: segCount,
        resegment: reCount,
        total,
      });
    } else if (reCount > 0) {
      label = t('queue.resegmentSelected', { count: reCount });
    } else {
      label = t('queue.segmentSelectedWithCount', { count: segCount });
    }
  }

  return {
    selectedToSegmentCount: segCount,
    selectedToResegmentCount: reCount,
    totalToProcess: total,
    buttonLabel: label,
  };
}, [selectedImageIds, images, t]);
```

- [ ] **Step 3: Update both buttons' `title` tooltip**

In BOTH the `UniversalCancelButton` (lines 192-199) and the fallback `Button` (lines 213-220), replace the `title={...}` expression with:

```tsx
                  title={
                    totalToProcess === 0
                      ? t('queue.selectNothingTooltip')
                      : selectedToResegmentCount > 0
                        ? t('queue.segmentTooltip', {
                            new: selectedToSegmentCount,
                            resegment: selectedToResegmentCount,
                          })
                        : undefined
                  }
```

(The `disabled` props already key on `totalToProcess === 0` — no change needed. `primaryText` / label already use `buttonLabel`.)

- [ ] **Step 4: Remove the now-dead project-wide count in `ProjectDetail.tsx`**

- Delete the `imagesToSegmentCount` memo (lines 390-399).
- Remove `imagesToSegmentCount={imagesToSegmentCount}` from the `<QueueStatsPanel .../>` props (line 1567).
- Grep to confirm no other use: `grep -n "imagesToSegmentCount" src/pages/ProjectDetail.tsx` → no matches.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`. Expected: no errors (`selectedWithSegmentationCount` fully removed; new keys referenced but added in Task 4 — `t()` is untyped so TS stays green).

- [ ] **Step 6: Commit**

```bash
git add src/components/project/QueueStatsPanel.tsx src/pages/ProjectDetail.tsx
git commit -m "feat(project): selection-based Segment button label + disabled state"
```

---

### Task 4: i18n keys (6 locales) + dead-key cleanup

**Files:**

- Modify: `src/translations/{en,cs,es,de,fr,zh}.ts`

- [ ] **Step 1: Add 3 keys to each locale's `queue` object**

Insert next to `resegmentSelected` in each file. Values:

| key                        | en                             | cs                                | es                                    | de                                     | fr                                    | zh                     |
| -------------------------- | ------------------------------ | --------------------------------- | ------------------------------------- | -------------------------------------- | ------------------------------------- | ---------------------- |
| `segmentSelected`          | `Segment Selected`             | `Segmentovat vybrané`             | `Segmentar seleccionadas`             | `Ausgewählte segmentieren`             | `Segmenter la sélection`              | `分割所选`             |
| `segmentSelectedWithCount` | `Segment Selected ({{count}})` | `Segmentovat vybrané ({{count}})` | `Segmentar seleccionadas ({{count}})` | `Ausgewählte segmentieren ({{count}})` | `Segmenter la sélection ({{count}})`  | `分割所选 ({{count}})` |
| `selectNothingTooltip`     | `Select images to segment`     | `Vyberte obrázky k segmentaci`    | `Seleccione imágenes para segmentar`  | `Bilder zum Segmentieren auswählen`    | `Sélectionnez des images à segmenter` | `选择要分割的图像`     |

- [ ] **Step 2: Remove now-dead keys (only if unreferenced)**

Grep the whole `src/` for each candidate before deleting:

- `grep -rn "queue.segmentAll\b\|'segmentAll'\|segmentAllWithCount\|allImagesAlreadySegmented" src/`
- `segmentAll` / `segmentAllWithCount`: replaced by `segmentSelected` / `segmentSelectedWithCount`. If no remaining references, delete from all 6 locales.
- `projects.allImagesAlreadySegmented`: the guard toast now uses `queue.selectNothingTooltip`. If no remaining references, delete from all 6 locales.

Keep `resegmentSelected`, `segmentMixed`, `segmentTooltip`, `addingToQueue` (still used).

- [ ] **Step 3: Validate i18n completeness**

Run: `node scripts/check-i18n.cjs`. Expected: PASS (all keys present in all 6 locales, no orphans).

- [ ] **Step 4: Commit**

```bash
git add src/translations/
git commit -m "i18n(queue): segment-selected labels + tooltip; drop dead segment-all keys"
```

---

### Task 5: Verification

- [ ] **Step 1: Full local CI gate**

Run: `make ci`. Expected: TS clean, ESLint 0 warnings, i18n valid.

- [ ] **Step 2: Frontend unit tests for the helper**

Run: `docker compose exec frontend npx vitest run src/lib/segmentationSelection.test.ts`. Expected: 5 pass.

- [ ] **Step 3: Production bundle build (catches vite/minify/chunk issues — failure patterns #6/#14)**

Run: `make build-service SERVICE=frontend`. Expected: build succeeds (no "Could not resolve entry module").

- [ ] **Step 4: Runtime behaviour check (Playwright)**

Per CLAUDE.md gate A. Inject JWT for the test account and drive the project-detail page:

1. Nothing selected → Segment button **disabled**, tooltip "Select images to segment" (`browser_snapshot` + `browser_take_screenshot`).
2. Select 2 unsegmented images → label reads "Segment Selected (2)".
3. Click → `browser_network_requests`: `POST /queue/batch` body has exactly those 2 `imageIds`, `forceResegment=false`; no other (unselected) image enqueued.
4. Select 1 already-segmented image → label "Re-segment Selected (1)"; click → payload has that id with `forceResegment=true`.
5. `browser_console_messages` → zero errors.

Because verifying the exact network payload with real project data lives on production, and this requires a deploy, **STOP before deploying and ask the user for explicit permission to deploy to production** (CLAUDE.md production-safety gate). If permission is withheld, verify against the dev stack (`make up`, `localhost:3000`) with a small test project instead, and report what was and wasn't exercised.

- [ ] **Step 5: Update memory**

Record the change (selected-only segmentation default, the SSOT helper, the branch) as a `project` memory once merged/deployed.
