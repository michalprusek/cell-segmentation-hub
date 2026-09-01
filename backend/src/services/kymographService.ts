/**
 * Backend orchestrator for the kymograph modal.
 *
 * Given a video container, a polyline ID and a frame index, this service:
 *
 * 1. Resolves the polyline from the chosen frame's Segmentation.
 * 2. If the polyline carries a ``trackId``, gathers every sibling polyline
 *    sharing that trackId across all frames (tracked geometry).  Otherwise
 *    it reuses the same polyline geometry across every frame as a static
 *    reference line — mirrors the ImageJ Multi Kymograph plugin's
 *    behaviour.
 * 3. Resolves the per-frame PNG path for the requested channel.
 * 4. POSTs the bundle to the ML service's ``/kymograph`` endpoint, which
 *    samples raw image intensity along each polyline and renders a
 *    viridis heatmap.
 *
 * Returns the ML response verbatim — frontend handles PNG/CSV download
 * UX.
 *
 * Callers that ask again for the same render (the editor modal, every time it
 * is reopened) can opt in to a Redis response cache with ``useCache``; see
 * the "Response cache" section below for the key and its bounds.
 *
 * Callers that build MANY kymographs of ONE container (the MT export: every
 * microtubule x every channel) load its rows once with
 * ``loadKymographContainerContext`` and hand the result to every call as
 * ``containerContext``, instead of repeating the same queries — and the same
 * multi-MB polygon decode — per kymograph. They should also send them through
 * ``buildKymographBatch`` rather than one ``buildKymograph`` at a time: same
 * bodies, one HTTP call, and the ML service then decodes each frame ONCE for
 * every polyline instead of once per polyline.
 */

import * as path from 'path';
import { createHash } from 'crypto';
import axios from 'axios';
import { prisma } from '../db/prismaClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { cacheService, CacheService } from './cacheService';
import { CHANNEL_NAME_RE } from './video/types';

/** Net-velocity cut-off (µm/s): trajectories slower than this are dropped as
 *  non-processive (oscillatory / static blobs are not directed transport).
 *  Applied in the ML service, which needs the container calibration to turn
 *  this µm/s threshold into px/frame. */
const MIN_NET_VELOCITY_UM_S = 0.01;

/** Mirrors the pattern accepted by the ML KymographRequest. Defence in
 *  depth — the controller layer also validates. */
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/** Signal-band width used when the caller passes no `intensityWidth`.
 *
 *  NOT the kymograph's line width: it is the number of columns
 *  `track_intensity` reads off the FINISHED kymograph, centred on a detected
 *  trajectory, with two background bands of the same width a 2-column guard to
 *  either side.
 *
 *  Raised 3 -> 5 on 2026-09-01 at the user's request. Signal and background
 *  bands widen together, so every `intensitySignal` / `intensityBackground` /
 *  `intensityMinusBackground` in `velocity_metrics.xlsx` changes: sheets from
 *  before that date are not comparable with later ones. */
const DEFAULT_INTENSITY_WIDTH = 5;

// ---------------------------------------------------------------------------
// Response cache
// ---------------------------------------------------------------------------

const CACHE_NAMESPACE = 'kymograph';

/** Bump when a cached `KymographServiceResult` stops being what this build
 *  would produce — in SHAPE (fields the new code expects are missing) or in
 *  CONTENT (the same request now renders different pixels or different
 *  numbers). Entries written by an older build then hash to a different key
 *  instead of being served.
 *
 *  2 (2026-09-01): the column cap was removed, so every kymograph of a
 *  microtubule longer than 200 px is now a different image, and the
 *  intensity-band default went 3 -> 5, so every velocity row's intensity
 *  columns moved. Both are visible in the descriptor below anyway — the
 *  `targetWidth` field left it and `intensityWidth` changed value — but a
 *  reader should not have to derive that from a hash to know old entries are
 *  unreachable. */
const CACHE_SCHEMA_VERSION = 2;

/** 30 minutes.
 *
 *  The key is content-addressed — it carries every render parameter plus a
 *  per-frame ``updatedAt`` staleness token — so the TTL is NOT what keeps the
 *  cache honest: an edit invalidates by changing the key, not by expiring.
 *  The TTL is purely a footprint bound, and there has to be one, because the
 *  production Redis runs with ``maxmemory 0`` and ``noeviction`` (measured
 *  2026-08-31) and so reclaims nothing on its own. 30 minutes covers the
 *  reported pain — close the modal, reopen it, scrub back to the same
 *  polyline — while capping a pathological session (a new polyline every
 *  20 s for half an hour) at roughly 90 entries x 0.6 MB = 55 MB. */
const CACHE_TTL_SECONDS = CacheService.TTL_PRESETS.MEDIUM;

/** Skip caching a response larger than this once serialized.
 *
 *  Measured on the 300-frame container 1990f89e (56 MB of polygons JSON,
 *  30 790 polylines): the editor modal's response is 611 KB — a 128 KB PNG
 *  plus a 483 KB CSV — so 4 MB leaves ~6.5x headroom for the velocity overlay
 *  and a long track table. A backstop, not the main defence: the caller that
 *  produces genuinely huge results (``renderProfiles``, one matplotlib PNG
 *  per frame) does not opt in to the cache at all. */
const CACHE_MAX_BYTES = 4 * 1024 * 1024;

interface PolylineRecord {
  id: string;
  points?: Array<{ x: number; y: number }>;
  geometry?: string;
  trackId?: string;
  instanceId?: string;
}

/** Which kymograph end(s) a trajectory reaches (motor continues onto MT outside
 *  the imaged segment). Closed set — kept in sync with the ML `edge_touch`
 *  return and the FE `KymographTrack.edge`. */
export type EdgeFlag = 'left' | 'right' | 'both' | 'none';

/** Raw track shape returned by the ML ``/kymograph`` endpoint: velocity +
 *  displacement in kymograph columns/frame, intensity in raw pixel units, time
 *  in frames. Converted to the calibrated (µm/s velocity, µm length, s time)
 *  camelCase shape below. Per-run detail is not exposed — only the two
 *  processive totals. */
interface MlTrack {
  points: KymoPoint[];
  net_pxframe: number;
  snr: number;
  total_run_time_frames: number;
  total_run_displacement_px: number;
  edge: EdgeFlag;
  intensity_signal: number | null;
  intensity_background: number | null;
  intensity_minus_bg: number | null;
  bright: boolean;
}

