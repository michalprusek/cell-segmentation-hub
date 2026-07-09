/**
 * ImageJ / Fiji ``.roi`` binary encoder + per-frame ROI exporter.
 *
 * Microtubule projects annotate open polylines that biologists want to
 * re-open in ImageJ (RoiManager, kymograph plugins, manual re-measurement).
 * ImageJ's native ROI format is a big-endian binary blob — NOT JSON — so this
 * module hand-encodes it against the layout defined in ImageJ's
 * ``ij/io/RoiEncoder.java`` / ``RoiDecoder.java``.
 *
 * File layout produced here (offsets in bytes, all big-endian):
 *   0    "Iout" magic
 *   4    version (int16, 227)
 *   6    ROI type (uint8): 0 = polygon, 5 = polyline  (on-disk codes)
 *   8    top / 10 left / 12 bottom / 14 right  (int16 integer bounding box)
 *   16   nCoordinates (int16)
 *   34   stroke width (int16): 0 = unset; the line thickness (MT thickness in
 *        px) so a re-opened polyline draws + measures as a band of that width
 *   40   stroke colour (uint32 ARGB): 0 = unset; set for per-track colouring
 *   50   options (int16): SUB_PIXEL_RESOLUTION (128) is always set here
 *   56   position (int32): 0 = unset; the 1-based stack slice for RoiSet.zip
 *        exports so each ROI lands on its own video frame
 *   60   header2 offset (int32)
 *   64   integer coords: x[n] then y[n] (int16; x relative to left, y to top)
 *   64+4n  float32 x[n] (absolute), then float32 y[n]  ← authoritative geometry
 *   +HEADER2  header2 block (name offset/length; +36 float32 stroke width)
 *   +name   ROI name as UTF-16BE code units
 *
 * Stroke width is stored twice, matching ImageJ's own RoiEncoder: an int16 at
 * @34 for legacy readers and a float32 in header2 (+36) that modern ImageJ
 * prefers when > 0. Both are written together so every reader version agrees.
 *
 * The sub-pixel float block preserves the true polyline geometry (tracking
 * works in float space); the legacy integer block is required by the format
 * but only used by very old readers.
 */

import * as path from 'path';
import { promises as fs, createWriteStream } from 'fs';
import archiver from 'archiver';
import type { PolygonPoint } from '../../types/polygon';
import { logger } from '../../utils/logger';
import { sanitizeFilename } from './exportFileOperations';
import { getLabels as getMtTypeLabels } from '../mtTypeLabelService';
import {
  colorKeyForRoi,
  imageJStrokeColor,
  imageJColorFromHex,
} from './imagejColor';

// ---------------------------------------------------------------------------
//  Low-level encoder
// ---------------------------------------------------------------------------

export type RoiGeometry = 'polyline' | 'polygon';

/** Alias of the canonical polygon point — kept for local readability. */
export type RoiPoint = PolygonPoint;

const MAGIC = 'Iout';
const VERSION = 227; // supports sub-pixel floats + header2 name; universally read
const HEADER_SIZE = 64;
const HEADER2_SIZE = 64;

// On-disk ROI type codes from ij.io.RoiEncoder / RoiDecoder — NOT the
// ij.gui.Roi runtime constants (whose POLYGON=2 / POLYLINE=6 differ). Changing
// these to the gui values would silently corrupt every exported file.
const ROI_TYPE_POLYGON = 0;
const ROI_TYPE_POLYLINE = 5;

// header field offsets used for the optional stroke width, colour + position.
const STROKE_WIDTH_OFFSET = 34;
const STROKE_COLOR_OFFSET = 40;
const POSITION_OFFSET = 56;

// options flags (RoiDecoder)
const SUB_PIXEL_RESOLUTION = 128;

// header2 field offsets (relative to the header2 block start)
const H2_NAME_OFFSET = 16;
const H2_NAME_LENGTH = 20;
const H2_FLOAT_STROKE_WIDTH = 36;

/**
 * Write the low 16 bits of ``value`` as a big-endian short. Mirrors ImageJ's
 * ``putShort`` which casts to ``(short)`` — so out-of-int16-range coordinates
 * wrap identically instead of throwing (the sub-pixel float block carries the
 * real values, making the integer wrap cosmetic).
 */
