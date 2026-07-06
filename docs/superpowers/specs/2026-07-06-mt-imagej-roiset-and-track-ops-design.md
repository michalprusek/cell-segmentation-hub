# MT ImageJ RoiSet export + cross-frame track operations

Date: 2026-07-06
Status: Approved (design), pending implementation
Project type scope: **microtubules only**

## Problem

Two pain points reported for microtubule (MT) projects:

1. **ImageJ export is unwieldy.** The MT export writes thousands of loose
   `.roi` files (`annotations/imagej/<video>/frame_NNNN/<trackId>.roi`).
   Biologists want **one file per video** they can drag-and-drop into
   ImageJ / Fiji. ImageJ cannot read `.nd2`, so the native single-file
   equivalent is a **RoiSet.zip** (loads into the ROI Manager).

2. **No cross-frame track editing from the canvas.** Users want, from the
   right-click menu on an MT polyline:
   - **Propagate** the polyline forward into all following frames.
   - **Delete** an MT to remove the **entire track** (all frames), not
     just the current frame.

## Decisions (locked with the user)

| Topic                      | Decision                                                                          |
| -------------------------- | --------------------------------------------------------------------------------- |
| Export format              | One `annotations/imagej/<video>_RoiSet.zip` per video container                   |
| Loose `.roi` files         | **Removed** — replaced by the zip (no dead output)                                |
| ROI colour                 | Per-`trackId` stroke colour, identical hue math to the editor                     |
| Propagate overwrite policy | **Overwrite** same-`trackId` polyline in every following frame; add where missing |
| Propagate range            | Forward only: `frameIndex > current`                                              |
| Delete scope               | **Whole track** — all frames of the video (past + future)                         |
| Delete confirmation        | Yes — dialog states the frame count                                               |
| Gating                     | Both editor features are microtubules-only                                        |

## Feature A — RoiSet.zip export

### ImageJ `.roi` format additions

The existing pure encoder `encodeImageJRoi(points, geometry, name)` writes a
zero-filled header and leaves two fields at 0. We extend it with an optional
`options` argument:

- **`position`** (int32 @ offset 56): 1-based stack slice = `frameIndex + 1`.
  Lets ImageJ place each ROI on its own frame of the opened stack.
- **`strokeColor`** (int32 @ offset 40): ARGB, alpha `0xFF` (opaque required or
  ImageJ treats the colour as unset). Value derived from the MT's colour key.

Back-compat: when `options` is omitted the bytes stay 0 (identical to today's
golden fixture).

### Colour parity (`backend/src/services/export/imagejColor.ts`, new)

Ports the frontend `instanceColors.ts` hue math so exported colours match the
editor exactly:

- `colorKeyForRoi(p)` — precedence `trackId || (mt_-prefixed instanceId) || id`
  (mirrors `CanvasPolygon.tsx`).
- djb2-style hash → `hue = |hash| % 360`; fixed `S=70%`, `L=55%` (unselected).
- HSL→RGB → `0xFF000000 | (r<<16)|(g<<8)|b`.

A parity unit test asserts a handful of keys produce the same hue as the FE
values in `instanceColors.test.ts`.

### Per-video zip exporter (`imagejRoiEncoder.ts`)

Replace `exportImageJRois` with **`exportImageJRoiSets`**:

- Group frames by `parentVideoId` (container row supplies the clean video
  label; multi-position ND2 splits already yield one container per position).
- For each video: open an `archiver('zip')` stream to
  `annotations/imagej/<videoLabel>_RoiSet.zip`. Process videos sequentially to
  cap open streams; append frames in `frameIndex` order.
- For each valid polyline/polygon: `position = frameIndex + 1`,
  `strokeColor = imageJStrokeColor(colorKeyForRoi(p))`, encode, append as
  entry `<safeLabel>__frame_<NNNN>.roi` (MT-first so the same track's ROIs are
  adjacent in the ROI Manager and globally unique).