export interface KymographServiceInput {
  videoContainerId: string;
  polylineId: string;
  frameIndex: number;
  sourceChannel: string;
  /** Optional hex `#RRGGBB`. When supplied, the ML service renders the
   *  kymograph as a black-to-color linear gradient instead of viridis,
   *  matching the channel tint the user picked in the editor. */
  channelColor?: string;
  /** When true, the ML service also runs blob-motion detection and the
   *  result carries one ``KymographTrack`` per moving particle. */
  detectVelocity?: boolean;
  /** When true (with detectVelocity), the result carries ``overlayPngBase64``
   *  — the kymograph with detected tracks composited on top. Used by export. */
  renderOverlay?: boolean;
  /** Width (kymograph position columns) of the signal band sampled around each
   *  trajectory for the background-subtracted intensity metric. Defaults to
   *  `DEFAULT_INTENSITY_WIDTH` (5 since 2026-09-01). */
  intensityWidth?: number;
  /** When true, the ML service also renders one matplotlib line plot per frame
   *  (intensity vs. position along the microtubule) and the result carries
   *  ``profiles``. Used by the "intensity profiles" export mode. */
  renderProfiles?: boolean;
  /** Restrict the kymograph/profiles to these frame indices (the export image
   *  selection). When omitted, every frame of the container is used (the editor
   *  modal's full-kymograph behaviour). Frames not in the set are excluded from
   *  the sampled matrix, so both the ML render cost and the output scope shrink
   *  to the selection. */
  frameFilter?: number[];
  /** Build the intensity-matrix CSV. Defaults TRUE, so every existing caller
   *  gets exactly today's result.
   *
   *  Worth turning off when the caller does not read `csvBase64`: it is by far
   *  the largest part of the response — 483 KB of the editor modal's 611 KB on
   *  a 300-frame container — and the kymograph-mode export never touches it
   *  (it writes the overlay PNG and the velocity workbook). Batched, that is
   *  the difference between a 35.9 MB and a 14.4 MB response for 60
   *  microtubules; measured 2026-09-01 on container 4972cad8.
   *
   *  Setting it false makes `KymographServiceResult.csvBase64` null, so only
   *  set it from a caller that has checked. */
  includeCsv?: boolean;
  /** Opt in to the Redis response cache. Opt-IN, not opt-out, on purpose.
   *
   *  Only the interactive modal sets it: it asks for the same (container,
   *  polyline, channel) again every time the user reopens the dialog, so a hit
   *  is likely and the entry earns its space. The export fan-out deliberately
   *  does not — it renders every polyline of every container exactly once, in
   *  one pass, and would push thousands of 0.6 MB entries that nothing will
   *  ever read into a Redis running `maxmemory 0` / `noeviction`. A 20-video,
   *  2-channel project at MAX_MT_PER_CONTAINER would be ~1.4 GB of write-only
   *  cache, on the instance that also holds sessions. */
  useCache?: boolean;
  /** Pre-loaded per-container rows (see `loadKymographContainerContext`).
   *  Every kymograph of one container reads the identical container + frame
   *  rows and differs only in the polyline geometry sampled from them, so a
   *  caller building many of them loads them once and passes them here.
   *  Omitted by the editor modal, which builds exactly one — and which
   *  deliberately reads the polygons LATE and narrowly instead (see
   *  `fetchPolygonsByFrame`). */
  containerContext?: KymographContainerContext;
}

/** One per-frame intensity profile rendered as a matplotlib PNG. Mirrors the ML
 *  ``ProfilePng`` (frame index + base64 PNG). */
export interface KymographProfile {
  frame: number;
  pngBase64: string;
}

/** A sub-pixel trajectory sample: `[frame, xPosition]` along the polyline. */
export type KymoPoint = [frame: number, x: number];

/** One moving particle detected on the kymograph. `netVelocityUmPerSec`,
 *  `totalRunLengthUm` and `totalRunTimeS` are null when the container lacks the
 *  relevant calibration (pixel size and/or frame interval). */
export interface KymographTrack {
  points: KymoPoint[]; // time-ordered
  netVelocityPxPerFrame: number;
  netVelocityUmPerSec: number | null;
  snr: number;
  /** Total processive distance (µm) and time in directed motion (s). */
  totalRunLengthUm: number | null;
  totalRunTimeS: number | null;
  /** Background-subtracted intensity along the trajectory (raw pixel units). */
  intensitySignal: number | null;
  intensityBackground: number | null;
  intensityMinusBackground: number | null;
  /** Which kymograph end(s) the trajectory reaches. */
  edge: EdgeFlag;
  /** True when this trajectory's signal is an intensity outlier (median + k·MAD)
   *  relative to the other tracks on the same kymograph — likely a multi-motor
   *  aggregate rather than a single motor. */
  bright: boolean;
}

export interface KymographServiceResult {
  pngBase64: string;
  /** The sampled intensity matrix as base64 CSV. `null` ONLY when the caller
   *  passed `includeCsv: false`; never as a degraded fallback, so a caller that
   *  asked for it and got null has hit a bug. The editor modal never opts out,
   *  so the route that serves it always answers with a string. */
  csvBase64: string | null;
  frameCount: number;
  lengthPx: number;
  tracked: boolean;
  sourceChannel: string;
  /** Container calibration (null when the source upload had no metadata). */
  pixelSizeUm: number | null;
  frameIntervalMs: number | null;
  /** Detected moving particles; present only when ``detectVelocity`` was set. */
  tracks?: KymographTrack[];
  /** How many tracks the net-velocity cut-off hid as non-processive. Lets the UI
   *  distinguish "hidden below 0.01 µm/s" from "nothing detected". 0 otherwise. */
  filteredTrackCount: number;
  /** Set when ML velocity detection crashed (vs. legitimately finding no
   *  particles). Lets callers surface a failure instead of a silent empty table. */
  velocityError?: string;
  /** Base64 PNG of the kymograph + tracks; present only with ``renderOverlay``. */
  overlayPngBase64?: string;
  /** Per-frame intensity-profile plots; present only with ``renderProfiles``. */
  profiles?: KymographProfile[];
}

/** Resolves the on-disk PNG path for a given frame + channel. */
function framePngPath(
  projectId: string,
  videoContainerId: string,
  frameIndex: number,
  channelName: string
): string {
  return path.join(
    config.UPLOAD_DIR,
    'projects',
    projectId,
    'images',
    videoContainerId,
    'frames',
    String(frameIndex).padStart(4, '0'),
    `${channelName}.png`
  );
}

