/**
 * Mean intensity of the soma and neurite classes, per frame and per channel.
 *
 * One row per (frame, channel, class). The regions are the STORED polygons —
 * what the user sees in the editor, corrections included — and the pixels are
 * each channel's own per-frame file at its native bit depth. The geometry and
 * the statistics run in the ML service (`/api/v1/neurite-intensity`), which
 * shares them with the microtubule export.
 *
 * Deliberately independent of `neuriteMetricsExporter`'s tables: those need a
 * pixel size (every staging threshold is in micrometres) and a soma to key
 * rows by, and skip a frame that lacks either. Intensity needs neither, so a
 * frame without a calibration still gets its row here.
 */

import axios from 'axios';
import * as path from 'path';

import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import type { Semaphore } from '../../utils/concurrency';
import { frameChannelPath } from '../../utils/channelPath';
import { prisma } from '../../db/prismaClient';
import {
  splitNeuritePolygons,
  type NeuriteIntensityResult,
  type NeuriteIntensityRow,
} from './neuriteMetricsExporter';

export interface NeuriteIntensityImage {
  id: string;
  name?: string | null;
  width?: number | null;
  height?: number | null;
  originalPath?: string | null;
  parentVideoId?: string | null;
  isVideoContainer?: boolean | null;
  segmentation?: { polygons?: string | null } | null;
}

interface ContainerChannel {
  name: string;
  displayName?: string;
  sparseFill?: Record<string, number> | null;
  frameIds?: string[];
}

interface ChannelFile {
  name: string;
  path: string;
}

/**
 * The file of every channel of one image.
 *
 * A frame of a multi-channel container has one file per channel; a still is
 * its own single channel. A channel that does not cover this frame (added
 * after upload, to a subset of frames) is left out rather than reported as
 * missing.
 */
function channelFiles(
  image: NeuriteIntensityImage,
  containerChannels: ContainerChannel[] | undefined
): ChannelFile[] {
  if (!image.originalPath) {
    return [];
  }
  if (containerChannels?.length) {
    const files: ChannelFile[] = [];
    for (const channel of containerChannels) {
      if (channel.frameIds && !channel.frameIds.includes(image.id)) {
        continue;
      }
      const key = frameChannelPath(image.originalPath, channel);
      if (key) {
        files.push({
          name: channel.displayName ?? channel.name,
          path: path.join(config.UPLOAD_DIR, key),
        });
      }
    }
    if (files.length) {
      return files;
    }
  }
  return [
    { name: 'image', path: path.join(config.UPLOAD_DIR, image.originalPath) },
  ];
}

function assertRows(data: unknown): NeuriteIntensityRow[] {
  const rows = (data as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) {
    throw new Error('neurite-intensity: response.rows was not an array');
  }
  return rows as NeuriteIntensityRow[];
}

export async function computeNeuriteIntensity(
  images: NeuriteIntensityImage[],
  mlGate?: Semaphore
): Promise<NeuriteIntensityResult> {
  const rows: NeuriteIntensityRow[] = [];
  const skipped: Array<{ image: string; reason: string }> = [];

  const frames = images.filter(img => !img.isVideoContainer);
  const containerIds = Array.from(
    new Set(frames.map(img => img.parentVideoId).filter((v): v is string => !!v))
  );
  const containers = containerIds.length
    ? await prisma.image.findMany({
        where: { id: { in: containerIds } },
        select: { id: true, channels: true },
      })
    : [];
  const channelsByContainer = new Map<string, ContainerChannel[]>(
    containers.map(c => [
      c.id,
      Array.isArray(c.channels)
        ? (c.channels as unknown as ContainerChannel[])
        : [],
    ])
  );

  const url = `${config.SEGMENTATION_SERVICE_URL}/api/v1/neurite-intensity`;

  // Sequential, like the metrics tables: the endpoint serialises on a
  // one-slot executor, so parallel requests would only queue there.
  for (const image of frames) {
    const label = image.name ?? image.id;
    if (!image.segmentation?.polygons) {
      skipped.push({ image: label, reason: 'not segmented' });
      continue;
    }
    if (!image.width || !image.height) {
      skipped.push({ image: label, reason: 'frame dimensions unknown' });
      continue;
    }
    const split = splitNeuritePolygons(image.segmentation.polygons);
    if (!split) {
      skipped.push({ image: label, reason: 'segmentation JSON unreadable' });
      continue;
    }
    if (!split.soma.length && !split.neurite.length) {
      skipped.push({ image: label, reason: 'no soma or neurite polygons' });
      continue;
    }
    const channels = channelFiles(
      image,
      image.parentVideoId
        ? channelsByContainer.get(image.parentVideoId)
        : undefined
    );
    if (!channels.length) {
      skipped.push({ image: label, reason: 'image file unknown' });
      continue;
    }

    const body = {
      frame: label,
      width: image.width,
      height: image.height,
      soma_polygons: split.soma,
      neurite_polygons: split.neurite,
      channels,
    };
    const megapixels = (image.width * image.height) / 1_000_000;
    const timeout = Math.min(
      10 * 60_000,
      Math.max(60_000, Math.round(megapixels * channels.length * 2_000))
    );
    const send = async (): Promise<void> => {
      try {
        const response = await axios.post(url, body, { timeout });
        // The service names the frame once, on the envelope; its rows are
        // (channel, class) only. Stamped here, from the label this side
        // chose, so a row can be traced to its image.
        rows.push(
          ...assertRows(response.data).map(row => ({ ...row, frame: label }))
        );
      } catch (error) {
        const detail =
          axios.isAxiosError(error) &&
          typeof error.response?.data === 'object' &&
          error.response?.data !== null
            ? String(
                (error.response.data as { detail?: unknown }).detail ??
                  error.message
              )
            : error instanceof Error
              ? error.message
              : String(error);
        logger.warn(
          `Neurite intensity failed for ${label}`,
          'neuriteIntensityExporter',
          { detail }
        );
        skipped.push({ image: label, reason: detail });
      }
    };
    await (mlGate ? mlGate.run(send) : send());
  }

  return { rows, skipped };
}
