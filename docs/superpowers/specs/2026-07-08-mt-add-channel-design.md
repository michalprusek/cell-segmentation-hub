# MT "Add channel" to selected frames — design

**Date:** 2026-07-08
**Scope:** Microtubule (`type === 'microtubules'`) projects only.
**Goal:** From the project gallery, let the user append an extra image channel to a
set of selected video frames by uploading either a matching-length video/stack or a
single image.

## User story

In an MT project a second acquisition (e.g. a fluorescence video, or a static
reference image) is captured of the same field. The user selects frames in the
gallery, clicks **Add channel** (next to _Delete annotations_ in the selection
toolbar), uploads the source, names the channel, optionally aligns it, and the new
channel becomes available in the editor and every export — exactly on the frames
they selected.

## Decisions (from brainstorming)

1. **Coverage = exactly the selected frames.** The channel is written only for the
   selected frame rows. Other frames of the same video do **not** get it.
2. **Alignment = user toggle** in the dialog (default OFF). ON → per-frame phase
   correlation against that frame's segmentation-source PNG.
3. **Source = video/stack/ND2 or single image; all source channels added.** A
   multi-channel source (2-channel ND2/TIFF) appends all its channels.
4. **Naming = user-provided; type `fluorescent`, `isSegmentationSource:false`.**
5. **Multi-video:** a multi-frame (video/stack) source is allowed only when the
   selection lies within a **single** video (`M === selectedCount`, paired by
   ascending `frameIndex`). A **single-image** source stamps onto every selected
   frame across any number of videos.

## Architecture facts this relies on

- Video container = hidden `Image` row (`isVideoContainer=true`) carrying
  `channels: ChannelMeta[]`. Each frame is a child `Image` row (gallery tile).
- On disk: `projects/<pid>/images/<containerId>/frames/<TTTT>/<channelName>.png`,
  built by `frameStorageKey()` (`videoUploadService.ts`).
- Channel PNG served by `GET /images/:id/frame-data?channel=<name>` (already 404s
  cleanly when absent).
- `MultiChannelCanvas` treats a 404 channel as `null` and composites the rest — so
  partial coverage renders fine in the editor.
- `ChannelMeta = { name, displayName?, type:'irm'|'fluorescent', wavelengthNm?,
displayColor?, isSegmentationSource }`. `name` matches `/^[A-Za-z0-9_-]{1,64}$/`
  and equals the on-disk filename.
- `channel_registration.py` exposes `estimate_translation(ref, moving) -> (dy,dx,conf)`
  and `shift_frame(arr, dy, dx)` (lossless integer shift).
- Extractors (`extract_nd2.py`, `extract_tiff_stack.py`, ffmpeg path) write
  `frames/<TTTT>/<chan>.png` + return `{frameCount,width,height,channels[...]}`.

## Backend

**Route:** `POST /projects/:id/images/add-channel` (in `imageRoutes.ts`), guarded by
`authenticate`, `uploadSingleVideo` multer (large limit — source may be a video),
`handleUploadError`. Controller `VideoController.addChannel`.

**Request (multipart/form-data):**

- `file` — the source (video/stack/nd2/png/jpg/tiff)
- `channelName` — friendly label; slugified to a path-safe machine `name`
- `align` — `'true' | 'false'`
- `imageIds` — JSON array of selected frame Image ids

**Response:** `{ addedChannels: string[], affectedContainerIds: string[], framesWritten: number }`

**Service `addChannelService.ts` — `addChannelToFrames(params)`:**

1. Load project; assert `type === 'microtubules'` and ownership (via project scope).
2. Load selected frames by id, scoped to project; drop container rows / standalone
   rows without `parentVideoId`. Group by `parentVideoId`.
3. Detect source kind by extension.
4. Extract source to a temp dir:
   - video/tiff/nd2 → `extractVideoSafe` → temp `frames/<j>/<chan>.png` + `{M,W,H,channels}`.
     (Reject a multi-position ND2 — not meaningful as an added channel.)
   - png/jpg → `sharp` grayscale decode → one temp frame, one channel `{1,W,H}`.
5. Validate:
   - multi-frame source (`M>1`) ⇒ all selected frames share one `parentVideoId` and
     `M === selectedCount`; else 400 with a clear message.
   - each target frame's seg-source PNG dimensions must equal `W×H`; else 400.
6. Build final `ChannelMeta[]` from the source channels: machine `name` = slug of
   `channelName` (+ `_2`,`_3`… per source channel), deduped against the container's
   existing channel names; `displayName` = `channelName` (+ ` (n)`); `type:'fluorescent'`,
   `isSegmentationSource:false`, `displayColor` from source wavelength if present.
