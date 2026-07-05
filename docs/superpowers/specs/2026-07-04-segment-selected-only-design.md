# Segment only selected images (drop "segment all unsegmented" default)

- **Date:** 2026-07-04
- **Status:** Approved (design), pending implementation
- **Scope:** Frontend only. All project types (universal, not gated).

## Problem / current behaviour

The project detail page has a single primary **Segment** button
(`QueueStatsPanel` → `handleSegmentAll` in `ProjectDetail.tsx`). Today it
enqueues **two groups**:

1. **Every** unsegmented / failed / pending image in the whole project —
   **regardless of the user's selection**.
2. Any **selected** images that are already segmented → re-segment
   (`forceResegment=true`).

So selection currently only _adds_ already-segmented images for a re-run; it
never _restricts_ the unsegmented set. Clicking Segment on a fresh project
enqueues everything.

The backend (`POST /api/queue/batch`, `queueController.ts:196`) is already
selection-agnostic: it segments exactly the explicit `imageIds` array the
frontend sends. There is no "segment all" flag on the wire. **The all-vs-selected
decision is 100 % frontend.**

## Desired behaviour

The Segment button **always acts on the current selection only** ("strict
selected-only"):

- Images **not** selected are never enqueued.
- Selected images that are unsegmented/failed/pending → segmented
  (`forceResegment=false`).
- Selected images that are already segmented → re-segmented
  (`forceResegment=true`).
- Selected images already `queued`/`processing` → skipped (already in flight),
  same as today.
- **Nothing selected** → button is **disabled** with tooltip "Select images to
  segment". To segment the whole project, the user clicks the existing
  **Select All** toolbar checkbox first, then Segment.

This applies to **all project types** (the button is the same component
everywhere; no project-type gating).

## Design

### 1. Enqueue logic — `handleSegmentAll` (`ProjectDetail.tsx:1304-1326`)

Replace the current two-group filter with selection-gated groups:

```ts
const selectedToSegment = images.filter(
  img =>
    selectedImageIds.has(img.id) &&
    (img.segmentationStatus === 'pending' ||
      img.segmentationStatus === 'failed' ||
      img.segmentationStatus === 'no_segmentation' ||
      !img.segmentationStatus)
);

const selectedToResegment = images.filter(
  img =>
    selectedImageIds.has(img.id) &&
    (img.segmentationStatus === 'completed' ||
      img.segmentationStatus === 'segmented')
);
```

- `selectedToSegment` → `processImageChunks(..., forceResegment=false)`.
- `selectedToResegment` → `processImageChunks(..., forceResegment=true)`.
- If both are empty, guard early (see edge cases). Existing chunking
  (`processImageChunks`, 500/chunk → `apiClient.addBatchToQueue`) is unchanged.

### 2. Button state, label, counts

- Counts derived from the **selection**, not project-wide. `ProjectDetail`
  computes `selectedToSegmentCount` and `selectedToResegmentCount` and passes
  them to `QueueStatsPanel` (replacing / supplementing the project-wide
  `imagesToSegmentCount` memo at `ProjectDetail.tsx:391-399`).
- Label logic in `QueueStatsPanel.tsx:64-105`:
  - `selectedToSegmentCount > 0 && selectedToResegmentCount === 0` →
    **"Segment Selected (N)"** (new key `queue.segmentSelectedWithCount`).
  - `selectedToSegmentCount === 0 && selectedToResegmentCount > 0` →
    **"Re-segment Selected (N)"** (existing `queue.resegmentSelected`).
  - both > 0 → **"Segment X + Re-segment Y"** (existing `queue.segmentMixed`).
  - both === 0 → disabled, label falls back to a static "Segment Selected"
    (new key `queue.segmentSelected`), tooltip
    `queue.selectNothingTooltip` = "Select images to segment".
- Disabled gating (`QueueStatsPanel.tsx:191 & 206`,
  `totalToProcess = selectedToSegmentCount + selectedToResegmentCount`):
  disabled whenever `totalToProcess === 0`.

### 3. i18n (all 6 locales: en, cs, es, de, fr, zh)

Add under the `queue` object:

- `segmentSelected: 'Segment Selected'` (disabled/static label)
- `segmentSelectedWithCount: 'Segment Selected ({{count}})'`
- `selectNothingTooltip: 'Select images to segment'`

Reuse existing `resegmentSelected`, `segmentMixed`, `addingToQueue`. Validate
with `node scripts/check-i18n.cjs`.

### 4. Consequence to flag (intentional)

"Select All → Segment" now re-runs **already-completed** images too, because
they are selected. This is the honest meaning of "segment what's selected"; the
label makes it explicit ("Re-segment Selected" / "Segment X + Re-segment Y"), so
it is never silent. Users who only want the unsegmented images can filter by
status before selecting.

## Edge cases

- **Empty processable selection** (nothing selected, or only queued/processing
  images selected): `totalToProcess === 0` → button disabled; the click handler
  is unreachable, but keep the existing early-return guard + toast
  (`projects.allImagesAlreadySegmented`) as defence in depth.
- **`handleSelectAll` selects all _filtered_ images** (not just the current
  page) — unchanged; this is what preserves the segment-everything workflow.
- Selection state (`selectedImageIds`) already survives filtering/pagination in
  `ProjectDetail`; no change needed.

## Files to change

- `src/pages/ProjectDetail.tsx` — `handleSegmentAll` filter (1304-1326), count
  memo (391-399), props passed to `QueueStatsPanel` (~1560-1573).
- `src/components/project/QueueStatsPanel.tsx` — label/count/disabled logic
  (64-105, 181-225).
- `src/translations/{en,cs,es,de,fr,zh}.ts` — 3 new `queue.*` keys each.

No backend, ML, or DB changes.

## Out of scope

- No new separate buttons (single button, repurposed).
- No change to `handleCancelSegmentation`, batch delete, or the queue backend.
- No change to per-image checkbox or Select-All mechanics themselves.

## Verification (CLAUDE.md gate A — UI/behaviour change)

Playwright MCP against `https://spherosegapp.utia.cas.cz` (inject JWT per the
usual pattern):

1. Open a project with a mix of segmented + unsegmented images.
2. Select nothing → button disabled, tooltip "Select images to segment",
   `browser_snapshot` confirms disabled state.
3. Select 2 unsegmented images → label reads "Segment Selected (2)".
4. Click → `browser_network_requests`: the `POST /queue/batch` payload contains
   exactly those 2 `imageIds`, `forceResegment=false`.
5. Select 1 already-segmented image → label "Re-segment Selected (1)"; click →
   payload has that 1 id with `forceResegment=true`.
6. `browser_console_messages` → zero errors throughout.
7. Confirm no other unsegmented (unselected) image was enqueued (queue stats /
   network payload only lists selected ids).
