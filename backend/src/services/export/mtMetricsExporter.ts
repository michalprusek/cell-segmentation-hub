/**
 * Microtubule per-channel intensity metrics exporter.
 *
 * For an MT project export, this module:
 *  1. Groups the project's frame Image rows by their parent video container.
 *  2. Resolves each container's original ND2 / TIFF on disk + its
 *     ``channels`` JSON.
 *  3. Maps the user-selected channel names to channel indices in the
 *     original file (positional, matching the extractor's convention).
 *  4. POSTs a per-video request to the ML service's ``/api/v1/mt-metrics``
 *     endpoint, which re-reads the raw 16-bit signal and returns a
 *     long-format list of per-(frame, polyline, channel) rows.
 *  5. Appends Node-side derived columns (``length_um`` / ``area_um2``
 *     using ``pixelToMicrometerScale`` from the export modal) and
 *     returns the unified row list.
 *
 * The ML side intentionally does not handle unit conversion so the
 * user's pixel-scale entry on the modal remains the sole source of
 * truth — preventing drift between metric formats.
 *
 * On write, the same rows are ALSO emitted pivoted (`metrics_wide.*` /
 * a second XLSX sheet): one row per (frame, microtubule) with one column set
 * per channel, so e.g. IRM and TIRF intensities of the same MT sit side by
 * side. See {@link pivotMTMetricsWide}. The long format is unchanged — it
 * stays the canonical `metrics.*`.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import axios from 'axios';
import { prisma } from '../../db/prismaClient';
import { getLabels as getMtTypeLabels } from '../mtTypeLabelService';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import { isSafeChannelName } from '../video/types';
import {
  buildInstanceLabelMap,
  MICROTUBULE_LABEL_PREFIX,
} from '../../utils/instanceLabels';
import { Semaphore, runGated } from '../../utils/concurrency';
import {
  estimateMlRequestTimeoutMs,
  megapixelsFromFrames,
} from './mlRequestBudget';

// ----------------------------------------------------------------------------
//  Types (mirror the Python Pydantic models — keep in sync if either changes)
// ----------------------------------------------------------------------------

export interface MTMetricsOptions {
  thicknessPx: number;
  marginMultiplier: number;
  /** Channel display names to sample. Empty => ALL channels of each container
   *  (per-channel intensity is always exported for MT projects). */
  channels: string[];
  /** From `ExportOptions.pixelToMicrometerScale`. ``null`` => no µm cols. */
  pixelToMicrometerScale: number | null;
}

/**
 * One emitted row. Long format keyed by (frame, polyline, channel) so
 * downstream pandas/Excel users can pivot freely.
 */
export interface MTMetricsRow {
  frameIndex: number;
  /** Human-readable image (frame) name — the frame's `Image.name`, not its DB
   *  UUID. Combined with `frameIndex` it identifies the source frame. */
  imageName: string;
  /** Per-frame instance badge drawn on the visualization image ("MT1",
   *  "MT2", …), matching {@link buildInstanceLabelMap}. Empty string when the
   *  polyline has no `instanceId` (no badge is drawn for it either). */
  label: string;
  /** User-assigned tubulin type class (the label NAME resolved from the
   *  project's mtTypeLabels palette). Empty string when the polyline is
   *  untyped or its label id is unknown. */
  mtType: string;
  instanceId: string;
  trackId: string | null;
  /** Channel machine name, or '' for geometry-only rows (no channel picked). */
  channel: string;
  /**
   * The frame this row's channel intensity was actually MEASURED on.
   *
   * Equal to `frameIndex` for every ordinary row. It differs only on a gap
   * frame of a SPARSE channel — one the microscope refreshed every N-th
   * timepoint (`ChannelMeta.sparseSource`) — where the acquisition wrote a
   * constant fill and the measurement repeats another frame's exposure instead
   * of being an independent observation. Without this column such a run of
   * frames reads as a genuine flat stretch of a time series.
   *
   * Usually the PREVIOUS real frame, so `channelFrameSource < frameIndex`. Not
   * always: gaps before the first exposure read FORWARD from it
   * (`plan_sparse_channels`, "head gaps"), so on a video whose IRM starts at
   * frame 4 the first four rows carry `channelFrameSource === 4`. Compare the
   * two columns for equality; do not assume an ordering between them.
   *
   * `null` on geometry-only rows: nothing was measured, so no frame was read.
   */
  channelFrameSource: number | null;
  lengthPx: number;
  lengthUm: number | null;
  // Intensity-dependent columns are null on geometry-only rows (no channel
  // selected): the band area + per-channel signal stats need the raw raster,
  // which is only read when a channel is actually sampled.
  areaPx: number | null;
  areaUm2: number | null;
  pixelCount: number | null;
  sumIntensity: number | null;
  meanIntensity: number | null;
  medianIntensity: number | null;
  stdIntensity: number | null;
  medianBackground: number | null;
  meanBackground: number | null;
  signalMinusBackground: number | null;
}

/**
 * One row of the whole-video, whole-image per-channel total (the "channel
 * totals" summary sheet). Distinct from the per-MT band sums: this is the sum
 * of EVERY pixel of the channel across all frames of the video, independent of
 * the microtubules — a global "how bright is this channel overall" measure.
 */
export interface MTChannelSummaryRow {
  /** Source video container's file name (or id fallback) for readability. */
  video: string;
  channel: string;
  totalIntensity: number;
  meanIntensity: number;
  pixelCount: number;
  frames: number;
}

/**
 * The columns that genuinely differ between channels — everything the raw
 * raster feeds, plus the frame that raster was read from. In the wide output
 * each of these becomes one column PER channel, named ``<channel>_<measure>``.
 *
 * Deliberately excludes ``lengthPx`` / ``areaPx`` / ``pixelCount``: the ML side
 * builds the band + vicinity masks ONCE per frame and reuses them for every
 * channel (`mt_metrics.py` → `mt_measure.frame_geometry`), so those are
 * channel-independent and appear once in {@link WIDE_SHARED_HEADERS}.
 *
 * ``channelFrameSource`` belongs here rather than in the shared headers for the
 * same reason in reverse: sparseness is a property of ONE channel. On a video
 * whose IRM refreshes every third frame, the IRM columns of the frames in
 * between are a repeat while the fluorescent columns beside them are genuine —
 * a single per-row flag could not say that.
 */
export const WIDE_CHANNEL_MEASURES = [
  'sumIntensity',
  'meanIntensity',
  'medianIntensity',
  'stdIntensity',
  'medianBackground',
  'meanBackground',
  'signalMinusBackground',
  'channelFrameSource',
] as const;

export type MTChannelMeasure = (typeof WIDE_CHANNEL_MEASURES)[number];

/** Identity + geometry columns of the wide output — emitted once per row. */
export const WIDE_SHARED_HEADERS = [
  'frameIndex',
  'imageName',
  'label',
  'mtType',
  'instanceId',
  'trackId',
  'lengthPx',
  'lengthUm',
  'areaPx',
  'areaUm2',
  'pixelCount',
] as const;