function parsePolygons(json: string | null | undefined): PolylineRecord[] {
  if (!json) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as PolylineRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Raw ``Segmentation.polygons`` JSON for the named frames, keyed by frame
 *  index. Fetched separately from the frame metadata (and only for the frames
 *  whose geometry is actually read) because the polygons column dominates the
 *  cost of this service: 56 MB for one real 300-frame container.
 *
 *  Doing the ``trackId`` lookup inside Postgres instead was measured on that
 *  container and is SLOWER, so it is deliberately not done here:
 *  ``jsonb_array_elements(polygons::jsonb)`` took 1097 ms and the ``::json``
 *  variant 724 ms, against 459 ms to ship the text plus 285 ms to
 *  ``JSON.parse`` it in Node — the cast has to re-parse all 56 MB on every
 *  call, and it burns shared database CPU to do it. */
async function fetchPolygonsByFrame(
  videoContainerId: string,
  frameIndices: number[]
): Promise<Map<number, string | null>> {
  const byFrame = new Map<number, string | null>();
  if (frameIndices.length === 0) {
    return byFrame;
  }
  const rows = await prisma.image.findMany({
    where: {
      parentVideoId: videoContainerId,
      frameIndex: { in: frameIndices },
    },
    // `(parentVideoId, frameIndex)` is indexed but NOT unique, so a duplicated
    // frame row (an orphan or re-extraction artefact) would otherwise resolve
    // to whichever row Postgres happened to return first — and back two
    // different renders under one cache key. Order it explicitly.
    orderBy: [{ frameIndex: 'asc' }, { id: 'asc' }],
    select: {
      frameIndex: true,
      segmentation: { select: { polygons: true } },
    },
  });
  const wanted = new Set(frameIndices);
  for (const row of rows) {
    // First row wins on a duplicated frame index.
    if (
      row.frameIndex != null &&
      wanted.has(row.frameIndex) &&
      !byFrame.has(row.frameIndex)
    ) {
      byFrame.set(row.frameIndex, row.segmentation?.polygons ?? null);
    }
  }
  return byFrame;
}

/** Per-frame staleness token. ``seg`` is the load-bearing half: a resegment or
 *  a polyline edit bumps ``Segmentation.updatedAt`` and so changes the cache
 *  key. ``img`` costs nothing extra (same row) and additionally catches a
 *  frame whose image record was rewritten — a re-extracted channel PNG changes
 *  the pixels the kymograph samples without touching the segmentation. */
interface FrameStamp {
  f: number;
  img: number;
  seg: number | null;
}

/** Everything the ML render depends on, hashed into one key.
 *
 *  Note the frame stamps carry the frame SET as well as its contents, so a
 *  ``frameFilter`` and a frame being added or deleted both change the key.
 *  The container id stays in the clear as a prefix: it keeps the key
 *  greppable in ``redis-cli --scan`` and leaves a per-container
 *  ``invalidatePattern`` open should one ever be needed.
 *
 *  The kymograph's WIDTH is not listed because it is no longer an input: since
 *  2026-09-01 it is one column per pixel of the seed polyline's arc length, and
 *  editing that polyline bumps its frame's ``Segmentation.updatedAt`` — i.e.
 *  ``frames[].seg`` already covers it. */
function kymographCacheKey(
  input: KymographServiceInput,
  container: {
    updatedAt: Date;
    pixelSizeUm: number | null;
    frameIntervalMs: number | null;
  },
  frames: FrameStamp[]
): string {
  const descriptor = JSON.stringify({
    v: CACHE_SCHEMA_VERSION,
    polylineId: input.polylineId,
    frameIndex: input.frameIndex,
    sourceChannel: input.sourceChannel,
    channelColor: input.channelColor ?? null,
    detectVelocity: input.detectVelocity === true,
    renderOverlay:
      input.detectVelocity === true && input.renderOverlay === true,
    renderProfiles: input.renderProfiles === true,
    intensityWidth: input.intensityWidth ?? DEFAULT_INTENSITY_WIDTH,
    minNetVelocityUmS: MIN_NET_VELOCITY_UM_S,
    // Container calibration scales every velocity/length in the result. Held
    // explicitly as well as via `containerUpdatedAt` so the key stays correct
    // even for a backfill written with raw SQL, which does not bump the row's
    // updatedAt. `containerUpdatedAt` covers the rest of the container row —
    // notably the `channels` JSON.
    pixelSizeUm: container.pixelSizeUm ?? null,
    frameIntervalMs: container.frameIntervalMs ?? null,
    containerUpdatedAt: container.updatedAt.getTime(),
    frames,
  });
  return `${input.videoContainerId}:${createHash('sha256')
    .update(descriptor)
    .digest('hex')}`;
}

/** Store a freshly rendered kymograph, unless it is transient or oversized. */
async function cacheKymographResult(
  key: string,
  result: KymographServiceResult,
  context: { videoContainerId: string; polylineId: string }
): Promise<void> {
  // A crashed velocity run and a render that came back without a PNG are both
  // transient ML failures. Caching either would pin the failure in front of
  // the user for the whole TTL, and a retry would never reach the ML service.
  if (result.velocityError || !result.pngBase64) {
    return;
  }
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > CACHE_MAX_BYTES) {
    logger.info('Kymograph too large to cache', 'KymographService', {
      ...context,
      bytes,
      limit: CACHE_MAX_BYTES,
    });
    return;
  }
  await cacheService.set(key, result, {
    namespace: CACHE_NAMESPACE,
    ttl: CACHE_TTL_SECONDS,
  });
}

// ---------------------------------------------------------------------------
// Per-container rows
// ---------------------------------------------------------------------------

/** Raised by both frame loaders, so the two cannot drift apart. */
const NO_FRAMES_ERROR = 'No frames found for the given video container';

/** What every code path needs about a frame: its identity, its position in
 *  the video, and the two timestamps the response-cache key is stamped with.
 *  Deliberately WITHOUT the polygons column — that is the expensive half, and
 *  is read separately and only when it is actually going to be looked at. */
interface KymographFrameMeta {
  id: string;
  frameIndex: number | null;
  /** `Image.updatedAt`. */
  updatedAt: Date;
  /** `Segmentation.updatedAt`; null when the frame has no segmentation. */
  segmentationUpdatedAt: Date | null;
}

