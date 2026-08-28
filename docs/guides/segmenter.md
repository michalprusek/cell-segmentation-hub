# Segmenter — few-shot polygon annotation

A standalone, class-based polygon annotation tool with its own datasets,
independent of projects and of the segmentation editor. It is the ground floor
of a planned few-shot active-learning workflow; today it is a **manual
annotation tool with no ML in it at all**.

**Routes:** `/segmenter`, `/segmenter/:datasetId`,
`/segmenter/:datasetId/image/:imageId`. All require sign-in.

> **There is no navigation link to the Segmenter anywhere in the UI.** It is
> reachable only by typing the URL. That is the current state, not an oversight
> in this documentation.

---

## What you can do today

1. **Create datasets.** A dataset is a bag of images plus its own class palette.
   Datasets are owner-only — there is no sharing.
2. **Upload static images.** Video-like files are rejected client-side with a
   toast: the segmenter accepts still images only. Limits are the app's image
   limits — **20 MB per file, 100 files per request**. Failed uploads are named
   explicitly rather than silently dropped.
3. **Define a class palette.** Any number of classes, each a name (1–100 chars)
   and a `#RRGGBB` colour. Renaming and recolouring are live.
   **Deleting a class does not delete its polygons** — it clears `classId` on
   every polygon that referenced it and reports how many images were touched.
   Unclassified polygons render grey (`#9ca3af`).
4. **Draw, edit and delete closed polygons**, assign each a class, undo/redo,
   and save.
5. **Delete individual images.** The grid badges images that already have an
   annotation.

Overlapping polygons — including two of the same class — are a **supported
case**, not a mistake. Nothing deduplicates or rejects on overlap.

---

## The editor

Deliberately a separate, much smaller editor from the main
[segmentation editor](segmentation-editor.md): it shares no code with the
video / microtubule / sperm machinery, only pure geometry helpers.

|                  | Segmenter editor                                            | Main segmentation editor                          |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| Edit modes       | **4** — View, Create polygon, Edit vertices, Delete polygon | **7** — adds Add points, Create polyline, Slice   |
| Geometry         | **Closed polygons only**, minimum 3 points                  | Polygons _and_ open polylines                     |
| Per-shape fields | `classId` + optional `instanceId`                           | `partClass`, `instanceId`, `trackId`, `mtType`, … |
| Saving           | **Explicit** — Save button or <kbd>Ctrl</kbd>+<kbd>S</kbd>  | Queue / WebSocket driven                          |
| Zoom range       | 0.1× – 15×, step 1.2×                                       | different constants                               |

### Drawing

- **Click** to place vertices.
- Click within ~12 screen pixels of the **first** vertex (once you have at least 3) to close the polygon; <kbd>Enter</kbd> also closes it.
- <kbd>Esc</kbd> cancels the polygon in progress.
- A new polygon takes the currently active class, or none if no class is active.

### Editing

- In **Edit vertices**, drag a vertex to move it.
- **Right-click a vertex** to delete it. Deletion is refused below 4 points —
  a triangle is the smallest valid polygon.

### Shortcuts

| Key                                                                          | Action                         |
| ---------------------------------------------------------------------------- | ------------------------------ |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd>                                     | Delete the selected polygon    |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd>                                                 | Undo                           |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Redo                           |
| <kbd>Ctrl</kbd>+<kbd>S</kbd>                                                 | Save                           |
| <kbd>Enter</kbd>                                                             | Close the polygon being drawn  |
| <kbd>Esc</kbd>                                                               | Cancel the polygon being drawn |

All are ignored while you are typing in a text field.

### Saving safely

Saving replaces the whole polygon array for that image (maximum **5000**
polygons). Two guards:

- Leaving with unsaved changes prompts a browser confirmation.
- If loading the existing annotation **failed** (anything other than a clean
  "no annotation yet"), **Save is disabled** and a retry banner appears —
  otherwise saving a canvas that never loaded would overwrite real work with an
  empty array.

---

## What is _not_ implemented

The design intent in
[`docs/superpowers/specs/2026-07-09-segmenter-fewshot-al-design.md`](../superpowers/specs/2026-07-09-segmenter-fewshot-al-design.md)
describes an active-learning loop. **None of the ML exists**:

- No in-context pre-labelling, no memory bank, no `/embed`, `/prelabel` or
  `/acquire` endpoint in the ML service.
- No active-learning acquisition, rounds, or convergence UI.
- No export in any format.
- No thumbnails (the grid scales the originals), no dataset sharing, no
  Add-points or Slice modes, and no navigation entry point.

Two things in that spec are also **stale** and should not be relied on: it says
"nothing implemented" (P0 has since shipped), and it proposes building on "the
frozen DINOv3-L already in production for microtubules" — DINOv3 was removed
from the platform with the v5H model swap in August 2026.

## Related

- [Segmentation editor](segmentation-editor.md) — the full-featured editor for
  project images
- [REST API](../api/README.md#segmenter) — the endpoints behind these pages
