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
 */

import * as path from 'path';
import axios from 'axios';
import { prisma } from '../db/prismaClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

/** Net-velocity cut-off (µm/s): trajectories slower than this are dropped as
 *  non-processive (oscillatory / static blobs are not directed transport).
 *  Applied in the ML service, which needs the container calibration to turn
 *  this µm/s threshold into px/frame. */
const MIN_NET_VELOCITY_UM_S = 0.01;

/** Same whitelist used by VideoController. Channel names must be alnum +
 *  underscore + dash so they can't escape the storage root. */
const CHANNEL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Mirrors the pattern accepted by the ML KymographRequest. Defence in
 *  depth — the controller layer also validates. */
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

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
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as PolylineRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

  const allFrames = await prisma.image.findMany({
    where: { parentVideoId: videoContainerId },
    orderBy: { frameIndex: 'asc' },
    select: {
      id: true,
      frameIndex: true,
      segmentation: { select: { polygons: true } },
    },
  });
  if (allFrames.length === 0) {
    throw new Error('No frames found for the given video container');
  }

  // Locate the selected polyline and decide tracked vs static-line mode.
  const seedFrame = allFrames.find(f => f.frameIndex === frameIndex);
  if (!seedFrame) {
    throw new Error(`Frame ${frameIndex} not found in container`);
  }
  const seedPolygons = parsePolygons(
    seedFrame.segmentation?.polygons ?? null
  );
  const seedPolyline = seedPolygons.find(p => p.id === polylineId);
  if (!seedPolyline || !Array.isArray(seedPolyline.points)) {
    throw new Error(`Polyline ${polylineId} not found in frame ${frameIndex}`);
  }

  const trackId = seedPolyline.trackId;
  const trackedMode = typeof trackId === 'string' && trackId.length > 0;

  const framesPayload: Array<{
    frame: number;
    polyline_rc: number[][];
    image_path: string;
  }> = [];

  for (const f of allFrames) {
    if (f.frameIndex == null) continue;
    // Restrict to the selected frames when the export passed a filter.
    if (frameFilterSet && !frameFilterSet.has(f.frameIndex)) continue;
    let geometry: Array<{ x: number; y: number }> | null = null;
    if (trackedMode) {
      const polygons = parsePolygons(f.segmentation?.polygons ?? null);
      const sibling = polygons.find(p => p.trackId === trackId);
      if (sibling && Array.isArray(sibling.points)) {
        geometry = sibling.points;
      }
    }
    if (!geometry) {
      // Fallback: reuse the seed-frame polyline as a static reference line.
      geometry = seedPolyline.points as Array<{ x: number; y: number }>;
    }
    framesPayload.push({
      frame: f.frameIndex,
      polyline_rc: geometry.map(pt => [pt.y, pt.x]),
      image_path: framePngPath(
        container.projectId,
        videoContainerId,
        f.frameIndex,
        sourceChannel
      ),
    });
  }

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
      target_width: 200,
      tracked: trackedMode,
      intensity_width: intensityWidth ?? 3,
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

  return {
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
}
