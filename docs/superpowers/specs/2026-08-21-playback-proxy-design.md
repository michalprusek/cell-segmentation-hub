# 8-bit WebP playback proxy for multi-channel video

**Status:** approved 2026-08-21 · **Supersedes:** nothing · **Depends on:** `c4ebed70` (static channel fetched once)

## The problem, measured

Playback of a three-channel microtubule container runs at **1.1 frames/s against a
10 fps target**. The cause is not the cache, the decoder or the server:

| Where the time goes (median, per channel request) |                |
| ------------------------------------------------- | -------------- |
| Wait in the client request throttle               | 1 ms           |
| TTFB                                              | 639 ms         |
| Download of 2115 kB                               | 1352 ms        |
| **The same request issued ON the server**         | **7 ms total** |

The server is idle-fast; the ~2 s is transport. Measured link capacity is a hard
ceiling — one stream gets 30.4 Mbit/s, four get 38.6, eight get 22.1 (congestion),
so concurrency does not help. RTT is 50 ms, so the user is not on the server's LAN.

At ~35 Mbit/s a cold three-channel frame (6.3 MB) cannot arrive faster than
~0.7 fps. Removing the static `irm` channel (`c4ebed70`) takes it to ~1.1.

**Lossless compression cannot close the gap.** First-order entropy of the data is
6.53 bit/px against PNG's 8.33, so PNG wastes ~28% — but five lossless variants
(byte-plane split, min-shift, horizontal delta, max-level PNG, and combinations)
top out at **1.3×**. The frames are microscopy noise, and noise does not compress.

**The headroom is elsewhere: we ship 11 bits at 1474 px to a canvas that shows
8 bits at ~600 px.** The data occupies 126–1566 — 526 distinct values in a 16-bit
container. Measured on one real frame:

|                              | Per frame  | 2 dynamic channels | fps at 35 Mbit/s |
| ---------------------------- | ---------- | ------------------ | ---------------- |
| Today (16-bit PNG)           | 2117 kB    | 4.13 MB            | 1.1              |
| 8-bit PNG, full res          | 1037 kB    | 2.03 MB            | 2.2              |
| **8-bit WebP q90, full res** | **265 kB** | **0.52 MB**        | **8.5**          |
| 8-bit PNG, half res          | 191 kB     | 0.37 MB            | 11.8             |

Full spatial resolution is kept. What is given up is bit depth the monitor cannot
show anyway, plus mild lossy compression.

## Decisions taken

1. **The proxy is what the canvas always draws.** Full data is fetched for export,
   segmentation and measurement — and for the narrow-window case below.
2. **Fixed mapping range, with a fallback.** The proxy is a linear map of a fixed
   per-channel range so the window/level sliders keep working unchanged. When the
   window narrows far enough that banding would show, the displayed frame is
   fetched at full depth.

   > **Revised during implementation — the range is PER FRAME.** Deploying the
   > per-channel version and looking at the numbers killed it: the measured
   > container's three channels peak at 8984, 1177 and 29636, so one range
   > across the container leaves the dimmest channel 9 of the 256 levels, and
   > one range across a channel leaves that channel's dimmest frame 30 (its own
   > maxima run 1950..8984). Per frame every frame gets all 256.
   >
   > The original objection to per-frame — each frame rescaled to its own
   > brightest pixel makes brightness flicker — turned out to be an artefact of
   > the other rejected design, drawing the 8-bit samples directly and rescaling
   > the window to match. The client instead multiplies the samples back out at
   > decode, which undoes the per-frame scaling exactly, so nothing flickers and
   > the only thing varying between frames is the quantisation step. The range
   > travels in the file name (`488_nm.p2047.webp`) and reaches the client as
   > `X-Proxy-Range`.
   >
   > The container-wide figure survives, in `ChannelMeta.proxyRangeMax`, for the
   > one thing it is still right for: judging whether the user's window is
   > narrow enough to need full depth.

3. **Generated lazily on first request and cached on disk.** Uploads do not slow
   down, space is spent only on videos someone actually plays, and existing
   projects need no backfill.

## Design

### Representation

`GET /api/images/:id/frame-data?channel=X&repr=proxy` returns an 8-bit grayscale
WebP (q90) of the same pixel dimensions. Without `repr`, the route behaves exactly
as today — the 16-bit PNG — so every existing caller is unaffected.

Cached at `…/frames/<NNNN>/<channel>.webp`, beside the PNG it derives from. Same
`framePngCache` headers: these files are as immutable as their source.

### The mapping range is per CONTAINER and CHANNEL

`value8 = round(value16 / rangeMax * 255)`, and `rangeMax` is fixed for the whole
channel. Deriving it per frame would make brightness flicker frame to frame, which
is the one failure mode that would make this feature worse than the problem.

Derived once, on the first proxy request for a channel: read the max of three
frames (first, middle, last) and round **up to the next power of two minus one**.
For the container measured here, max 1566 → range 0–2047, using 180 of the 256
available levels. Stored in the channel's metadata next to `staticSource`, so it is
computed once and is identical for every frame.

**A frame that exceeds the stored range is NOT clipped.** The server returns its
16-bit PNG instead. Clipping would silently destroy the brightest structures in a
measurement tool; serving one slow correct frame is the right trade.

The mapping itself is a pure function over a raw buffer — `sharp` is used to read
the 16-bit PNG as raw and to encode the resulting 8-bit buffer to WebP, but the
arithmetic lives in testable code rather than in a chain of image-library calls.

### Client

`png16Client` gains a WebP branch: `createImageBitmap` → `OffscreenCanvas` →
`getImageData`, taking one channel of the RGBA result. This is native and cheaper
than the current JS inflate, so decode cost drops as a side effect. It produces the
existing `DecodedGray` with `bitDepth: 8`, which `webglCompositor` already accepts
(`data: Uint16Array | Uint8Array`, with an `isShort` branch on upload).

The shader receives `rangeMax` so window/level continues to be expressed in the
original sample units. The sliders do not change meaning.

### Fallback to full depth

When the current window spans fewer than **32 of the proxy's 256 levels**, the
displayed frame is fetched as 16-bit PNG. Below ~32 levels banding becomes visible;
above it the proxy is indistinguishable.

The fallback applies to the DISPLAYED frame only, never to the prefetch window, so
scrubbing stays fast and the cache is not invalidated by slider movement.

## What does not change

Segmentation, tracking, kymographs, export and every measurement path continue to
read the original 16-bit PNGs. The proxy is only ever what gets drawn.

## Testing

- The 16→8 mapping: range ends, rounding, and a frame exceeding `rangeMax`
  producing the PNG fallback rather than clipped samples.
- Range derivation: fixed across frames of a channel; power-of-two rounding.
- Fallback threshold as a function of window width.
- A regression that a proxy request never reaches the export path.
- Browser measurement on the real container, repeating the method used to
  diagnose this: bytes and achieved frames/s before and after.

## Risks

- **WebP q90 is lossy DCT.** On noise it smooths the faintest structures. Requires
  a human A/B on a frame with the filaments of interest before this is called good.
- **~159 MB per played container** (2 dynamic channels × 300 frames × 265 kB).
  cvat2 is at 86% with 68 GB free and is shared with maptimize.
- Encoding competes with ML for CPU on a shared host; it runs through the existing
  image work queue rather than inline on the request thread.