/**
 * One row of the WIDE (pivoted) output: one row per (frame, microtubule), with
 * every channel's measures side by side instead of on separate rows.
 *
 * The long format (one row per (frame, polyline, channel), see
 * {@link MTMetricsRow}) stays the primary `metrics.*` file — existing pipelines
 * depend on it. This is an additional `metrics_wide.*` view for people who want
 * to compare channels on one line (e.g. IRM vs TIRF for the same MT).
 */
export interface MTMetricsWideRow {
  frameIndex: number;
  imageName: string;
  label: string;
  mtType: string;
  instanceId: string;
  trackId: string | null;
  lengthPx: number;
  lengthUm: number | null;
  areaPx: number | null;
  areaUm2: number | null;
  pixelCount: number | null;
  /**
   * Channel machine name → its per-channel measures. A channel MISSING from
   * this map produced no measurement for this microtubule (e.g. a PNG-backed
   * channel whose frame PNG is absent), and its columns are written blank.
   */
  channels: Record<string, Record<MTChannelMeasure, number | null>>;
}

interface VideoChannelMeta {
  name: string;
  displayName?: string;
  /** True for channels ADDED after upload (see addChannelService). Their
   *  pixels live only in the per-frame PNGs, not the original volume, so they
   *  are sampled via ``png_channels`` rather than a C-axis index. */
  pngBacked?: boolean;
  /** True when the microscope only refreshed this channel every N-th frame
   *  (see `ChannelMeta.sparseSource`). The un-acquired planes are still in the
   *  original file as a constant fill, so the ML side must be told to read the
   *  anchor's plane instead of measuring that fill as signal. */
  sparseSource?: boolean;
  /** Gap frameIndex (stringified) -> the frameIndex whose plane stands in for
   *  it. See `ChannelMeta.sparseFill`. */
  sparseFill?: Record<string, number>;
}

interface PolylinePayload {
  image_id: string;
  instance_id: string;
  track_id: string | null;
  points: Array<[number, number]>;
}

interface FramePayload {
  image_id: string;
  frame_index: number;
  polylines: PolylinePayload[];
}

interface MLMTMetricsRequest {
  original_path: string;
  file_kind: 'nd2' | 'tiff';
  channel_indices: number[];
  channel_names: string[];
  frames: FramePayload[];
  thickness_px: number;
  margin_multiplier: number;
  /** Per-frame per-channel translation applied at extraction (channel
   *  registration). Keyed by frame index; each value is `[dy, dx]` per C-axis
   *  channel index. Omitted for unregistered uploads. */
  channel_offsets?: Record<string, number[][]>;
  /** Machine names of PNG-backed channels (added post-upload). The ML side
   *  samples these from ``dirname(original_path)/frames/<t>/<name>.png`` rather
   *  than the original volume, skipping any frame whose PNG is absent (an added
   *  channel may cover only some frames). No channel_offsets are applied. */
  png_channels?: string[];
  /** Sparse channels: machine name -> {gap frameIndex -> the frameIndex whose
   *  plane stands in for it}. Mirrors `ChannelMeta.sparseFill`. Omitted when no
   *  sampled channel is sparse, which is every container extracted before
   *  2026-08-28. */
  sparse_fill?: Record<string, Record<string, number>>;
}

/** On-disk shape of the `registration.json` sidecar written by the extractors
 *  when channel registration ran. */
interface RegistrationSidecar {
  channels: string[];
  frames: Record<string, number[][]>;
}

interface MLMTMetricsResponseRow {
  frame_index: number;
  image_id: string;
  instance_id: string;
  track_id: string | null;
  channel: string;
  /** The frame the channel's pixels were read from — `frame_index` except on a
   *  sparse channel's gap frame.
   *
   *  NOT optional, unlike `channel_summaries` on the response envelope. The ML
   *  request model is `extra="forbid"`, so an ML service that does not know
   *  `sparse_fill` rejects the request outright (422) rather than answering
   *  without this field: there is no version in which a row arrives unlabelled,
   *  and a fallback for one would be unreachable code asserting something
   *  untrue. Deploy `ml` before `backend`; in the window between them MT
   *  intensity degrades to the geometry-only fallback, which stamps itself. */
  source_frame_index: number;
  length_px: number;
  area_px: number;
  pixel_count: number;
  sum_intensity: number;
  mean_intensity: number;
  median_intensity: number;
  std_intensity: number;
  median_background: number | null;
  mean_background: number | null;
  signal_minus_background: number | null;
}

interface MLMTMetricsResponseChannelSummary {
  channel: string;
  total_intensity: number;
  mean_intensity: number;
  pixel_count: number;
  frames: number;
}

interface MLMTMetricsResponse {
  rows: MLMTMetricsResponseRow[];
  /** Whole-image per-channel totals over the whole video. Optional so a stale
   *  ML build (pre-channel-summary) doesn't break the export. */
  channel_summaries?: MLMTMetricsResponseChannelSummary[];
  frames_processed: number;
  frame_height: number;
  frame_width: number;
}

// ----------------------------------------------------------------------------
//  Shape of the image rows the export pipeline passes in. Only the fields
//  we actually need — keeps the interface independent of Prisma's strict
//  payload type which would otherwise force the caller to widen its select.
// ----------------------------------------------------------------------------

interface FrameImageInput {
  id: string;
  /** The frame's human-readable `Image.name`, surfaced in the export as the
   *  `imageName` column (replacing the old UUID `imageId`). */
  name?: string | null;
  parentVideoId: string | null;
  frameIndex: number | null;
  isVideoContainer?: boolean;
  segmentation?: { polygons?: string | null } | null;
  /** Frame pixel dimensions, when known. Used only to size the ML request
   *  timeout to the actual workload (see `mlRequestBudget.ts`) — never
   *  required, and absent entirely in most callers' minimal test fixtures. */
  width?: number | null;
  height?: number | null;
}

interface RawPolyline {
  geometry?: string;
  type?: string;
  points?: Array<{ x: number; y: number }>;
  instanceId?: string;
  trackId?: string | null;
}

// ----------------------------------------------------------------------------
//  Helpers
// ----------------------------------------------------------------------------