/** One frame of a prefetched container context. `polygonsJson` is kept RAW
 *  and parsed at most once, into `parsed`, on the first call that reads this
 *  frame's geometry: a 300-frame microtubule container carries ~30 MB of
 *  polygon JSON, and the static-line (untracked) path only ever reads the
 *  seed frame's copy. */
export interface KymographContextFrame extends KymographFrameMeta {
  polygonsJson: string | null;
  /** Memoised `parsePolygons(polygonsJson)` — populated on first read. */
  parsed?: PolylineRecord[];
}

/**
 * Everything `buildKymograph` reads from the database for ONE video container.
 *
 * Every kymograph of a container needs the identical rows — the container
 * record and every frame's segmentation — and only the polyline geometry
 * differs between them. Loading it per call therefore re-fetched the same
 * ~30 MB of polygon JSON once per (microtubule x channel): the export of a
 * real 300-frame, 3-channel, 60-microtubule container issued 180 identical
 * pairs of queries and pulled 5.6 GB through Prisma, all of it decoded and
 * materialised on the single Node event loop (so it stalled the rest of the
 * API too). Callers that build many kymographs for one container load this
 * once and pass it to every call.
 */
export interface KymographContainerContext {
  container: {
    id: string;
    projectId: string;
    channels: unknown;
    pixelSizeUm: number | null;
    frameIntervalMs: number | null;
    /** Part of the response-cache key — covers the rest of the container row,
     *  notably the `channels` JSON. */
    updatedAt: Date;
  };
  /** Every frame of the container, frameIndex-ascending — including frames
   *  with no segmentation, which still contribute an image to sample. */
  frames: KymographContextFrame[];
}

/** The container row, validated as a video container. Shared by both entry
 *  points so the two see the same fields and raise the same error. */
async function loadContainerRow(
  videoContainerId: string
): Promise<KymographContainerContext['container']> {
  const row = await prisma.image.findUnique({
    where: { id: videoContainerId },
    select: {
      id: true,
      projectId: true,
      isVideoContainer: true,
      channels: true,
      pixelSizeUm: true,
      frameIntervalMs: true,
      updatedAt: true,
    },
  });
  if (!row || !row.isVideoContainer) {
    throw new Error('videoContainerId does not refer to a video container');
  }
  return {
    id: row.id,
    projectId: row.projectId,
    channels: row.channels,
    pixelSizeUm: row.pixelSizeUm ?? null,
    frameIntervalMs: row.frameIntervalMs ?? null,
    updatedAt: row.updatedAt,
  };
}

/** Frame METADATA only — deliberately without `segmentation.polygons`. This
 *  query used to carry the polygons of every frame (56 MB, 459 ms, plus
 *  285 ms of event-loop-blocking JSON.parse on a real 300-frame container)
 *  purely to find one sibling polyline per frame. Everything needed to build
 *  the cache key is here, so a cache hit — and every static-line render — now
 *  costs ~8 ms of database time instead of ~745 ms. */
async function loadFrameMetadata(
  videoContainerId: string
): Promise<KymographFrameMeta[]> {
  const rows = await prisma.image.findMany({
    where: { parentVideoId: videoContainerId },
    orderBy: { frameIndex: 'asc' },
    select: {
      id: true,
      frameIndex: true,
      updatedAt: true,
      segmentation: { select: { updatedAt: true } },
    },
  });
  if (rows.length === 0) {
    throw new Error(NO_FRAMES_ERROR);
  }
  return rows.map(row => ({
    id: row.id,
    frameIndex: row.frameIndex,
    updatedAt: row.updatedAt,
    segmentationUpdatedAt: row.segmentation?.updatedAt ?? null,
  }));
}

/**
 * Load the per-container rows `buildKymograph` needs, once, for a caller that
 * is about to build many kymographs of the same container.
 *
 * This one DOES pull every frame's polygons, unlike the metadata-only load
 * above, because the alternative is re-reading them per kymograph. It is the
 * right trade only for the bulk caller: with 180 builds over one container
 * the polygons are read once instead of 180 times, whereas the editor modal
 * builds a single kymograph and would rather not read them at all.
 *
 * The channel whitelist is NOT applied here: a context is channel-agnostic —
 * one load serves every channel of the container — so `buildKymograph`
 * applies it per call instead.
 */
export async function loadKymographContainerContext(
  videoContainerId: string
): Promise<KymographContainerContext> {
  const container = await loadContainerRow(videoContainerId);

  const rows = await prisma.image.findMany({
    where: { parentVideoId: videoContainerId },
    orderBy: { frameIndex: 'asc' },
    select: {
      id: true,
      frameIndex: true,
      updatedAt: true,
      segmentation: { select: { polygons: true, updatedAt: true } },
    },
  });
  if (rows.length === 0) {
    throw new Error(NO_FRAMES_ERROR);
  }

  return {
    container,
    frames: rows.map(row => ({
      id: row.id,
      frameIndex: row.frameIndex,
      updatedAt: row.updatedAt,
      segmentationUpdatedAt: row.segmentation?.updatedAt ?? null,
      polygonsJson: row.segmentation?.polygons ?? null,
    })),
  };
}

/**
 * Stored polylines for the named frames, keyed by frame index.
 *
 * With a prefetched context the rows are already in memory and each frame's
 * JSON is parsed at most ONCE, however many kymographs are built from that
 * context. Without one, exactly these frames' `polygons` are read from the
 * database — the column that dominates this service's cost, so it is read as
 * late and as narrowly as possible.
 */
async function polylinesForFrames(
  context: KymographContainerContext | undefined,
  videoContainerId: string,
  frameIndices: number[]
): Promise<Map<number, PolylineRecord[]>> {
  const byFrame = new Map<number, PolylineRecord[]>();
  if (context) {
    const wanted = new Set(frameIndices);
    for (const frame of context.frames) {
      if (frame.frameIndex == null || !wanted.has(frame.frameIndex)) {
        continue;
      }
      if (frame.parsed === undefined) {
        frame.parsed = parsePolygons(frame.polygonsJson);
      }
      byFrame.set(frame.frameIndex, frame.parsed);
    }
    return byFrame;
  }
  for (const [index, json] of await fetchPolygonsByFrame(
    videoContainerId,
    frameIndices
  )) {
    byFrame.set(index, parsePolygons(json));
  }
  return byFrame;
}

