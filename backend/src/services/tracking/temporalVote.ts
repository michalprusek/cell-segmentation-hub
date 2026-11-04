/**
 * Microtubule temporal vote: before the tracker runs on a freshly segmented
 * video, each interior frame is decoded again with the vote of its two
 * neighbours (ML `POST /api/v1/microtubule/temporal-vote`, which documents the
 * vote and what it was measured to do: on 12 real IRM videos the share of
 * centerline length that keeps ONE curve three frames later rose by +0.026,
 * CI [+0.018, +0.034], with the same gain on all six seeds of the recipe, and
 * tracks per filament fell 2.09 -> 2.00). The per-frame model is unchanged; this only
 * re-cuts which skeleton arcs join, using the curves of t-1 and t+1.
 *
 * Unlike the tracker, which only adds `trackId`, the vote REPLACES geometry,
 * so it is fenced to the condition it was measured on:
 *
 *   - Only frames the queue segmented in this pass are voted. The queue notes
 *     each one here (`noteFreshFrame`) together with the channel it read and
 *     the `updatedAt` of the row it wrote; the tracker takes the notes once
 *     the container is complete. A note is consumed once, so a later
 *     tracker-only trigger never re-votes (voted neighbours were never
 *     measured), and the editor's re-segment, which notes nothing, never
 *     changes a frame behind the user's back. Notes live in memory: a backend
 *     restart loses them, which means no vote, never a wrong one.
 *   - A frame whose row changed after the queue wrote it is skipped, and the
 *     write itself is conditional on `updatedAt`, so an edit made while the
 *     pass runs wins.
 *   - The ML route recomputes the per-frame curves and refuses (`applied:
 *     false`) when they differ from the stored ones: an edited frame, another
 *     channel's file, another model.
 *   - The first and last frame, a frame without both neighbours, and a frame
 *     beyond the L+H arc limit keep their per-frame curves.
 *
 * Neighbours are read once, before any write: the vote of every frame uses the
 * per-frame curves of its neighbours, one pass, as measured.
 *
 * Best-effort like the tracker: any failure is logged and the tracker runs on
 * whatever is stored. `MT_TEMPORAL_VOTE=off` in the backend environment turns
 * the pass off without a rebuild.
 */

import axios from 'axios';
import FormData from 'form-data';
import { prisma } from '../../db/prismaClient';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import { getStorageProvider } from '../../storage/index';
import { resolveChannelPath } from '../../utils/channelPath';
import { safeMlFilename } from '../../utils/mlFilename';
import { mapWithConcurrency } from '../../utils/concurrency';
import { segmentationTimeoutMs } from '../../constants/imageLimits';
import { toStoredPolygon } from '../../utils/storedPolygon';
import type { SegmentationPolygon } from '../segmentationService';
import type { ThumbnailManager } from '../thumbnailManager';

interface FreshFrame {
  channel: string | null;
  segmentationUpdatedAt: number;
}

const _fresh = new Map<string, Map<string, FreshFrame>>();

/** Two requests in flight: the route aligns one frame's neighbours on the CPU
 *  while the card runs another's map. More would only queue on the ML side. */
const VOTE_CONCURRENCY = 2;

/** Note a frame the queue has just segmented with the microtubule model. */
export function noteFreshFrame(
  containerId: string,
  imageId: string,
  channel: string | null,
  segmentationUpdatedAt: Date
): void {
  let frames = _fresh.get(containerId);
  if (!frames) {
    frames = new Map();
    _fresh.set(containerId, frames);
  }
  frames.set(imageId, {
    channel,
    segmentationUpdatedAt: segmentationUpdatedAt.getTime(),
  });
}

/** Test seam: how many frames are noted for a container. */
export function freshFrameCount(containerId: string): number {
  return _fresh.get(containerId)?.size ?? 0;
}

type Curves = number[][][];

/** The stored polylines of one frame as `[[[x, y], ...], ...]`, in stored
 *  order, or null for a row that is not microtubule output. */
function storedCurves(segmentation: {
  model: string;
  polygons: string;
}): Curves | null {
  if (segmentation.model !== 'microtubule') {
    return null;
  }
  let polygons: unknown;
  try {
    polygons = JSON.parse(segmentation.polygons);
  } catch {
    return null;
  }
  if (!Array.isArray(polygons)) {
    return null;
  }
  const curves: Curves = [];
  for (const p of polygons as Array<Record<string, unknown>>) {
    if (p?.geometry !== 'polyline' || !Array.isArray(p.points)) {
      continue;
    }
    const pts = p.points as Array<{ x: number; y: number }>;
    if (pts.length < 2) {
      continue;
    }
    curves.push(pts.map(q => [q.x, q.y]));
  }
  return curves;
}

// Imported on first use: a static import would pull the thumbnail renderer
// (sharp, canvas) into the module graph of the tracker and of everything that
// imports the queue, which is most of the backend.
let _thumbnails: Promise<ThumbnailManager> | null = null;
function thumbnails(): Promise<ThumbnailManager> {
  if (!_thumbnails) {
    _thumbnails = import('../thumbnailManager').then(
      m => new m.ThumbnailManager(prisma)
    );
  }
  return _thumbnails;
}

