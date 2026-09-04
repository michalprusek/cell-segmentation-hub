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
 *     per detected trajectory, plus a ``<channel> segments`` sheet with one row
 *     per motion/pause phase of each trajectory (when
 *     ``includeVelocityMetrics``).
 *
 * Reuses the same ``kymographService`` sampling, detection and calibration path
 * as the editor modal — no drift between what the user sees and what ships in
 * the bundle.
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
 * to avoid.
 *
 * That fixed the Node half. The 54 000 image reads were still there, because
 * one ML request per job means one full decode of the container per job — and
 * the ML service's row cache cannot help, since every job has a different
 * polyline and so a different key (a real production export, 2026-09-01:
 * 61 requests, 0 frames from cache, 69 decoded). The jobs of ONE CHANNEL now go
 * to ``/kymograph/batch`` in a single request instead, which decodes each frame
 * once and samples every polyline from it. Same bodies, same output, 900 decodes
 * where there were 54 000. Batches never span channels: two channels share no
 * frame images, so a chunk straddling the boundary would decode one channel's
 * frames twice — which is also why the channel-major ordering is load-bearing
 * rather than cosmetic.
 *
 * This is an OPTIONAL add-on: any failure (DB, disk, ML) degrades to "no
 * kymograph output" and must never abort the surrounding export job.
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import { prisma } from '../../db/prismaClient';
import { logger } from '../../utils/logger';
import { runGated, type Semaphore } from '../../utils/concurrency';
import {
  buildKymographBatch,
  loadKymographContainerContext,
  type KymographBatchOutcome,
  type KymographContainerContext,
  type KymographLineReduce,
  type KymographServiceInput,
} from '../kymographService';
import { resolveSegmentationSource } from '../video/types';

const CTX = 'MTKymographExporter';

/** Per-container cap so a 200-MT field can't make one export run for hours.
 *  Anything dropped is logged (never silently truncated). */
const MAX_MT_PER_CONTAINER = 60;

/** How many (microtubule × channel) kymographs this file hands to ONE
 *  `buildKymographBatch` call.
 *
 *  The batch is what makes the ML service decode each frame once for all of
 *  them instead of once per job, so the useful value is "the whole channel in
 *  one request" — hence the per-container microtubule cap. Batches never span
 *  channels: two channels share no frame images, so a chunk that straddled the
 *  boundary would decode one channel's frames in two requests.
 *
 *  This is an ITEM count and no longer bounds the response, because a kymograph
 *  is now as wide as its microtubule is long (up to 2077 columns) rather than a
 *  fixed 200. The response bound lives in `kymographService`, which is the layer
 *  that knows each item's column count: it splits what it is given into as many
 *  ML requests as `ML_BATCH_MAX_OUTPUT_PIXELS` allows. So this number is a
 *  ceiling on how much the service gets to pack, not on what it sends.
 *
 *  Measured 2026-09-01 on container 4972cad8 (300 frames, 60 microtubules, one
 *  channel, velocity detection + overlay): 60 separate requests took 186.2 s
 *  and decoded 18 000 frames; one batch of 60 took 13.2 s and decoded 300. The
 *  request is the same 29.2 MB either way (it is the same bodies). */
const KYMOGRAPH_BATCH_MAX_ITEMS = MAX_MT_PER_CONTAINER;

/** profiles mode only: also bound how many matplotlib PNGs one response
 *  carries, because there the response is O(items × frames) rather than
 *  O(items). A profile PNG measured 39 KB (52 KB base64) on real frames, so
 *  300 of them is ~15.6 MB — the same envelope as a full 60-item kymograph
 *  batch. The consequence is deliberate: a short stack (the case profiles mode
 *  exists for — a single-frame project forces it) batches all 60 microtubules
 *  and gets the full win, while a 300-frame profiles export falls back to one
 *  item per request and gains nothing. Its response IS its product; there is
 *  no version of it that both batches and stays small.
 *
 *  A profile PNG is a fixed-size matplotlib figure and does NOT grow with the
 *  uncapped column axis; the intensity CSV this mode also carries does, and
 *  that is covered by the service's output-pixel budget. */