function safeParsePolygons(json: string | null | undefined): RawPolyline[] {
  if (!json) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as RawPolyline[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function detectFileKind(mimeType: string | null, originalPath: string): 'nd2' | 'tiff' | null {
  const lower = originalPath.toLowerCase();
  if (lower.endsWith('.nd2')) {
    return 'nd2';
  }
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) {
    return 'tiff';
  }
  if (mimeType?.toLowerCase().includes('nd2')) {
    return 'nd2';
  }
  if (mimeType?.toLowerCase().includes('tiff')) {
    return 'tiff';
  }
  return null;
}

/**
 * Read the per-frame channel-registration offsets that sit next to the original
 * file (``registration.json``), written by the extractor when the user enabled
 * channel registration at upload. Returns the ``frameIndex -> [[dy, dx], ...]``
 * map (offsets indexed by C-axis channel index), or ``undefined`` when the
 * sidecar is absent/unreadable — in which case the ML endpoint samples the raw
 * file unchanged (legacy / unregistered uploads). The sidecar lives in the same
 * directory as the original (both the single- and per-position ND2 layouts).
 */
async function readRegistrationOffsets(
  originalAbsPath: string
): Promise<Record<string, number[][]> | undefined> {
  const sidecarPath = path.join(
    path.dirname(originalAbsPath),
    'registration.json'
  );
  try {
    const raw = await fs.readFile(sidecarPath, 'utf-8');
    const parsed = JSON.parse(raw) as RegistrationSidecar;
    if (!parsed?.frames || typeof parsed.frames !== 'object') {
      return undefined;
    }
    // Reconstruct as validated integer offsets rather than forwarding the raw
    // parsed file object into the outbound ML request. This (a) guards against a
    // malformed / hand-edited sidecar (a bad entry degrades to [0, 0] = no
    // shift) and (b) coerces every value through Number/Math.trunc so only
    // sanitised integers — never raw file data — reach the network request.
    const clean: Record<string, number[][]> = {};
    for (const [frame, rows] of Object.entries(parsed.frames)) {
      if (!/^\d+$/.test(frame) || !Array.isArray(rows)) {
        continue;
      }
      clean[frame] = rows.map(o => {
        const dy = Array.isArray(o) ? Math.trunc(Number(o[0])) : NaN;
        const dx = Array.isArray(o) ? Math.trunc(Number(o[1])) : NaN;
        return [Number.isFinite(dy) ? dy : 0, Number.isFinite(dx) ? dx : 0];
      });
    }
    return Object.keys(clean).length > 0 ? clean : undefined;
  } catch (err) {
    // "No sidecar" and "a sidecar that cannot be read" are different events and
    // must not share a silent return. The second means the container HAS
    // registered or de-drifted frames while this export samples the raw file
    // unshifted — every intensity off by exactly the offsets in the file we
    // just failed to parse. Undefined is still returned (an export that works
    // beats one that aborts), but it no longer happens in silence.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.warn(
        `${sidecarPath} present but unreadable; ` +
          'sampling the raw file UNSHIFTED — intensities will be off by the ' +
          'recorded offsets',
        'MTMetricsExporter',
        { error: err instanceof Error ? err.message : String(err) }
      );
    }
    return undefined;
  }
}

function resolveChannelIndices(
  containerChannels: VideoChannelMeta[],
  selected: string[]
): { indices: number[]; names: string[]; skipped: string[] } {
  const indices: number[] = [];
  const names: string[] = [];
  const skipped: string[] = [];
  for (const sel of selected) {
    const idx = containerChannels.findIndex(
      c => c.name === sel || c.displayName === sel
    );
    if (idx >= 0) {
      indices.push(idx);
      // Use the canonical machine name so the CSV column stays consistent
      // across renames / re-uploads with edited displayNames.
      names.push(containerChannels[idx].name);
    } else {
      skipped.push(sel);
    }
  }
  return { indices, names, skipped };
}

/**
 * The `sparse_fill` fragment of the ML request: for every channel being sampled
 * that the microscope only refreshed every N-th frame, its gap → anchor map.
 *
 * Why the export needs it at all. The forward fill added in PR #377 redirects
 * the READ path (editor, frame-data route, segmentation collapse); it does not
 * touch the original ND2/TIFF, where the un-acquired planes remain the constant
 * fill the acquisition software wrote. `mt_metrics.py` samples that original, so
 * without this map a gap frame's intensity for a sparse channel is a
 * measurement of the fill — a number with no exposure behind it, sitting in a
 * per-frame time series next to real ones.
 *
 * Entries are re-validated rather than forwarded from the parsed `channels`
 * JSON, the same defensive shape `readRegistrationOffsets` uses: only a
 * non-negative integer frame index reaches the outbound request. `Number.
 * isInteger` and not a `Number()` coercion, because coercion would turn a
 * `null` anchor into frame 0 — i.e. invent a redirect to the first frame out of
 * a corrupt entry, which is the one outcome worse than dropping it.
 *
 * Returns `undefined` when nothing sampled here is sparse — the field is then
 * omitted entirely and the ML side takes its dense path unchanged.
 */
