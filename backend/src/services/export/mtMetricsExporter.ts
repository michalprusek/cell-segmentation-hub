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
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import axios from 'axios';
import { prisma } from '../../db/prismaClient';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import {
  buildInstanceLabelMap,
  MICROTUBULE_LABEL_PREFIX,
} from '../../utils/instanceLabels';

// ----------------------------------------------------------------------------
//  Types (mirror the Python Pydantic models — keep in sync if either changes)
// ----------------------------------------------------------------------------

export interface MTMetricsOptions {
  thicknessPx: number;
  marginMultiplier: number;
  /** Channel display names the user picked. Empty => exporter is a no-op. */
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
  imageId: string;
  /** Per-frame instance badge drawn on the visualization image ("MT1",
   *  "MT2", …), matching {@link buildInstanceLabelMap}. Empty string when the
   *  polyline has no `instanceId` (no badge is drawn for it either). */
  label: string;
  instanceId: string;
  trackId: string | null;
  /** Channel machine name, or '' for geometry-only rows (no channel picked). */
  channel: string;
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

interface VideoChannelMeta {
  name: string;
  displayName?: string;
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

interface MLMTMetricsResponse {
  rows: MLMTMetricsResponseRow[];
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
  parentVideoId: string | null;
  frameIndex: number | null;
  isVideoContainer?: boolean;
  segmentation?: { polygons?: string | null } | null;
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

const CHANNEL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

function safeParsePolygons(json: string | null | undefined): RawPolyline[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as RawPolyline[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function detectFileKind(mimeType: string | null, originalPath: string): 'nd2' | 'tiff' | null {
  const lower = originalPath.toLowerCase();
  if (lower.endsWith('.nd2')) return 'nd2';
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'tiff';
  if (mimeType?.toLowerCase().includes('nd2')) return 'nd2';
  if (mimeType?.toLowerCase().includes('tiff')) return 'tiff';
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
      if (!/^\d+$/.test(frame) || !Array.isArray(rows)) continue;
      clean[frame] = rows.map(o => {
        const dy = Array.isArray(o) ? Math.trunc(Number(o[0])) : NaN;
        const dx = Array.isArray(o) ? Math.trunc(Number(o[1])) : NaN;
        return [Number.isFinite(dy) ? dy : 0, Number.isFinite(dx) ? dx : 0];
      });
    }
    return Object.keys(clean).length > 0 ? clean : undefined;
  } catch {
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
 * @returns Long-format rows ready to write to CSV / XLSX / JSON, plus
 *          a list of human-readable skip reasons for videos that could
 *          not be processed. The caller should surface these as job
 *          warnings so the user knows which videos were omitted.
 */
export async function computeMTMetrics(
  frameImages: FrameImageInput[],
  projectId: string,
  options: MTMetricsOptions
): Promise<{ rows: MTMetricsRow[]; skipped: string[] }> {
  const skipped: string[] = [];

  if (!options.channels.length) {
    logger.info(
      'MT metrics: no channels selected; skipping',
      'mtMetricsExporter',
      { projectId }
    );
    return { rows: [], skipped };
  }

  // Validate channel names defensively (the FE should have done this,
  // but the export options can be POSTed directly).
  for (const ch of options.channels) {
    if (!CHANNEL_NAME_RE.test(ch)) {
      throw new Error(`Invalid channel name in MT metrics options: ${ch}`);
    }
  }

  // Group frame rows by parentVideoId. Standalone Images (parentVideoId
  // === null) are excluded — MT projects are always video.
  const framesByVideo = new Map<string, FrameImageInput[]>();
  for (const img of frameImages) {
    if (img.isVideoContainer) continue;
    if (!img.parentVideoId) continue;
    if (img.frameIndex == null) continue;
    const arr = framesByVideo.get(img.parentVideoId);
    if (arr) arr.push(img);
    else framesByVideo.set(img.parentVideoId, [img]);
  }

  if (framesByVideo.size === 0) {
    logger.info(
      'MT metrics: no frame images with parentVideoId; nothing to do',
      'mtMetricsExporter',
      { projectId }
    );
    return { rows: [], skipped };
  }

  // Fetch all video container rows in a single query.
  const containerIds = Array.from(framesByVideo.keys());
  const containers = await prisma.image.findMany({
    where: { id: { in: containerIds } },
    select: {
      id: true,
      originalPath: true,
      mimeType: true,
      channels: true,
    },
  });
  const containerMap = new Map(containers.map(c => [c.id, c]));

  const mlBaseUrl = config.SEGMENTATION_SERVICE_URL;
  const mlUrl = `${mlBaseUrl}/api/v1/mt-metrics`;
  const allRows: MTMetricsRow[] = [];

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

    const { indices, names, skipped: channelSkipped } = resolveChannelIndices(
      containerChannels,
      options.channels
    );
    if (channelSkipped.length) {
      logger.warn(
        'MT metrics: some selected channels not found on this video',
        'mtMetricsExporter',
        { projectId, videoId, skipped: channelSkipped }
      );
    }
    if (!indices.length) {
      logger.warn(
        'MT metrics: no overlap between selected channels and this video; skipping',
        'mtMetricsExporter',
        { projectId, videoId }
      );
      skipped.push(`Video ${videoId}: none of the selected channels (${options.channels.join(', ')}) were found on this video — intensity metrics omitted.`);
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
    for (const fr of frames) {
      const parsed = safeParsePolygons(fr.segmentation?.polygons);
      const labelByInstanceId = buildInstanceLabelMap(
        parsed,
        MICROTUBULE_LABEL_PREFIX
      );
      const sentIdToLabel = new Map<string, string>();
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
          return {
            image_id: fr.id,
            instance_id: sentId,
            track_id: p.trackId ?? null,
            points: p.points!.map(pt => [pt.x, pt.y]),
          };
        });
      labelBySentId.set(fr.id, sentIdToLabel);
      if (!polylines.length) continue;
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

    const body: MLMTMetricsRequest = {
      original_path: absoluteOriginalPath,
      file_kind: fileKind,
      channel_indices: indices,
      channel_names: names,
      frames: framesPayload,
      thickness_px: options.thicknessPx,
      margin_multiplier: options.marginMultiplier,
      channel_offsets: channelOffsets,
    };

    logger.info(
      'MT metrics: requesting ML computation',
      'mtMetricsExporter',
      {
        projectId,
        videoId,
        fileKind,
        frames: framesPayload.length,
        channels: indices.length,
      }
    );

    let mlResponse: MLMTMetricsResponse;
    try {
      // 5 minutes — covers a long video × multiple channels with full
      // ND2 / TIFF reads. Failures bubble up so the export job fails
      // visibly rather than silently emitting an empty sheet.
      const res = await axios.post<MLMTMetricsResponse>(mlUrl, body, {
        timeout: 5 * 60 * 1000,
      });
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
        imageId: row.image_id,
        label: label ?? '',
        instanceId: row.instance_id,
        trackId: row.track_id,
        channel: row.channel,
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
    for (const r of videoRows) allRows.push(r);
  }

  logger.info(
    'MT metrics: total rows produced',
    'mtMetricsExporter',
    { projectId, rows: allRows.length, skippedVideos: skipped.length }
  );
  return { rows: allRows, skipped };
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
  pixelToMicrometerScale: number | null
): MTMetricsRow[] {
  const rows: MTMetricsRow[] = [];
  // Emit rows grouped by video, frame-ascending, so the sheet reads frame 0,
  // 1, 2… regardless of the order the frames were passed in.
  const ordered = [...frameImages].sort((a, b) => {
    const va = a.parentVideoId ?? '';
    const vb = b.parentVideoId ?? '';
    if (va !== vb) return va < vb ? -1 : 1;
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
      rows.push({
        frameIndex: fr.frameIndex,
        imageId: fr.id,
        label: p.instanceId ? (labelMap.get(p.instanceId) ?? '') : '',
        instanceId:
          p.instanceId ?? `mt_${fr.id.slice(0, 8)}_${p.points!.length}`,
        trackId: p.trackId ?? null,
        channel: '',
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
//  Output writers
// ----------------------------------------------------------------------------

/** Long-format column order used in CSV / XLSX. JSON uses the camelCase
 *  field names from MTMetricsRow directly. */
const CSV_HEADERS: readonly (keyof MTMetricsRow)[] = [
  'frameIndex',
  'imageId',
  'label',
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
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
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

async function writeXLSX(rows: MTMetricsRow[], filePath: string): Promise<void> {
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
  await workbook.xlsx.writeFile(filePath);
}

/**
 * Persist the metric rows to disk in any subset of {excel, csv, json}.
 *
 * @param rows     Output from {@link computeMTMetrics}.
 * @param destDir  Target directory (created if absent).
 * @param formats  Same formats list the user picked for general metrics.
 */
export async function writeMTMetrics(
  rows: MTMetricsRow[],
  destDir: string,
  formats: ReadonlyArray<'excel' | 'csv' | 'json'>
): Promise<void> {
  if (!rows.length || !formats.length) return;
  await fs.mkdir(destDir, { recursive: true });

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
    } else if (fmt === 'json') {
      await fs.writeFile(
        path.join(destDir, 'metrics.json'),
        JSON.stringify(rows, null, 2),
        'utf8'
      );
    } else if (fmt === 'excel') {
      await writeXLSX(rows, path.join(destDir, 'metrics.xlsx'));
    }
  }
}
