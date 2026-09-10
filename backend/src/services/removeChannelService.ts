/**
 * Removing a channel from SELECTED video frames.
 *
 * The exact inverse of `addChannelService`: that one writes one PNG per
 * (target frame x source channel) and records coverage in the container's
 * `channels` JSON, this one deletes those PNGs and narrows the same coverage.
 * Keeping the two symmetric is what makes "remove then add again" a round trip
 * rather than a repair job.
 *
 * The coverage arithmetic lives in `applyChannelRemoval` as a pure function
 * because getting it wrong does not throw — it leaves the editor requesting
 * PNGs that are gone (404 per frame), or hiding PNGs that are still on disk.
 */

import path from 'path';
import fs from 'fs/promises';
import { prisma } from '../db/prismaClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { frameStorageKey } from './videoUploadService';
import { isMicrotubuleProject } from '../types/validation';
import type { ChannelMeta } from './video/types';

export interface ChannelRemovalPlan {
  /** The container's channels JSON after the removal. */
  channels: ChannelMeta[];
  /** Frames whose PNG (and playback proxy) must be deleted. Only frames the
   *  channel actually covered — removing a channel from a frame that never had
   *  it is a no-op, not an error. */
  removedFrameIds: string[];
  /** Gap frames that lost their pixels because the real frame they are served
   *  from was removed. They leave coverage but own no file to delete. */
  sparseDependentsDropped: string[];
  /** The channel no longer exists on this container at all. */
  fullyRemoved: boolean;
  /** The removed channel carried `isSegmentationSource` and is now gone, so
   *  the container has no segmentation source left. The caller surfaces this;
   *  it is not an error, because a user may legitimately be replacing it. */
  segmentationSourceCleared: boolean;
  /** Whether anything at all changed. False means the caller should not write
   *  the row or touch the disk. */
  changed: boolean;
}

/**
 * Narrow one container's channel coverage to the frames that survive.
 *
 * @param channels    the container's current channels JSON
 * @param allFrameIds every frame id of the container, in frame order
 * @param removeFrom  the selected frame ids to remove the channel from
 * @param channelName the channel's path-safe `name`
 */
export function applyChannelRemoval(
  channels: readonly ChannelMeta[],
  allFrameIds: readonly string[],
  removeFrom: readonly string[],
  channelName: string
): ChannelRemovalPlan {
  const unchanged: ChannelRemovalPlan = {
    channels: channels as ChannelMeta[],
    removedFrameIds: [],
    sparseDependentsDropped: [],
    fullyRemoved: false,
    segmentationSourceCleared: false,
    changed: false,
  };

  const index = channels.findIndex(c => c.name === channelName);
  if (index < 0) {
    return unchanged;
  }
  const channel = channels[index];

  // An omitted `frameIds` means FULL coverage — the compact form the add path
  // writes for the common "add to the whole video" case.
  const coverage = channel.frameIds ?? allFrameIds;
  const requested = new Set(removeFrom);
  const removedFrameIds = coverage.filter(id => requested.has(id));

  // A sparse channel's gap frames hold no acquisition of their own; the
  // backend serves each from the last real frame before it. Delete that real
  // frame's PNG and the gaps have nothing left to be served from, so they
  // leave coverage as well. They own no file, hence the separate list.
  const gone = new Set(removedFrameIds);
  const fills = channel.sparseFillFrameIds ?? {};
  const sparseDependentsDropped = coverage.filter(
    id => !gone.has(id) && fills[id] !== undefined && gone.has(fills[id])
  );

  if (removedFrameIds.length === 0 && sparseDependentsDropped.length === 0) {
    return unchanged;
  }

  for (const id of sparseDependentsDropped) {
    gone.add(id);
  }
  const remaining = coverage.filter(id => !gone.has(id));

  if (remaining.length === 0) {
    return {
      channels: channels.filter((_, i) => i !== index),
      removedFrameIds,
      sparseDependentsDropped,
      fullyRemoved: true,
      segmentationSourceCleared: channel.isSegmentationSource === true,
      changed: true,
    };
  }

  const next: ChannelMeta = { ...channel };
  // Still covers everything? Keep the compact form. Writing an explicit list
  // would also switch a static channel from "no de-duplication" to
  // de-duplicating onto `frameIds[0]`, which is a behaviour change, not a
  // bookkeeping one.
  if (remaining.length === allFrameIds.length) {
    delete next.frameIds;
  } else {
    next.frameIds = remaining;
  }

  const kept = new Set(remaining);
  if (next.staticShifts) {
    next.staticShifts = Object.fromEntries(
      Object.entries(next.staticShifts).filter(([id]) => kept.has(id))
    );
  }
  if (next.sparseFillFrameIds) {
    next.sparseFillFrameIds = Object.fromEntries(
      Object.entries(next.sparseFillFrameIds).filter(([id]) => kept.has(id))
    );
  }

  const out = [...channels];
  out[index] = next;
  return {
    channels: out,
    removedFrameIds,
    sparseDependentsDropped,
    fullyRemoved: false,
    segmentationSourceCleared: false,
    changed: true,
  };
}

export interface RemoveChannelParams {
  projectId: string;
  /** The channel's path-safe `name`, not its `displayName`. */
  channelName: string;
  /** Selected FRAME ids. Containers and standalone images are ignored. */
  imageIds: string[];
}

