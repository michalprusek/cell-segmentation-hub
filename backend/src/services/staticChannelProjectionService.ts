/**
 * Fill in a static channel's remaining frames from the one frame that was
 * segmented.
 *
 * See `staticChannelProjection.ts` for why this exists and for the pure
 * geometry; this module is only the database half. It runs after a queue item
 * completes, in place of scheduling the tracker: the projected polylines carry
 * the source frame's `trackId`, so cross-frame identity is exact rather than
 * inferred, and there is nothing left for a tracker to work out. A source frame
 * that has no `trackId` yet — the usual case, since the model emits none — is
 * given one here (`withMintedTrackIds`) and updated in place, because otherwise
 * "carry the anchor's identity" carries nothing and the whole container ends up
 * without one.
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

import { randomUUID } from 'crypto';
import { prisma } from '../db';
import { logger } from '../utils/logger';
import {
  findSparseChannel,
  findStaticChannel,
  projectionDelta,
  projectPolygons,
  sparseFollowers,
  withMintedTrackIds,
  type ProjectablePolygon,
  type Shift,
  type StaticChannelLike,
} from './staticChannelProjection';

/**
 * A fresh cross-frame identity for one filament.
 *
 * Same shape as the id `segmentationService.propagateTrackGeometryForward`
 * mints when the user propagates a polyline by hand (`mt_<8 hex>`), so a
 * container can hold ids from both sources without a reader having to tell them
 * apart. Nothing anywhere parses a `trackId` — the tracker's own ids are
 * `track_<10 hex>` and are equally opaque — it is only ever compared for
 * equality, and `withMintedTrackIds` guarantees uniqueness within the frame.
 */