7. For each (target frame, source channel):
   - **align OFF** → `fs.copyFile(tempPng, frameStorageKey(pid, container, frameIndex, name))`.
   - **align ON** → batched Python call `add_channel_align.py` with a manifest
     `[{moving, reference, out}]`; it reads moving+reference, `estimate_translation`,
     `shift_frame`, writes `out`. Reuses `channel_registration.py`.
8. Append the new `ChannelMeta[]` to each affected container's `channels` JSON
   (dedupe) in a transaction.
9. Cleanup temp dir (always, even on failure).

**Python driver `add_channel_align.py`** (new, in `pythonHelpers/`): stdin/arg JSON
manifest of `{moving, reference, out}` triples → for each, load both PNGs (imageio),
`estimate_translation(ref, mov)`, `shift_frame(mov, dy, dx)`, save `out` preserving
dtype. No new deps (numpy + imageio already used).

### PNG-backed vs volume-backed channels (pivotal)

Traced from code:

- **Editor** composites channels from per-frame PNGs (`MultiChannelCanvas`) → an
  added channel works automatically.
- **Kymograph** also reads per-frame PNGs (`kymographService.ts` builds
  `frames/<TTTT>/<name>.png`, ML `PILImage.open`) → works automatically.
- **MT intensity metrics** (`mt_metrics.py`) reads the **original ND2/TIFF volume**
  and indexes channels by their **position in the `channels` JSON array**
  (`resolveChannelIndices` → `findIndex`). An added channel has no slot in the
  original file, so this path must sample it from the per-frame PNGs instead.

Per-frame PNGs are **lossless** for uint8/uint16/int16 (`_to_png_dtype` — no
percentile clip; only float rescales), so PNG sampling is accurate. Added channels
are written losslessly (extractor output is already 16-bit; the single-image path
uses `sharp` with bit-depth preserved).

**Mechanism:** mark added channels with `pngBacked: true` on their `ChannelMeta`.
Added channels are always **appended** to `channels` JSON, so volume-backed channels
keep their array-index == C-axis-index (existing metrics unaffected).

- `mtMetricsExporter.ts`: partition selected channels into volume-backed (send
  `channel_indices`/`channel_names` as today) and `pngBacked` (send names only in a
  new `png_channels: string[]`). Registration `channel_offsets` apply only to
  volume-backed channels.
- `mt_metrics.py`: for `png_channels`, load `dirname(original_path)/frames/<t:04d>/<name>.png`
  per frame; emit rows + channel-summary only for frames whose PNG exists (partial
  coverage → simply fewer rows, never a crash). No `channel_offsets` applied.

**Partial-coverage tolerance:** a frame missing a channel PNG is normal (coverage =
exactly the selected frames). Editor drops it (404→null); metrics/kymograph skip it.
Nothing throws.

## Frontend

- **`ProjectToolbar.tsx`**: new `onAddChannel?` + `canAddChannel?` props; render an
  **Add channel** button inside the `selectedCount > 0` block, before _Delete
  annotations_, only when `canAddChannel` (project type `microtubules`).
- **`AddChannelDialog.tsx`** (new, mirrors `SegmentChannelDialog`): file input,
  channel-name text field, align switch, live summary ("N frames across M videos",
  single-video hint for video sources), submit + progress + error toast.
- **`ProjectDetail.tsx`**: wire `handleAddChannel` (opens dialog), pass selected ids,
  on success invalidate/refetch project data + close dialog + success toast.
- **`apiClient`**: `addChannel(projectId, { file, channelName, align, imageIds }, onProgress)`
  building `FormData`, mirroring the existing video-upload method.
- **i18n**: keys in all 6 locales (`project.addChannel`, dialog labels, validation +
  toast messages).

## Testing / verification

- Unit: slug/dedupe of channel names; pairing + validation rules
  (`addChannelService` pure helpers); `add_channel_align.py` alignment on a
  synthetic shifted pair.
- Playwright (per CLAUDE.md gate F, cross-stack): on the test account, MT project →
  select frames → Add channel (single image, then a matching-length stack) → confirm
  toast, then open the editor and confirm the new channel appears in the channel list
  and composites; scrub to an unselected frame and confirm no console error and the
  channel is simply absent. Console must be error-free.
- Export: run an MT metrics export after adding a channel to a subset; confirm rows
  for unselected frames are null (not crashing) and selected frames carry intensity.

## Out of scope

- No Prisma schema change (channels are JSON + files on disk).
- No resizing of mismatched dimensions (reject instead — channels share a pixel grid).
- No re-segmentation triggered by adding a channel.
