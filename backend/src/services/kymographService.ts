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
import { PrismaClient } from '@prisma/client';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

interface PolylineRecord {
  id: string;
  points?: Array<{ x: number; y: number }>;
  geometry?: string;
  trackId?: string;
  instanceId?: string;
}

export interface KymographServiceInput {
  videoContainerId: string;
  polylineId: string;
  frameIndex: number;
  sourceChannel: string;
}

export interface KymographServiceResult {
  pngBase64: string;
  csvBase64: string;
  frameCount: number;
  lengthPx: number;
  tracked: boolean;
  sourceChannel: string;
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
  const { videoContainerId, polylineId, frameIndex, sourceChannel } = input;

  const container = await prisma.image.findUnique({
    where: { id: videoContainerId },
    select: { id: true, projectId: true, isVideoContainer: true },
  });
  if (!container || !container.isVideoContainer) {
    throw new Error('videoContainerId does not refer to a video container');
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

  const mlUrl = `${config.ML_SERVICE_URL}/api/v1/kymograph`;
  const res = await axios.post(
    mlUrl,
    {
      frames: framesPayload,
      target_width: 200,
      tracked: trackedMode,
    },
    { timeout: 120_000 }
  );
  const payload = res.data?.data ?? res.data ?? {};

  logger.info('Kymograph generated', 'KymographService', {
    videoContainerId,
    polylineId,
    tracked: trackedMode,
    frames: framesPayload.length,
  });

  return {
    pngBase64: payload.png_base64,
    csvBase64: payload.csv_base64,
    frameCount: payload.frame_count,
    lengthPx: payload.length_px,
    tracked: trackedMode,
    sourceChannel,
  };
}
