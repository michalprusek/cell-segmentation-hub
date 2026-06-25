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

/** Raw track shape returned by the ML ``/kymograph`` endpoint (snake_case,
 *  px/frame + raw pixel units). Converted to the camelCase + µm/s + µm/s shape
 *  below. Per-run detail is not exposed — only the two processive totals. */
interface MlTrack {
  points: KymoPoint[];
  net_pxframe: number;
  snr: number;
  total_run_time_frames: number;
  total_run_displacement_px: number;
  edge: string;
  intensity_signal: number | null;
  intensity_background: number | null;
  intensity_minus_bg: number | null;
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
}

/** A sub-pixel trajectory sample: `[frame, xPosition]` along the polyline. */
export type KymoPoint = [frame: number, x: number];

/** One moving particle detected on the kymograph. ``*Um*`` / ``*UmPerSec``
 *  fields are null when the container has no calibration. */
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
  /** "left" | "right" | "both" | "none" — trajectory reaches a kymograph end. */
  edge: string;
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
  /** Base64 PNG of the kymograph + tracks; present only with ``renderOverlay``. */
  overlayPngBase64?: string;
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
  } = input;

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
    },
    { timeout: 120_000 }
  );
  const payload = res.data?.data ?? res.data ?? {};

  // px/frame -> µm/s factor (velocities); px -> µm and frames -> s converters
  // (run length / run time totals). All null when uncalibrated.
  const umPerSecPerPxFrame =
    pixelSizeUm != null && frameIntervalMs != null && frameIntervalMs > 0
      ? pixelSizeUm / (frameIntervalMs / 1000)
      : null;
  const toUms = (pxPerFrame: number): number | null =>
    umPerSecPerPxFrame != null ? pxPerFrame * umPerSecPerPxFrame : null;
  const toUmLength = (px: number): number | null =>
    pixelSizeUm != null ? px * pixelSizeUm : null;
  const toSeconds = (frames: number): number | null =>
    frameIntervalMs != null && frameIntervalMs > 0
      ? frames * (frameIntervalMs / 1000)
      : null;

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
      }))
    : undefined;

  logger.info('Kymograph generated', 'KymographService', {
    videoContainerId,
    polylineId,
    tracked: trackedMode,
    frames: framesPayload.length,
    velocityTracks: tracks?.length,
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
    ...(tracks ? { tracks } : {}),
    ...(typeof payload.overlay_png_base64 === 'string'
      ? { overlayPngBase64: payload.overlay_png_base64 }
      : {}),
  };
}
