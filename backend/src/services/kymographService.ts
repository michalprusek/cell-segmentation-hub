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

/** Column count requested from the ML renderer. Part of the cache key, so
 *  changing it can never serve back an entry rendered at the old width. */
const KYMOGRAPH_TARGET_WIDTH = 200;

/** Signal-band width used when the caller passes no ``intensityWidth``. */
const DEFAULT_INTENSITY_WIDTH = 3;

// ---------------------------------------------------------------------------
// Response cache
// ---------------------------------------------------------------------------

const CACHE_NAMESPACE = 'kymograph';

/** Bump when ``KymographServiceResult`` changes shape, so entries written by
 *  an older build hash to a different key instead of being read back missing
 *  fields the new code expects. */
const CACHE_SCHEMA_VERSION = 1;

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
   *  trajectory for the background-subtracted intensity metric. Default 3. */
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
  csvBase64: string;
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
 *  ``invalidatePattern`` open should one ever be needed. */
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
    targetWidth: KYMOGRAPH_TARGET_WIDTH,
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

export async function buildKymograph(
  input: KymographServiceInput
): Promise<KymographServiceResult> {
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
    frameFilter,
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

  const container = await prisma.image.findUnique({
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
  if (!container || !container.isVideoContainer) {
    throw new Error('videoContainerId does not refer to a video container');
  }

  // Whitelist sourceChannel against the container's declared channels.
  const declared = Array.isArray(container.channels)
    ? (container.channels as Array<{ name: string }>).map(c => c.name)
    : [];
  if (declared.length > 0 && !declared.includes(sourceChannel)) {
    throw new Error(`Unknown source channel: ${sourceChannel}`);
  }

  // Frame METADATA only — deliberately without `segmentation.polygons`. This
  // query used to carry the polygons of every frame (56 MB, 459 ms, plus
  // 285 ms of event-loop-blocking JSON.parse on a real 300-frame container)
  // purely to find one sibling polyline per frame. Everything needed to build
  // the cache key is here, so a cache hit — and every static-line render —
  // now costs ~8 ms of database time instead of ~745 ms.
  const allFrames = await prisma.image.findMany({
    where: { parentVideoId: videoContainerId },
    orderBy: { frameIndex: 'asc' },
    select: {
      id: true,
      frameIndex: true,
      updatedAt: true,
      segmentation: { select: { updatedAt: true } },
    },
  });
  if (allFrames.length === 0) {
    throw new Error('No frames found for the given video container');
  }
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

  let cacheKey: string | null = null;
  if (input.useCache) {
    const stamp = (
      f: (typeof allFrames)[number],
      index: number
    ): FrameStamp => ({
      f: index,
      img: f.updatedAt.getTime(),
      seg: f.segmentation?.updatedAt.getTime() ?? null,
    });
    const frameStamps = selectedFrames.map(f => stamp(f, f.frameIndex));
    // The seed polyline is the geometry every frame falls back to, and it is
    // what decides tracked-vs-static — so its staleness token belongs in the
    // key even when a frameFilter leaves its own frame out of the render.
    if (frameFilterSet && !frameFilterSet.has(frameIndex)) {
      frameStamps.unshift(stamp(seedMeta, frameIndex));
    }
    cacheKey = kymographCacheKey(input, container, frameStamps);

    const cached = await cacheService.get<KymographServiceResult>(cacheKey, {
      namespace: CACHE_NAMESPACE,
    });
    if (cached) {
      logger.info('Kymograph served from cache', 'KymographService', {
        videoContainerId,
        polylineId,
        frames: selectedFrames.length,
      });
      return cached;
    }
  }

  // Cache miss: only now is any polygon JSON worth fetching. The seed frame
  // comes first because it is what decides whether ANY other frame's polygons
  // are needed at all.
  const seedPolygons = parsePolygons(
    (await fetchPolygonsByFrame(videoContainerId, [frameIndex])).get(
      frameIndex
    ) ?? null
  );
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
    for (const [idx, json] of await fetchPolygonsByFrame(
      videoContainerId,
      otherFrames
    )) {
      const points = siblingPoints(parsePolygons(json));
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

  const mlUrl = `${config.SEGMENTATION_SERVICE_URL}/api/v1/kymograph`;
  const res = await axios.post(
    mlUrl,
    {
      frames: framesPayload,
      target_width: KYMOGRAPH_TARGET_WIDTH,
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
      ...(detectVelocity ? { detect_velocity: true } : {}),
      ...(detectVelocity && renderOverlay ? { render_overlay: true } : {}),
      ...(renderProfiles ? { render_profiles: true } : {}),
    },
    { timeout: 120_000 }
  );
  const payload = res.data?.data ?? res.data ?? {};

  // ML velocities + run displacements are in kymograph COLUMNS; one column spans
  // `pxPerColumn` image pixels (>1 once a long MT's column axis is compressed at
  // target_width). Scale columns -> µm via `umPerColumn`, and frames -> s via
  // `secPerFrame`. All null when the relevant calibration is absent (treat 0 as
  // uncalibrated, consistently with the >0 forwarding guard above).
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
    ? (payload.tracks as MlTrack[]).map(tr => ({
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
    ? (payload.profiles as Array<{ frame: number; png_base64: string }>)
        .filter(p => typeof p?.png_base64 === 'string')
        .map(p => ({ frame: Number(p.frame), pngBase64: p.png_base64 }))
    : undefined;

  logger.info('Kymograph generated', 'KymographService', {
    videoContainerId,
    polylineId,
    tracked: trackedMode,
    frames: framesPayload.length,
    velocityTracks: tracks?.length,
    profiles: profiles?.length,
  });

  const result: KymographServiceResult = {
    pngBase64: payload.png_base64,
    csvBase64: payload.csv_base64,
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

  if (cacheKey) {
    await cacheKymographResult(cacheKey, result, {
      videoContainerId,
      polylineId,
    });
  }

  return result;
}