- Preserve the return contract `{ frames, rois, warnings }`, corrupt-frame →
  warning, dropped-polygon → log, `shouldAbort()` between frames → `archive.abort()`
  - rethrow (cancellation stays fatal).
- Delete the now-dead loose-file path (`frameFolderName` etc.).

`exportService.ts`: swap the call, update the comment block.

## Feature B — Propagate track forward

### Backend

- Route: `POST /api/segmentation/videos/:videoId/tracks/propagate`
  body `{ fromFrameIndex, polyline: { trackId?, name?, points, geometry } }`.
- Controller `trackOpsController.ts` → service
  `segmentationService.propagateTrackGeometryForward(videoId, fromFrameIndex, polyline, userId)`:
  - Verify the user owns the video/project.
  - `trackId = polyline.trackId || generated 'mt_<uuid>'`.
  - In one Prisma transaction: for every child frame with `frameIndex > fromFrameIndex`,
    parse its polygons, drop any polyline with `trackId`, append a copy
    (fresh per-frame polygon `id`, shared `trackId`, `name`, `points`, `geometry`),
    write back.
  - Return `{ trackId, framesUpdated }`.

### Frontend

- `PolygonContextMenu.tsx`: new item "Propagate to following frames"
  (`ChevronsRight`), rendered only for `isMicrotubules && isPolyline`.
- `usePolygonHandlers.ts` + `SegmentationEditor.tsx`: handler reads the source
  polyline from the editor, calls `apiClient.propagateTrackForward(...)`, then on
  success patches the source polyline's `trackId` in editor state (so colour /
  next save stay consistent), refreshes via the reload-nonce, and toasts
  `framesUpdated`.
- `src/lib/api.ts`: `propagateTrackForward(videoId, fromFrameIndex, polyline)`.

## Feature C — Delete whole track

### Backend

- Route: `DELETE /api/segmentation/videos/:videoId/tracks/:trackId`.
- Service `deleteTrackAcrossVideo(videoId, trackId, userId)`: one transaction,
  remove every polyline with `trackId` from all child frames; return
  `{ framesAffected }`. Shared helper factored so the existing save-time delete
  propagation can reuse it (no duplicate delete logic).

### Frontend

- `PolygonContextMenu.tsx`: the delete `AlertDialog` becomes track-aware — when
  the polyline is an MT with a `trackId`, title/description say "delete the
  whole track across N frames" (`N` = the video's frame count, known to the
  editor); otherwise the current single-polygon copy.
- Delete handler: MT with `trackId` → `apiClient.deleteTrack(videoId, trackId)`
  - refresh + toast; otherwise the existing local `handleDeletePolygon`.

## i18n

New strings in all six files (`en, cs, es, de, fr, zh`); validate with
`node scripts/check-i18n.cjs`.

## Testing & verification

- **Unit:** `imagejColor.test.ts` (FE parity); extend `imagejRoiEncoder.test.ts`
  (position @56, stroke @40, golden unchanged when `options` omitted); service
  unit tests for `propagateTrackGeometryForward` / `deleteTrackAcrossVideo`
  (pure diff over fixture polygon arrays).
- **Feature A wire-level:** run `exportImageJRoiSets` on fixture frames, unzip,
  decode with Python `roifile`; assert ROI count, `position`, `stroke_color`,
  coordinates.
- **Features B/C cross-stack (gate F):** build FE + BE, exercise on the running
  stack with real MT data via Playwright — right-click → Propagate → scrub to a
  later frame → MT present with the same colour; delete track → confirm dialog
  with count → MT gone across frames; confirm via `docker logs spheroseg-backend`
  and a DB query; zero console errors.
- **Gate G:** `make build-service SERVICE=frontend` + backend build before done.

## Out of scope

- Backward propagation and "fill only missing frames" (explicitly deferred).
- Embedding the image + overlay into a single TIFF (RoiSet.zip chosen instead).
- Time-aware geometry interpolation between frames (propagation is a frozen copy).