function newTrackId(): string {
  return `mt_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

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
  /** The frame Image ids actually written, `projected` of them. A caller that
   *  has to invalidate client state needs to know WHICH frames changed, not
   *  just how many: a channel with partial coverage (`frameIds`) leaves the
   *  rest of the container untouched, and so does a frame whose shift was not
   *  recorded, so "all frames of the container" would be a claim about rows
   *  this never wrote. */
  projectedIds: string[];
}

const NOT_APPLIED: ProjectStaticChannelOutcome = {
  applied: false,
  projected: 0,
  skipped: 0,
  projectedIds: [],
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

    const parsed = parsePolygons(source.polygons);
    if (!parsed) {
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

    // Resolve every target's shift BEFORE anything is written. A covered frame
    // whose own offset was never recorded cannot be projected — assuming zero
    // would put filaments somewhere they are not, and look entirely plausible
    // doing it — and alignment failing for most of a channel's frames is a
    // condition `addChannelService` explicitly warns about, so "nothing left to
    // project" is a real outcome rather than a theoretical one. Knowing that up
    // front is what keeps the minting below from stamping the anchor with ids
    // for a projection that never happens.
    const targets = covered.map(target => ({
      target,
      delta: projectionDelta(meta, sourceImageId, target.id),
    }));
    const skipped = targets.reduce((n, t) => (t.delta ? n : n + 1), 0);
    if (skipped === targets.length) {
      return NOT_APPLIED;
    }

    // Mint the cross-frame identity the copies are about to carry.
    //
    // A static channel's frames are one acquisition, so the polylines below are
    // literally the same filaments — but a freshly segmented anchor arrives
    // with no `trackId` at all (the model emits none; only the tracker writes
    // the field), and suppressing the tracker means nothing downstream will
    // ever supply one. Projecting that nothing is what left container 4972cad8
    // with 299 segmented frames, 17 940 polylines and 0 trackIds, so every
    // cross-frame editor operation on it degraded to a single-frame one.
    //
    // The anchor is written back FIRST, so an id is never projected onto a
    // sibling that the frame which produced it does not itself carry — the
    // editor reads `trackId` off whichever frame the user has open, the anchor
    // included. A failure here throws to the catch below, which leaves every
    // frame to the ordinary segment-then-track path, the same as any other
    // failure in this module.
    //
    // SPARSE deliberately opts out: its real frames are genuinely different
    // timepoints, `applied` is false for it, and the tracker that then runs
    // would immediately overwrite anything minted here.
    let polygons = parsed;
    let minted = 0;
    if (!isSparse) {
      const minting = withMintedTrackIds(parsed, newTrackId);
      minted = minting.minted;
      if (minted > 0) {
        polygons = minting.polygons;
        await prisma.segmentation.update({
          where: { imageId: sourceImageId },
          data: { polygons: JSON.stringify(polygons) },
        });
      }
    }

    // One transaction per CHUNK of frames, not one per frame. The statements
    // are identical either way; what changes is 299 round trips and 299
    // commits against 6 of each.
    //
    // Measured against a stock postgres:15 on containers seeded to the exact
    // shape of the two this feature exists for (20 points per polyline, the
    // median real centerline after RDP). Per-frame vs chunks of 50, two runs
    // each in one session so the PAIR is comparable — the absolute figures move
    // with machine load:
    //
    //   5ac61392  300 frames x  68 polylines   1715-1970 ms -> 1186-1296 ms
    //   aafdf846  299 frames x 146 polylines   2620-3140 ms -> 2005-2108 ms
    //
    // What is left is the payload itself — ~26 MB of polygon JSON for the
    // second container — so a larger chunk buys little; 50 bounds the
    // transaction to ~100 statements and a few MB held at once. The same win
    // applies to the queue path this module was written for.
    const CHUNK = 50;
    const writable = targets.filter(
      (t): t is { target: (typeof targets)[number]['target']; delta: Shift } =>
        t.delta !== null
      // A target with no delta has an unknown offset — counted into `skipped`
      // above and left to segment normally.
    );

    const projectedIds: string[] = [];
    for (let i = 0; i < writable.length; i += CHUNK) {
      const slice = writable.slice(i, i + CHUNK);
      // Build the copy ONCE per distinct shift rather than once per frame:
      // every frame sharing a delta gets a byte-identical payload, and with
      // alignment off there is exactly one delta — [0, 0] — for the whole
      // container, which is every static channel in production today. Scoped
      // to the chunk on purpose. With alignment ON every frame has its own
      // delta and the cache never hits, so a call-wide map would retain one
      // full payload per frame (~26 MB on the container measured below) where
      // this retains only what the pending transaction already holds.
      const payloadByShift = new Map<string, string>();
      const payloadFor = (delta: Shift): string => {
        const key = `${delta[0]},${delta[1]}`;
        let cached = payloadByShift.get(key);
        if (cached === undefined) {
          cached = JSON.stringify(projectPolygons(polygons, delta));
          payloadByShift.set(key, cached);
        }
        return cached;
      };
      const ops = slice.flatMap(({ target, delta }) => {
        const payload = payloadFor(delta);
        return [
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
        ];
      });
      try {
        await prisma.$transaction(ops);
      } catch (chunkErr) {
        // Report what COMMITTED, not nothing. The chunks before this one are in
        // the database, and a caller that is told "nothing applied" would leave
        // its own view of those frames stale — the editor would keep painting
        // the rows it was about to evict. Stop here rather than press on: a
        // failing write is not likely to succeed 50 rows later, and an accurate
        // partial answer beats a longer inaccurate one.
        logger.error(
          `Static channel projection stopped after ${projectedIds.length} frame(s): ${(chunkErr as Error).message}`,
          chunkErr as Error,
          'StaticChannelProjection',
          { containerId, sourceImageId, channel }
        );
        break;
      }
      // Recorded only after the chunk commits.
      projectedIds.push(...slice.map(({ target }) => target.id));
    }
    const projected = projectedIds.length;
    const incomplete = projected < writable.length;

    logger.info(
      `${isSparse ? 'Sparse' : 'Static'} channel '${channel}': projected ${polygons.length} polyline(s) from frame ${sourceImageId} onto ${projected} frame(s)` +
        (skipped ? `, ${skipped} left to segment (no recorded shift)` : '') +
        (isSparse
          ? ' — these frames hold no acquisition of their own; the tracker still runs over the real ones'
          : ' — no tracking needed, identity is carried not inferred') +
        (minted ? `; ${minted} trackId(s) minted onto the anchor` : ''),
      'StaticChannelProjection',
      { containerId, projected, skipped, minted, polylines: polygons.length }
    );

    // Frames left for normal segmentation still need the tracker, so only a
    // clean sweep suppresses it — and a sparse channel never does, because its
    // real frames are genuinely different timepoints. A run that stopped part
    // way through is not a clean sweep either.
    return {
      applied: !isSparse && skipped === 0 && !incomplete,
      projected,
      skipped,
      projectedIds,
    };
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
