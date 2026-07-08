/**
 * Microtubule kymograph export (microtubules projects only).
 *
 * For every MT video container in the project, builds one kymograph per
 * microtubule × fluorescent channel (each polyline in the container's first
 * segmented frame, sampled on every fluorescent channel — motility can live in
 * any of them), runs blob-motion detection, and writes:
 *
 *   - ``kymographs/<video>__<polyline>__<channel>.png`` — the kymograph with the
 *     detected tracks drawn on top (when ``includeSegmentedImages``).
 *   - ``kymographs/velocity_metrics.xlsx`` — one worksheet per fluorescent
 *     channel (channel = motor/protein, e.g. one sheet for kinesin), one row
 *     per detected trajectory (when ``includeVelocityMetrics``).
 *
 * Reuses ``buildKymograph`` so the export and the editor modal share the exact
 * same sampling, detection and calibration path — no drift between what the
 * user sees and what ships in the bundle.
 *
 * This is an OPTIONAL add-on: any failure (DB, disk, ML) degrades to "no
 * kymograph output" and must never abort the surrounding export job.
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import { prisma } from '../../db/prismaClient';
import { logger } from '../../utils/logger';
import { mapWithConcurrency } from '../../utils/concurrency';
import { buildKymograph } from '../kymographService';

const CTX = 'MTKymographExporter';

/** Per-container cap so a 200-MT field can't make one export run for hours.
 *  Anything dropped is logged (never silently truncated). */
const MAX_MT_PER_CONTAINER = 60;

/** Parallel ML kymograph builds. The ML service has finite capacity, so keep
 *  this small — it bounds export wall-clock without overrunning inference. */
const KYMOGRAPH_CONCURRENCY = 3;

/** Per (microtubule × channel) cap on the number of frame profiles written in
 *  ``profiles`` mode. Profiles are intended for small stacks (the single-frame
 *  case forces this mode); a long time-lapse would otherwise emit thousands of
 *  PNGs. Deterministic per job (every MT treated identically); truncation is
 *  logged, never silent. */
const MAX_PROFILE_FRAMES_PER_MT = 300;

/** Which artefact the MT kymograph export produces. ``kymograph`` = the stacked
 *  heatmap + velocity metrics (default); ``profiles`` = one matplotlib
 *  intensity-vs-position plot per frame (+ the intensity CSV). */
export type MTKymographMode = 'kymograph' | 'profiles';

export interface MTKymographOptions {
  enabled: boolean;
  mode: MTKymographMode;
  includeVelocityMetrics: boolean;
  includeSegmentedImages: boolean;
}

interface PolylineRecord {
  id: string;
  points?: Array<{ x: number; y: number }>;
}

interface ChannelMeta {
  name: string;
  type?: string;
  isSegmentationSource?: boolean;
}

/** One (microtubule × channel) kymograph to build. */
interface KymographJob {
  containerId: string;
  videoName: string;
  safeVideo: string;
  polylineId: string;
  frameIndex: number;
  sourceChannel: string;
}

function parsePolylines(
  json: string | null | undefined,
  containerId: string
): PolylineRecord[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as PolylineRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // A parse failure of stored segmentation is a real defect, not an empty
    // frame — surface it instead of silently yielding "no microtubules".
    logger.warn(
      `Failed to parse polygons for container ${containerId}: ${(err as Error).message}`,
      CTX
    );
    return [];
  }
}

/** Channels to sample per microtubule. ALL fluorescent channels (motility can
 *  live in any of them — picking just the first silently misses motion in the
 *  others); fall back to the segmentation source / first channel when the
 *  upload has no fluorescent channels. */
export function pickSourceChannels(channels: ChannelMeta[]): string[] {
  if (channels.length === 0) return [];
  const fluorescent = channels
    .filter(c => c.type === 'fluorescent')
    .map(c => c.name);
  if (fluorescent.length > 0) return fluorescent;
  const source = channels.find(c => c.isSegmentationSource);
  return [source?.name ?? channels[0].name];
}

/** One velocity row, in the exact column order of ``VELOCITY_HEADER``. Cells are
 *  written to Excel as their native type — numbers stay numeric, ``null`` is an
 *  empty cell (uncalibrated / no background band), ``bright`` is a boolean. */
type VelocityRow = Array<string | number | boolean | null>;

const VELOCITY_HEADER = [
  'video',
  'microtubule',
  'track',
  'net_velocity_um_s',
  'net_velocity_px_frame',
  'snr',
  'total_run_length_um',
  'total_run_time_s',
  'intensity_signal',
  'intensity_background',
  'intensity_minus_background',
  'bright',
  'edge_touch',
  'pixel_size_um',
  'frame_interval_ms',
];

/** Excel worksheet names must be ≤31 chars, non-blank, unique, and free of
 *  ``* ? : \ / [ ]``. Sanitise the channel name and de-duplicate against the
 *  names already used so two channels that collide after truncation stay
 *  distinct (the suffix is kept inside the 31-char budget). */