function buildSparseFillRequest(
  containerChannels: VideoChannelMeta[],
  sampledNames: readonly string[]
): Record<string, Record<string, number>> | undefined {
  const out: Record<string, Record<string, number>> = {};
  for (const name of new Set(sampledNames)) {
    const meta = containerChannels.find(c => c.name === name);
    if (meta?.sparseSource !== true || !meta.sparseFill) {
      continue;
    }
    const clean: Record<string, number> = {};
    for (const [gap, anchor] of Object.entries(meta.sparseFill)) {
      if (!/^\d+$/.test(gap)) {
        continue;
      }
      if (!Number.isInteger(anchor) || anchor < 0) {
        continue;
      }
      clean[gap] = anchor;
    }
    if (Object.keys(clean).length > 0) {
      out[name] = clean;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ----------------------------------------------------------------------------
//  Public entry point
// ----------------------------------------------------------------------------

/**
 * Compute per-MT-per-channel metrics for an export job.
 *
 * @param frameImages  All Image rows selected for export (frames + any
 *                     standalone images — standalone images are silently
 *                     skipped since MT data is video-only).
 * @param projectId    For logging context only.
 * @param options      User-supplied MT metric controls from the export
 *                     modal.
 * @param mlGate       Optional shared semaphore bounding how many ML-bound
 *                     requests this export job has in flight at once, across
 *                     ALL of its ML-bound stages (mt-metrics,
 *                     mt-background-rois, kymograph) — not just this one.
 *                     Omitted in unit tests, which call this function
 *                     directly against a mocked axios.
 * @returns Long-format rows ready to write to CSV / XLSX / JSON, plus
 *          a list of human-readable skip reasons for videos that could
 *          not be processed. The caller should surface these as job
 *          warnings so the user knows which videos were omitted.
 */
export async function computeMTMetrics(
  frameImages: FrameImageInput[],
  projectId: string,
  options: MTMetricsOptions,
  mlGate?: Semaphore
): Promise<{
  rows: MTMetricsRow[];
  skipped: string[];
  channelSummaries: MTChannelSummaryRow[];
}> {
  const skipped: string[] = [];

  // Resolve the project's microtubule type-label palette once (id → class
  // NAME) so each row can carry the human-readable class. Untyped polylines or
  // unknown ids resolve to '' via the lookup below.
  const mtTypeNameById = new Map<string, string>();
  for (const label of await getMtTypeLabels(projectId)) {
    mtTypeNameById.set(label.id, label.name);
  }
  const resolveMtTypeName = (id: string | undefined | null): string =>
    (id && mtTypeNameById.get(id)) || '';

  // Per-channel intensity (incl. the integrated sum) is ALWAYS included for MT
  // exports — there is no opt-in. An empty `channels` list therefore means
  // "all channels of each container", NOT "skip". A specific subset can still
  // be requested via the API by naming channels explicitly.
  const requestAllChannels = options.channels.length === 0;

  // Validate any explicitly-requested channel names defensively (the FE
  // validates too, but export options can be POSTed directly). The
  // all-channels path derives names from stored container metadata (validated
  // at upload), so it needs no re-check.
  if (!requestAllChannels) {
    for (const ch of options.channels) {
      if (!isSafeChannelName(ch)) {
        throw new Error(`Invalid channel name in MT metrics options: ${ch}`);
      }
    }
  }

  // Group frame rows by parentVideoId. Standalone Images (parentVideoId
  // === null) are excluded — MT projects are always video.
  const framesByVideo = new Map<string, FrameImageInput[]>();
  for (const img of frameImages) {
    if (img.isVideoContainer) {
      continue;
    }
    if (!img.parentVideoId) {
      continue;
    }
    if (img.frameIndex == null) {
      continue;
    }
    const arr = framesByVideo.get(img.parentVideoId);
    if (arr) {
      arr.push(img);
    } else {
      framesByVideo.set(img.parentVideoId, [img]);
    }
  }

  if (framesByVideo.size === 0) {
    logger.info(
      'MT metrics: no frame images with parentVideoId; nothing to do',
      'mtMetricsExporter',
      { projectId }
    );
    return { rows: [], skipped, channelSummaries: [] };
  }

  // DB frame id → human-readable frame name, for the `imageName` output column.
  // The ML response echoes `image_id` (the id we sent = fr.id), so we join the
  // name back through this map.
  const frameNameById = new Map<string, string>();
  for (const img of frameImages) {
    if (img.name) {
      frameNameById.set(img.id, img.name);
    }
  }

  // Fetch all video container rows in a single query.
  const containerIds = Array.from(framesByVideo.keys());
  const containers = await prisma.image.findMany({
    where: { id: { in: containerIds } },
    select: {
      id: true,
      name: true,
      originalPath: true,
      mimeType: true,
      channels: true,
    },
  });
  const containerMap = new Map(containers.map(c => [c.id, c]));

  const mlBaseUrl = config.SEGMENTATION_SERVICE_URL;
  const mlUrl = `${mlBaseUrl}/api/v1/mt-metrics`;
  const allRows: MTMetricsRow[] = [];
  const allChannelSummaries: MTChannelSummaryRow[] = [];

  for (const [videoId, frames] of framesByVideo.entries()) {
    const container = containerMap.get(videoId);
    if (!container) {
      logger.warn(
        'MT metrics: container row not found; skipping video',
        'mtMetricsExporter',
        { projectId, videoId }
      );
      skipped.push(`Video ${videoId}: container row not found in database.`);
      continue;
    }
    const fileKind = detectFileKind(container.mimeType, container.originalPath);
    if (!fileKind) {
      logger.warn(
        'MT metrics: cannot detect ND2/TIFF from container; skipping video',
        'mtMetricsExporter',
        { projectId, videoId, originalPath: container.originalPath }
      );
      skipped.push(`Video ${videoId}: could not determine file type (not ND2 or TIFF) — intensity metrics omitted.`);
      continue;
    }
    const containerChannels = Array.isArray(container.channels)
      ? (container.channels as unknown as VideoChannelMeta[])
      : [];
    if (!containerChannels.length) {
      logger.warn(
        'MT metrics: container has no channels JSON; skipping video',
        'mtMetricsExporter',
        { projectId, videoId }
      );
      skipped.push(`Video ${videoId}: no channel metadata stored — intensity metrics omitted.`);
      continue;
    }

    // Empty request => sample every channel this container has. A named subset
    // is resolved against the container's own channels (a video may lack a
    // channel that another video in the project has).
    const selectedChannelNames = requestAllChannels
      ? containerChannels.map(c => c.name)
      : options.channels;

    // Partition into volume-backed (sampled from the original ND2/TIFF by
    // C-axis index) and PNG-backed (added post-upload; sampled from per-frame
    // PNGs). A selected name may reference a channel by machine name OR
    // displayName — resolve both. PNG-backed channels are always appended to
    // the channels array, so volume channels keep array-index == C-axis-index
    // and resolveChannelIndices stays correct after this split.
    const isPngChannel = (sel: string): boolean => {
      const c = containerChannels.find(
        cc => cc.name === sel || cc.displayName === sel
      );
      return !!c?.pngBacked;
    };
    const volumeSelected = selectedChannelNames.filter(sel => !isPngChannel(sel));
    const pngChannelNames = Array.from(
      new Set(
        selectedChannelNames
          .filter(isPngChannel)
          .map(
            sel =>
              containerChannels.find(
                cc => cc.name === sel || cc.displayName === sel
              )!.name
          )
      )
    );

    const { indices, names, skipped: channelSkipped } = resolveChannelIndices(
      containerChannels,
      volumeSelected
    );
    if (channelSkipped.length) {
      logger.warn(
        'MT metrics: some selected channels not found on this video',
        'mtMetricsExporter',
        { projectId, videoId, skipped: channelSkipped }
      );
    }
    if (!indices.length && !pngChannelNames.length) {
      logger.warn(
        'MT metrics: no channels resolved for this video; skipping',
        'mtMetricsExporter',
        { projectId, videoId }
      );
      const which = requestAllChannels
        ? 'stored channels'
        : `selected channels (${options.channels.join(', ')})`;
      skipped.push(
        `Video ${videoId}: none of the ${which} were found on this video — intensity metrics omitted.`
      );
      continue;
    }

    // Build the frames payload — only frames that actually have polylines.
    // Alongside it, build a per-frame label map ("MT1", …) keyed by the EXACT
    // `instance_id` sent to ML (real instanceId, or the synthesized fallback
    // for polylines without one). Keying on the sent id means the response
    // join below hits for every polyline we sent — including the empty-label
    // no-instanceId case (stored as '') — so a genuine miss (an ML row we
    // never sent) reads back as `undefined` and is flagged rather than
    // silently blanking the label.
    const framesPayload: FramePayload[] = [];
    const labelBySentId = new Map<string, Map<string, string>>();
    // Parallel to labelBySentId: the polyline's assigned tubulin type-label id,
    // keyed by the same sent instance_id so the row join below can resolve the
    // class name from the palette.
    const mtTypeBySentId = new Map<string, Map<string, string>>();
    for (const fr of frames) {
      const parsed = safeParsePolygons(fr.segmentation?.polygons);
      const labelByInstanceId = buildInstanceLabelMap(
        parsed,
        MICROTUBULE_LABEL_PREFIX
      );
      const sentIdToLabel = new Map<string, string>();
      const sentIdToMtType = new Map<string, string>();
      const polylines = parsed
        .filter(p => (p.geometry ?? 'polygon') === 'polyline')
        .filter(p => Array.isArray(p.points) && p.points.length >= 2)
        .map<PolylinePayload>(p => {
          const sentId =
            p.instanceId ?? `mt_${fr.id.slice(0, 8)}_${p.points!.length}`;
          // No instanceId → no badge on the image → empty label, matching viz.
          sentIdToLabel.set(
            sentId,
            p.instanceId ? labelByInstanceId.get(p.instanceId) ?? '' : ''
          );
          const mtTypeId = (p as { mtType?: string }).mtType;
          if (mtTypeId) {
            sentIdToMtType.set(sentId, mtTypeId);
          }
          return {
            image_id: fr.id,
            instance_id: sentId,
            track_id: p.trackId ?? null,
            points: p.points!.map(pt => [pt.x, pt.y]),
          };
        });
      labelBySentId.set(fr.id, sentIdToLabel);
      mtTypeBySentId.set(fr.id, sentIdToMtType);
      if (!polylines.length) {
        continue;
      }
      framesPayload.push({
        image_id: fr.id,
        frame_index: fr.frameIndex!,
        polylines,
      });
    }

    if (!framesPayload.length) {
      logger.info(
        'MT metrics: no polylines for this video; skipping',
        'mtMetricsExporter',
        { projectId, videoId }
      );
      continue;
    }

    // Original file absolute path. `originalPath` is stored relative to
    // UPLOAD_DIR; resolve here so ML gets a path it can open directly.
    const absoluteOriginalPath = path.join(
      config.UPLOAD_DIR,
      container.originalPath
    );

    // If channel registration ran at upload, sample each channel in the
    // registered (channel-0) space the polylines live in — otherwise a shifted
    // channel's intensity would be read at the wrong pixels.
    const channelOffsets = await readRegistrationOffsets(absoluteOriginalPath);

    // Channels this container only acquired every N-th frame. Sent so the gap
    // frames are measured on the plane that stands in for them and stamped with
    // it, instead of on the constant fill the microscope left behind.
    const sparseFill = buildSparseFillRequest(containerChannels, [
      ...names,
      ...pngChannelNames,
    ]);

    const body: MLMTMetricsRequest = {
      original_path: absoluteOriginalPath,
      file_kind: fileKind,
      channel_indices: indices,
      channel_names: names,
      frames: framesPayload,
      thickness_px: options.thicknessPx,
      margin_multiplier: options.marginMultiplier,
      channel_offsets: channelOffsets,
      png_channels: pngChannelNames.length ? pngChannelNames : undefined,
      sparse_fill: sparseFill,
    };

    // Scale the timeout to this request's actual workload (frames x channels,
    // adjusted for frame resolution) rather than a fixed number — see
    // `mlRequestBudget.ts` for the measured rate + headroom this is built
    // from. `channels` counts every channel actually being sampled (volume +
    // PNG-backed), matching what the ML side has to read.
    const requestChannelCount = indices.length + pngChannelNames.length;
    const megapixels = megapixelsFromFrames(frames);
    const timeoutMs = estimateMlRequestTimeoutMs({
      frames: framesPayload.length,
      channels: requestChannelCount,
      megapixels,
    });

    logger.info(
      'MT metrics: requesting ML computation',
      'mtMetricsExporter',
      {
        projectId,
        videoId,
        fileKind,
        frames: framesPayload.length,
        channels: indices.length,
        pngChannels: pngChannelNames.length,
        megapixels,
        timeoutMs,
      }
    );

    let mlResponse: MLMTMetricsResponse;
    try {
      // Failures bubble up so the export job fails visibly rather than
      // silently emitting an empty sheet. `mlGate` serialises this request
      // against the export's other ML-bound stages so it never has to queue
      // behind them AND its own timeout at once (see `Semaphore` in
      // `utils/concurrency.ts`) — the timeout clock only starts once the
      // request is actually sent.
      const res = await runGated(mlGate, () =>
        axios.post<MLMTMetricsResponse>(mlUrl, body, { timeout: timeoutMs })
      );
      mlResponse = res.data;
    } catch (err) {
      logger.error(
        'MT metrics: ML request failed',
        err instanceof Error ? err : new Error(String(err)),
        'mtMetricsExporter',
        { projectId, videoId }
      );
      throw err;
    }

    const scale = options.pixelToMicrometerScale;
    const videoRows: MTMetricsRow[] = [];
    for (const row of mlResponse.rows) {
      // Every polyline we sent has an entry (badge or ''); `undefined` means
      // ML returned an (image_id, instance_id) we never sent — a contract
      // drift that would otherwise silently blank the label column.
      const label = labelBySentId.get(row.image_id)?.get(row.instance_id);
      if (label === undefined) {
        logger.warn(
          'MT metrics: ML returned an (image_id, instance_id) not present in the request — label join drift; label left blank',
          'mtMetricsExporter',
          { projectId, videoId, imageId: row.image_id, instanceId: row.instance_id }
        );
      }
      videoRows.push({
        frameIndex: row.frame_index,
        imageName: frameNameById.get(row.image_id) ?? '',
        label: label ?? '',
        mtType: resolveMtTypeName(
          mtTypeBySentId.get(row.image_id)?.get(row.instance_id)
        ),
        instanceId: row.instance_id,
        trackId: row.track_id,
        channel: row.channel,
        channelFrameSource: row.source_frame_index,
        lengthPx: row.length_px,
        lengthUm: scale != null ? row.length_px * scale : null,
        areaPx: row.area_px,
        areaUm2: scale != null ? row.area_px * scale * scale : null,
        pixelCount: row.pixel_count,
        sumIntensity: row.sum_intensity,
        meanIntensity: row.mean_intensity,
        medianIntensity: row.median_intensity,
        stdIntensity: row.std_intensity,
        medianBackground: row.median_background,
        meanBackground: row.mean_background,
        signalMinusBackground: row.signal_minus_background,
      });
    }
    // Order this video's rows by frame (stable sort preserves the ML row order
    // within a frame — polyline then channel) so the sheet reads frame 0, 1, 2…
    // instead of the ML response's grouping. Videos stay grouped (each block is
    // appended whole) since rows carry no video id to sort across.
    videoRows.sort((a, b) => a.frameIndex - b.frameIndex);
    for (const r of videoRows) {
      allRows.push(r);
    }

    // Whole-image per-channel totals for this video (sum of every pixel of the
    // channel across all frames — independent of the microtubules). `?? []`
    // keeps a stale pre-summary ML build from breaking the export.
    for (const cs of mlResponse.channel_summaries ?? []) {
      allChannelSummaries.push({
        video: container.name ?? videoId,
        channel: cs.channel,
        totalIntensity: cs.total_intensity,
        meanIntensity: cs.mean_intensity,
        pixelCount: cs.pixel_count,
        frames: cs.frames,
      });
    }
  }

  logger.info(
    'MT metrics: total rows produced',
    'mtMetricsExporter',
    {
      projectId,
      rows: allRows.length,
      channelSummaries: allChannelSummaries.length,
      skippedVideos: skipped.length,
    }
  );
  return { rows: allRows, skipped, channelSummaries: allChannelSummaries };
}

/** Arc length in pixels = sum of consecutive segment lengths. */
function polylineLengthPx(points: Array<{ x: number; y: number }>): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y
    );
  }
  return len;
}