const PROFILE_BATCH_MAX_IMAGES = 300;

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
  /** Width (image px) of the line sampled along each microtubule, measured
   *  PERPENDICULAR to it, with the samples across it reduced by `lineReduce`.
   *
   *  Optional, and absent means 1 — a single-pixel line profile, which is what
   *  this exporter has always asked for. Absent is not the same as `1` only in
   *  that it is what an older frontend bundle (or any API caller that predates
   *  this field) sends; both render the identical kymograph, because
   *  `kymographService` omits the ML field at the default either way.
   *
   *  Deliberately NOT coupled to the editor modal's line-width control: the two
   *  are separate surfaces with separate persistence, exactly like `mode` and
   *  `includeVelocityMetrics`. Range (1…51) is validated at the route and
   *  clamped again in `kymographService`.
   *
   *  It applies to BOTH modes. The ML service renders the profile plots of
   *  `profiles` mode from the same sampled matrix the kymograph is a heatmap of
   *  (`_render_profiles(kymo, …)` in `api/tracker_kymograph.py`), so a profile
   *  is one row of the very picture this widens. */
  lineWidth?: number;
  /** How the `lineWidth` samples of one column collapse to one value: `mean`
   *  (default, ImageJ's convention) or `max` (KymoResliceWide's). Ignored at
   *  width 1, where there is a single sample. */
  lineReduce?: KymographLineReduce;
  /** Absolute intensity floor for detected trajectories, in RAW SAMPLE UNITS
   *  (counts above each trajectory's own local background). Trajectories below
   *  it are dropped before the overlay is rendered, so the segmented-kymograph
   *  images, the velocity workbook and the modal all show one set.
   *
   *  Absent / 0 = off, which is what every export did before this field, and
   *  the ML request then omits the field entirely.
   *
   *  Per CHANNEL by nature: on one production container 488 nm trajectories
   *  measured 9-51 counts above background where 640 nm measured 93-228, so a number
   *  chosen while looking at one channel does not transfer to another. */
  minIntensityMinusBg?: number;
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
 *  while never holding more than one container's rows in memory.
 *
 *  ``channelRuns`` is the same jobs split per source channel — the unit a
 *  batched ML request is carved out of, because only jobs of one channel share
 *  their frame images. */
