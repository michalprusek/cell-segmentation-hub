/**
 * Fill in a static channel's remaining frames from the one frame that was
 * segmented.
 *
 * See `staticChannelProjection.ts` for why this exists and for the pure
 * geometry; this module is only the database half. It runs after a queue item
 * completes, in place of scheduling the tracker: the projected polylines carry
 * the source frame's `trackId`, so cross-frame identity is exact rather than
 * inferred, and there is nothing left for a tracker to work out.
 *
 * Every failure mode here degrades to "leave those frames alone", never to
 * "write something approximate". A frame this cannot project is simply not
 * projected, and the caller falls back to the ordinary tracking path.
 */

import { prisma } from '../db';
import { logger } from '../utils/logger';
import {
  findStaticChannel,
  projectionDelta,
  projectPolygons,
  type ProjectablePolygon,
  type StaticChannelLike,
} from './staticChannelProjection';

export interface ProjectStaticChannelArgs {
  containerId: string;
  sourceImageId: string;
  channel: string | null;
}

export interface ProjectStaticChannelOutcome {
  /** True when this container's frames were filled in from the source frame,
   *  which is also the signal that tracking must NOT run for it. */
  applied: boolean;
  projected: number;
  /** Frames deliberately left for normal segmentation (unknown shift). */
  skipped: number;
}

const NOT_APPLIED: ProjectStaticChannelOutcome = {
  applied: false,
  projected: 0,
  skipped: 0,
};

function parsePolygons(raw: string): ProjectablePolygon[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // A polygon without points cannot be translated; rather than silently
    // dropping it, refuse the whole projection so the frames get segmented
    // properly instead of receiving a partial copy.
    return parsed.every(
      p => p && Array.isArray((p as ProjectablePolygon).points)
    )
      ? (parsed as ProjectablePolygon[])
      : null;
  } catch {
    return null;
  }
}

export async function projectStaticChannelResult(
  args: ProjectStaticChannelArgs
): Promise<ProjectStaticChannelOutcome> {
  const { containerId, sourceImageId, channel } = args;
  if (!channel) return NOT_APPLIED;

  try {
    const container = await prisma.image.findUnique({
      where: { id: containerId },
      select: { channels: true },
    });
    const meta = findStaticChannel(
      container?.channels as unknown as StaticChannelLike[] | null,
      channel
    );
    if (!meta) return NOT_APPLIED;

    const source = await prisma.segmentation.findUnique({
      where: { imageId: sourceImageId },
      select: {
        polygons: true,
        model: true,
        threshold: true,
        confidence: true,
        imageWidth: true,
        imageHeight: true,
      },
    });
    if (!source) return NOT_APPLIED;

    const polygons = parsePolygons(source.polygons);
    if (!polygons) {
      logger.warn(
        `Static channel '${channel}': source frame ${sourceImageId} has polygons this cannot project; leaving the other frames to segment normally`,
        'StaticChannelProjection',
        { containerId }
      );
      return NOT_APPLIED;
    }

    const siblings = await prisma.image.findMany({
      where: { parentVideoId: containerId, id: { not: sourceImageId } },
      select: { id: true, frameIndex: true },
    });
    const covered = meta.frameIds
      ? siblings.filter(f => meta.frameIds?.includes(f.id))
      : siblings;
    if (covered.length === 0) return NOT_APPLIED;

    let projected = 0;
    let skipped = 0;

    for (const target of covered) {
      const delta = projectionDelta(meta, sourceImageId, target.id);
      if (!delta) {
        // Unknown offset. Assuming zero would put filaments somewhere they are
        // not, and look entirely plausible doing it.
        skipped++;
        continue;
      }
      const moved = projectPolygons(polygons, delta);
      const payload = JSON.stringify(moved);

      await prisma.$transaction([
        prisma.segmentation.upsert({
          where: { imageId: target.id },
          create: {
            imageId: target.id,
            polygons: payload,
            model: source.model,
            threshold: source.threshold,
            confidence: source.confidence,
            imageWidth: source.imageWidth,
            imageHeight: source.imageHeight,
          },
          update: {
            polygons: payload,
            model: source.model,
            threshold: source.threshold,
            confidence: source.confidence,
            imageWidth: source.imageWidth,
            imageHeight: source.imageHeight,
          },
        }),
        prisma.image.update({
          where: { id: target.id },
          data: { segmentationStatus: 'segmented' },
        }),
      ]);
      projected++;
    }

    if (projected === 0) return NOT_APPLIED;

    logger.info(
      `Static channel '${channel}': projected ${polygons.length} polyline(s) from frame ${sourceImageId} onto ${projected} frame(s)` +
        (skipped ? `, ${skipped} left to segment (no recorded shift)` : '') +
        ' — no tracking needed, identity is carried not inferred',
      'StaticChannelProjection',
      { containerId, projected, skipped, polylines: polygons.length }
    );

    // Frames left for normal segmentation still need the tracker, so only a
    // clean sweep suppresses it.
    return { applied: skipped === 0, projected, skipped };
  } catch (err) {
    logger.error(
      `Static channel projection failed: ${(err as Error).message}`,
      err as Error,
      'StaticChannelProjection',
      { containerId, sourceImageId, channel }
    );
    return NOT_APPLIED;
  }
}
