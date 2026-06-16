/**
 * Microtubule kymograph export (microtubules projects only).
 *
 * For every MT video container in the project, builds one kymograph per
 * microtubule (each polyline in the container's first segmented frame), runs
 * blob-motion detection, and writes:
 *
 *   - ``kymographs/<video>__<polyline>.png`` — the kymograph with the detected
 *     tracks drawn on top (when ``includeSegmentedImages``).
 *   - ``kymographs/velocity_metrics.csv`` — one long-format row per run across
 *     all microtubules (when ``includeVelocityMetrics``).
 *
 * Reuses ``buildKymograph`` so the export and the editor modal share the exact
 * same sampling, detection and calibration path — no drift between what the
 * user sees and what ships in the bundle.
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import { prisma } from '../../db/prismaClient';
import { logger } from '../../utils/logger';
import { buildKymograph } from '../kymographService';

const CTX = 'MTKymographExporter';

/** Per-container cap so a 200-MT field can't make one export run for hours.
 *  Anything dropped is logged (never silently truncated). */
const MAX_MT_PER_CONTAINER = 60;

export interface MTKymographOptions {
  enabled: boolean;
  includeVelocityMetrics: boolean;
  includeSegmentedImages: boolean;
}

interface PolylineRecord {
  id: string;
  points?: Array<{ x: number; y: number }>;
}

function parsePolylines(json: string | null | undefined): PolylineRecord[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as PolylineRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Channels to sample per microtubule. ALL fluorescent channels (motility can
 *  live in any of them — picking just the first silently misses motion in the
 *  others); fall back to the segmentation source / first channel when the
 *  upload has no fluorescent channels. */
function pickSourceChannels(
  channels: Array<{
    name: string;
    type?: string;
    isSegmentationSource?: boolean;
  }>
): string[] {
  if (channels.length === 0) return [];
  const fluorescent = channels
    .filter(c => c.type === 'fluorescent')
    .map(c => c.name);
  if (fluorescent.length > 0) return fluorescent;
  const source = channels.find(c => c.isSegmentationSource);
  return [source?.name ?? channels[0].name];
}

const csvField = (v: number | string | null | undefined): string =>
  v == null ? '' : String(v);

export async function exportMicrotubuleKymographs(
  projectId: string,
  exportDir: string,
  options: MTKymographOptions
): Promise<void> {
  if (!options.enabled) return;

  const containers = await prisma.image.findMany({
    where: { projectId, isVideoContainer: true },
    select: { id: true, name: true, channels: true },
  });
  if (containers.length === 0) return;

  const outDir = path.join(exportDir, 'kymographs');
  await fs.mkdir(outDir, { recursive: true });

  const csvRows: string[] = [
    [
      'video',
      'microtubule',
      'source_channel',
      'track',
      'net_velocity_um_s',
      'net_velocity_px_frame',
      'snr',
      'run_index',
      'run_velocity_um_s',
      'run_se_um_s',
      'run_velocity_px_frame',
      't0',
      't1',
      'pixel_size_um',
      'frame_interval_ms',
    ].join(','),
  ];

  for (const container of containers) {
    const channels = Array.isArray(container.channels)
      ? (container.channels as Array<{
          name: string;
          type?: string;
          isSegmentationSource?: boolean;
        }>)
      : [];
    const sourceChannels = pickSourceChannels(channels);
    if (sourceChannels.length === 0) {
      logger.warn(
        `Container ${container.id} has no usable channel; skipping kymographs`,
        CTX
      );
      continue;
    }

    // Seed = first frame that actually carries polylines.
    const seedFrame = await prisma.image.findFirst({
      where: {
        parentVideoId: container.id,
        segmentation: { isNot: null },
      },
      orderBy: { frameIndex: 'asc' },
      select: {
        frameIndex: true,
        segmentation: { select: { polygons: true } },
      },
    });
    if (!seedFrame || seedFrame.frameIndex == null) continue;

    const polylines = parsePolylines(
      seedFrame.segmentation?.polygons ?? null
    ).filter(p => Array.isArray(p.points) && p.points.length >= 2);
    if (polylines.length === 0) continue;

    const safeVideo = container.name.replace(/[^A-Za-z0-9_-]+/g, '_');
    const selected = polylines.slice(0, MAX_MT_PER_CONTAINER);
    if (polylines.length > selected.length) {
      logger.warn(
        `Container ${container.name}: ${polylines.length} microtubules, ` +
          `capping kymograph export at ${MAX_MT_PER_CONTAINER}`,
        CTX
      );
    }

    for (const poly of selected) {
      // One kymograph per (microtubule × fluorescent channel) — motion may be
      // in any channel, so we sample them all rather than guess one.
      for (const sourceChannel of sourceChannels) {
        try {
          const result = await buildKymograph({
            videoContainerId: container.id,
            polylineId: poly.id,
            frameIndex: seedFrame.frameIndex,
            sourceChannel,
            detectVelocity: true,
            renderOverlay: options.includeSegmentedImages,
          });

          if (options.includeSegmentedImages && result.overlayPngBase64) {
            await fs.writeFile(
              path.join(outDir, `${safeVideo}__${poly.id}__${sourceChannel}.png`),
              Buffer.from(result.overlayPngBase64, 'base64')
            );
          }

          if (options.includeVelocityMetrics && result.tracks) {
            result.tracks.forEach((tr, ti) => {
              const base = [
                container.name,
                poly.id,
                sourceChannel,
                ti + 1,
                csvField(tr.netVelocityUmPerSec),
                tr.netVelocityPxPerFrame,
                tr.snr,
              ];
              if (tr.runs.length === 0) {
                csvRows.push(
                  [
                    ...base,
                    '',
                    '',
                    '',
                    '',
                    '',
                    '',
                    csvField(result.pixelSizeUm),
                    csvField(result.frameIntervalMs),
                  ].join(',')
                );
              }
              tr.runs.forEach((r, ri) => {
                csvRows.push(
                  [
                    ...base,
                    ri + 1,
                    csvField(r.velocityUmPerSec),
                    csvField(r.seUmPerSec),
                    r.velocityPxPerFrame,
                    r.t0,
                    r.t1,
                    csvField(result.pixelSizeUm),
                    csvField(result.frameIntervalMs),
                  ].join(',')
                );
              });
            });
          }
        } catch (err) {
          // One bad microtubule/channel must not abort the whole export.
          logger.warn(
            `Kymograph failed for ${container.name}/${poly.id}/${sourceChannel}: ${(err as Error).message}`,
            CTX
          );
        }
      }
    }
  }

  if (options.includeVelocityMetrics && csvRows.length > 1) {
    await fs.writeFile(
      path.join(outDir, 'velocity_metrics.csv'),
      csvRows.join('\n'),
      'utf-8'
    );
  }

  logger.info('Microtubule kymographs exported', CTX, {
    projectId,
    containers: containers.length,
    velocityRows: csvRows.length - 1,
  });
}
