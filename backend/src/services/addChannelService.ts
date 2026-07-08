/**
 * "Add channel" service (microtubule projects).
 *
 * Appends an extra image channel to a set of SELECTED video frames by
 * decoding an uploaded source (video / stack / ND2 / single image) and writing
 * one per-frame PNG per source channel into the target frames' existing
 * ``frames/<TTTT>/`` directories, then appending the new channel(s) to each
 * affected video container's ``channels`` JSON.
 *
 * The added channel is **PNG-backed** (`ChannelMeta.pngBacked = true`): its
 * pixels live only in the per-frame PNGs, never in the container's original
 * volume. It renders in the editor and can be kymographed like any channel;
 * ``mt_metrics.py`` samples it from the PNGs (see `mtMetricsExporter.ts`).
 *
 * Coverage is exactly the selected frames — other frames of the same video do
 * not get the channel, which every consumer tolerates (a missing per-frame PNG
 * is expected).
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { prisma } from '../db/prismaClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { ChannelMeta, defaultColorForWavelength } from './video/types';
import { detectVideoKind, extractVideoSafe } from './video/videoExtractor';
import { alignChannelFrames, ChannelAlignJob } from './video/pythonExtractor';
import { frameStorageKey } from './videoUploadService';

const CHANNEL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DISPLAY_NAME_LEN = 128;

export interface AddChannelParams {
  projectId: string;
  /** Uploaded source file's original name — drives format detection. */
  originalName: string;
  /** Multer temp path of the uploaded source (owned by the caller). */
  tempFilePath: string;
  /** User-provided friendly channel name (base label). */
  channelName: string;
  /** Phase-correlation align each added frame to the frame's seg source. */
  align: boolean;
  /** Selected frame Image ids. */
  imageIds: string[];
}

export interface AddChannelResult {
  addedChannels: string[];
  affectedContainerIds: string[];
  framesWritten: number;
}

interface TargetFrame {
  id: string;
  frameIndex: number;
}

/** Slugify a user label into a path-safe channel machine name. */
function slugifyChannelName(label: string): string {
  const slug = label
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  if (!CHANNEL_NAME_RE.test(slug)) {
    throw new Error(
      'Channel name must contain at least one letter, digit, underscore or dash'
    );
  }
  return slug;
}