function safeSheetName(channel: string, used: Set<string>): string {
  const cleaned =
    channel.replace(/[*?:\\/[\]]/g, '_').slice(0, 31) || 'channel';
  let name = cleaned;
  let i = 2;
  while (used.has(name)) {
    const suffix = `_${i++}`;
    name = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name);
  return name;
}

/** Write ``velocity_metrics.xlsx`` with one worksheet per source channel.
 *  exceljs is loaded lazily (CJS interop via ``.default``) so it is only pulled
 *  in when MT velocity metrics are actually exported. Sheets are emitted in
 *  sorted channel order for deterministic, reproducible workbooks. */
async function writeVelocityWorkbook(
  filePath: string,
  rowsByChannel: Map<string, VelocityRow[]>
): Promise<void> {
  type ExcelJsDefault = typeof import('exceljs');
  const excelMod = (await import('exceljs')) as unknown as {
    default: ExcelJsDefault;
  };
  const ExcelJS = excelMod.default;

  const workbook = new ExcelJS.Workbook();
  const used = new Set<string>();
  for (const channel of [...rowsByChannel.keys()].sort()) {
    const sheet = workbook.addWorksheet(safeSheetName(channel, used));
    sheet.addRow(VELOCITY_HEADER);
    for (const row of rowsByChannel.get(channel) ?? []) sheet.addRow(row);
  }
  await workbook.xlsx.writeFile(filePath);
}