function putShort(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt16BE(value & 0xffff, offset);
}

/** Optional ImageJ header fields for slice-aware, colour-coded ROIs. */
export interface RoiEncodeOptions {
  /**
   * 1-based stack slice this ROI belongs to (ImageJ POSITION @56). Lets a
   * RoiSet.zip place each ROI on its own video frame. Omit / 0 leaves it unset.
   */
  position?: number;
  /**
   * ARGB stroke colour (alpha in the high byte, `0xFF` = opaque). ImageJ reads
   * an all-zero value as "no colour set", so pass a value with alpha. Omit to
   * leave the ROI at ImageJ's default colour.
   */
  strokeColor?: number;
  /**
   * Line thickness in pixels (the microtubule "thickness" — the same band width
   * used for intensity sampling). Written to both the int16 @34 and the header2
   * float32 fields so ImageJ draws + measures the polyline as a band of this
   * width. Omit / ≤0 / non-finite leaves both fields at 0 (ImageJ's default
   * hairline), keeping the no-thickness byte layout unchanged.
   */
  strokeWidth?: number;
}

/**
 * Encode a single polyline/polygon into an ImageJ ``.roi`` byte buffer.
 *
 * @param points   Vertices in image-pixel space (sub-pixel floats preserved).
 *                 Coordinates must be finite; callers filter beforehand.
 * @param geometry ``'polyline'`` (open, ≥2 points) or ``'polygon'`` (closed,
 *                 ≥3 points).
 * @param name     ROI name embedded in header2 (shown in RoiManager). Empty
 *                 string / undefined omits the name block.
 * @param options  Optional slice position + stroke colour (see RoiEncodeOptions).
 */
export function encodeImageJRoi(
  points: RoiPoint[],
  geometry: RoiGeometry,
  name?: string,
  options?: RoiEncodeOptions
): Buffer {
  const n = points.length;
  const minPoints = geometry === 'polygon' ? 3 : 2;
  if (n < minPoints) {
    throw new Error(
      `ImageJ ${geometry} ROI requires at least ${minPoints} points, got ${n}`
    );
  }

  // Integer bounding box from rounded coordinates (matches Roi.getBounds()).
  const xs = points.map(p => Math.round(p.x));
  const ys = points.map(p => Math.round(p.y));
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);

  const roiType =
    geometry === 'polyline' ? ROI_TYPE_POLYLINE : ROI_TYPE_POLYGON;

  // Coordinate section = int16 x[n] + int16 y[n] + float32 x[n] + float32 y[n].
  const coordBytes = n * 4 + n * 8;
  const header2Offset = HEADER_SIZE + coordBytes;

  const roiName = name ?? '';
  const nameLength = roiName.length; // UTF-16 code units, not bytes
  const nameOffset = header2Offset + HEADER2_SIZE;
  const totalSize = nameOffset + nameLength * 2;

  const buf = Buffer.alloc(totalSize); // zero-filled: unset fields stay 0

  // ---- Header (0..63) ----
  buf.write(MAGIC, 0, 'ascii');
  putShort(buf, 4, VERSION);
  buf.writeUInt8(roiType, 6);
  putShort(buf, 8, top);
  putShort(buf, 10, left);
  putShort(buf, 12, bottom);
  putShort(buf, 14, right);
  putShort(buf, 16, n);
  putShort(buf, 50, SUB_PIXEL_RESOLUTION);
  buf.writeInt32BE(header2Offset, 60);

  // Optional stroke colour (ARGB, unsigned) + 1-based slice position. Left 0
  // (already zero-filled) when the caller omits them, preserving the exact
  // byte layout the golden-file test pins for the no-options path.
  if (options?.strokeColor) {
    buf.writeUInt32BE(options.strokeColor >>> 0, STROKE_COLOR_OFFSET);
  }
  if (options?.position && options.position > 0) {
    // POSITION is an int32 slice index; truncate defensively so a fractional
    // value never reaches writeInt32BE (which would throw).
    buf.writeInt32BE(Math.trunc(options.position), POSITION_OFFSET);
  }
  // Optional stroke width (MT thickness). Written only for a finite positive
  // value so the omitted / non-positive case leaves both fields 0 (golden-file
  // safe). int16 for legacy readers, header2 float32 for modern ImageJ.
  const strokeWidth = options?.strokeWidth;
  if (
    typeof strokeWidth === 'number' &&
    Number.isFinite(strokeWidth) &&
    strokeWidth > 0
  ) {
    putShort(buf, STROKE_WIDTH_OFFSET, Math.round(strokeWidth));
    buf.writeFloatBE(strokeWidth, header2Offset + H2_FLOAT_STROKE_WIDTH);
  }

  // ---- Coordinates (64..) ----
  const intXBase = HEADER_SIZE;
  const intYBase = intXBase + n * 2;
  const floatXBase = HEADER_SIZE + n * 4;
  const floatYBase = floatXBase + n * 4;
  for (let i = 0; i < n; i++) {
    putShort(buf, intXBase + i * 2, xs[i] - left);
    putShort(buf, intYBase + i * 2, ys[i] - top);
    buf.writeFloatBE(points[i].x, floatXBase + i * 4);
    buf.writeFloatBE(points[i].y, floatYBase + i * 4);
  }

  // ---- header2 + name ----
  if (nameLength > 0) {
    buf.writeInt32BE(nameOffset, header2Offset + H2_NAME_OFFSET);
    buf.writeInt32BE(nameLength, header2Offset + H2_NAME_LENGTH);
    for (let i = 0; i < nameLength; i++) {
      buf.writeUInt16BE(roiName.charCodeAt(i), nameOffset + i * 2);
    }
  }

  return buf;
}