export interface RemoveChannelResult {
  /** Frames whose PNG was deleted. */
  framesAffected: number;
  /** Containers whose channels JSON was rewritten. */
  containersAffected: number;
  /** Containers the channel no longer exists on at all. */
  containersFullyCleared: number;
  /** PNGs + playback proxies unlinked. */
  filesDeleted: number;
  /** Gap frames dropped because the real frame they read from was removed. */
  sparseDependentsDropped: number;
  /** At least one container lost its segmentation source. Surfaced so the UI
   *  can say so — a container without one is silently never segmented, which
   *  is a documented way to lose a day. */
  segmentationSourceCleared: boolean;
}

/**
 * Delete a frame's PNG for this channel, plus every playback proxy beside it.
 *
 * The proxies are named `<channel>.p<range>[.v2].webp`, so the dot right after
 * the channel name is what separates `488_nm` from `488_nm_extra` — channel
 * names ban dots (`CHANNEL_NAME_RE`), which is what makes that safe. Both
 * naming schemes are matched: a v1 file left behind would be served for a
 * channel whose pixels are gone.
 */
async function deleteFrameChannelFiles(
  projectId: string,
  containerId: string,
  frameIndex: number,
  channelName: string
): Promise<number> {
  const key = frameStorageKey(projectId, containerId, frameIndex, channelName);
  const abs = path.join(config.UPLOAD_DIR, key);
  const dir = path.dirname(abs);
  let deleted = 0;
  await fs.rm(abs, { force: true });
  deleted++;
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir)) as unknown as string[];
  } catch {
    // The frame directory may already be gone. Nothing left to unlink.
    return deleted;
  }
  const prefix = `${channelName}.p`;
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.webp')) {continue;}
    await fs.rm(path.join(dir, name), { force: true });
    deleted++;
  }
  return deleted;
}

/**
 * Remove `channelName` from the selected frames.
 *
 * Deliberately tolerant of frames the channel does not cover: the project grid
 * selects whole videos as easily as single frames, and "remove this channel
 * from everything I picked" must not fail because one of them never had it.
 */
export async function removeChannelFromFrames(
  params: RemoveChannelParams
): Promise<RemoveChannelResult> {
  const { projectId, channelName, imageIds } = params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, type: true },
  });
  if (!project || !isMicrotubuleProject(project.type)) {
    throw new Error(
      'Remove channel is only available for microtubule projects'
    );
  }
  // Storage paths are built from the ROW's id, never the URL segment that
  // found it — same reasoning as `addChannelToFrames`.
  const storageProjectId = project.id;

  if (!Array.isArray(imageIds) || imageIds.length === 0) {
    throw new Error('No images selected');
  }

  const rows = await prisma.image.findMany({
    where: { id: { in: imageIds }, projectId },
    select: {
      id: true,
      parentVideoId: true,
      frameIndex: true,
      isVideoContainer: true,
    },
  });
  const selectedByContainer = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.isVideoContainer || r.parentVideoId == null || r.frameIndex == null) {
      continue;
    }
    const set = selectedByContainer.get(r.parentVideoId) ?? new Set<string>();
    set.add(r.id);
    selectedByContainer.set(r.parentVideoId, set);
  }
  if (selectedByContainer.size === 0) {
    throw new Error(
      'Select video frames to remove a channel from (standalone images are not supported)'
    );
  }

  const containers = await prisma.image.findMany({
    where: { id: { in: [...selectedByContainer.keys()] }, projectId },
    select: { id: true, channels: true },
  });

  const result: RemoveChannelResult = {
    framesAffected: 0,
    containersAffected: 0,
    containersFullyCleared: 0,
    filesDeleted: 0,
    sparseDependentsDropped: 0,
    segmentationSourceCleared: false,
  };

  for (const container of containers) {
    const selected = selectedByContainer.get(container.id);
    if (!selected) {continue;}

    // The container's OWN frames, in frame order. This is what "full coverage"
    // is measured against — using the SELECTION instead would read a one-frame
    // pick as "covers everything" and wipe the channel off the whole video.
    const allFrames = await prisma.image.findMany({
      where: { parentVideoId: container.id },
      select: { id: true, frameIndex: true },
      orderBy: { frameIndex: 'asc' },
    });
    const allFrameIds = allFrames.map(f => f.id);
    const indexById = new Map(allFrames.map(f => [f.id, f.frameIndex ?? 0]));

    const existing: ChannelMeta[] = Array.isArray(container.channels)
      ? (container.channels as unknown as ChannelMeta[])
      : [];

    const plan = applyChannelRemoval(
      existing,
      allFrameIds,
      [...selected],
      channelName
    );
    if (!plan.changed) {continue;}

    for (const frameId of plan.removedFrameIds) {
      const frameIndex = indexById.get(frameId);
      if (frameIndex === undefined) {continue;}
      result.filesDeleted += await deleteFrameChannelFiles(
        storageProjectId,
        container.id,
        frameIndex,
        channelName
      );
    }

    await prisma.image.update({
      where: { id: container.id },
      data: { channels: plan.channels as unknown as object },
    });

    result.framesAffected += plan.removedFrameIds.length;
    result.containersAffected++;
    result.sparseDependentsDropped += plan.sparseDependentsDropped.length;
    if (plan.fullyRemoved) {result.containersFullyCleared++;}
    if (plan.segmentationSourceCleared) {result.segmentationSourceCleared = true;}
  }

  logger.info(
    `removeChannel: '${channelName}' removed from ${result.framesAffected} frame(s) ` +
      `across ${result.containersAffected} container(s), ${result.filesDeleted} file(s) deleted`
  );
  return result;
}
