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
 * SHAPE OF THE WORK. This stage is quadratic in a way that is easy to miss:
 * every one of the (microtubule × channel) kymographs of a container reads the
 * SAME rows and the SAME per-frame images, and differs only in the polyline
 * geometry sampled from them. A real 300-frame, 3-channel container with the
 * 60-microtubule cap fans out into 180 builds over 900 distinct frame images —
 * 54 000 image reads, and (before the grouping below) 180 repeats of the
 * container's polygon JSON: 5.6 GB through Prisma for a 31 MB container,
 * decoded on the single Node event loop, so it stalled the rest of the API
 * too. Measured on that container, replacing the repeats with one load per
 * container took this stage's Node-side wall clock from 84 s to 3.7 s; on a
 * tracked 53 MB container (where the old code re-parsed every frame per job)
 * 147 s to 4.7 s, at 2.9x LOWER peak heap (748 MB -> 254 MB).
 *
 * So the jobs are dispatched grouped by container, and channel-major within
 * it, and each container's rows are read twice in total (once in Phase 1 to
 * find the seed polylines, once in Phase 2 for the builds) rather than once
 * per job. Phase 1 keeps its own read because the whole job list — and with it
 * the progress total — has to be known before the first container's rows are
 * held, and holding every container's rows at once is what the grouping exists
 * to avoid. Ordering is not cosmetic either: consecutive jobs then share their
 * entire decode set, which keeps the page-cache working set to one channel's
 * frames instead of rotating over all of them, and is the precondition for any
 * frame cache in the ML service to score a hit at all (an LRU that rotates
 * over N channels needs N x the frames resident before it hits once).
 *
 * This is an OPTIONAL add-on: any failure (DB, disk, ML) degrades to "no
 * kymograph output" and must never abort the surrounding export job.
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import { prisma } from '../../db/prismaClient';
import { logger } from '../../utils/logger';
import { mapWithConcurrency, runGated, type Semaphore } from '../../utils/concurrency';
import {
  buildKymograph,
  loadKymographContainerContext,
  type KymographContainerContext,
} from '../kymographService';
import { resolveSegmentationSource } from '../video/types';

const CTX = 'MTKymographExporter';

/** Per-container cap so a 200-MT field can't make one export run for hours.
 *  Anything dropped is logged (never silently truncated). */
const MAX_MT_PER_CONTAINER = 60;

/** Parallel kymograph JOB ORCHESTRATION (DB-free local prep + file writes
 *  around each ML call) — NOT the ML request concurrency itself, which is
 *  bounded separately by the shared `mlGate` (see `exportMicrotubuleKymographs`
 *  below) across the whole export, not just this stage. Kept > 1 so local
 *  I/O for one job can overlap the (gated) network call for another. */
const KYMOGRAPH_CONCURRENCY = 3;

/** Per (microtubule × channel) cap on the number of frame profiles written in
 *  ``profiles`` mode. Profiles are intended for small stacks (the single-frame
 *  case forces this mode); a long time-lapse would otherwise emit thousands of
 *  PNGs. Deterministic per job (every MT treated identically); truncation is
 *  logged, never silent. */
const MAX_PROFILE_FRAMES_PER_MT = 300;

/** Sanitise an untrusted path segment (polyline id, channel name) before it goes
 *  into an export filename — strips anything outside ``[A-Za-z0-9_-]`` so a
 *  crafted polyline id (e.g. ``../../evil``) can't inject a path separator or
 *  ``..`` traversal into the write target. ``safeVideo`` is already sanitised at
 *  the call site with the same character class. */
const safeSegment = (s: string): string => s.replace(/[^A-Za-z0-9_-]+/g, '_');

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
  /** Selected frame indices for this container (export image selection), or
   *  undefined when the whole video is in scope. */
  frameFilter?: number[];
}