// ---------------------------------------------------------------------------
//  Per-frame exporter
// ---------------------------------------------------------------------------

/** Minimal shape of the Image rows the export pipeline passes in. */
export interface RoiFrameInput {
  id: string;
  name: string;
  parentVideoId?: string | null;
  frameIndex?: number | null;
  isVideoContainer?: boolean;
  segmentation?: { polygons?: string | null } | null;
}

export interface ImageJRoiExportResult {
  /** Frames that contributed at least one ROI to a zip. */
  frames: number;
  /** Total ROI entries written across all RoiSet.zip files. */
  rois: number;
  /** User-facing, non-fatal warnings (e.g. corrupt frames skipped). */
  warnings: string[];
}

interface RawPolygon {
  id?: string;
  name?: string;
  geometry?: string;
  points?: PolygonPoint[];
  instanceId?: string;
  trackId?: string | null;
  /** User-assigned microtubule type-label id (resolved to name+colour via the
   *  project palette passed to buildVideoRoiEntries). */
  mtType?: string;
}

/** Minimal palette entry the ROI builder needs: the class name (for the ROI
 *  name prefix) + the colour (for the stroke colour). */
export interface RoiTypeLabel {
  name: string;
  color: string;
}

/**
 * Parse a frame's polygons JSON, distinguishing "no polygons" from "corrupt".
 * The `corrupt` flag lets the caller surface a warning instead of silently
 * dropping a frame's microtubules (matching the COCO/JSON parse-failure path).
 */
function parseFramePolygons(json: string | null | undefined): {
  polygons: RawPolygon[];
  corrupt: boolean;
} {
  if (!json) {
    return { polygons: [], corrupt: false };
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? { polygons: parsed as RawPolygon[], corrupt: false }
      : { polygons: [], corrupt: false };
  } catch {
    return { polygons: [], corrupt: true };
  }
}

function isFinitePoint(p: unknown): p is PolygonPoint {
  return (
    typeof p === 'object' &&
    p !== null &&
    Number.isFinite((p as PolygonPoint).x) &&
    Number.isFinite((p as PolygonPoint).y)
  );
}

/**
 * Sanitised copy of a polygon's points, or `[]` if ANY point is missing/
 * non-finite — a polyline with a hole is meaningless, so the whole polygon is
 * dropped (and counted) rather than emitting a NaN-coordinate ROI ImageJ can't
 * read.
 */
