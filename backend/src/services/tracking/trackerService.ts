/**
 * Cross-frame microtubule tracker.
 *
 * Listens for "batch completed" events on the segmentation queue: when
 * every frame of a video container with the ``microtubule`` model
 * reaches status ``segmented``, this service:
 *
 *   1. Reads every per-frame Segmentation row's polyline geometry.
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
  /** Legacy: written by the microtubule v7 model, never by v5H. Declared so
   *  the type still describes rows already in the database; nothing reads it. */
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
      // Segmentation polygon ids ("polyline_1", "polyline_2", …) restart per
      // frame, so they COLLIDE across frames. The tracker keys its
      // assignments by this id and the write-back looks trackIds up by it —
      // a raw id would make every frame's "polyline_1" share one trackId
      // (ordinal tracking, the geometric match discarded). Scope it by
      // frameIndex so each frame's polyline is globally unique; the
      // write-back rebuilds the same `${frameIndex}::${id}` key.
      id: `${frameIndex}::${p.id}`,
      // points are stored as {x: col, y: row}; tracker uses (row, col).
      points_rc: (p.points as Array<{ x: number; y: number }>).map(
        pt => [pt.y, pt.x] as [number, number]
      ),
      // No `embedding`: the microtubule v5H model emits no embedding field,
      // and the tracker matches on geometry. Rows written by v7 still carry a
      // several-KB `_embedding` each; deliberately NOT forwarding it keeps
      // tens of MB per video off the wire for a payload nothing reads.
    }));
  return { frame: frameIndex, polylines };
}

/** Returns true once every frame of the container has reached a FINAL
 *  segmentation status: `'segmented'` (succeeded), `'no_segmentation'`
 *  (model returned empty), or `'failed'`. Frames in pending states
 *  (`'queued'`, `'processing'`) still need to resolve before tracking
 *  can produce a stable cross-frame identity.
 *
 *  Previously the gate required strict `'segmented'`, which meant a
 *  single failed/empty frame indefinitely blocked the tracker on the
 *  other 600 frames — and the cross-frame color went random because
 *  `instanceId` (the only fallback) re-randomises per inference. The
 *  tracker itself already skips empty frames via the
 *  `polylines.length === 0` early-return downstream, so admitting
 *  no_segmentation / failed states here is safe. */
const FINAL_SEGMENTATION_STATUSES = new Set([
  'segmented',
  'no_segmentation',
  'failed',
]);
async function isBatchComplete(containerId: string): Promise<boolean> {
  const frames = await prisma.image.findMany({
    where: { parentVideoId: containerId },
    select: { segmentationStatus: true },
  });
  if (frames.length === 0) return false;
  return frames.every(
    f =>
      f.segmentationStatus != null &&
      FINAL_SEGMENTATION_STATUSES.has(f.segmentationStatus)
  );
}

/**
 * In-flight guard against the race that round 2 found: each `'segmented'`
 * webhook for a frame in the same container fires
 * scheduleTrackingForContainer; with a 200-frame video, the last few
 * `'segmented'` events all observe isBatchComplete()==true concurrently
 * and overlap. Two concurrent runTrackingForContainer passes write
 * different trackIds to the same Segmentation rows ("last writer wins"
 * looks like flapping trackIds to the editor). A module-scope Set keeps
 * each containerId to a single in-flight pass; later triggers are
 * dropped silently because the work is already underway.
 */
const _inFlightTrackers = new Set<string>();

export async function runTrackingForContainer(
  containerId: string
): Promise<void> {
  // Claim the in-flight slot **synchronously** before any await.
  // Round-3 review caught: doing `has()` then `await ...` then `add()`
  // creates a check-then-act race in Node's single-threaded async model
  // — two near-simultaneous triggers both see `has() === false`, both
  // await isBatchComplete (which yields the microtask), both reach add,
  // and both proceed. Set.add is idempotent for membership but the two
  // coroutines have already passed the gate. Claiming the slot before
  // the first await closes the window: the second caller observes the
  // slot already taken and bails immediately.
  if (_inFlightTrackers.has(containerId)) {
    logger.debug(
      `Tracker: container ${containerId} already in flight, skipping duplicate trigger`,
      'TrackerService'
    );
    return;
  }
  _inFlightTrackers.add(containerId);
  try {
    if (!(await isBatchComplete(containerId))) {
      logger.debug(
        `Tracker: batch ${containerId} not yet complete, skipping`,
        'TrackerService'
      );
      return;
    }
    await _runTrackingForContainerInner(containerId);
  } finally {
    _inFlightTrackers.delete(containerId);
  }
}