export async function exportMicrotubuleKymographs(
  projectId: string,
  exportDir: string,
  options: MTKymographOptions
): Promise<void> {
  // Normalise the mode: the controller casts req.body without validation, so an
  // older cached FE bundle (or a direct API caller) may omit it. Default to the
  // prior behaviour (kymograph) rather than trusting the raw wire value.
  const mode: MTKymographMode =
    options.mode === 'profiles' ? 'profiles' : 'kymograph';

  // Nothing to produce → skip the (expensive) builds entirely. In kymograph
  // mode, both sub-options off = no output. Profiles mode always writes plots +
  // CSV, so it has no such short-circuit.
  if (!options.enabled) return;
  if (
    mode === 'kymograph' &&
    !options.includeVelocityMetrics &&
    !options.includeSegmentedImages
  ) {
    return;
  }

  try {
    const containers = await prisma.image.findMany({
      where: { projectId, isVideoContainer: true },
      select: { id: true, name: true, channels: true },
    });
    if (containers.length === 0) return;

    const outDir = path.join(
      exportDir,
      mode === 'profiles' ? 'profiles' : 'kymographs'
    );
    await fs.mkdir(outDir, { recursive: true });

    // --- Phase 1: resolve the (microtubule × channel) job list. ----------
    const jobs: KymographJob[] = [];
    for (const container of containers) {
      const channels = Array.isArray(container.channels)
        ? (container.channels as unknown as ChannelMeta[])
        : [];
      const sourceChannels = pickSourceChannels(channels);
      if (sourceChannels.length === 0) {
        logger.warn(
          `Container ${container.id} has no usable channel; skipping kymographs`,
          CTX
        );
        continue;
      }

      // Seed = the EARLIEST frame whose segmentation actually carries a usable
      // polyline. Frame 0 is frequently an empty / unsegmented record while the
      // tracked polylines only appear from frame 1 on, so picking merely "the
      // first frame that has a segmentation record" would skip the whole
      // container. Scan in frameIndex order and take the first non-empty one.
      const segmentedFrames = await prisma.image.findMany({
        where: { parentVideoId: container.id, segmentation: { isNot: null } },
        orderBy: { frameIndex: 'asc' },
        select: {
          frameIndex: true,
          segmentation: { select: { polygons: true } },
        },
      });

      let seedFrameIndex: number | null = null;
      let polylines: PolylineRecord[] = [];
      for (const f of segmentedFrames) {
        if (f.frameIndex == null) continue;
        const usable = parsePolylines(
          f.segmentation?.polygons ?? null,
          container.id
        ).filter(p => Array.isArray(p.points) && p.points.length >= 2);
        if (usable.length > 0) {
          seedFrameIndex = f.frameIndex;
          polylines = usable;
          break;
        }
      }
      if (seedFrameIndex == null || polylines.length === 0) continue;

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
        for (const sourceChannel of sourceChannels) {
          jobs.push({
            containerId: container.id,
            videoName: container.name,
            safeVideo,
            polylineId: poly.id,
            frameIndex: seedFrameIndex,
            sourceChannel,
          });
        }
      }
    }

    // --- Phase 2 (profiles mode): one matplotlib intensity-vs-position plot
    // per frame, plus the intensity CSV, for each (microtubule × channel).
    // Capped per MT so a long time-lapse can't emit thousands of PNGs. --------
    if (mode === 'profiles') {
      let profileCount = 0;
      await mapWithConcurrency(jobs, KYMOGRAPH_CONCURRENCY, async job => {
        try {
          const result = await buildKymograph({
            videoContainerId: job.containerId,
            polylineId: job.polylineId,
            frameIndex: job.frameIndex,
            sourceChannel: job.sourceChannel,
            detectVelocity: false,
            renderProfiles: true,
          });

          const stem = `${job.safeVideo}__${job.polylineId}__${job.sourceChannel}`;

          // Intensity matrix CSV (rows = frames, cols = position) — the raw
          // numbers behind the plots. ML returns it on every kymograph build.
          if (result.csvBase64) {
            await fs.writeFile(
              path.join(outDir, `${stem}.csv`),
              Buffer.from(result.csvBase64, 'base64')
            );
          }

          const profiles = result.profiles ?? [];
          const toWrite = Math.min(profiles.length, MAX_PROFILE_FRAMES_PER_MT);
          if (profiles.length > toWrite) {
            logger.warn(
              `${job.videoName}/${job.polylineId}/${job.sourceChannel}: ` +
                `${profiles.length} frame profiles, capping at ${MAX_PROFILE_FRAMES_PER_MT}`,
              CTX
            );
          }
          for (let i = 0; i < toWrite; i++) {
            const p = profiles[i];
            await fs.writeFile(
              path.join(
                outDir,
                `${stem}__f${String(p.frame).padStart(4, '0')}.png`
              ),
              Buffer.from(p.pngBase64, 'base64')
            );
            profileCount++;
          }
        } catch (err) {
          // One bad microtubule/channel must not abort the whole export.
          logger.warn(
            `Profile export failed for ${job.videoName}/${job.polylineId}/${job.sourceChannel}: ${(err as Error).message}`,
            CTX
          );
        }
      });

      logger.info('Microtubule intensity profiles exported', CTX, {
        projectId,
        containers: containers.length,
        jobs: jobs.length,
        profiles: profileCount,
      });
      return;
    }

    // --- Phase 2: build kymographs with bounded concurrency. -------------
    // Velocity rows grouped by source channel — each channel becomes one
    // worksheet (channel = motor/protein) in velocity_metrics.xlsx.
    const rowsByChannel = new Map<string, VelocityRow[]>();

    await mapWithConcurrency(jobs, KYMOGRAPH_CONCURRENCY, async job => {
      try {
        const result = await buildKymograph({
          videoContainerId: job.containerId,
          polylineId: job.polylineId,
          frameIndex: job.frameIndex,
          sourceChannel: job.sourceChannel,
          detectVelocity: true,
          renderOverlay: options.includeSegmentedImages,
        });

        // buildKymograph degrades a velocity-detection crash to empty tracks
        // (it does NOT throw), so the per-job catch below would never see it.
        // Surface it explicitly so a missing/short velocity_metrics.xlsx isn't
        // mistaken for "no motility".
        if (result.velocityError) {
          logger.warn(
            `Velocity detection failed for ${job.videoName}/${job.polylineId}/${job.sourceChannel}: ${result.velocityError}`,
            CTX
          );
        }

        if (options.includeSegmentedImages && result.overlayPngBase64) {
          await fs.writeFile(
            path.join(
              outDir,
              `${job.safeVideo}__${job.polylineId}__${job.sourceChannel}.png`
            ),
            Buffer.from(result.overlayPngBase64, 'base64')
          );
        }

        if (options.includeVelocityMetrics && result.tracks) {
          // One row per trajectory (no per-run breakdown). Build this job's
          // rows locally, then splice in one push so rows stay grouped per
          // microtubule under concurrent job completion.
          const rows: VelocityRow[] = result.tracks.map((tr, ti) => [
            job.videoName,
            job.polylineId,
            ti + 1,
            tr.netVelocityUmPerSec,
            tr.netVelocityPxPerFrame,
            tr.snr,
            tr.totalRunLengthUm,
            tr.totalRunTimeS,
            tr.intensitySignal,
            tr.intensityBackground,
            tr.intensityMinusBackground,
            tr.bright,
            tr.edge,
            result.pixelSizeUm,
            result.frameIntervalMs,
          ]);
          const existing = rowsByChannel.get(job.sourceChannel);
          if (existing) existing.push(...rows);
          else rowsByChannel.set(job.sourceChannel, rows);
        }
      } catch (err) {
        // One bad microtubule/channel must not abort the whole export.
        logger.warn(
          `Kymograph failed for ${job.videoName}/${job.polylineId}/${job.sourceChannel}: ${(err as Error).message}`,
          CTX
        );
      }
    });

    const velocityRowCount = [...rowsByChannel.values()].reduce(
      (n, rows) => n + rows.length,
      0
    );
    if (options.includeVelocityMetrics && velocityRowCount > 0) {
      await writeVelocityWorkbook(
        path.join(outDir, 'velocity_metrics.xlsx'),
        rowsByChannel
      );
    }

    logger.info('Microtubule kymographs exported', CTX, {
      projectId,
      containers: containers.length,
      kymographs: jobs.length,
      velocityRows: velocityRowCount,
      channels: rowsByChannel.size,
    });
  } catch (err) {
    // Orchestration-level failure (DB / mkdir / final write): degrade to "no
    // kymograph output" rather than failing the whole export job.
    logger.error(
      `Microtubule kymograph export failed for project ${projectId}; ` +
        `continuing without kymograph output`,
      err as Error,
      CTX
    );
  }
}
