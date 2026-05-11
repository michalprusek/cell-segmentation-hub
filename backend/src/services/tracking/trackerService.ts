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
import { prisma } from '../../db/prismaClient';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';

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

/** Convert one frame's polygons JSON into the shape the ML tracker expects.
 *  Parse failures are logged at error level — the read path already
 *  validated this JSON when storing, so a failure here indicates real
 *  corruption (truncated row, encoding flip). Returns empty polylines so
 *  the tracker still processes other frames. */
function asTrackerPolylines(
  frameIndex: number,
  segmentation: SegmentationRecord
) {
  let polygons: PolygonRecord[];
  try {
    polygons = JSON.parse(segmentation.polygons) as PolygonRecord[];
  } catch (err) {
    logger.error(
      `Polygons JSON malformed for segmentation ${segmentation.id}; tracker will skip this frame`,
      err as Error,
      'TrackerService',
      {
        segmentationId: segmentation.id,
        frameIndex,
        polygonsLength: segmentation.polygons?.length,
      }
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

  // Write back trackIds in chunked transactions. A single $transaction
  // over hundreds of frame updates routinely exceeds the default 5 s
  // Prisma transactionTimeout (especially with large polygon JSON
  // payloads). Chunking + an explicit per-chunk timeout keeps the
  // 200-frame case reliable while still being atomic per chunk.
  const TX_CHUNK_SIZE = 25;
  const TX_TIMEOUT_MS = 60_000;

  const updates: Array<{ segmentationId: string; polygonsJson: string }> = [];
  for (const f of frames) {
    if (!f.segmentation) continue;
    const seg = f.segmentation as SegmentationRecord;
    let polygons: PolygonRecord[];
    try {
      polygons = JSON.parse(seg.polygons) as PolygonRecord[];
    } catch (err) {
      // Parse failure here is corruption (we read this exact row a few
      // hundred ms ago in the read pass). Log loudly and skip — do NOT
      // silently substitute [] which would erase any existing trackIds.
      logger.error(
        `Refusing to overwrite malformed polygons JSON during tracker write-back`,
        err as Error,
        'TrackerService',
        { segmentationId: seg.id, polygonsLength: seg.polygons?.length }
      );
      continue;
    }
    let mutated = false;
    for (const poly of polygons) {
      const tid = assignments[poly.id];
      if (tid && poly.trackId !== tid) {
        poly.trackId = tid;
        mutated = true;
      }
    }
    if (mutated) {
      updates.push({
        segmentationId: seg.id,
        polygonsJson: JSON.stringify(polygons),
      });
    }
  }

  // Use the interactive transaction overload so we can set the timeout.
  // The array-form overload from Prisma 5.x does not accept timeout
  // options; the function-form does.
  for (let i = 0; i < updates.length; i += TX_CHUNK_SIZE) {
    const chunk = updates.slice(i, i + TX_CHUNK_SIZE);
    await prisma.$transaction(
      async tx => {
        for (const u of chunk) {
          await tx.segmentation.update({
            where: { id: u.segmentationId },
            data: { polygons: u.polygonsJson },
          });
        }
      },
      { timeout: TX_TIMEOUT_MS, maxWait: 10_000 }
    );
  }

  const uniqueTracks = new Set(Object.values(assignments)).size;
  logger.info(
    `Tracker: container ${containerId} → ${uniqueTracks} unique tracks across ${frames.length} frames (${updates.length} rows updated in ${Math.ceil(updates.length / TX_CHUNK_SIZE)} chunks)`,
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