/**
 * How long to wait for the tracker, scaled to the work being asked of it.
 *
 * A flat 60 s threw away completed results. Observed in production
 * (2026-08-20): a 299-frame container with 30498 polylines finished on the ML
 * side at 05:56:16 and returned 200 — but the caller had already given up at
 * 05:55:41, so a correct answer that cost 95 s of GPU-box CPU was discarded and
 * the container silently went untracked. From the user's side that is
 * indistinguishable from "tracking is broken", which is exactly how it was
 * reported.
 *
 * The cost is driven by the polyline count, not the frame count: the tracker
 * solves a linear assignment between consecutive frames, so it grows roughly
 * with polylines per frame squared times frames. Rather than model that, budget
 * generously per polyline and clamp. 4 ms per polyline puts the observed 30498
 * at ~122 s, comfortably past the 95 s it actually took, and a container an
 * order of magnitude larger still lands inside the ceiling.
 *
 * The ceiling exists so a genuinely stuck call cannot pin a connection for ever;
 * it is not a performance target. If it is ever hit, the fix is to stop asking
 * the tracker to re-derive identity that is already known — see the static
 * channel path, where the same 102 objects were being rediscovered 299 times.
 */
const TRACKER_MS_PER_POLYLINE = 4;
const TRACKER_MIN_TIMEOUT_MS = 60_000;
const TRACKER_MAX_TIMEOUT_MS = 15 * 60_000;

export function trackerTimeoutMs(
  frames: ReadonlyArray<{ polylines: ReadonlyArray<unknown> }>
): number {
  const polylines = frames.reduce((n, f) => n + f.polylines.length, 0);
  return Math.min(
    TRACKER_MAX_TIMEOUT_MS,
    Math.max(TRACKER_MIN_TIMEOUT_MS, polylines * TRACKER_MS_PER_POLYLINE)
  );
}


async function _runTrackingForContainerInner(
  containerId: string
): Promise<void> {

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
    // Max accepted filament-match cost for the two-step LAP tracker. The ML
    // side's filament-aware cost is a weighted sum of four [0,1] terms
    // (curve distance + endpoint + orientation + length), so 0.6 accepts
    // moderately-confident links. The remaining tracker params (motion_model,
    // max_gap=3, gap_penalty, term weights, image_hw fallback) use the ML
    // defaults.
    cost_threshold: 0.6,
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
  const timeoutMs = trackerTimeoutMs(trackPayload.frames);
  try {
    const res = await axios.post(mlUrl, trackPayload, { timeout: timeoutMs });
    const payload = res.data?.data ?? res.data ?? {};
    assignments = payload.assignments ?? {};
  } catch (err) {
    const polylines = trackPayload.frames.reduce(
      (n, f) => n + f.polylines.length,
      0
    );
    logger.error(
      `Tracker ML call failed: ${(err as Error).message}`,
      err as Error,
      'TrackerService',
      {
        containerId,
        frames: trackPayload.frames.length,
        polylines,
        timeoutMs,
      }
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
    if (!f.segmentation || f.frameIndex == null) continue;
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
      // Rebuild the same frame-scoped key asTrackerPolylines sent, so each
      // frame's polyline gets ITS geometric trackId (not a collision-collapsed
      // ordinal one).
      const tid = assignments[`${f.frameIndex}::${poly.id}`];
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
  //
  // Round-2 caveat: chunking trades batch atomicity for predictable
  // timeout behaviour. If chunk #N fails after chunks 0..N-1 committed,
  // the container is left half-tracked. We can't recover that mid-pass
  // (Prisma doesn't expose nested savepoints across separate
  // transactions in this overload), so the contract is: log the partial
  // commit count loudly and re-throw so the caller's error path runs.
  // Ops can then re-trigger tracking; the next pass overwrites trackIds
  // idempotently, because the same centerlines produce the same geometric
  // cost matrix and therefore the same Hungarian output.
  let chunksCommitted = 0;
  const totalChunks = Math.ceil(updates.length / TX_CHUNK_SIZE);
  try {
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
      chunksCommitted++;
    }
  } catch (err) {
    const rowsCommitted = chunksCommitted * TX_CHUNK_SIZE;
    const rowsTotal = updates.length;
    logger.error(
      `Tracker write-back aborted after chunk ${chunksCommitted}/${totalChunks}; ` +
        `${rowsCommitted}/${rowsTotal} rows committed, remainder skipped — ` +
        `container is now half-tracked, re-run tracker to converge`,
      err as Error,
      'TrackerService',
      {
        containerId,
        chunksCommitted,
        totalChunks,
        rowsCommitted,
        rowsTotal,
      }
    );
    throw err;
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