function validPoints(points: PolygonPoint[] | undefined): PolygonPoint[] {
  if (!Array.isArray(points)) {
    return [];
  }
  const out: PolygonPoint[] = [];
  for (const p of points) {
    if (!isFinitePoint(p)) {
      return [];
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * Cross-frame-stable ROI label. trackId keeps the same microtubule identically
 * named across every frame (when cross-frame tracking ran); the remaining
 * fallbacks kick in for untracked polygons so a name is never empty. Uses `||`
 * (not `??`) so an empty-string trackId/name also falls through — an empty
 * label would collapse distinct microtubules to the same file.
 */
function roiLabel(p: RawPolygon, index: number): string {
  return (
    p.trackId ||
    p.name ||
    p.instanceId ||
    p.id ||
    `roi_${String(index + 1).padStart(4, '0')}`
  );
}

/**
 * Frame slice label ``frame_NNNN`` from the structured frameIndex — NOT the
 * display name, which for real MT frames is ``"<original>.nd2 (frame 1)"`` and
 * would collapse under ``path.parse``. Falls back to the sanitised id.
 */
function frameLabelFor(frame: RoiFrameInput): string {
  return typeof frame.frameIndex === 'number'
    ? `frame_${String(frame.frameIndex).padStart(4, '0')}`
    : sanitizeFilename(frame.id);
}

/**
 * Clean, human-readable label for a video's RoiSet.zip. The container row's
 * name is a real filename (no "(frame N)" suffix), so stripping the extension
 * is safe; multi-position ND2 splits already yield one container per position,
 * so the label also disambiguates them.
 */
function videoZipLabel(
  videoKey: string,
  containerNames: Map<string, string>
): string {
  if (videoKey === NO_VIDEO_KEY) return 'video';
  const name = containerNames.get(videoKey);
  if (name) return sanitizeFilename(path.parse(name).name);
  return `video_${videoKey.slice(0, 8)}`;
}

/**
 * Per-video microtubule display names following `<type>_<counter>` — a per-type
 * running counter (HeLa_1, HeLa_2, brain_1, …) assigned in first-appearance
 * order across the ordered frames and keyed on the cross-frame-stable trackId so
 * the SAME microtubule keeps ONE name on every slice. Rules per MT:
 *   1. a manual rename (`polygon.name`) wins and is used verbatim;
 *   2. otherwise `<typeName>_<n>` where n counts that type from 1;
 *   3. an untyped MT falls into the `untyped_<n>` bucket.
 * Keyless or degenerate polygons are absent (the caller falls back to roiLabel).
 */
function buildMtNameByKey(
  orderedFrames: RoiFrameInput[],
  labelById?: Map<string, RoiTypeLabel>
): Map<string, string> {
  const nameByKey = new Map<string, string>();
  const perTypeCount = new Map<string, number>();
  for (const frame of orderedFrames) {
    const parsed = parseFramePolygons(frame.segmentation?.polygons);
    if (parsed.corrupt) continue;
    for (const p of parsed.polygons) {
      const geometry = p.geometry === 'polygon' ? 'polygon' : 'polyline';
      const pts = validPoints(p.points);
      if (pts.length < (geometry === 'polyline' ? 2 : 3)) continue;
      const key = p.trackId || p.instanceId || p.id;
      if (!key || nameByKey.has(key)) continue;
      // A manual rename overrides the automatic scheme.
      const renamed = p.name?.trim();
      if (renamed) {
        nameByKey.set(key, renamed);
        continue;
      }
      const typeName = p.mtType
        ? labelById?.get(p.mtType)?.name?.trim()
        : undefined;
      const bucket = typeName || 'untyped';
      const n = (perTypeCount.get(bucket) ?? 0) + 1;
      perTypeCount.set(bucket, n);
      nameByKey.set(key, `${bucket}_${n}`);
    }
  }
  return nameByKey;
}

/** Sentinel bucket for the rare MT frame with no parentVideoId. */
const NO_VIDEO_KEY = '__novideo__';

/** A single entry in a RoiSet.zip: the on-disk name + the encoded ROI bytes. */
export interface RoiZipEntry {
  /** Entry name including the ``.roi`` extension (becomes the ROI-Manager name). */
  name: string;
  buffer: Buffer;
}

export interface VideoRoiBuild {
  entries: RoiZipEntry[];
  framesWithRois: number;
  corruptFrames: number;
  droppedPolygons: number;
}

/**
 * Build the ImageJ ``.roi`` zip entries for ONE video's frames. Pure (no IO)
 * so the exact bytes — slice position, per-track stroke colour, geometry, and
 * entry names — are unit-testable with the inline decoder.
 *
 * Frames are processed in frameIndex order. Each ROI carries ``position =
 * frameIndex + 1`` (1-based ImageJ slice) and a stroke colour derived from its
 * track (identical hue to the editor). The ROI label is the per-video
 * ``<type>_<counter>`` name (e.g. ``HeLa_1``; a manual rename overrides it, an
 * untyped MT reads ``untyped_N``), and entry names are ``<label>__frame_NNNN``
 * so the same microtubule's ROIs sort together in the ROI Manager and every
 * name is unique within the zip.
 *
 * Degradation matches the rest of the export: corrupt-JSON frames are counted
 * (surfaced as a warning by the caller), and polygons with too few / non-finite
 * points are dropped and counted.
 *
 * @param strokeWidth Optional line thickness (px) stamped as every ROI's stroke
 *                    width — the microtubule thickness, uniform across the export
 *                    (see `encodeImageJRoi`). Omit / ≤0 leaves ImageJ's default.
 */
export function buildVideoRoiEntries(
  frames: RoiFrameInput[],
  strokeWidth?: number,
  /** Project type-label palette (id → {name,color}). When a polyline carries an
   *  `mtType` present here, its class NAME is prepended to the ROI name and the
   *  label's COLOUR becomes the ROI stroke colour — so in ImageJ the ROI's name
   *  and colour both reflect its class. Untyped polylines keep the per-track
   *  hue. Omit for non-MT exports. */
  labelById?: Map<string, RoiTypeLabel>,
  /** Vicinity band width (px) for the per-MT background ROI — the full width of
   *  the region background stats are sampled from (`thickness + 2*margin`). When
   *  set and wider than the signal thickness, each polyline also gets a
   *  `<name>_bg` polyline drawn at this width, so ImageJ shows the background
   *  band around the (narrower) signal band. Omit to skip background ROIs. */
  backgroundStrokeWidth?: number
): VideoRoiBuild {
  const ordered = [...frames].sort(
    (a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0)
  );

  // Per-video `<type>_<counter>` names (rename-override), keyed on the
  // cross-frame-stable trackId so one microtubule reads identically on every
  // slice. Computed once over all frames before per-frame ROI encoding.
  const mtNameByKey = buildMtNameByKey(ordered, labelById);

  const entries: RoiZipEntry[] = [];
  let framesWithRois = 0;
  let corruptFrames = 0;
  let droppedPolygons = 0;
  const usedEntryNames = new Set<string>();

  for (const frame of ordered) {
    const parsed = parseFramePolygons(frame.segmentation?.polygons);
    if (parsed.corrupt) {
      corruptFrames++;
      continue;
    }

    const frameLabel = frameLabelFor(frame);
    const position =
      typeof frame.frameIndex === 'number' ? frame.frameIndex + 1 : undefined;

    // Normalise to concrete items, dropping degenerate geometry (polyline < 2 /
    // polygon < 3) and any polygon with non-finite coordinates. Missing geometry
    // defaults to 'polyline' — MT annotations are always open polylines.
    const items = parsed.polygons
      .map((p, index) => {
        const geometry: RoiGeometry =
          p.geometry === 'polygon' ? 'polygon' : 'polyline';
        // Resolve the assigned tubulin type label (if any). Its COLOUR drives
        // the stroke so the ROI reads as its class; its NAME feeds the
        // `<type>_<counter>` scheme via buildMtNameByKey.
        const typeLabel = p.mtType ? labelById?.get(p.mtType) : undefined;
        // ROI name: the per-video `<type>_<counter>` (or manual rename) when a
        // stable key resolved, else the legacy trackId/id label as a fallback.
        const key = p.trackId || p.instanceId || p.id;
        const label = (key && mtNameByKey.get(key)) || roiLabel(p, index);
        return {
          geometry,
          points: validPoints(p.points),
          label,
          strokeColor: typeLabel
            ? imageJColorFromHex(typeLabel.color)
            : imageJStrokeColor(colorKeyForRoi(p)),
        };
      })
      .filter(it => it.points.length >= (it.geometry === 'polyline' ? 2 : 3));

    droppedPolygons += parsed.polygons.length - items.length;
    if (items.length === 0) continue;

    // Dedup labels within the frame first (distinct MTs that sanitise to the
    // same base must not collide), then suffix the unique frame label.
    const usedInFrame = new Set<string>();
    let frameRois = 0;
    // Reserve a unique `<base>__<frameLabel>` entry name within the zip.
    const reserveEntry = (base: string): string => {
      let candidate = base;
      let dupe = 2;
      while (usedInFrame.has(candidate.toLowerCase())) {
        candidate = `${base}_${dupe++}`;
      }
      usedInFrame.add(candidate.toLowerCase());
      let stem = `${candidate}__${frameLabel}`;
      let extra = 2;
      while (usedEntryNames.has(stem.toLowerCase())) {
        stem = `${candidate}__${frameLabel}_${extra++}`;
      }
      usedEntryNames.add(stem.toLowerCase());
      return stem;
    };
    for (const { geometry, points, label, strokeColor } of items) {
      const entryStem = reserveEntry(sanitizeFilename(label));
      const buffer = encodeImageJRoi(points, geometry, label, {
        position,
        strokeColor,
        strokeWidth,
      });
      entries.push({ name: `${entryStem}.roi`, buffer });
      frameRois++;

      // Second ROI: the per-MT background band. It's the SAME polyline drawn at
      // the vicinity width (thickness + 2*margin), so ImageJ renders the
      // background band around the (narrower) signal band — the ring between
      // them is where background stats come from. Only for polylines, and only
      // when the vicinity is actually wider than the signal (margin > 0).
      if (
        geometry === 'polyline' &&
        typeof backgroundStrokeWidth === 'number' &&
        backgroundStrokeWidth > (strokeWidth ?? 0)
      ) {
        const bgLabel = `${label}_bg`;
        const bgStem = reserveEntry(sanitizeFilename(bgLabel));
        const bgBuffer = encodeImageJRoi(points, 'polyline', bgLabel, {
          position,
          strokeColor,
          strokeWidth: backgroundStrokeWidth,
        });
        entries.push({ name: `${bgStem}.roi`, buffer: bgBuffer });
        frameRois++;
      }
    }
    if (frameRois > 0) framesWithRois++;
  }

  return { entries, framesWithRois, corruptFrames, droppedPolygons };
}

/**
 * Stream a video's ROI entries into a single deflated RoiSet.zip. Kept separate
 * from `buildVideoRoiEntries` so the byte generation stays pure/testable and
 * only this thin wrapper touches the filesystem.
 */
async function writeRoiSetZip(
  zipPath: string,
  entries: RoiZipEntry[]
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    output.on('close', () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    output.on('error', fail);
    // A zip 'warning' (e.g. a stat failure) would silently truncate the archive,
    // so treat it as fatal for correctness.
    archive.on('warning', fail);
    archive.on('error', fail);
    archive.pipe(output);
    for (const entry of entries) {
      archive.append(entry.buffer, { name: entry.name });
    }
    archive.finalize().catch(fail);
  });
}

/**
 * Export one ImageJ **RoiSet.zip per video** for a microtubule project:
 *
 *   annotations/imagej/<video>_RoiSet.zip
 *
 * Biologists drag the single zip into ImageJ / Fiji; the ROI Manager loads
 * every microtubule polyline, each placed on its own stack slice (via the ROI
 * position) and coloured per track (matching the editor). Both open polylines
 * (→ ImageJ POLYLINE) and any closed polygons (→ POLYGON) are emitted; MT
 * projects are polyline-only in practice.
 *
 * Degradation: corrupt-JSON frames are skipped and reported via the returned
 * `warnings` (never silently dropped); polygons with too few / non-finite
 * points are dropped and logged. This function must NOT reject on routine bad
 * data — its caller treats a rejection as non-fatal — but a genuine
 * cancellation stays fatal.
 *
 * @param options.strokeWidth Uniform microtubule thickness (px) stamped as each
 *        ROI's stroke width, so re-opened polylines render/measure as a band of
 *        that width. Omit / ≤0 leaves ImageJ's default hairline.
 * @returns Counts + non-fatal warnings for the caller to fold into job.warnings.
 */
export async function exportImageJRoiSets(
  frameImages: RoiFrameInput[],
  exportDir: string,
  projectId: string,
  options: {
    shouldAbort?: () => boolean;
    strokeWidth?: number;
    /** Vicinity band width (px) for the per-MT background ROI
     *  (`thickness + 2*margin`). When wider than `strokeWidth`, each MT also
     *  gets a `<name>_bg` band ROI. Omit to skip background ROIs. */
    backgroundStrokeWidth?: number;
  } = {}
): Promise<ImageJRoiExportResult> {
  const baseDir = path.join(exportDir, 'annotations', 'imagej');

  // Resolve the project's microtubule type-label palette (id → {name,color}) so
  // each typed polyline's ROI carries its class name + colour. Empty for
  // untyped projects, which then keep the per-track hue.
  const labelById = new Map<string, RoiTypeLabel>();
  for (const label of await getMtTypeLabels(projectId)) {
    labelById.set(label.id, { name: label.name, color: label.color });
  }

  // Container rows (carried in the same images array) supply a clean, human
  // readable video label — build the lookup before filtering them out.
  const containerNames = new Map<string, string>();
  for (const f of frameImages) {
    if (f.isVideoContainer && f.name) {
      containerNames.set(f.id, f.name);
    }
  }

  // Segmented frames grouped by their video container (one zip each). Container
  // rows never hold polygons, so skip them.
  const byVideo = new Map<string, RoiFrameInput[]>();
  for (const f of frameImages) {
    if (f.isVideoContainer || !f.segmentation?.polygons) continue;
    const key = f.parentVideoId ?? NO_VIDEO_KEY;
    const arr = byVideo.get(key);
    if (arr) arr.push(f);
    else byVideo.set(key, [f]);
  }

  let framesWritten = 0;
  let roisWritten = 0;
  let corruptFrames = 0;
  let droppedPolygons = 0;
  let failedVideos = 0;
  const usedZipNames = new Set<string>();

  // One zip per video, written sequentially to cap concurrent write streams.
  for (const [videoKey, videoFrames] of byVideo) {
    if (options.shouldAbort?.()) {
      throw new Error('Export cancelled by user');
    }

    const build = buildVideoRoiEntries(
      videoFrames,
      options.strokeWidth,
      labelById,
      options.backgroundStrokeWidth
    );
    corruptFrames += build.corruptFrames;
    droppedPolygons += build.droppedPolygons;
    if (build.entries.length === 0) continue;

    const label = videoZipLabel(videoKey, containerNames);
    let zipName = `${label}_RoiSet.zip`;
    let dupe = 2;
    while (usedZipNames.has(zipName.toLowerCase())) {
      zipName = `${label}_RoiSet_${dupe++}.zip`;
    }
    usedZipNames.add(zipName.toLowerCase());

    const zipPath = path.join(baseDir, zipName);
    try {
      await fs.mkdir(baseDir, { recursive: true });
      await writeRoiSetZip(zipPath, build.entries);
      framesWritten += build.framesWithRois;
      roisWritten += build.entries.length;
    } catch (error) {
      // One video's zip failing must not drop the rest. Remove the partial
      // (possibly truncated) file so a corrupt zip is never shipped, record a
      // per-video warning, and continue with the remaining videos.
      failedVideos++;
      await fs.rm(zipPath, { force: true }).catch(() => {});
      logger.error(
        `ImageJ RoiSet export failed for video "${label}"`,
        error instanceof Error ? error : new Error(String(error)),
        'imagejRoiEncoder',
        { projectId, videoKey }
      );
    }
  }

  if (droppedPolygons > 0) {
    logger.warn(
      `ImageJ ROI export: dropped ${droppedPolygons} polygon(s) with too few or non-finite points`,
      'imagejRoiEncoder',
      { projectId }
    );
  }

  const warnings: string[] = [];
  if (failedVideos > 0) {
    warnings.push(
      `ImageJ ROI export: ${failedVideos} video(s) could not be packaged into a RoiSet.zip and were skipped.`
    );
  }
  if (corruptFrames > 0) {
    warnings.push(
      `ImageJ ROI export: ${corruptFrames} frame(s) had corrupt polygon data and were skipped.`
    );
  }
  if (roisWritten === 0) {
    warnings.push(
      'ImageJ ROI export: no microtubule polylines were found to export.'
    );
  }

  logger.info('ImageJ RoiSet.zip export complete', 'imagejRoiEncoder', {
    projectId,
    videos: usedZipNames.size,
    frames: framesWritten,
    rois: roisWritten,
    corruptFrames,
    droppedPolygons,
  });

  return { frames: framesWritten, rois: roisWritten, warnings };
}