/**
 * Geometry-only metrics (microtubule length) computed Node-side straight from
 * the stored polylines — no channel raster, no ML call. Used when an MT
 * project is exported WITHOUT a selected channel: length is the fundamental
 * MT measurement and must not be silently dropped just because no intensity
 * channel was chosen. The intensity/area columns (which need the raw raster)
 * are left null so the row schema matches the full intensity export.
 */
export function computeMTGeometry(
  frameImages: FrameImageInput[],
  pixelToMicrometerScale: number | null,
  /** id → class NAME from the project's mtTypeLabels palette. Untyped / unknown
   *  ids resolve to '' (the default empty map). */
  mtTypeNameById: Map<string, string> = new Map()
): MTMetricsRow[] {
  const rows: MTMetricsRow[] = [];
  // Emit rows grouped by video, frame-ascending, so the sheet reads frame 0,
  // 1, 2… regardless of the order the frames were passed in.
  const ordered = [...frameImages].sort((a, b) => {
    const va = a.parentVideoId ?? '';
    const vb = b.parentVideoId ?? '';
    if (va !== vb) {
      return va < vb ? -1 : 1;
    }
    return (a.frameIndex ?? 0) - (b.frameIndex ?? 0);
  });
  for (const fr of ordered) {
    if (fr.isVideoContainer || !fr.parentVideoId || fr.frameIndex == null) {
      continue;
    }
    const parsed = safeParsePolygons(fr.segmentation?.polygons);
    // Same instance→label map the visualization uses, so geometry-only rows
    // still carry the "MT1" badge shown on the image.
    const labelMap = buildInstanceLabelMap(parsed, MICROTUBULE_LABEL_PREFIX);
    const polylines = parsed
      .filter(p => (p.geometry ?? 'polygon') === 'polyline')
      .filter(p => Array.isArray(p.points) && p.points!.length >= 2);
    for (const p of polylines) {
      const lengthPx = polylineLengthPx(p.points!);
      const mtTypeId = (p as { mtType?: string }).mtType;
      rows.push({
        frameIndex: fr.frameIndex,
        imageName: fr.name ?? '',
        label: p.instanceId ? (labelMap.get(p.instanceId) ?? '') : '',
        mtType: (mtTypeId && mtTypeNameById.get(mtTypeId)) || '',
        instanceId:
          p.instanceId ?? `mt_${fr.id.slice(0, 8)}_${p.points!.length}`,
        trackId: p.trackId ?? null,
        channel: '',
        // Nothing was measured, so no frame was read — not even this one.
        channelFrameSource: null,
        lengthPx,
        lengthUm:
          pixelToMicrometerScale != null
            ? lengthPx * pixelToMicrometerScale
            : null,
        areaPx: null,
        areaUm2: null,
        pixelCount: null,
        sumIntensity: null,
        meanIntensity: null,
        medianIntensity: null,
        stdIntensity: null,
        medianBackground: null,
        meanBackground: null,
        signalMinusBackground: null,
      });
    }
  }
  return rows;
}

