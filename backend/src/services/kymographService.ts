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
 *  velocities in px/frame). Converted to the camelCase + um/s shape below. */
interface MlTrack {
  points: number[][];
  net_pxframe: number;
  snr: number;
  runs: Array<{
    v_pxframe: number;
    se_pxframe: number;
    t0: number;
    t1: number;
  }>;
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
}

/** One constant-velocity segment of a track. ``*UmPerSec`` fields are null
 *  when the container has no calibration (pixelSizeUm / frameIntervalMs). */
export interface KymographRun {
  velocityPxPerFrame: number;
  sePxPerFrame: number;
  velocityUmPerSec: number | null;
  seUmPerSec: number | null;
  t0: number;
  t1: number;
}

/** One moving particle detected on the kymograph. */
export interface KymographTrack {
  points: number[][]; // [[frame, xSubpixel], ...]
  netVelocityPxPerFrame: number;
  netVelocityUmPerSec: number | null;
  snr: number;
  runs: KymographRun[];
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

  const mlUrl = `${config.SEGMENTATION_SERVICE_URL}/api/v1/kymograph`;
  const res = await axios.post(
    mlUrl,
    {
      frames: framesPayload,
      target_width: 200,
      tracked: trackedMode,
      ...(channelColor ? { channel_color: channelColor } : {}),
      ...(detectVelocity ? { detect_velocity: true } : {}),
    },
    { timeout: 120_000 }
  );
  const payload = res.data?.data ?? res.data ?? {};

  // Calibration: px/frame -> um/s factor. Null when the upload carried no
  // pixel size / frame interval (older videos, non-microscopy formats).
  const pixelSizeUm = container.pixelSizeUm ?? null;
  const frameIntervalMs = container.frameIntervalMs ?? null;
  const umPerSecPerPxFrame =
    pixelSizeUm != null && frameIntervalMs != null && frameIntervalMs > 0
      ? pixelSizeUm / (frameIntervalMs / 1000)
      : null;
  const toUms = (pxPerFrame: number): number | null =>
    umPerSecPerPxFrame != null ? pxPerFrame * umPerSecPerPxFrame : null;

  const tracks: KymographTrack[] | undefined = Array.isArray(payload.tracks)
    ? (payload.tracks as MlTrack[]).map(tr => ({
        points: tr.points,
        netVelocityPxPerFrame: tr.net_pxframe,
        netVelocityUmPerSec: toUms(tr.net_pxframe),
        snr: tr.snr,
        runs: tr.runs.map(r => ({
          velocityPxPerFrame: r.v_pxframe,
          sePxPerFrame: r.se_pxframe,
          velocityUmPerSec: toUms(r.v_pxframe),
          seUmPerSec: toUms(r.se_pxframe),
          t0: r.t0,
          t1: r.t1,
        })),
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
  };
}