/** All jobs of one video container, in the order they are dispatched. Grouping
 *  is what lets the per-container database rows be loaded ONCE (see
 *  ``loadKymographContainerContext``) and reused by every job in the group,
 *  while never holding more than one container's rows in memory. */
interface ContainerJobGroup {
  containerId: string;
  videoName: string;
  jobs: KymographJob[];
}

function parsePolylines(
  json: string | null | undefined,
  containerId: string
): PolylineRecord[] {
  if (!json) {
    return [];
  }
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
  if (channels.length === 0) {
    return [];
  }
  const fluorescent = channels
    .filter(c => c.type === 'fluorescent')
    .map(c => c.name);
  if (fluorescent.length > 0) {
    return fluorescent;
  }
  // channels is non-empty here (the caller returns early on an empty list), so
  // the shared resolver cannot come back undefined.
  return [resolveSegmentationSource(channels) as string];
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
    for (const row of rowsByChannel.get(channel) ?? []) {
      sheet.addRow(row);
    }
  }
  await workbook.xlsx.writeFile(filePath);
}

export async function exportMicrotubuleKymographs(
  projectId: string,
  exportDir: string,
  options: MTKymographOptions,
  selectedImageIds?: string[] | null,
  /**
   * Called once per finished (microtubule x channel) job, in completion order.
   * Deliberately NOT part of `MTKymographOptions`: that object is deserialised
   * straight off the wire, and a function has no business round-tripping
   * through JSON. Kept optional so every existing caller and test is unchanged.
   *
   * This is the export's longest stage by far — one real 300-frame project
   * spent ~20 min here — so it is the one place where per-item reporting is
   * worth the plumbing rather than a single bump on completion.
   */
  onProgress?: (done: number, total: number) => void,
  /**
   * Shared semaphore bounding how many ML-bound requests this export job has
   * in flight at once, across ALL of its ML-bound stages (mt-metrics,
   * mt-background-rois, kymograph) — not just this one. Every `buildKymograph`
   * call below (the actual ML request) is routed through it. Omitted in unit
   * tests, which mock `buildKymograph` directly.
   */
  mlGate?: Semaphore
): Promise<void> {
  // Normalise the mode: the controller casts req.body without validation, so an
  // older cached FE bundle (or a direct API caller) may omit it. Default to the
  // prior behaviour (kymograph) rather than trusting the raw wire value.
  const mode: MTKymographMode =
    options.mode === 'profiles' ? 'profiles' : 'kymograph';

  // Honour the export image selection: kymographs/profiles are built only from
  // the selected frames (mirrors the other MT exporters, which already scope via
  // the filtered project.images). null = whole video (no selection). When active
  // it scopes the seed enumeration, the rendered frames AND the ML render cost.
  const hasSelection =
    Array.isArray(selectedImageIds) && selectedImageIds.length > 0;

  // Nothing to produce → skip the (expensive) builds entirely. In kymograph
  // mode, both sub-options off = no output. Profiles mode always writes plots +
  // CSV, so it has no such short-circuit.
  if (!options.enabled) {
    return;
  }
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
    if (containers.length === 0) {
      return;
    }

    const outDir = path.join(
      exportDir,
      mode === 'profiles' ? 'profiles' : 'kymographs'
    );
    await fs.mkdir(outDir, { recursive: true });

    // --- Phase 1: resolve the (microtubule × channel) job list. ----------
    // `jobs` is the flat dispatch order (its length is the progress total and
    // its indices key the velocity rows); `groups` is the same jobs partitioned
    // per container, which is the unit Phase 2 loads database rows for.
    const jobs: KymographJob[] = [];
    const groups: ContainerJobGroup[] = [];
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
        where: {
          parentVideoId: container.id,
          segmentation: { isNot: null },
          // Restrict to the selected frames when the export carried a selection.
          ...(hasSelection ? { id: { in: selectedImageIds! } } : {}),
        },
        orderBy: { frameIndex: 'asc' },
        select: {
          frameIndex: true,
          segmentation: { select: { polygons: true } },
        },
      });

      // Frames to render: the selected (+segmented) frames when a selection is
      // active, else undefined = every frame (buildKymograph's full-video path).
      const frameFilter = hasSelection
        ? segmentedFrames
            .map(f => f.frameIndex)
            .filter((i): i is number => i != null)
        : undefined;
      // A selection that excludes every segmented frame of this container ⇒
      // nothing to export for it.
      if (hasSelection && (!frameFilter || frameFilter.length === 0)) {
        continue;
      }

      let seedFrameIndex: number | null = null;
      let polylines: PolylineRecord[] = [];
      for (const f of segmentedFrames) {
        if (f.frameIndex == null) {
          continue;
        }
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
      if (seedFrameIndex == null || polylines.length === 0) {
        continue;
      }

      const safeVideo = container.name.replace(/[^A-Za-z0-9_-]+/g, '_');
      const selected = polylines.slice(0, MAX_MT_PER_CONTAINER);
      if (polylines.length > selected.length) {
        logger.warn(
          `Container ${container.name}: ${polylines.length} microtubules, ` +
            `capping kymograph export at ${MAX_MT_PER_CONTAINER}`,
          CTX
        );
      }

      // CHANNEL-major, not microtubule-major (see the header note). It does NOT
      // change the output: files are named per (video, polyline, channel) and
      // the velocity sheets are assembled by job index below, so within each
      // channel the rows stay in polyline order either way.
      const containerJobs: KymographJob[] = [];
      for (const sourceChannel of sourceChannels) {
        for (const poly of selected) {
          containerJobs.push({
            containerId: container.id,
            videoName: container.name,
            safeVideo,
            polylineId: poly.id,
            frameIndex: seedFrameIndex,
            sourceChannel,
            frameFilter,
          });
        }
      }
      jobs.push(...containerJobs);
      groups.push({
        containerId: container.id,
        videoName: container.name,
        jobs: containerJobs,
      });
    }

    let jobsDone = 0;
    const reportDone = (): void => {
      jobsDone++;
      onProgress?.(jobsDone, jobs.length);
    };

    /**
     * Run `runJob` over every job, one container group at a time, with that
     * container's database rows loaded ONCE and handed to each of its jobs.
     *
     * Groups are processed one after another rather than interleaved so at most
     * one container's rows (tens of MB of polygon JSON) are resident. Nothing
     * is lost by not overlapping them: the shared `mlGate` serialises the ML
     * requests anyway.
     *
     * A container whose rows fail to load is skipped with a warning and its
     * jobs still count as done — same treatment as an individual job failure,
     * so the progress bar still reaches 100 % and the export still completes.
     *
     * `runJob` catches its own errors, so `mapWithConcurrency` (which
     * short-circuits the remaining work on the first throw) should never see
     * one. The belt-and-braces catch below keeps an unexpected escape — a
     * throwing `onProgress`, say — contained to the one container group,
     * instead of abandoning every later container AND the velocity workbook.
     */
    const forEachJobWithContext = async (
      runJob: (
        job: KymographJob,
        context: KymographContainerContext,
        jobIndex: number
      ) => Promise<void>
    ): Promise<void> => {
      let base = 0;
      for (const group of groups) {
        const groupBase = base;
        base += group.jobs.length;

        let context: KymographContainerContext | null = null;
        try {
          context = await loadKymographContainerContext(group.containerId);
        } catch (err) {
          logger.warn(
            `Kymograph export skipped ${group.jobs.length} job(s) for ` +
              `${group.videoName}: ${(err as Error).message}`,
            CTX
          );
        }
        if (!context) {
          for (let i = 0; i < group.jobs.length; i++) {
            reportDone();
          }
          continue;
        }

        const loaded = context;
        try {
          await mapWithConcurrency(
            group.jobs,
            KYMOGRAPH_CONCURRENCY,
            (job, i) => runJob(job, loaded, groupBase + i)
          );
        } catch (err) {
          logger.warn(
            `Kymograph export aborted for ${group.videoName}: ` +
              `${(err as Error).message}`,
            CTX
          );
        }
      }
    };

    // --- Phase 2 (profiles mode): one matplotlib intensity-vs-position plot
    // per frame, plus the intensity CSV, for each (microtubule × channel).
    // Capped per MT so a long time-lapse can't emit thousands of PNGs. --------
    if (mode === 'profiles') {
      let profileCount = 0;
      await forEachJobWithContext(async (job, containerContext) => {
        try {
          const result = await runGated(mlGate, () =>
            buildKymograph({
              videoContainerId: job.containerId,
              polylineId: job.polylineId,
              frameIndex: job.frameIndex,
              sourceChannel: job.sourceChannel,
              detectVelocity: false,
              renderProfiles: true,
              frameFilter: job.frameFilter,
              containerContext,
            })
          );

          const stem = `${job.safeVideo}__${safeSegment(job.polylineId)}__${safeSegment(job.sourceChannel)}`;

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
        } finally {
          // `finally`, not the end of `try`: a microtubule whose profile export
          // failed is still one job the user is no longer waiting on. Counting
          // only successes would stall the bar short of 100% on any failure.
          reportDone();
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
    // Velocity rows, one slot per job, filled in place. Assembling the
    // worksheets from these slots in JOB order (below) rather than in
    // completion order makes the sheet contents independent of which worker
    // finished first — the same rows, in the same order, on every run.
    // `undefined` = the job failed or returned no `tracks` array at all; an
    // EMPTY array = the job ran and detected nothing, which still gives the
    // channel a (header-only) worksheet.
    const rowSlots: Array<VelocityRow[] | undefined> = new Array(jobs.length);

    await forEachJobWithContext(async (job, containerContext, jobIndex) => {
      try {
        const result = await runGated(mlGate, () =>
          buildKymograph({
            videoContainerId: job.containerId,
            polylineId: job.polylineId,
            frameIndex: job.frameIndex,
            sourceChannel: job.sourceChannel,
            detectVelocity: true,
            renderOverlay: options.includeSegmentedImages,
            frameFilter: job.frameFilter,
            containerContext,
          })
        );

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
              `${job.safeVideo}__${safeSegment(job.polylineId)}__${safeSegment(job.sourceChannel)}.png`
            ),
            Buffer.from(result.overlayPngBase64, 'base64')
          );
        }

        if (options.includeVelocityMetrics && result.tracks) {
          // One row per trajectory (no per-run breakdown), parked in this job's
          // slot so the worksheet order follows the job list, not the order the
          // concurrent workers happened to finish in.
          rowSlots[jobIndex] = result.tracks.map((tr, ti) => [
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
        }
      } catch (err) {
        // One bad microtubule/channel must not abort the whole export.
        logger.warn(
          `Kymograph failed for ${job.videoName}/${job.polylineId}/${job.sourceChannel}: ${(err as Error).message}`,
          CTX
        );
      } finally {
        reportDone();
      }
    });

    // Group the per-job rows by source channel — each channel becomes one
    // worksheet (channel = motor/protein) in velocity_metrics.xlsx. Walking the
    // slots in job order keeps every sheet in polyline order; a channel whose
    // jobs all detected nothing still gets its (header-only) sheet, because an
    // empty-but-present slot creates the entry.
    const rowsByChannel = new Map<string, VelocityRow[]>();
    for (let i = 0; i < jobs.length; i++) {
      const rows = rowSlots[i];
      if (!rows) {
        continue;
      }
      const existing = rowsByChannel.get(jobs[i].sourceChannel);
      if (existing) {
        existing.push(...rows);
      } else {
        rowsByChannel.set(jobs[i].sourceChannel, [...rows]);
      }
    }

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
