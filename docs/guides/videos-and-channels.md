# Videos, frames and channels

Everything about time-lapse and multi-channel data: how a video is stored, how
frames are navigated, how channels are displayed and combined, and the two
optional alignment features.

---

## The container / frame model

Uploading a video, an ND2 or a multi-page TIFF creates:

- **one container row** — the original recording. It holds the frame count, the
  calibration (`pixelSizeUm`, `frameIntervalMs`) and the **channel list**.
- **N frame rows** — one per time point, each with a `frameIndex` (0-based) and
  a name `"<video name> (frame N)"` (**N is 1-based** — the display is
  1-based, the internals are 0-based).

Two consequences you will notice:

- **The container is invisible in the gallery.** You see N frames and never the
  parent. Calibration is bubbled down onto the frames so the export dialog can
  read it.
- **Containers are never segmented.** Only frame rows are ever queued.

Deleting the last remaining frame deletes the container and its files as well,
in the same transaction — no orphan rows are left behind.

### Multi-position ND2

An ND2 recording several stage positions is **split**: P positions become P
independent containers named `<file name> — <position label>`, where the label
is the ND2's own point name (e.g. `D03_0000`) or `position N`. The uploaded
`.nd2` is deleted; each container keeps its own single-position 16-bit OME-TIFF.
The hard cap is **1536 positions**.

---

## Channels

Each container carries a channel list. A channel has:

| Field                  | Meaning                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `name`                 | Path-safe identifier; also the PNG filename. `A–Z a–z 0–9 _ -`, max 64 chars. |
| `displayName`          | The human label you see and can rename.                                       |
| `type`                 | `irm` or `fluorescent`. **There is no `tirf` type** — TIRF is `fluorescent`.  |
| `wavelengthNm`         | Emission wavelength when the file records it.                                 |
| `displayColor`         | Overlay tint.                                                                 |
| `isSegmentationSource` | **At most one channel per container.** The channel the model reads.           |

The channel's **position in the list is its C-axis index**; added channels are
always appended so that stays true.

### How channel names are derived

**ND2** files carry channel names, which are sanitised (non-alphanumerics become
`_`, over-long names are truncated with a hash suffix).

**TIFF** stacks rarely do, so four strategies are tried in order:

1. MetaMorph `WaveName` entries from the ImageJ `Info` block.
2. A shared slice label of the form `c:1/2 t:1/61 - WD_LED_IRM/TIRF_491`, split
   on the last `-` then on `/`.
3. Bio-Formats scaffolding stripped away — and if the remaining tails are all
   identical (the common case, where the tail is just the source filename),
   the channels become `c1`, `c2`, …
4. The raw labels, if they happen to be distinct.

If none of that yields distinct names, channels become **`Channel 1`,
`Channel 2`, …**. For TIFF the wavelength is guessed from the first 3–4 digit
run in 350–900 in the name, ignoring runs followed by `ms` (so `IRM_500ms` is
not read as 500 nm).

**MP4-like videos** get exactly one channel named `video`, typed `fluorescent`,
with no segmentation source set.

### Which channel gets segmented

A channel is auto-typed `irm` if its recorded wavelength is **exactly 0**, or if
its name contains any of the whole words **IRM, BF, DIC, TL, BRIGHTFIELD,
TRANSMITTED** (underscores count as word separators, so `IRM_WIDEFIELD`
matches). The first such channel is pre-selected as the segmentation source.

> **When nothing matches, no channel is marked as the source** and every
> consumer silently falls back to **channel 0**. For a microtubule project that
> is a real hazard: the model is IRM-only, so pointing it at a TIRF channel
> produces plenty of confident-looking polylines with no contrast underneath
> them. **Set the segmentation source explicitly** in the channels list, or in
> the channel picker that appears before Segment All.

### Renaming, colouring and toggling channels

In the editor sidebar, each channel row offers:

- a **checkbox** — include the channel in the composite;
- a **colour swatch** — pick the overlay tint;
- **double-click the name** — rename it (persisted);
- an **opacity slider**, 0–100 %.

The segmentation source is marked **"● src"**.

Default colours follow emission wavelength: unknown → grey `#cccccc`,
< 430 nm → blue, < 490 → cyan, < 530 → green, < 580 → yellow, < 620 → orange,
otherwise red.

Channel **colours and opacities are remembered** per user, in browser storage.
Window/level, brightness and contrast are **not** — see below.

---

## Displaying 16-bit data: window and level

Frames are stored at their native bit depth, so a 16-bit frame must be _windowed_
down to something a screen can show. Two sliders per channel — **Min** and
**Max** — set that window, plus a **Brightness** and **Contrast** pair (0–200 %,
100 % = unchanged) applied to the finished composite.

**The window is per channel, not global**, and the tab row above the sliders
selects which channel you are adjusting — defaulting to the segmentation source.

> This is not a cosmetic detail. When the window was shared, it auto-fitted to
> the **union** of every visible channel's range: an IRM channel spanning
> 2941–4145 was drawn through the 489–53 927 window its TIRF siblings had
> opened — about 2 % of the range, i.e. a flat grey field. That is the origin of
> the August 2026 report that "the model segments microtubules where there is
> nothing". ImageJ windows each channel of a composite separately for the same
> reason.

### The auto-fit rule

- A channel seen for the **first time** auto-fits to that frame's **full data
  minimum and maximum** — not a percentile, no saturation fraction. This
  matches ImageJ's behaviour when opening a 16-bit image.
- A channel that already has a window **keeps your cutoffs** and only _widens_
  its slider bounds as brighter frames arrive. Scrubbing never yanks the view,
  but new extremes stay reachable.
- A channel that fitted to a **flat frame** (an unilluminated time point) re-fits
  once a frame with real range appears — **unless you have moved the sliders**.
  After that the window is yours and is never auto-recovered, even if that
  leaves the channel white.
- Switching to a different container clears windows for channels that are not
  present, so a same-named channel of another video cannot inherit a stale
  window.

The Min/Max slider range adapts to the channel's **observed peak**, not to a
nominal bit depth — a channel that never exceeds 4095 gets a 0–4095 slider.

**Window, brightness and contrast are session-only.** They survive frame scrubs
(and brightness/contrast survive channel switches), but not a page reload.

---

## The multi-channel composite

Per channel: fetch its PNG → decode at native depth → apply _that channel's_
window to the true sample values → tint with the channel colour → composite
**additively**, the way multi-channel fluorescence emission actually adds. Later
channels in the list paint on top.

This runs in a WebGL2 fragment shader when the browser provides one — a frame
costs one texture upload and a slider drag costs one uniform update — with a CPU
path as fallback. Both produce the same image. Decoding is cached separately
from windowing, so dragging a slider never re-fetches anything.

---

## Navigating frames

The editor header shows frame controls whenever a container has more than one
frame:

- an editable **frame number** box (1-based, clamped),
- an **`N / M`** counter,
- a **scrubber**,
- **Play / Pause** between the Back and Next buttons.

| Key                         | Action                |
| --------------------------- | --------------------- |
| <kbd>←</kbd> / <kbd>→</kbd> | Previous / next frame |
| <kbd>Space</kbd>            | Play / pause          |

**Playback is a fixed 10 fps and stops at the last frame** rather than looping.
There is no frame-rate control.

The URL carries the **frame's own image id**, not a frame number. Playback
commits each tick immediately; manual scrubbing is debounced by 120 ms, and
pausing flushes the pending commit. Frames around the current one are
prefetched — 5 back, 10 ahead — with a small decode-ahead window.

### The playback proxy

To make scrubbing fast, the server generates an **8-bit grayscale WebP** beside
each 16-bit PNG (roughly 141 kB instead of 2.1 MB per frame). It is built
lazily in the background the first time a container's frames are fetched.

