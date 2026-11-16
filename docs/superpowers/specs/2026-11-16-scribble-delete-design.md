# Scribble delete in the segmentation editor — design

Approved by the owner 2026-11-16. Short design (a small change).

## Intent

The delete tool (`D`, `EditMode.DeletePolygon`) used to delete one shape per
click. Cleaning up many false detections — dozens of microtubules on a frame,
debris around a spheroid — meant one click per object. The tool becomes a
scribble eraser: drag across the canvas, every shape the scribble touches
fades while dragging, and is deleted on mouse release. `Esc` cancels the
scribble.

## Goals

- Drag with the left button in delete mode draws a scribble; shapes it touches
  fade live; release deletes them.
- A plain click still deletes (a one-point scribble).
- `Esc` during a scribble cancels it — nothing deleted, shapes restored, delete
  mode stays armed. A second `Esc` (no scribble) leaves to View as today.
- One scribble is one undo step and one toast.
- Tracked microtubules (non-empty `trackId` on an MT project) are asked about
  ONCE per scribble — "this frame / whole track" — and that answer applies to
  every tracked MT the scribble hit (owner's choice, mirrors the Shift
  multi-select bulk delete). Untracked shapes from the same scribble are
  deleted immediately.

## Non-goals / anti-goals

- Hidden shapes must never be deleted — only what is rendered can be hit.
- A fast stroke must not skip a thin polyline (events are rAF-coalesced).
- The separate `/segmenter` editor is out of scope.
- No "restore while dragging" (Excalidraw's Alt) — not requested.

## Approaches

1. **Geometric segment test in `useAdvancedInteractions` (chosen).** Modelled
   on Excalidraw's eraser (`packages/excalidraw/eraser/index.ts` @
   `b42b1a19`): each pointer move tests only the NEWEST scribble segment
   against candidates not yet hit, bbox prefilter first. Filled shapes: point
   inside OR segment within tolerance of the outline. Lines: segment-to-segment
   distance within a zoom-scaled tolerance. Pending shapes render at 20 %
   opacity (`ELEMENT_READY_TO_ERASE_OPACITY = 20`).
2. DOM hit-testing (`elementsFromPoint`, `pointerenter` on SVG paths) —
   rejected: mouse moves are coalesced to one per animation frame, so a fast
   stroke jumps over a 3 px polyline between two events; it also returns only
   the topmost element.
3. Raster mask — rejected: precision depends on mask resolution and
   rasterising thousands of MT polylines per move costs far more than the
   segment test, for no gain.

## Decided

- Hit rule, closed polygon: the scribble segment comes within the tolerance of
  its boundary, or a scribble point lies inside it. A point inside a HOLE
  (an `internal` polygon) is not inside the polygon that owns the hole — the
  hole is hit, the parent is not.
- Hit rule, polyline: segment-to-segment distance ≤ tolerance.
- Tolerance ≈ 6 screen px, divided by zoom (constant on screen). This is
  stricter than today's 12 px click band on polylines; deliberate, so a stroke
  through a dense MT field does not catch neighbours.
- Click = one-point scribble: deletes EVERY shape under the point (today: only
  the topmost). The old per-polygon `onClick` delete path no longer deletes.
- Candidates = exactly the list the canvas renders (`visiblePolygons`).
- Leaving the canvas mid-scribble keeps the scribble; a release anywhere
  commits it (same rule as vertex drag). Right-click mid-scribble cancels it.
- Cursor in delete mode: `crosshair`.
- Copy: mode instructions, shortcuts help, in-app docs — six languages.

## Left to the builder

- Exact tolerance and trail stroke width, tuned in a real browser on real MT
  data.
- How hole ownership is resolved when an `internal` polygon has no
  `parent_id` (geometric containment fallback).
- State shape and where the trail is drawn (`CanvasTemporaryGeometryLayer`).