/** Everything one kymograph needs from the database, resolved BEFORE any
 *  polygon JSON is read. Split out of `buildKymograph` so the batch entry
 *  point can do this per input, and so the Redis cache lookup still happens
 *  between this step and the expensive one (see `buildKymograph`). */
interface KymographPlan {
  container: KymographContainerContext['container'];
  seedMeta: KymographFrameMeta;
  /** Frames that will actually be sampled, in frameIndex order. */
  selectedFrames: Array<KymographFrameMeta & { frameIndex: number }>;
  /** null = "all frames" (editor modal / unfiltered export). */
  frameFilterSet: Set<number> | null;
}

async function planKymograph(
  input: KymographServiceInput
): Promise<KymographPlan> {
  const {
    videoContainerId,
    frameIndex,
    sourceChannel,
    channelColor,
    frameFilter,
    containerContext,
  } = input;

  // Selected-frame scope (export image selection). A Set for O(1) membership;
  // null means "all frames" (editor modal / unfiltered export).
  const frameFilterSet =
    frameFilter && frameFilter.length > 0 ? new Set(frameFilter) : null;

  // Defence in depth: reject any sourceChannel containing path separators
  // or other unsafe characters. The route layer also validates, but this
  // service is a public entry point for any future caller.
  if (!CHANNEL_NAME_RE.test(sourceChannel)) {
    throw new Error('Invalid sourceChannel');
  }
  if (channelColor !== undefined && !HEX_COLOR_RE.test(channelColor)) {
    throw new Error('Invalid channelColor (expected #RRGGBB)');
  }

  // A mismatched context is loud, because it would otherwise be silent and
  // plausible: the frame paths below are built from the CONTEXT's projectId
  // and the INPUT's container id, so it would yield a kymograph of some other
  // container's frames (or of nothing) under this container's calibration.
  if (containerContext && containerContext.container.id !== videoContainerId) {
    throw new Error(
      `containerContext is for ${containerContext.container.id}, ` +
        `not ${videoContainerId}`
    );
  }
  const container =
    containerContext?.container ?? (await loadContainerRow(videoContainerId));

  // Whitelist sourceChannel against the container's declared channels. Runs on
  // BOTH paths: a prefetched context is channel-agnostic — one load serves
  // every channel of the container — so it cannot have been validated against
  // this call's channel.
  const declared = Array.isArray(container.channels)
    ? (container.channels as Array<{ name: string }>).map(c => c.name)
    : [];
  if (declared.length > 0 && !declared.includes(sourceChannel)) {
    throw new Error(`Unknown source channel: ${sourceChannel}`);
  }

  // Metadata for every frame: enough to build the cache key, and to decide
  // which frames are rendered, without touching a single polygon.
  const allFrames: KymographFrameMeta[] =
    containerContext?.frames ?? (await loadFrameMetadata(videoContainerId));
  const seedMeta = allFrames.find(f => f.frameIndex === frameIndex);
  if (!seedMeta) {
    throw new Error(`Frame ${frameIndex} not found in container`);
  }

  // Frames that will actually be sampled, in frameIndex order. `frameIndex` is
  // nullable on the column, never null on a video frame row.
  const selectedFrames = allFrames.filter(
    (f): f is typeof f & { frameIndex: number } =>
      f.frameIndex != null &&
      (!frameFilterSet || frameFilterSet.has(f.frameIndex))
  );

  return { container, seedMeta, selectedFrames, frameFilterSet };
}

/** The ML `/kymograph` request body — one item of a `/kymograph/batch` too.
 *
 *  No `target_width`: the ML service sizes the column axis from the seed
 *  polyline's arc length and has ignored the field since 2026-09-01. It still
 *  ACCEPTS it (its models are `extra="forbid"`, so removing it there would 422
 *  an un-recreated Node), which is what makes the deploy order free here. */
interface MlKymographBody {
  frames: Array<{
    frame: number;
    polyline_rc: number[][];
    image_path: string;
  }>;
  tracked: boolean;
  intensity_width: number;
  min_net_velocity_um_s: number;
  pixel_size_um?: number;
  frame_interval_ms?: number;
  channel_color?: string;
  detect_velocity?: true;
  render_overlay?: true;
  render_profiles?: true;
  include_csv?: false;
}

/** Read the geometry this kymograph samples and build the ML request body.
 *  This is the expensive half (it is what parses the container's polygon
 *  JSON), which is why `buildKymograph` checks the response cache first. */