// ----------------------------------------------------------------------------
//  Long → wide pivot
// ----------------------------------------------------------------------------

/**
 * Identity of one microtubule ON one frame — the pivot key. Channel is
 * deliberately absent: collapsing a microtubule's per-channel rows onto one
 * line is the whole point.
 *
 * `imageName` is part of the key because `frameIndex` alone is not unique
 * across videos (every video restarts at 0) and an export can span several
 * containers; frame names are container-prefixed (`"<video>.nd2 (frame 3)"`),
 * so together they identify the frame.
 */
function wideIdentityKey(row: MTMetricsRow): string {
  return `${row.imageName}\u0000${row.frameIndex}\u0000${row.instanceId}`;
}

/**
 * Pivot the long-format rows to one row per (frame, microtubule), with each
 * channel's measures in its own set of columns.
 *
 * Row order follows first appearance in `rows`, which (after the frame sort in
 * {@link computeMTMetrics}) means frame-ascending, polyline order — i.e. the
 * same reading order as `metrics.csv`. Channel column order follows first
 * appearance too, which is the container's own channel order.
 *
 * Two guarantees this relies on, both from the ML side:
 *  - the band / vicinity geometry is built once per frame and shared across
 *    channels, so `lengthPx` / `areaPx` / `pixelCount` do not vary by channel;
 *  - `instanceId` is unique per polyline within a frame. Where it is NOT — the
 *    `mt_<frameId>_<nPoints>` fallback for polylines with no `instanceId` can
 *    collide — repeated ids are disambiguated positionally (the k-th row with
 *    that id in a given channel belongs to the k-th such polyline), so two
 *    colliding microtubules stay two rows instead of silently merging.
 *
 * Geometry-only rows (`channel === ''`, the no-raster fallback) contribute a
 * row with no channel columns at all rather than a bogus `''`-named channel.
 *
 * @returns `channels` — every non-empty channel name seen, in column order —
 *          and the pivoted rows.
 */
