/**
 * Cross-frame microtubule tracker.
 *
 * Listens for "batch completed" events on the segmentation queue: when
 * every frame of a video container with the ``microtubule`` model
 * reaches status ``segmented``, this service:
 *
 *   1. Reads every per-frame Segmentation row + its polyline embeddings.
 *   2. POSTs the bundle to the ML service's /track endpoint.
 *   3. Receives an assignments map (polylineId → trackId).
 *   4. Patches each Segmentation's polygon JSON to inject ``trackId``.
 *
 * Tracking is best-effort — failures are logged but do not surface as
 * user-visible errors; kymograph then falls back to the static-line path.
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

interface PolygonRecord {
  id: string;
  points?: Array<{ x: number; y: number }>;
  geometry?: string;
  instanceId?: string;
  trackId?: string;
  _embedding?: string;
  [k: string]: unknown;
}

interface SegmentationRecord {
  id: string;
  imageId: string;
  polygons: string;
}

/** Convert one frame's polygons JSON into the shape the ML tracker expects. */
function asTrackerPolylines(frameIndex: number, segmentation: SegmentationRecord) {
  let polygons: PolygonRecord[];
  try {
    polygons = JSON.parse(segmentation.polygons) as PolygonRecord[];
  } catch (err) {
    logger.warn(
      `Failed to parse polygons for segmentation ${segmentation.id}: ${(err as Error).message}`,
      'TrackerService'
    );
    return { frame: frameIndex, polylines: [] };
  }
  const polylines = polygons
    .filter(p => p.geometry === 'polyline' && Array.isArray(p.points))
    .map(p => ({
      id: p.id,
      // points are stored as {x: col, y: row}; tracker uses (row, col).
      points_rc: (p.points as Array<{ x: number; y: number }>).map(
        pt => [pt.y, pt.x] as [number, number]
      ),
      embedding: typeof p._embedding === 'string' ? p._embedding : null,
    }));
  return { frame: frameIndex, polylines };
}

/** Returns true once every frame of the container has segmentation
 *  status `'segmented'` (the per-frame model succeeded). */
async function isBatchComplete(containerId: string): Promise<boolean> {
  const frames = await prisma.image.findMany({
    where: { parentVideoId: containerId },
    select: { segmentationStatus: true },
  });
  if (frames.length === 0) return false;
  return frames.every(f => f.segmentationStatus === 'segmented');
}

export async function runTrackingForContainer(containerId: string): Promise<void> {
  if (!(await isBatchComplete(containerId))) {
    logger.debug(
      `Tracker: batch ${containerId} not yet complete, skipping`,
      'TrackerService'
    );
    return;
  }

  const frames = await prisma.image.findMany({
    where: { parentVideoId: containerId },
    orderBy: { frameIndex: 'asc' },
    select: {
      id: true,
      frameIndex: true,
      segmentation: {
        select: { id: true, imageId: true, polygons: true },
      },
    },
  });

  const trackPayload = {
    frames: frames
      .filter(f => f.segmentation != null && f.frameIndex != null)
      .map(f =>
        asTrackerPolylines(
          f.frameIndex as number,
          f.segmentation as SegmentationRecord
        )
      ),
    cost_threshold: 0.5,
    spatial_weight: 0.3,
  };

  if (trackPayload.frames.every(f => f.polylines.length === 0)) {
    logger.info(
      `Tracker: no polylines to track in container ${containerId}`,
      'TrackerService'
    );
    return;
  }

  const mlUrl = `${config.SEGMENTATION_SERVICE_URL}/api/v1/track`;
  let assignments: Record<string, string> = {};
  try {
    const res = await axios.post(mlUrl, trackPayload, { timeout: 60_000 });
    const payload = res.data?.data ?? res.data ?? {};
    assignments = payload.assignments ?? {};
  } catch (err) {
    logger.error(
      `Tracker ML call failed: ${(err as Error).message}`,
      err as Error,
      'TrackerService',
      { containerId }
    );
    return;
  }

  // Write back trackIds: parse each frame's polygons, set trackId on
  // matching polyline rows, serialise back.
  await prisma.$transaction(
    frames
      .filter(f => f.segmentation)
      .map(f => {
        const seg = f.segmentation as SegmentationRecord;
        let polygons: PolygonRecord[];
        try {
          polygons = JSON.parse(seg.polygons) as PolygonRecord[];
        } catch {
          polygons = [];
        }
        let mutated = false;
        for (const poly of polygons) {
          const tid = assignments[poly.id];
          if (tid && poly.trackId !== tid) {
            poly.trackId = tid;
            mutated = true;
          }
        }
        if (!mutated) {
          return prisma.segmentation.findUnique({ where: { id: seg.id } });
        }
        return prisma.segmentation.update({
          where: { id: seg.id },
          data: { polygons: JSON.stringify(polygons) },
        });
      })
  );

  const uniqueTracks = new Set(Object.values(assignments)).size;
  logger.info(
    `Tracker: container ${containerId} → ${uniqueTracks} unique tracks across ${frames.length} frames`,
    'TrackerService'
  );
}

/** Fire-and-forget version used by post-segmentation hooks. */
export function scheduleTrackingForContainer(containerId: string): void {
  runTrackingForContainer(containerId).catch(err => {
    logger.error(
      `Background tracking failed: ${err.message}`,
      err,
      'TrackerService',
      { containerId }
    );
  });
}
