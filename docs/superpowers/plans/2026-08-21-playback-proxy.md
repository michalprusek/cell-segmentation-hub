# 8-bit WebP playback proxy — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** the editor canvas draws multi-channel video from 8-bit WebP proxies so playback reaches ~10 fps over a ~35 Mbit/s link, while every measurement path keeps reading the original 16-bit PNGs.

**Architecture:** a Python helper converts a channel's frames to WebP beside the PNGs; the backend serves them under `?repr=proxy`, generating lazily in the background and falling back to the PNG whenever the proxy is absent or would misrepresent the frame; the client decodes WebP natively into the existing `DecodedGray` shape and hands the compositor an 8-bit channel plus the mapping range.

**Tech Stack:** Node/Express + Prisma, Python 3 (numpy, PIL 11 with WebP), React + WebGL2 compositor, vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-playback-proxy-design.md`

> **This plan is a historical record and is stale in its details.** It was
> written before two things changed under it: the mapping range moved from
> per-container to per-frame (so the `--range-max` argument below does not
> exist, the file name carries the range, and there is no over-range case), and
> the range seeding was split from the conversion so the feature can bootstrap.
> The spec carries the revision notes; the code and its tests are the authority.
> Kept unedited because what a plan got wrong is worth being able to read.

## Global Constraints

- `rangeMax` is per CONTAINER and CHANNEL, never per frame — a per-frame range makes brightness flicker.
- A frame whose max exceeds `rangeMax` is served as 16-bit PNG, never clipped.
- Segmentation, tracking, kymographs and export keep reading the original PNGs. The proxy is only ever drawn.
- No request path may block on encoding; generation is a background batch.
- Measured on cvat2: 141 kB/frame/channel, 274 ms to encode, 85 MB per 300-frame 2-channel container.
- `sharp` CANNOT be used to READ these PNGs — verified: its pipeline narrows 16-bit to 8-bit (max 1566 reads back as 6), with or without `pipelineColourspace`/`toColourspace`/`extractChannel`. Decoding is Python's job.

## File structure

| File | Responsibility |
| ----------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| `backend/src/services/video/pythonHelpers/make_playback_proxy.py` | create | one channel's frames → WebP; prints per-frame outcome as JSON lines |
| `backend/src/services/playbackProxyRange.ts` | create | pure: derive `rangeMax` from sampled maxima; decide PNG-vs-proxy for a window |
| `backend/src/services/playbackProxyService.ts` | create | locate/queue/serve proxies; owns the lazy batch |
| `backend/src/api/controllers/videoController.ts` | modify | honour `?repr=proxy` |
| `backend/src/services/video/types.ts` | modify | `proxyRangeMax?: number` on `ChannelMeta` |
| `src/lib/webpGray.ts` | create | WebP blob → `DecodedGray` (bitDepth 8) |
| `src/lib/png16Client.ts` | modify | route a WebP blob to `webpGray` |
| `src/pages/segmentation/hooks/segmentationPolygonCache.ts` | modify | `repr=proxy` in the URL when the proxy is wanted |
| `src/pages/segmentation/components/canvas/MultiChannelCanvas.tsx` | modify | pass `rangeMax` to the compositor; ask for full depth on a narrow window |
| `src/types/index.ts` | modify | `proxyRangeMax` on `VideoChannel` |

---

### Task 1: range arithmetic (pure, TS)

**Files:** create `backend/src/services/playbackProxyRange.ts`, test `backend/src/services/__tests__/playbackProxyRange.test.ts`

**Produces:**

- `deriveRangeMax(maxima: number[]): number` — next power of two minus one, at least 255
- `PROXY_LEVELS = 256`, `MIN_LEVELS_IN_WINDOW = 32`
- `windowNeedsFullDepth(windowMin, windowMax, rangeMax): boolean`

Tests: `[1566] → 2047`; `[126, 1566, 900] → 2047`; `[2048] → 4095`; `[0] → 255`; `[]` throws. Window covering the whole range → false; window of 1/32 of the range → true; inverted window handled like the display code does (swap).

### Task 2: the Python converter

**Files:** create `.../pythonHelpers/make_playback_proxy.py`, test `.../pythonHelpers/tests/test_make_playback_proxy.py`

**CLI:** `make_playback_proxy.py --frames-dir DIR --channel NAME --range-max N [--limit N]`
Walks `DIR/<NNNN>/<channel>.png`, writes `<channel>.webp` beside each, prints one JSON line per frame: `{"frame":"0004","status":"written"|"skipped-exists"|"over-range","bytes":N}`.

`over-range` (frame max > `range-max`) writes NOTHING — the service serves the PNG for that frame.

Mapping: `clip(v * 255 // range_max, 0, 255)` as uint8, saved `quality=90`.

Tests: a synthetic 16-bit PNG maps its max to 255 and its zero to 0; a frame above `range-max` is reported `over-range` and leaves no file; re-running reports `skipped-exists`.

### Task 3: proxy service

**Files:** create `backend/src/services/playbackProxyService.ts`, test alongside.

**Produces:**

- `proxyPathFor(framesDir, frameIndex, channel): string`
- `ensureChannelProxies(containerId, channel): void` — idempotent; starts at most one batch per (container, channel); runs through the existing image work queue
- `resolveFrameResponse(container, frameIndex, channel, wantProxy): {kind:'proxy'|'png', path:string}`

Tests: a present `.webp` resolves to `proxy`; an absent one resolves to `png` AND schedules a batch; a second call while a batch runs does not schedule a second; `wantProxy=false` never resolves to `proxy`.

### Task 4: route + metadata

**Files:** modify `videoController.ts`, `video/types.ts`, `imageRoutes.ts` (only if the cache preset needs to cover `.webp` — it already does, same route).

`?repr=proxy` resolves through the service; anything else behaves exactly as today. `rangeMax` is derived on the first proxy request from `sharp(...).stats()` over first/middle/last frame (stats DOES report true 16-bit maxima — only the pixel pipeline narrows) and persisted to `ChannelMeta.proxyRangeMax`.

Test: existing frame-data tests still pass untouched; `repr=proxy` on a container without proxies returns the PNG and leaves `proxyRangeMax` set.

### Task 5: client WebP decode

**Files:** create `src/lib/webpGray.ts`, test alongside; modify `png16Client.ts`.

**Produces:** `decodeWebpGray(blob): Promise<DecodedGray>` — `createImageBitmap` → `OffscreenCanvas` → `getImageData`, take the R byte of each pixel, compute min/max, `bitDepth: 8`.

`png16Client` picks the decoder by blob type, so every existing caller keeps working.

Test: a WebP blob of a known ramp decodes to the expected samples and min/max. (jsdom lacks `createImageBitmap`; the test stubs it the way the existing worker tests stub theirs.)

### Task 6: draw from the proxy

**Files:** modify `segmentationPolygonCache.ts` (URL), `MultiChannelCanvas.tsx`, `src/types/index.ts`.

`buildFrameImageUrl(frameId, channel, opts?: {repr?: 'proxy'})`. The canvas asks for `proxy` unless `windowNeedsFullDepth(...)` says otherwise, and passes `rangeMax` into `computeChannelUniforms` so window/level stays in original sample units.

The cache key must include the representation — an 8-bit and a 16-bit decode of the same frame are different entries.

Tests: proxy URL shape; a narrow window produces a non-proxy URL for the DISPLAYED frame while the prefetch window keeps asking for proxies; cache keys differ by representation.

### Task 7: verify and deploy

Typecheck gate, full touched-area test run, `npm run build`. Deploy needs BOTH backend and frontend this time — warn the user before the backend restart (in-flight ND2 uploads die with it). Then repeat the browser measurement from the spec: bytes and achieved frames/s, and an A/B of one frame proxy-vs-original for the user to judge the lossy smoothing.