export function pivotMTMetricsWide(rows: readonly MTMetricsRow[]): {
  channels: string[];
  rows: MTMetricsWideRow[];
} {
  const channels: string[] = [];
  const channelSeen = new Set<string>();
  const byKey = new Map<string, MTMetricsWideRow>();
  // `${channel}\u0000${identity}` → how many rows with that identity this
  // channel has already contributed. Disambiguates colliding instance ids.
  const occurrences = new Map<string, number>();
  let geometryDrift = 0;

  for (const row of rows) {
    const identity = wideIdentityKey(row);
    const occKey = `${row.channel}\u0000${identity}`;
    const occ = occurrences.get(occKey) ?? 0;
    occurrences.set(occKey, occ + 1);
    const key = `${identity}\u0000${occ}`;

    let wide = byKey.get(key);
    if (!wide) {
      wide = {
        frameIndex: row.frameIndex,
        imageName: row.imageName,
        label: row.label,
        mtType: row.mtType,
        instanceId: row.instanceId,
        trackId: row.trackId,
        lengthPx: row.lengthPx,
        lengthUm: row.lengthUm,
        areaPx: row.areaPx,
        areaUm2: row.areaUm2,
        pixelCount: row.pixelCount,
        // Null-prototype, kept as belt and braces. `isSafeChannelName` now
        // rejects `__proto__` (and every other `Object.prototype` member) at
        // the gate, so a stored name can no longer reach here — but this map
        // is keyed by a name that came from file metadata / user input, and on
        // a plain object such a key would set the prototype instead of adding
        // an entry.
        channels: Object.create(null) as MTMetricsWideRow['channels'],
      };
      byKey.set(key, wide);
    } else {
      // Geometry is channel-independent by construction. Fill any column the
      // first row left null, and flag a genuine disagreement rather than
      // silently keeping whichever channel happened to come first.
      if (Math.abs(wide.lengthPx - row.lengthPx) > 1e-6) {
        geometryDrift++;
      }
      if (wide.areaPx == null) {
        wide.areaPx = row.areaPx;
      } else if (row.areaPx != null && wide.areaPx !== row.areaPx) {
        geometryDrift++;
      }
      if (wide.areaUm2 == null) {
        wide.areaUm2 = row.areaUm2;
      }
      if (wide.pixelCount == null) {
        wide.pixelCount = row.pixelCount;
      } else if (row.pixelCount != null && wide.pixelCount !== row.pixelCount) {
        geometryDrift++;
      }
    }

    if (!row.channel) {
      continue; // geometry-only row: no per-channel columns
    }
    if (!channelSeen.has(row.channel)) {
      channelSeen.add(row.channel);
      channels.push(row.channel);
    }
    wide.channels[row.channel] = {
      sumIntensity: row.sumIntensity,
      meanIntensity: row.meanIntensity,
      medianIntensity: row.medianIntensity,
      stdIntensity: row.stdIntensity,
      medianBackground: row.medianBackground,
      meanBackground: row.meanBackground,
      signalMinusBackground: row.signalMinusBackground,
      channelFrameSource: row.channelFrameSource,
    };
  }

  if (geometryDrift) {
    logger.warn(
      'MT metrics (wide): geometry columns differ between channels of the same microtubule — the wide sheet keeps the first non-null value',
      'mtMetricsExporter',
      { mismatches: geometryDrift }
    );
  }

  return { channels, rows: Array.from(byKey.values()) };
}

/** Wide column name for one channel's measure, e.g. ``IRM_meanIntensity``. */
function wideChannelColumn(channel: string, measure: MTChannelMeasure): string {
  return `${channel}_${measure}`;
}

/**
 * Full wide header row: the shared identity/geometry columns once, then eight
 * columns per channel. Column count is `11 + 8 * channels` — Excel's
 * 16 384-column ceiling is only reached past ~2 045 distinct channel names, so
 * no cap is applied.
 */
function wideHeaders(channels: readonly string[]): string[] {
  const headers: string[] = [...WIDE_SHARED_HEADERS];
  for (const channel of channels) {
    for (const measure of WIDE_CHANNEL_MEASURES) {
      headers.push(wideChannelColumn(channel, measure));
    }
  }
  return headers;
}

/** Values of one wide row, positionally aligned with {@link wideHeaders}. */
function wideRowValues(
  row: MTMetricsWideRow,
  channels: readonly string[]
): Array<string | number | null> {
  const values: Array<string | number | null> = WIDE_SHARED_HEADERS.map(
    h => row[h]
  );
  for (const channel of channels) {
    const measures = row.channels[channel];
    for (const measure of WIDE_CHANNEL_MEASURES) {
      values.push(measures ? measures[measure] : null);
    }
  }
  return values;
}

/**
 * Flat JSON objects for the wide rows — same keys as the CSV header, so all
 * three formats agree. The header array is built ONCE for the whole set: on a
 * 600-frame video this loop runs 100 000+ times and rebuilding the
 * ``<channel>_<measure>`` strings per row is pure garbage.
 */
function wideToJSONRows(
  rows: readonly MTMetricsWideRow[],
  channels: readonly string[]
): Array<Record<string, string | number | null>> {
  const headers = wideHeaders(channels);
  return rows.map(row => {
    const values = wideRowValues(row, channels);
    const obj: Record<string, string | number | null> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i];
    });
    return obj;
  });
}

// ----------------------------------------------------------------------------
//  Output writers
// ----------------------------------------------------------------------------

/** Long-format column order used in CSV / XLSX. JSON uses the camelCase
 *  field names from MTMetricsRow directly. */