async function buildMlBody(
  input: KymographServiceInput,
  plan: KymographPlan
): Promise<{ body: MlKymographBody; trackedMode: boolean }> {
  const {
    videoContainerId,
    polylineId,
    frameIndex,
    sourceChannel,
    channelColor,
    detectVelocity,
    renderOverlay,
    intensityWidth,
    renderProfiles,
    containerContext,
  } = input;
  const { container, selectedFrames } = plan;

  // The seed frame comes first because it is what decides whether ANY other
  // frame's polygons are needed at all.
  const seedPolygons =
    (
      await polylinesForFrames(containerContext, videoContainerId, [frameIndex])
    ).get(frameIndex) ?? [];
  const seedPolyline = seedPolygons.find(p => p.id === polylineId);
  if (!seedPolyline || !Array.isArray(seedPolyline.points)) {
    throw new Error(`Polyline ${polylineId} not found in frame ${frameIndex}`);
  }

  const trackId = seedPolyline.trackId;
  const trackedMode = typeof trackId === 'string' && trackId.length > 0;

  // Sibling geometry, keyed by frame index. Static-line mode reuses the seed
  // polyline on every frame, so it never reads another frame's polygons —
  // which is the whole 56 MB.
  const geometryByFrame = new Map<number, Array<{ x: number; y: number }>>();
  if (trackedMode) {
    const siblingPoints = (
      polygons: PolylineRecord[]
    ): Array<{ x: number; y: number }> | null => {
      const sibling = polygons.find(p => p.trackId === trackId);
      return sibling && Array.isArray(sibling.points) ? sibling.points : null;
    };
    // The seed frame is already parsed; re-parsing it here was 190 KB of pure
    // waste on every tracked request.
    const seedSibling = siblingPoints(seedPolygons);
    if (seedSibling) {
      geometryByFrame.set(frameIndex, seedSibling);
    }
    const otherFrames = selectedFrames
      .map(f => f.frameIndex)
      .filter(idx => idx !== frameIndex);
    for (const [idx, polygons] of await polylinesForFrames(
      containerContext,
      videoContainerId,
      otherFrames
    )) {
      const points = siblingPoints(polygons);
      if (points) {
        geometryByFrame.set(idx, points);
      }
    }
  }

  const framesPayload = selectedFrames.map(f => ({
    frame: f.frameIndex,
    // Fallback: reuse the seed-frame polyline as a static reference line.
    polyline_rc: (
      geometryByFrame.get(f.frameIndex) ??
      (seedPolyline.points as Array<{ x: number; y: number }>)
    ).map(pt => [pt.y, pt.x]),
    image_path: framePngPath(
      container.projectId,
      videoContainerId,
      f.frameIndex,
      sourceChannel
    ),
  }));

  // Calibration: null when the upload carried no pixel size / frame interval
  // (older videos, non-microscopy formats). Resolved BEFORE the ML call so the
  // calibration + velocity cut-off can be forwarded (the ML service applies the
  // µm/s filter, since only it renders the overlay that must match the table).
  const pixelSizeUm = container.pixelSizeUm ?? null;
  const frameIntervalMs = container.frameIntervalMs ?? null;

  const body: MlKymographBody = {
    frames: framesPayload,
    tracked: trackedMode,
    intensity_width: intensityWidth ?? DEFAULT_INTENSITY_WIDTH,
    min_net_velocity_um_s: MIN_NET_VELOCITY_UM_S,
    // Forward calibration only when usable (> 0). The ML field is gt=0, and
    // 0 means "uncalibrated" here — sending it would 422 the whole request.
    ...(pixelSizeUm != null && pixelSizeUm > 0
      ? { pixel_size_um: pixelSizeUm }
      : {}),
    ...(frameIntervalMs != null && frameIntervalMs > 0
      ? { frame_interval_ms: frameIntervalMs }
      : {}),
    ...(channelColor ? { channel_color: channelColor } : {}),
    ...(detectVelocity ? { detect_velocity: true as const } : {}),
    ...(detectVelocity && renderOverlay ? { render_overlay: true as const } : {}),
    ...(renderProfiles ? { render_profiles: true as const } : {}),
    // Omitted (not `true`) when the CSV is wanted, so a caller that does not
    // touch `includeCsv` posts byte-for-byte the body it posted before this
    // field existed.
    ...(input.includeCsv === false ? { include_csv: false as const } : {}),
  };
  return { body, trackedMode };
}

/** How long to wait for an ML kymograph call.
 *
 *  120 s was right when trajectory detection was 0.03-0.2 s of numpy. It is
 *  not right for KymoButler: measured 2.6-131.7 s per kymograph on CPU on
 *  2026-08-31 (the spread is box load and torch thread count; the GPU path
 *  could not be measured, the host driver was mismatched). At 120 s a single
 *  slow kymograph aborts here while the ML service keeps working on it, so
 *  the editor modal shows a timeout and a batch export — one job per
 *  polyline x channel — dies partway through. Detection is also serialised
 *  one-at-a-time on the ML side, so a queued request waits for the one ahead
 *  of it as well. 10 minutes covers the measured worst case with room for
 *  both, and still fails rather than hanging forever.
 *
 *  It applies UNCHANGED to a batch, which is deliberate: batching does not
 *  make one kymograph slower, and the whole 60-microtubule batch measured
 *  13.2 s against 186.2 s for the same work one request at a time. */
const ML_KYMOGRAPH_TIMEOUT_MS = 600_000;

/** The ML `/kymograph` response, as this service reads it. Every optional
 *  field is still re-checked at runtime below: the mapping has to degrade on a
 *  malformed response rather than throw halfway through it. */
interface MlKymographPayload {
  png_base64: string;
  /** null only when the request set `include_csv: false`. */
  csv_base64: string | null;
  frame_count: number;
  length_px: number;
  px_per_column?: number;
  filtered_track_count?: number;
  tracks?: MlTrack[];
  overlay_png_base64?: string;
  velocity_error?: string;
  profiles?: Array<{ frame: number; png_base64: string }>;
}