/** First unique ``base``/``base_2``/``base_3`` … not already in ``used``. */
function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`.slice(0, 64);
    if (!used.has(candidate)) return candidate;
  }
  // Practically unreachable; fall back to a random suffix.
  return `${base}_${randomUUID().slice(0, 6)}`.slice(0, 64);
}

/** Absolute path of a frame's channel PNG under the upload root. */
function frameChannelAbs(
  projectId: string,
  containerId: string,
  frameIndex: number,
  channelName: string
): string {
  return path.join(
    config.UPLOAD_DIR,
    frameStorageKey(projectId, containerId, frameIndex, channelName)
  );
}

/**
 * Decode the uploaded source into a temp ``frames/<j>/<channel>.png`` layout
 * plus the list of its channels. For a plain image (png/jpg) this is a single
 * grayscale frame; for a video/stack/ND2 it delegates to the shared extractor.
 */
async function extractSource(
  originalName: string,
  tempFilePath: string,
  tempDir: string
): Promise<{
  frameCount: number;
  width: number;
  height: number;
  /** Machine channel names as written on disk under frames/<j>/. */
  channelNames: string[];
  /** Parallel metadata for building the final ChannelMeta. */
  channelMeta: ChannelMeta[];
}> {
  const isVideoLike = detectVideoKind(originalName) !== null;

  if (isVideoLike) {
    const outcome = await extractVideoSafe(tempFilePath, tempDir, {
      registerChannels: false,
    });
    if (outcome.kind === 'multi') {
      throw new Error(
        'A multi-position ND2 cannot be added as a channel. Upload a single-position video, stack, or image.'
      );
    }
    const r = outcome.result;
    return {
      frameCount: r.frameCount,
      width: r.width,
      height: r.height,
      channelNames: r.channels.map(c => c.name),
      channelMeta: r.channels,
    };
  }

  // Single image → one grayscale frame at frames/0000/ch0.png.
  const framesDir = path.join(tempDir, 'frames', '0000');
  await fs.mkdir(framesDir, { recursive: true });
  const meta = await sharp(tempFilePath, { unlimited: true }).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read image dimensions from the uploaded file');
  }
  await sharp(tempFilePath, { unlimited: true })
    .grayscale()
    .png()
    .toFile(path.join(framesDir, 'ch0.png'));
  return {
    frameCount: 1,
    width: meta.width,
    height: meta.height,
    channelNames: ['ch0'],
    channelMeta: [
      {
        name: 'ch0',
        type: 'fluorescent',
        isSegmentationSource: false,
      },
    ],
  };
}

/**
 * Core entry point. Assumes the caller has already verified project access.
 * Always removes ``tempFilePath`` and the temp extraction dir before returning
 * (success or throw).
 */
export async function addChannelToFrames(
  params: AddChannelParams
): Promise<AddChannelResult> {
  const { projectId, originalName, tempFilePath, channelName, align, imageIds } =
    params;

  const baseSlug = slugifyChannelName(channelName);
  const displayBase = channelName.trim().slice(0, MAX_DISPLAY_NAME_LEN);

  const tempDir = path.join(os.tmpdir(), `add-channel-${randomUUID()}`);

  try {
    // 1. Project must be a microtubule project.
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { type: true },
    });
    if ((project?.type ?? '') !== 'microtubules') {
      throw new Error('Add channel is only available for microtubule projects');
    }

    // 2. Load the selected frames (video-frame rows only) and group by video.
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
    const byContainer = new Map<string, TargetFrame[]>();
    for (const r of rows) {
      if (r.isVideoContainer || r.parentVideoId == null || r.frameIndex == null) {
        continue;
      }
      const list = byContainer.get(r.parentVideoId) ?? [];
      list.push({ id: r.id, frameIndex: r.frameIndex });
      byContainer.set(r.parentVideoId, list);
    }
    if (byContainer.size === 0) {
      throw new Error(
        'Select video frames to add a channel to (standalone images are not supported)'
      );
    }
    const selectedCount = [...byContainer.values()].reduce(
      (n, l) => n + l.length,
      0
    );
    // Deterministic pairing order.
    for (const list of byContainer.values()) {
      list.sort((a, b) => a.frameIndex - b.frameIndex);
    }

    // 3. Decode the uploaded source.
    await fs.mkdir(tempDir, { recursive: true });
    const source = await extractSource(originalName, tempFilePath, tempDir);

    // 4. Coverage rules for a multi-frame (video/stack) source.
    if (source.frameCount > 1) {
      if (byContainer.size > 1) {
        throw new Error(
          'A multi-frame video can only be added to frames of a single video. Select frames from one video, or upload a single image.'
        );
      }
      if (source.frameCount !== selectedCount) {
        throw new Error(
          `Frame count mismatch: the uploaded video has ${source.frameCount} frames but ${selectedCount} frames are selected. They must match.`
        );
      }
    }

    // 5. Load affected containers (channels + dimensions + seg source).
    const containers = await prisma.image.findMany({
      where: { id: { in: [...byContainer.keys()] }, projectId },
      select: { id: true, channels: true, width: true, height: true },
    });
    const containerById = new Map(containers.map(c => [c.id, c]));

    // 6. Dimension check — an added channel must share the frames' pixel grid.
    for (const c of containers) {
      if (
        c.width != null &&
        c.height != null &&
        (c.width !== source.width || c.height !== source.height)
      ) {
        throw new Error(
          `Dimension mismatch: the source is ${source.width}×${source.height} but the target video is ${c.width}×${c.height}. Channels must share the same pixel grid.`
        );
      }
    }

    // 7. Write PNGs (copy, or collect alignment jobs) + build ChannelMeta per
    //    container. Names are resolved against each container's existing set.
    const alignJobs: ChannelAlignJob[] = [];
    const newChannelsByContainer = new Map<string, ChannelMeta[]>();
    const addedChannelNames = new Set<string>();
    let framesWritten = 0;

    for (const [containerId, frames] of byContainer) {
      const container = containerById.get(containerId);
      if (!container) continue;
      const existing: ChannelMeta[] = Array.isArray(container.channels)
        ? (container.channels as unknown as ChannelMeta[])
        : [];
      const usedNames = new Set(existing.map(c => c.name));
      const segSourceName =
        existing.find(c => c.isSegmentationSource)?.name ??
        existing[0]?.name ??
        null;
      if (align && !segSourceName) {
        throw new Error(
          'Cannot align: the target video has no channels to align against'
        );
      }

      const finalMeta: ChannelMeta[] = [];
      source.channelMeta.forEach((srcMeta, ci) => {
        const multi = source.channelMeta.length > 1;
        const finalName = uniqueName(
          multi ? `${baseSlug}_${ci + 1}`.slice(0, 64) : baseSlug,
          usedNames
        );
        usedNames.add(finalName);
        const displayName = (
          multi
            ? `${displayBase} (${srcMeta.displayName ?? srcMeta.name})`
            : displayBase
        ).slice(0, MAX_DISPLAY_NAME_LEN);
        finalMeta.push({
          name: finalName,
          displayName,
          type: 'fluorescent',
          isSegmentationSource: false,
          pngBacked: true,
          wavelengthNm: srcMeta.wavelengthNm,
          displayColor:
            srcMeta.displayColor ??
            defaultColorForWavelength(srcMeta.wavelengthNm),
        });
        addedChannelNames.add(finalName);
      });
      newChannelsByContainer.set(containerId, finalMeta);

      // Write / queue one PNG per (target frame × source channel).
      for (let fi = 0; fi < frames.length; fi++) {
        const target = frames[fi];
        // Single-image source → always source frame 0; multi-frame → paired.
        const sourceFrameIndex = source.frameCount > 1 ? fi : 0;
        const srcFrameDir = String(sourceFrameIndex).padStart(4, '0');

        for (let ci = 0; ci < source.channelMeta.length; ci++) {
          const srcName = source.channelNames[ci];
          const finalName = finalMeta[ci].name;
          const moving = path.join(
            tempDir,
            'frames',
            srcFrameDir,
            `${srcName}.png`
          );
          const outAbs = frameChannelAbs(
            projectId,
            containerId,
            target.frameIndex,
            finalName
          );
          await fs.mkdir(path.dirname(outAbs), { recursive: true });

          if (align && segSourceName) {
            alignJobs.push({
              moving,
              reference: frameChannelAbs(
                projectId,
                containerId,
                target.frameIndex,
                segSourceName
              ),
              out: outAbs,
            });
          } else {
            await fs.copyFile(moving, outAbs);
          }
          framesWritten++;
        }
      }
    }

    // 8. Run alignment (single batched Python call) if requested.
    if (align && alignJobs.length > 0) {
      const manifestPath = path.join(tempDir, 'align_manifest.json');
      await fs.writeFile(
        manifestPath,
        JSON.stringify({ jobs: alignJobs }),
        'utf-8'
      );
      const res = await alignChannelFrames(manifestPath);
      logger.info('Add-channel alignment complete', 'AddChannelService', {
        jobs: alignJobs.length,
        aligned: res.aligned,
      });
    }

    // 9. Append new channels to each container's channels JSON (transaction).
    await prisma.$transaction(
      [...newChannelsByContainer.entries()].map(([containerId, added]) => {
        const container = containerById.get(containerId);
        const existing: ChannelMeta[] = Array.isArray(container?.channels)
          ? (container!.channels as unknown as ChannelMeta[])
          : [];
        return prisma.image.update({
          where: { id: containerId },
          data: {
            channels: [...existing, ...added] as unknown as object,
          },
        });
      })
    );

    logger.info('Channel added to selected frames', 'AddChannelService', {
      projectId,
      containers: byContainer.size,
      addedChannels: [...addedChannelNames],
      framesWritten,
      align,
    });

    return {
      addedChannels: [...addedChannelNames],
      affectedContainerIds: [...byContainer.keys()],
      framesWritten,
    };
  } finally {
    await fs.rm(tempFilePath, { force: true }).catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
