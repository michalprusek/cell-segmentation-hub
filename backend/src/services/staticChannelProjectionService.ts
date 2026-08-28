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
 * The same function fills in a SPARSE channel's gaps, with one difference: a
 * sparse channel has an anchor per run of gaps rather than one for the whole
 * container, so a completed frame claims only the gaps that read from IT, and
 * the tracker still runs afterwards because the real frames are genuinely
 * different timepoints.
 *
 * Every failure mode here degrades to "leave those frames alone", never to
 * "write something approximate". A frame this cannot project is simply not
 * projected, and the caller falls back to the ordinary tracking path.
 */

import { prisma } from '../db';
import { logger } from '../utils/logger';
import {
  findSparseChannel,
  findStaticChannel,
  projectionDelta,
  projectPolygons,
  sparseFollowers,
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
    if (!Array.isArray(parsed)) {
      return null;
    }
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
  if (!channel) {
    return NOT_APPLIED;
  }

  try {
    const container = await prisma.image.findUnique({
      where: { id: containerId },
      select: { channels: true },
    });
    const declared = container?.channels as unknown as
      StaticChannelLike[] | null;
    const meta =
      findStaticChannel(declared, channel) ??
      findSparseChannel(declared, channel);
    if (!meta) {
      return NOT_APPLIED;
    }
    // A sparse channel has an anchor per RUN of gaps, not one for the whole
    // container, so its real frames still differ from each other over time and
    // the tracker still has work to do. Only the all-frames-identical static
    // case can suppress it — see the `applied` flag below.
    const isSparse = meta.sparseSource === true;

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
    if (!source) {
      return NOT_APPLIED;
    }

    const polygons = parsePolygons(source.polygons);
    if (!polygons) {
      logger.warn(
        `Static channel '${channel}': source frame ${sourceImageId} has polygons this cannot project; leaving the other frames to segment normally`,
        'StaticChannelProjection',
        { containerId }
      );
      return NOT_APPLIED;
    }

    // The source row is included so the sparse branch can learn its frameIndex
    // without a second query, then filtered back out below.
    const allFrames = await prisma.image.findMany({
      where: { parentVideoId: containerId },
      select: { id: true, frameIndex: true },
    });
    const siblings = allFrames.filter(f => f.id !== sourceImageId);

    // Which siblings does THIS frame's result belong to?
    //   static — every frame the channel covers; they are all the same picture.
    //   sparse — only the gaps that read from this particular anchor. A gap
    //            further along the video reads from a LATER real frame and must
    //            not be given this one's polylines.
    //
    // The sparse case resolves through `sparseFill`, in INDEX space, because
    // that is the field `planSparseCollapse` used to drop these frames from the
    // queue. Consulting the id-space mirror here instead would let a container
    // that has one field but not the other lose its gap frames from both sides
    // at once — see `sparseFollowers`.
    const sourceFrameIndex =
      allFrames.find(f => f.id === sourceImageId)?.frameIndex ?? null;
    const covered = isSparse
      ? sourceFrameIndex === null
        ? []
        : sparseFollowers(meta, sourceFrameIndex, siblings)
      : meta.frameIds
        ? siblings.filter(f => meta.frameIds?.includes(f.id))
        : siblings;
    if (covered.length === 0) {
      return NOT_APPLIED;
    }

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

    if (projected === 0) {
      return NOT_APPLIED;
    }

    logger.info(
      `${isSparse ? 'Sparse' : 'Static'} channel '${channel}': projected ${polygons.length} polyline(s) from frame ${sourceImageId} onto ${projected} frame(s)` +
        (skipped ? `, ${skipped} left to segment (no recorded shift)` : '') +
        (isSparse
          ? ' — these frames hold no acquisition of their own; the tracker still runs over the real ones'
          : ' — no tracking needed, identity is carried not inferred'),
      'StaticChannelProjection',
      { containerId, projected, skipped, polylines: polygons.length }
    );

    // Frames left for normal segmentation still need the tracker, so only a
    // clean sweep suppresses it — and a sparse channel never does, because its
    // real frames are genuinely different timepoints.
    return { applied: !isSparse && skipped === 0, projected, skipped };
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