interface ContainerJobGroup {
  containerId: string;
  videoName: string;
  jobCount: number;
  channelRuns: KymographJob[][];
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

/** One segment row, in the column order of ``SEGMENT_HEADER``. */
type SegmentRow = Array<string | number | boolean | null>;

/** Per-phase columns. The identity trio (video, microtubule, track) is the same
 *  as the trajectory sheet's, so a segment can always be traced back to the
 *  trajectory it was cut from, and `segment` numbers the phases within that
 *  trajectory in time order. The statistics are the trajectory ones measured
 *  over the phase: `kind` says whether the particle was running or paused,
 *  `velocity_*` is the fitted slope over the phase, `run_length_um` its
 *  distance and `run_time_s` its duration. */
const SEGMENT_HEADER = [
  'video',
  'microtubule',
  'track',
  'segment',
  'kind',
  'direction',
  'start_frame',
  'end_frame',
  'run_time_s',
  'run_length_um',
  'velocity_um_s',
  'velocity_px_frame',
  'intensity_signal',
  'intensity_background',
  'intensity_minus_background',
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
  rowsByChannel: Map<string, VelocityRow[]>,
  segmentsByChannel?: Map<string, SegmentRow[]>
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
  // The per-phase breakdown goes in its own sheets rather than replacing the
  // trajectory ones: a trajectory row is still the unit for "how fast does this
  // motor go overall", and anything already reading this workbook keeps
  // working. `safeSheetName` gets the suffix folded in so a long channel name
  // cannot collide with its own trajectory sheet after truncation.
  for (const channel of [...(segmentsByChannel?.keys() ?? [])].sort()) {
    const sheet = workbook.addWorksheet(
      safeSheetName(`${channel} segments`, used)
    );
    sheet.addRow(SEGMENT_HEADER);
    for (const row of segmentsByChannel?.get(channel) ?? []) {
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
   * worth the plumbing rather than a single bump on completion. Since the jobs
   * of one channel travel in one batched request, a whole batch's items are
   * reported together when it returns.
   */
  onProgress?: (done: number, total: number) => void,
  /**
   * Shared semaphore bounding how many ML-bound requests this export job has
   * in flight at once, across ALL of its ML-bound stages (mt-metrics,
   * mt-background-rois, kymograph) — not just this one. Every
   * `buildKymographBatch` call below (the actual ML request) is routed through
   * it. Omitted in unit tests, which mock `buildKymographBatch` directly.
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
      const channelRuns: KymographJob[][] = [];
      for (const sourceChannel of sourceChannels) {
        const run = selected.map(poly => ({
          containerId: container.id,
          videoName: container.name,
          safeVideo,
          polylineId: poly.id,
          frameIndex: seedFrameIndex,
          sourceChannel,
          frameFilter,
        }));
        channelRuns.push(run);
        jobs.push(...run);
      }
      groups.push({
        containerId: container.id,
        videoName: container.name,
        jobCount: channelRuns.reduce((n, run) => n + run.length, 0),
        channelRuns,
      });
    }

    let jobsDone = 0;
    const reportDone = (): void => {
      jobsDone++;
      onProgress?.(jobsDone, jobs.length);
    };

    /**
     * Run every job, one container group at a time, with that container's
     * database rows loaded ONCE and its jobs dispatched to the ML service in
     * per-channel BATCHES rather than one request each.
     *
     * `toInput` turns a job into the service input (the two modes differ only
     * there); `onOutcome` handles one finished job — success or failure — and
     * is called in job order, so the velocity worksheets stay independent of
     * which request finished first.
     *
     * Groups are processed one after another rather than interleaved so at most
     * one container's rows (tens of MB of polygon JSON) are resident. Nothing
     * is lost by not overlapping them: the shared `mlGate` serialises the ML
     * requests anyway.
     *
     * A container whose rows fail to load is skipped with a warning and its
     * jobs still count as done — same treatment as an individual job failure,
     * so the progress bar still reaches 100 % and the export still completes.
     * So is a batch that fails outright: every job in it is reported as failed
     * and the export carries on with the next batch, exactly as one failed
     * request used to cost exactly one microtubule. `buildKymographBatch`
     * reports an ML failure (a network drop, or an ml container old enough not
     * to have `/kymograph/batch`) per item rather than throwing, so it can keep
     * the results of any request that already succeeded; the catch here is the
     * guard against anything that escapes it anyway.
     *
     * Progress is still counted per microtubule, but a whole batch's jobs are
     * reported together when it returns, so the bar advances once per
     * (container × channel) instead of once per microtubule. That is a coarser
     * bar over a much shorter stage: the same 60-microtubule channel that took
     * 186 s in 60 steps now takes 13 s in one.
     */
    const forEachJobOutcome = async (
      toInput: (
        job: KymographJob,
        context: KymographContainerContext
      ) => KymographServiceInput,
      /** Items per ML request, given how many frames each item renders. */
      batchLimit: (framesPerJob: number) => number,
      onOutcome: (
        job: KymographJob,
        jobIndex: number,
        outcome: KymographBatchOutcome
      ) => Promise<void>
    ): Promise<void> => {
      let base = 0;
      for (const group of groups) {
        const groupBase = base;
        base += group.jobCount;

        let context: KymographContainerContext | null = null;
        try {
          context = await loadKymographContainerContext(group.containerId);
        } catch (err) {
          logger.warn(
            `Kymograph export skipped ${group.jobCount} job(s) for ` +
              `${group.videoName}: ${(err as Error).message}`,
            CTX
          );
        }
        if (!context) {
          for (let i = 0; i < group.jobCount; i++) {
            reportDone();
          }
          continue;
        }

        const loaded = context;
        // Every job of a container renders the same frames (the export image
        // selection, or the whole video), so one number covers the group.
        const framesPerJob =
          group.channelRuns[0]?.[0]?.frameFilter?.length ?? loaded.frames.length;
        const limit = Math.max(1, batchLimit(framesPerJob));
        let runBase = groupBase;
        for (const run of group.channelRuns) {
          for (let start = 0; start < run.length; start += limit) {
            const chunk = run.slice(start, start + limit);
            let outcomes: KymographBatchOutcome[];
            try {
              outcomes = await runGated(mlGate, () =>
                buildKymographBatch(chunk.map(job => toInput(job, loaded)))
              );
            } catch (err) {
              logger.warn(
                `Kymograph batch failed for ${group.videoName}/` +
                  `${chunk[0].sourceChannel} (${chunk.length} microtubule(s)): ` +
                  `${(err as Error).message}`,
                CTX
              );
              const error = err as Error;
              outcomes = chunk.map(() => ({ error }));
            }
            for (let i = 0; i < chunk.length; i++) {
              try {
                await onOutcome(chunk[i], runBase + start + i, outcomes[i]);
              } catch (err) {
                // `onOutcome` catches its own errors; this keeps an unexpected
                // escape — a throwing `onProgress`, a disk write failure —
                // contained to one microtubule instead of abandoning every
                // later container AND the velocity workbook.
                logger.warn(
                  `Kymograph export failed for ${chunk[i].videoName}/` +
                    `${chunk[i].polylineId}/${chunk[i].sourceChannel}: ` +
                    `${(err as Error).message}`,
                  CTX
                );
              } finally {
                // `finally`, not the end of `try`: a microtubule whose export
                // failed is still one job the user is no longer waiting on.
                // Counting only successes would stall the bar short of 100 %.
                reportDone();
              }
            }
          }
          runBase += run.length;
        }
      }
    };

    // --- Phase 2 (profiles mode): one matplotlib intensity-vs-position plot
    // per frame, plus the intensity CSV, for each (microtubule × channel).
    // Capped per MT so a long time-lapse can't emit thousands of PNGs. --------
    if (mode === 'profiles') {
      let profileCount = 0;
      await forEachJobOutcome(
        (job, containerContext) => ({
          videoContainerId: job.containerId,
          polylineId: job.polylineId,
          frameIndex: job.frameIndex,
          sourceChannel: job.sourceChannel,
          detectVelocity: false,
          renderProfiles: true,
          frameFilter: job.frameFilter,
          containerContext,
          // A profile IS a row of the kymograph this widens (the ML service
          // renders both from the same sampled matrix), so the band applies
          // here too. Undefined at the default, which posts the body this
          // exporter posted before the option existed.
          lineWidth: options.lineWidth,
          lineReduce: options.lineReduce,
          // NOT the intensity floor: this branch sets `detectVelocity: false`,
          // so there are no trajectories to filter and the ML service ignores
          // the field — while sending it still changes the request body and
          // the cache key, and 422s an un-recreated ml container. The line
          // width above DOES belong here (a profile is one row of the
          // kymograph it widens); that reasoning does not carry over.
        }),
        // One matplotlib PNG per rendered frame per item, so the batch is
        // bounded by images rather than by items. See PROFILE_BATCH_MAX_IMAGES.
        framesPerJob =>
          Math.min(
            KYMOGRAPH_BATCH_MAX_ITEMS,
            Math.floor(PROFILE_BATCH_MAX_IMAGES / Math.max(1, framesPerJob))
          ),
        async (job, _jobIndex, outcome) => {
          try {
            if (!outcome.result) {
              throw (
                outcome.error ?? new Error('ML kymograph batch returned no item')
              );
            }
            const result = outcome.result;

            const stem = `${job.safeVideo}__${safeSegment(job.polylineId)}__${safeSegment(job.sourceChannel)}`;

            // Intensity matrix CSV (rows = frames, cols = position) — the raw
            // numbers behind the plots. ML returns it on every kymograph build
            // unless the caller opts out, which this mode does not.
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
        }
      );

      logger.info('Microtubule intensity profiles exported', CTX, {
        projectId,
        containers: containers.length,
        jobs: jobs.length,
        profiles: profileCount,
      });
      return;
    }

    // --- Phase 2: build kymographs, one batched ML request per channel. ---
    // Velocity rows, one slot per job, filled in place. Assembling the
    // worksheets from these slots in JOB order (below) rather than in
    // completion order makes the sheet contents independent of which request
    // finished first — the same rows, in the same order, on every run.
    // `undefined` = the job failed or returned no `tracks` array at all; an
    // EMPTY array = the job ran and detected nothing, which still gives the
    // channel a (header-only) worksheet.
    const rowSlots: Array<VelocityRow[] | undefined> = new Array(jobs.length);
    const segmentSlots: Array<SegmentRow[] | undefined> = new Array(jobs.length);

    // Files actually written, as distinct from jobs dispatched. The two differ
    // whenever `includeSegmentedImages` is off: every kymograph is still
    // rendered by the ML service (the velocity metrics are derived from it),
    // and then discarded. Logging only `jobs.length` under the word "exported"
    // made an export that wrote nothing look like one that wrote 63 — a false
    // alarm that cost a real half hour on 2026-09-01.
    let imageCount = 0;

    await forEachJobOutcome(
      (job, containerContext) => ({
        videoContainerId: job.containerId,
        polylineId: job.polylineId,
        frameIndex: job.frameIndex,
        sourceChannel: job.sourceChannel,
        detectVelocity: true,
        renderOverlay: options.includeSegmentedImages,
        frameFilter: job.frameFilter,
        containerContext,
        // Undefined at the default, so an export that does not ask for a band
        // posts the body it posted before this option existed.
        lineWidth: options.lineWidth,
        lineReduce: options.lineReduce,
        minIntensityMinusBg: options.minIntensityMinusBg,
        // This mode writes the overlay PNG and the velocity workbook and never
        // reads the intensity matrix, so asking for it would be 483 KB of
        // base64 per microtubule built, shipped and thrown away.
        includeCsv: false,
      }),
      () => KYMOGRAPH_BATCH_MAX_ITEMS,
      async (job, jobIndex, outcome) => {
        try {
          if (!outcome.result) {
            throw (
              outcome.error ?? new Error('ML kymograph batch returned no item')
            );
          }
          const result = outcome.result;

          // A velocity-detection crash degrades to empty tracks in the ML
          // service (it does NOT fail the item), so the catch below would never
          // see it. Surface it explicitly so a missing/short
          // velocity_metrics.xlsx isn't mistaken for "no motility".
          if (result.velocityError) {
            logger.warn(
              `Velocity detection failed for ${job.videoName}/${job.polylineId}/${job.sourceChannel}: ${result.velocityError}`,
              CTX
            );
          }

          if (options.includeSegmentedImages && result.overlayPngBase64) {
            imageCount++;
            await fs.writeFile(
              path.join(
                outDir,
                `${job.safeVideo}__${safeSegment(job.polylineId)}__${safeSegment(job.sourceChannel)}.png`
              ),
              Buffer.from(result.overlayPngBase64, 'base64')
            );
          }

          if (options.includeVelocityMetrics && result.tracks) {
            // One row per trajectory (no per-run breakdown), parked in this
            // job's slot so the worksheet order follows the job list.
            // One row per motion/pause phase, carrying the same identity trio
            // so a segment can be traced back to its trajectory.
            segmentSlots[jobIndex] = result.tracks.flatMap((tr, ti) =>
              (tr.phases ?? []).map((ph, pi) => [
                job.videoName,
                job.polylineId,
                ti + 1,
                pi + 1,
                ph.kind,
                ph.direction,
                ph.startFrame,
                ph.endFrame,
                ph.durationS,
                ph.displacementUm,
                ph.velocityUmPerSec,
                ph.velocityPxPerFrame,
                ph.intensitySignal,
                ph.intensityBackground,
                ph.intensityMinusBackground,
                result.pixelSizeUm,
                result.frameIntervalMs,
              ])
            );
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
        }
      }
    );

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

    const segmentsByChannel = new Map<string, SegmentRow[]>();
    for (let i = 0; i < jobs.length; i++) {
      const rows = segmentSlots[i];
      if (!rows || rows.length === 0) {
        continue;
      }
      const existing = segmentsByChannel.get(jobs[i].sourceChannel);
      if (existing) {
        existing.push(...rows);
      } else {
        segmentsByChannel.set(jobs[i].sourceChannel, [...rows]);
      }
    }

    const velocityRowCount = [...rowsByChannel.values()].reduce(
      (n, rows) => n + rows.length,
      0
    );
    const wroteWorkbook =
      options.includeVelocityMetrics && velocityRowCount > 0;
    if (wroteWorkbook) {
      await writeVelocityWorkbook(
        path.join(outDir, 'velocity_metrics.xlsx'),
        rowsByChannel,
        segmentsByChannel
      );
    }

    // `rendered` is what the ML service built; `images`/`workbook` are what
    // reached the archive. Kept separate because they legitimately differ, and
    // conflating them is actively misleading: with `includeSegmentedImages`
    // off and no motility detected, this stage renders every kymograph and
    // writes nothing at all.
    const wroteNothing = imageCount === 0 && !wroteWorkbook;
    const payload = {
      projectId,
      containers: containers.length,
      rendered: jobs.length,
      images: imageCount,
      workbook: wroteWorkbook,
      velocityRows: velocityRowCount,
      channels: rowsByChannel.size,
    };
    if (wroteNothing && jobs.length > 0) {
      logger.warn(
        `Microtubule kymographs: rendered ${jobs.length} but wrote no file. ` +
          `includeSegmentedImages=${!!options.includeSegmentedImages}, ` +
          `includeVelocityMetrics=${!!options.includeVelocityMetrics}, ` +
          `velocityRows=${velocityRowCount}.`,
        CTX,
        payload
      );
    } else {
      logger.info('Microtubule kymographs exported', CTX, payload);
    }
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