/** Turn one ML response into the service's calibrated, camelCase result. */
function mapMlPayload(
  input: KymographServiceInput,
  plan: KymographPlan,
  trackedMode: boolean,
  payload: MlKymographPayload
): KymographServiceResult {
  const { videoContainerId, polylineId, sourceChannel, detectVelocity } = input;
  const pixelSizeUm = plan.container.pixelSizeUm ?? null;
  const frameIntervalMs = plan.container.frameIntervalMs ?? null;

  // ML velocities + run displacements are in kymograph COLUMNS; one column spans
  // `pxPerColumn` image pixels. Since the column cap was removed (2026-09-01)
  // that is 1.0 to within the rounding of the column count and can no longer
  // exceed it — the multiplication below is kept because it is still the right
  // conversion, not because it currently rescales anything. Scale columns -> µm
  // via `umPerColumn`, and frames -> s via `secPerFrame`. All null when the
  // relevant calibration is absent (treat 0 as uncalibrated, consistently with
  // the >0 forwarding guard above).
  const pxPerColumn =
    typeof payload.px_per_column === 'number' && payload.px_per_column > 0
      ? payload.px_per_column
      : 1;
  const umPerColumn =
    pixelSizeUm != null && pixelSizeUm > 0 ? pixelSizeUm * pxPerColumn : null;
  const secPerFrame =
    frameIntervalMs != null && frameIntervalMs > 0
      ? frameIntervalMs / 1000
      : null;
  const toUms = (colPerFrame: number): number | null =>
    umPerColumn != null && secPerFrame != null
      ? (colPerFrame * umPerColumn) / secPerFrame
      : null;
  const toUmLength = (cols: number): number | null =>
    umPerColumn != null ? cols * umPerColumn : null;
  const toSeconds = (frames: number): number | null =>
    secPerFrame != null ? frames * secPerFrame : null;

  // Distinguish "velocity detection crashed in ML" (velocity_error set) from
  // "no particles found" (tracks: []). The ML field was previously dropped here,
  // making the two indistinguishable downstream.
  const velocityError =
    typeof payload.velocity_error === 'string' && payload.velocity_error
      ? payload.velocity_error
      : undefined;
  if (velocityError) {
    logger.error(
      `ML kymograph velocity detection failed: ${velocityError}`,
      undefined,
      'KymographService',
      { videoContainerId, polylineId }
    );
  }

  // Surface a contract violation: detection was requested but the ML service
  // returned no tracks[] array (vs. legitimately empty). Don't let it look
  // identical to "no particles found".
  if (detectVelocity && !Array.isArray(payload.tracks)) {
    logger.warn(
      'ML kymograph response missing tracks[] despite detectVelocity',
      'KymographService',
      { videoContainerId, polylineId }
    );
  }
  const tracks: KymographTrack[] | undefined = Array.isArray(payload.tracks)
    ? payload.tracks.map(tr => ({
        points: tr.points,
        netVelocityPxPerFrame: tr.net_pxframe,
        netVelocityUmPerSec: toUms(tr.net_pxframe),
        snr: tr.snr,
        totalRunLengthUm: toUmLength(tr.total_run_displacement_px),
        totalRunTimeS: toSeconds(tr.total_run_time_frames),
        intensitySignal: tr.intensity_signal ?? null,
        intensityBackground: tr.intensity_background ?? null,
        intensityMinusBackground: tr.intensity_minus_bg ?? null,
        edge: tr.edge ?? 'none',
        bright: tr.bright ?? false,
      }))
    : undefined;

  // Map per-frame intensity profiles (present only when renderProfiles was set).
  // ML shape: [{ frame, png_base64 }]. Anything malformed degrades to undefined
  // rather than throwing — profiles are an optional add-on.
  const profiles: KymographProfile[] | undefined = Array.isArray(
    payload.profiles
  )
    ? payload.profiles
        .filter(p => typeof p?.png_base64 === 'string')
        .map(p => ({ frame: Number(p.frame), pngBase64: p.png_base64 }))
    : undefined;

  logger.info('Kymograph generated', 'KymographService', {
    videoContainerId,
    polylineId,
    tracked: trackedMode,
    frames: plan.selectedFrames.length,
    velocityTracks: tracks?.length,
    profiles: profiles?.length,
  });

  return {
    pngBase64: payload.png_base64,
    // `?? null` rather than a bare read: `include_csv: false` makes the ML
    // service answer `csv_base64: null`, and that is the ONE case where a null
    // is legitimate here (see `KymographServiceInput.includeCsv`).
    csvBase64: payload.csv_base64 ?? null,
    frameCount: payload.frame_count,
    lengthPx: payload.length_px,
    tracked: trackedMode,
    sourceChannel,
    pixelSizeUm,
    frameIntervalMs,
    filteredTrackCount:
      typeof payload.filtered_track_count === 'number'
        ? payload.filtered_track_count
        : 0,
    ...(tracks ? { tracks } : {}),
    ...(velocityError ? { velocityError } : {}),
    ...(typeof payload.overlay_png_base64 === 'string'
      ? { overlayPngBase64: payload.overlay_png_base64 }
      : {}),
    ...(profiles ? { profiles } : {}),
  };
}

export async function buildKymograph(
  input: KymographServiceInput
): Promise<KymographServiceResult> {
  const { videoContainerId, polylineId, frameIndex } = input;
  const plan = await planKymograph(input);

  // The response-cache lookup sits BETWEEN the plan and the body build,
  // because the plan needs only frame metadata (~8 ms) while building the body
  // parses the container's polygon JSON (~745 ms on a real 300-frame
  // container). Moving the lookup after it would give the modal's warm path
  // back the cost the cache exists to remove.
  let cacheKey: string | null = null;
  if (input.useCache) {
    const stamp = (f: KymographFrameMeta, index: number): FrameStamp => ({
      f: index,
      img: f.updatedAt.getTime(),
      seg: f.segmentationUpdatedAt?.getTime() ?? null,
    });
    const frameStamps = plan.selectedFrames.map(f => stamp(f, f.frameIndex));
    // The seed polyline is the geometry every frame falls back to, and it is
    // what decides tracked-vs-static — so its staleness token belongs in the
    // key even when a frameFilter leaves its own frame out of the render.
    if (plan.frameFilterSet && !plan.frameFilterSet.has(frameIndex)) {
      frameStamps.unshift(stamp(plan.seedMeta, frameIndex));
    }
    cacheKey = kymographCacheKey(input, plan.container, frameStamps);

    const cached = await cacheService.get<KymographServiceResult>(cacheKey, {
      namespace: CACHE_NAMESPACE,
    });
    if (cached) {
      logger.info('Kymograph served from cache', 'KymographService', {
        videoContainerId,
        polylineId,
        frames: plan.selectedFrames.length,
      });
      return cached;
    }
  }

  const { body, trackedMode } = await buildMlBody(input, plan);
  const res = await axios.post(
    `${config.SEGMENTATION_SERVICE_URL}/api/v1/kymograph`,
    body,
    { timeout: ML_KYMOGRAPH_TIMEOUT_MS }
  );
  const result = mapMlPayload(
    input,
    plan,
    trackedMode,
    res.data?.data ?? res.data ?? {}
  );

  if (cacheKey) {
    await cacheKymographResult(cacheKey, result, {
      videoContainerId,
      polylineId,
    });
  }

  return result;
}

/** One item's outcome from `buildKymographBatch`: EXACTLY one of `result` and
 *  `error` is set.
 *
 *  Per item, because that is what the un-batched export had: one HTTP request
 *  per microtubule, each with its own try/catch, so a polyline the seed frame
 *  no longer carries cost that microtubule its kymograph and nothing else.
 *
 *  A discriminated union would state the invariant better, but this package
 *  compiles with `strict: false` (see backend/tsconfig.json) and TypeScript
 *  does not narrow one without `strictNullChecks` — `if (!outcome.ok)` leaves
 *  `outcome.error` a type error. Two optional fields is the shape that
 *  survives that; check `result` first. */
export interface KymographBatchOutcome {
  result?: KymographServiceResult;
  error?: Error;
}

/** Items per ML batch request. Mirrors `_BATCH_MAX_ITEMS` in
 *  `tracker_kymograph.py`; exceeding it is a 422. */
const ML_BATCH_MAX_ITEMS = 64;

/** Summed kymograph pixels (frames x columns) per ML batch request. Mirrors
 *  `_BATCH_MAX_OUTPUT_PIXELS` in `tracker_kymograph.py`, where the arithmetic
 *  behind the number lives; exceeding it is a 413.
 *
 *  It has to be honoured HERE and not by the exporter, because only this layer
 *  knows an item's column count: it is the seed polyline's arc length, and
 *  `buildMlBody` is what resolves the polyline. */