export interface TemporalVoteSummary {
  noted: number;
  requested: number;
  changed: number;
  skipped: Record<string, number>;
}

/**
 * Vote the frames noted for `containerId`, then forget the notes. Called by
 * the tracker inside its in-flight guard, after every frame is final and
 * before it reads the polygons it tracks. Never throws.
 */
export async function runTemporalVote(
  containerId: string
): Promise<TemporalVoteSummary | null> {
  const noted = _fresh.get(containerId);
  _fresh.delete(containerId);
  if (!noted || noted.size === 0) {
    return null;
  }
  if (config.MT_TEMPORAL_VOTE === 'off') {
    logger.info(
      `Temporal vote: off (MT_TEMPORAL_VOTE), ${noted.size} frames of ${containerId} keep their per-frame curves`,
      'TemporalVote'
    );
    return null;
  }
  const summary: TemporalVoteSummary = {
    noted: noted.size,
    requested: 0,
    changed: 0,
    skipped: {},
  };
  const skip = (reason: string): void => {
    summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
  };
  const started = Date.now();
  try {
    const frames = await prisma.image.findMany({
      where: { parentVideoId: containerId },
      orderBy: { frameIndex: 'asc' },
      select: {
        id: true,
        name: true,
        mimeType: true,
        originalPath: true,
        width: true,
        height: true,
        frameIndex: true,
        segmentation: {
          select: { id: true, model: true, polygons: true, updatedAt: true },
        },
      },
    });
    // Read every frame's curves BEFORE any write: one pass, neighbours per-frame.
    const curves = new Map<number, Curves | null>();
    for (const f of frames) {
      if (f.frameIndex != null && f.segmentation) {
        curves.set(f.frameIndex, storedCurves(f.segmentation));
      }
    }
    const jobs = frames.filter(f => noted.has(f.id));
    let routeMissing = false;
    await mapWithConcurrency(jobs, VOTE_CONCURRENCY, async f => {
      const note = noted.get(f.id) as FreshFrame;
      const seg = f.segmentation;
      const t = f.frameIndex;
      if (routeMissing) {
        skip('route_missing');
        return;
      }
      if (!seg || t == null || seg.model !== 'microtubule') {
        skip('not_microtubule');
        return;
      }
      if (seg.updatedAt.getTime() !== note.segmentationUpdatedAt) {
        skip('changed_since_segmented');
        return;
      }
      const previous = curves.get(t - 1);
      const current = curves.get(t);
      const following = curves.get(t + 1);
      if (!previous || !current || !following) {
        skip('no_two_neighbours');
        return;
      }
      try {
        const buffer = await getStorageProvider().getBuffer(
          resolveChannelPath(f.originalPath, note.channel)
        );
        const form = new FormData();
        form.append('file', buffer, {
          filename: safeMlFilename(f),
          contentType: f.mimeType || 'image/png',
        });
        form.append('previous', JSON.stringify(previous));
        form.append('current', JSON.stringify(current));
        form.append('following', JSON.stringify(following));
        summary.requested++;
        const res = await axios.post(
          `${config.SEGMENTATION_SERVICE_URL}/api/v1/microtubule/temporal-vote`,
          form,
          {
            headers: form.getHeaders(),
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: segmentationTimeoutMs(f.width, f.height),
          }
        );
        const out = res.data ?? {};
        if (!out.applied) {
          skip(String(out.reason ?? 'not_applied'));
          return;
        }
        if (!out.changed) {
          skip('unchanged');
          return;
        }
        const polygons = (out.polylines as SegmentationPolygon[]).map(p =>
          toStoredPolygon(p as SegmentationPolygon & Record<string, unknown>)
        );
        const written = await prisma.segmentation.updateMany({
          where: { id: seg.id, updatedAt: seg.updatedAt },
          data: { polygons: JSON.stringify(polygons), updatedAt: new Date() },
        });
        if (written.count !== 1) {
          skip('changed_during_vote');
          return;
        }
        summary.changed++;
        try {
          await (await thumbnails()).generateAllThumbnails(seg.id);
        } catch (err) {
          logger.warn(
            `Temporal vote: thumbnail of ${f.id} not regenerated: ${(err as Error).message}`,
            'TemporalVote'
          );
        }
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response
          ?.status;
        if (status === 404 || status === 405) {
          // An ML image older than the backend: say it once, not per frame.
          routeMissing = true;
          skip('route_missing');
          return;
        }
        skip('error');
        logger.warn(
          `Temporal vote: frame ${f.id} keeps its per-frame curves: ${(err as Error).message}`,
          'TemporalVote',
          { containerId, status }
        );
      }
    });
    logger.info(
      `Temporal vote: container ${containerId}, ${summary.changed} of ${summary.noted} noted frames re-decoded in ${Math.round((Date.now() - started) / 1000)} s`,
      'TemporalVote',
      { ...summary }
    );
    return summary;
  } catch (err) {
    logger.error(
      `Temporal vote failed for container ${containerId}; the tracker runs on the stored curves`,
      err as Error,
      'TemporalVote',
      { ...summary }
    );
    return summary;
  }
}