const CSV_HEADERS: readonly (keyof MTMetricsRow)[] = [
  'frameIndex',
  'imageName',
  'label',
  'mtType',
  'instanceId',
  'trackId',
  'channel',
  'lengthPx',
  'lengthUm',
  'areaPx',
  'areaUm2',
  'pixelCount',
  'sumIntensity',
  'meanIntensity',
  'medianIntensity',
  'stdIntensity',
  'medianBackground',
  'meanBackground',
  'signalMinusBackground',
  // APPENDED, not slotted in next to `channel` where it reads best. The long
  // format is the canonical file and pipelines outside this repo consume it; a
  // column inserted mid-row shifts every later one and a positional reader
  // would silently pick this up where it expects `lengthPx`. Last in each
  // channel's block in the wide view too, for the same reason.
  'channelFrameSource',
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) {
    return '';
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      return '';
    }
    // Plenty of precision for fluorescence values without scientific notation
    // for typical-range numbers.
    return Number.isInteger(v) ? String(v) : v.toFixed(6).replace(/\.?0+$/, '');
  }
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCSV(rows: MTMetricsRow[]): string {
  const lines: string[] = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(CSV_HEADERS.map(h => csvCell(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

function wideToCSV(
  rows: readonly MTMetricsWideRow[],
  channels: readonly string[]
): string {
  const lines: string[] = [wideHeaders(channels).map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(wideRowValues(row, channels).map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

/** Column order for the whole-video per-channel totals summary. */
const CHANNEL_SUMMARY_HEADERS: readonly (keyof MTChannelSummaryRow)[] = [
  'video',
  'channel',
  'totalIntensity',
  'meanIntensity',
  'pixelCount',
  'frames',
] as const;

function channelSummariesToCSV(rows: MTChannelSummaryRow[]): string {
  const lines: string[] = [CHANNEL_SUMMARY_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(CHANNEL_SUMMARY_HEADERS.map(h => csvCell(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Excel sheet name for the wide view. Kept under Excel's 31-character sheet
 * name limit (26 characters).
 */
const WIDE_SHEET_NAME = 'Microtubule Metrics (wide)';

/**
 * Cell budget for the wide XLSX sheet.
 *
 * exceljs is not a streaming writer here: every cell is a live object held
 * until `xlsx.writeFile`. The long sheet alone is already the export's biggest
 * in-memory structure — a 620-frame ND2 with ~300 microtubules and 2 channels
 * is ~370 000 rows x 19 columns — and this export came within 200 MB of an OOM
 * in August 2026 (see the NODE_OPTIONS comment in
 * `docker-compose.production.yml`). The wide sheet would add another ~66 %.
 *
 * Past this budget the SHEET is dropped, but the data is not: `writeMTMetrics`
 * falls back to writing `metrics_wide.csv` beside the workbook (a plain string,
 * an order of magnitude cheaper). Documented in `exportDocs.ts`.
 *
 * Overridable with `MT_WIDE_XLSX_MAX_CELLS` so the ceiling can be retuned
 * without a deploy (and so the fallback branch is testable without building a
 * two-million-cell workbook).
 */
const DEFAULT_MAX_WIDE_XLSX_CELLS = 2_000_000;

function maxWideXlsxCells(): number {
  const raw = Number.parseInt(process.env.MT_WIDE_XLSX_MAX_CELLS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_WIDE_XLSX_CELLS;
}

/** Cells the wide sheet would occupy, header row included. */
export function wideCellCount(wide: {
  channels: readonly string[];
  rows: readonly MTMetricsWideRow[];
}): number {
  const columns =
    WIDE_SHARED_HEADERS.length +
    WIDE_CHANNEL_MEASURES.length * wide.channels.length;
  return (wide.rows.length + 1) * columns;
}

async function writeXLSX(
  rows: MTMetricsRow[],
  channelSummaries: MTChannelSummaryRow[],
  filePath: string,
  wide: { channels: string[]; rows: MTMetricsWideRow[] },
  includeWideSheet: boolean
): Promise<void> {
  // exceljs is CJS; mirror the dynamic-import idiom used by exportService.
  const excelMod = (await import('exceljs')) as unknown as {
    default?: typeof import('exceljs');
    Workbook?: typeof import('exceljs').Workbook;
  };
  const ExcelJS = excelMod.default ?? excelMod;
  const workbook = new ExcelJS.Workbook!();
  const sheet = workbook.addWorksheet('Microtubule Metrics');
  sheet.columns = CSV_HEADERS.map(h => ({ header: h, key: h, width: 18 }));
  for (const row of rows) {
    sheet.addRow(row);
  }
  // Bold header row.
  sheet.getRow(1).font = { bold: true };

  // Second sheet: the same numbers pivoted to one row per (frame, MT) with the
  // channels side by side. Rows are added positionally (not by key) so a
  // channel name can never clash with a column key.
  if (includeWideSheet) {
    const wideSheet = workbook.addWorksheet(WIDE_SHEET_NAME);
    wideSheet.columns = wideHeaders(wide.channels).map(header => ({
      header,
      width: 20,
    }));
    for (const row of wide.rows) {
      wideSheet.addRow(wideRowValues(row, wide.channels));
    }
    wideSheet.getRow(1).font = { bold: true };
  }

  // Third sheet: whole-video per-channel totals (independent of the MTs).
  if (channelSummaries.length) {
    const summary = workbook.addWorksheet('Channel Totals');
    summary.columns = CHANNEL_SUMMARY_HEADERS.map(h => ({
      header: h,
      key: h,
      width: 22,
    }));
    for (const row of channelSummaries) {
      summary.addRow(row);
    }
    summary.getRow(1).font = { bold: true };
  }

  await workbook.xlsx.writeFile(filePath);
}

/**
 * Persist the metric rows to disk in any subset of {excel, csv, json}.
 *
 * Alongside the long-format `metrics.*`, a WIDE view is written
 * (`metrics_wide.*` / a second XLSX sheet): the same numbers pivoted to one row
 * per (frame, microtubule) with one column set per channel, so two channels of
 * the same MT can be compared on one line. It is skipped when no channel was
 * sampled at all (the geometry-only fallback) — there would be nothing to
 * widen, and `metrics.*` already carries every column.
 *
 * On a very large export the wide XLSX *sheet* is dropped for memory
 * ({@link MAX_WIDE_XLSX_CELLS}) and `metrics_wide.csv` is written beside the
 * workbook instead, so the pivoted numbers are always available.
 *
 * @param rows              Output from {@link computeMTMetrics}.
 * @param destDir           Target directory (created if absent).
 * @param formats           Same formats list the user picked for general metrics.
 * @param channelSummaries  Whole-video per-channel totals. In Excel these go on
 *                          a "Channel Totals" sheet; in CSV/JSON they get
 *                          a companion `metrics_channel_totals.*` file.
 */
export async function writeMTMetrics(
  rows: MTMetricsRow[],
  destDir: string,
  formats: ReadonlyArray<'excel' | 'csv' | 'json'>,
  channelSummaries: MTChannelSummaryRow[] = []
): Promise<void> {
  if (!rows.length || !formats.length) {
    return;
  }
  await fs.mkdir(destDir, { recursive: true });

  const wide = pivotMTMetricsWide(rows);
  const writeWide = wide.channels.length > 0;
  // Too big to hold as exceljs cells → keep the numbers, drop only the sheet.
  const budget = maxWideXlsxCells();
  const cells = writeWide ? wideCellCount(wide) : 0;
  const wideSheetTooBig = writeWide && cells > budget;
  if (wideSheetTooBig) {
    logger.warn(
      'MT metrics (wide): too large for an Excel sheet; writing metrics_wide.csv instead',
      'mtMetricsExporter',
      {
        rows: wide.rows.length,
        channels: wide.channels.length,
        cells,
        budget,
      }
    );
  }

  // For microtubule projects these ARE the standard metrics files — the
  // closed-polygon report is skipped upstream (see exportService
  // `generateMetrics`), so write the canonical `metrics.*` names rather
  // than a separate `microtubule_metrics.*` the user might overlook.
  for (const fmt of formats) {
    if (fmt === 'csv') {
      await fs.writeFile(
        path.join(destDir, 'metrics.csv'),
        rowsToCSV(rows),
        'utf8'
      );
      if (writeWide) {
        await fs.writeFile(
          path.join(destDir, 'metrics_wide.csv'),
          wideToCSV(wide.rows, wide.channels),
          'utf8'
        );
      }
      if (channelSummaries.length) {
        await fs.writeFile(
          path.join(destDir, 'metrics_channel_totals.csv'),
          channelSummariesToCSV(channelSummaries),
          'utf8'
        );
      }
    } else if (fmt === 'json') {
      await fs.writeFile(
        path.join(destDir, 'metrics.json'),
        JSON.stringify(rows, null, 2),
        'utf8'
      );
      if (writeWide) {
        await fs.writeFile(
          path.join(destDir, 'metrics_wide.json'),
          JSON.stringify(wideToJSONRows(wide.rows, wide.channels), null, 2),
          'utf8'
        );
      }
      if (channelSummaries.length) {
        await fs.writeFile(
          path.join(destDir, 'metrics_channel_totals.json'),
          JSON.stringify(channelSummaries, null, 2),
          'utf8'
        );
      }
    } else if (fmt === 'excel') {
      await writeXLSX(
        rows,
        channelSummaries,
        path.join(destDir, 'metrics.xlsx'),
        wide,
        writeWide && !wideSheetTooBig
      );
      if (wideSheetTooBig) {
        await fs.writeFile(
          path.join(destDir, 'metrics_wide.csv'),
          wideToCSV(wide.rows, wide.channels),
          'utf8'
        );
      }
    }
  }
}