const ML_BATCH_MAX_OUTPUT_PIXELS = 3_840_000;

/** Kymograph pixels one body renders: frames x columns.
 *
 *  Columns mirror `_seed_columns` in `tracker_kymograph.py` — one per pixel of
 *  the SEED (lowest-numbered) frame's polyline arc length, uncapped. The two
 *  can differ by one column on an exact half-pixel arc (JS rounds .5 up,
 *  Python rounds to even), which is why this only ever SIZES a batch: the ML
 *  bound is what refuses one, and a 1-in-3 840 000 discrepancy cannot cross it. */
function mlBodyOutputPixels(body: MlKymographBody): number {
  if (body.frames.length === 0) {
    return 0;
  }
  let seed = body.frames[0];
  for (const f of body.frames) {
    if (f.frame < seed.frame) {
      seed = f;
    }
  }
  const pts = seed.polyline_rc;
  if (!Array.isArray(pts) || pts.length < 2) {
    return 0;
  }
  let arc = 0;
  for (let i = 1; i < pts.length; i++) {
    arc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return body.frames.length * Math.max(2, Math.round(arc) + 1);
}

/**
 * Build MANY kymographs in ONE ML call, so each frame is decoded once for all
 * of them instead of once per (microtubule x channel).
 *
 * The bodies are the SAME bodies `buildKymograph` posts — this only changes
 * how many travel per request, and therefore the ML service's loop order
 * (frame-major instead of polyline-major). Measured 2026-09-01 on container
 * 4972cad8, 60 microtubules x 300 frames of one channel: 60 requests /
 * 18 000 frame decodes / 186.2 s became 1 request / 300 decodes / 13.2 s.
 *
 * "ONE ML call" is the intent, not a guarantee. A batch whose combined output
 * would exceed `ML_BATCH_MAX_OUTPUT_PIXELS` is split into as few requests as
 * fit, because the ML service refuses an oversized one (413) and because the
 * response is what that budget protects. Splitting costs the channel's frames
 * one extra decode pass per extra request — nothing else changes, and the
 * per-item results are identical either way. On real data only 2 of the 60
 * microtubule containers in production split at all (into 3 and 2 requests);
 * the largest batch the export builds today, 3 596 700 px, still travels whole.
 *
 * Requires the ML service to have been deployed FIRST: `/api/v1/kymograph/batch`
 * does not exist on an older ml container, and a 404 here would cost the export
 * its whole kymograph stage.
 *
 * Deliberately NOT wired to the Redis response cache. Same reason
 * `KymographServiceInput.useCache` is opt-in: the export renders every polyline
 * exactly once and would fill a `noeviction` Redis with entries nothing reads.
 * A caller that wants caching should use `buildKymograph` per item.
 */
export async function buildKymographBatch(
  inputs: KymographServiceInput[]
): Promise<KymographBatchOutcome[]> {
  const outcomes: KymographBatchOutcome[] = new Array(inputs.length);
  // Index into `inputs` for each item we actually send, so a body that failed
  // to build does not shift the mapping of the response back onto its input.
  const sent: Array<{
    index: number;
    plan: KymographPlan;
    trackedMode: boolean;
    body: MlKymographBody;
  }> = [];

  for (let i = 0; i < inputs.length; i++) {
    try {
      const plan = await planKymograph(inputs[i]);
      const { body, trackedMode } = await buildMlBody(inputs[i], plan);
      sent.push({ index: i, plan, trackedMode, body });
    } catch (err) {
      outcomes[i] = { error: err as Error };
    }
  }

  if (sent.length === 0) {
    return outcomes;
  }

  // Greedy pack into requests that fit both ML bounds. An item bigger than the
  // whole budget travels alone rather than being refused: the un-batched
  // `/kymograph` renders any single kymograph regardless of size, and the ML
  // service exempts a one-item batch for exactly that reason.
  const chunks: Array<typeof sent> = [];
  let chunk: typeof sent = [];
  let chunkPixels = 0;
  for (const item of sent) {
    const pixels = mlBodyOutputPixels(item.body);
    if (
      chunk.length > 0 &&
      (chunk.length >= ML_BATCH_MAX_ITEMS ||
        chunkPixels + pixels > ML_BATCH_MAX_OUTPUT_PIXELS)
    ) {
      chunks.push(chunk);
      chunk = [];
      chunkPixels = 0;
    }
    chunk.push(item);
    chunkPixels += pixels;
  }
  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  if (chunks.length > 1) {
    logger.debug(
      `Kymograph batch of ${sent.length} item(s) split into ${chunks.length} ` +
        `ML request(s) by the output-size budget`,
      'KymographService'
    );
  }

  for (const group of chunks) {
    try {
      const res = await axios.post(
        `${config.SEGMENTATION_SERVICE_URL}/api/v1/kymograph/batch`,
        { items: group.map(s => s.body) },
        { timeout: ML_KYMOGRAPH_TIMEOUT_MS }
      );
      const payload = res.data?.data ?? res.data ?? {};
      const results = Array.isArray(payload.results) ? payload.results : [];
      if (results.length !== group.length) {
        // The contract is one result per item, in order. Anything else and we
        // cannot say which kymograph is which — fail every item of this request
        // rather than write one microtubule's velocities under another's name.
        throw new Error(
          `ML kymograph batch returned ${results.length} result(s) for ` +
            `${group.length} item(s)`
        );
      }

      for (let k = 0; k < group.length; k++) {
        const { index, plan, trackedMode } = group[k];
        const entry = results[k] as {
          kymograph?: MlKymographPayload;
          error?: string;
        };
        if (!entry?.kymograph) {
          outcomes[index] = {
            error: new Error(
              entry?.error ?? 'ML kymograph batch returned no item'
            ),
          };
          continue;
        }
        outcomes[index] = {
          result: mapMlPayload(
            inputs[index],
            plan,
            trackedMode,
            entry.kymograph
          ),
        };
      }
    } catch (err) {
      // One failed request costs its own items and no others. Before the split
      // existed a failure here threw and the caller failed the whole batch;
      // discarding requests that already succeeded would be strictly worse, and
      // the caller reports a missing `result` per microtubule either way.
      for (const { index } of group) {
        outcomes[index] = { error: err as Error };
      }
    }
  }

  return outcomes;
}