**You never see this and there is nothing to configure.** Points worth knowing:

- Each frame is mapped through **its own** range, rounded up to a power of two,
  so the proxy is per-frame — not a single global scale.
- If your window is narrower than 1/8 of the range, the client silently fetches
  the **full 16-bit frame** instead, so a tight window never shows 8-bit
  banding.
- If a proxy is missing or your browser cannot decode grayscale WebP, the
  original PNG is used. Nothing about a measurement ever comes from a proxy.
- Proxies are **never deleted**. Disk use grows with every container that gets
  played back.

---

## Channel registration (align at upload)

**Microtubule projects only.** When you drop a video into a microtubule project
a dialog offers **"Register & upload"** or **"Upload without registering"**.

Registration corrects small shifts _between channels_ by aligning each channel
to the **first** one, which never moves. It is a **translation only** — two
degrees of freedom, no rotation or scaling.

How it works, and why it survives multimodal data: each channel is reduced to a
**gradient-magnitude** map before phase correlation. IRM and fluorescence
intensities are not linearly related, but their _edges_ coincide. The estimated
shift is applied as a whole-pixel array shift with the vacated border zero-filled
— so it is **lossless for 16-bit data**, with no interpolation.

Two guards reject an implausible result and fall back to no shift:

- a peak further than **10 %** of the smaller image dimension is rejected as
  spurious;
- a peak-to-background ratio below **3.0** is rejected as too weak.

A sidecar `registration.json` records the reference channel and the per-frame
shifts, so a run can be audited later.

> **A rejected estimate is silent on this path.** Frames are written unshifted
> and the upload reports success. If channels still look misaligned after
> choosing "Register & upload", that is what happened.

---

## Add channel

**Microtubule projects only.** Select frames in the project gallery and click
**Add channel** to attach an extra imaging channel to them after the fact.

1. Select the target frames.
2. Drop **one** file — an image (`.png .jpg .jpeg .bmp`) or a video/stack
   (`.tif .tiff .mp4 .avi .mov .mkv .webm .nd2`).
3. Name the channel (max 128 characters; it is slugified to the 64-character
   path-safe form, with `_2`, `_3`, … appended on collision).
4. Optionally tick **"Align to segmentation channel"**.

Two source modes:

| Source               | Behaviour                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A single **image**   | Converted to grayscale and **stamped onto every selected frame**. The channel is marked as a static source.                                                                                        |
| A **video or stack** | Paired frame by frame. All selected frames must belong to **one** container, the source's frame count must **exactly equal** the number of selected frames, and the pixel grid must match exactly. |

The new channel is appended as `fluorescent`, never as the segmentation source,
and is backed by per-frame PNGs. If you selected only some frames, the channel
records which ones it covers.

Alignment failures here **do** surface, as a warning toast distinguishing "no
correlation", "implausible shift" and "size mismatch". The frames are still
added, unshifted.

> **A static (single-image) channel is segmented once, not per frame.** The
> queue projects the one result across every covered frame. This is not an
> optimisation detail you can ignore: one production container of 299 frames
> produced 30 498 polylines resolving to exactly 102 tracks — the same detection
> set counted 299 times — at a cost that overran the tracker's timeout.

---

## Segmenting a multi-channel video

**Segment All** (and **Resegment** in the editor) first opens a **channel
picker** on multi-channel containers. Your choice is stored per queue item and
the worker reads that channel's PNG.

For microtubule projects, cross-frame tracking runs automatically once **all**
frames of a container reach a final state. It is fire-and-forget: an ML timeout
is logged and produces no assignments, and a partial write-back can leave a
container half-tracked. If some frames have track colours and others do not, the
tracker needs re-running — it is not a model failure.

## Related

- [Uploading data](uploading-data.md) — formats, limits, routing
- [Microtubule projects](project-types/microtubules.md) — tracking, kymographs,
  type labels
- [Segmentation editor](segmentation-editor.md)
- [Glossary](../reference/glossary.md)
