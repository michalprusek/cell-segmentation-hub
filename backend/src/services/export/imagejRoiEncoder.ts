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
 *   6    ROI type (uint8): 0 = polygon, 5 = polyline
 *   8    top / 10 left / 12 bottom / 14 right  (int16 integer bounding box)
 *   16   nCoordinates (int16)
 *   50   options (int16): SUB_PIXEL_RESOLUTION (128) is always set here
 *   56   position (int32, slice — 0 = not slice-associated)
 *   60   header2 offset (int32)
 *   64   integer x[n] (int16, relative to left), then integer y[n]
 *   64+4n  float32 x[n] (absolute), then float32 y[n]  ← authoritative geometry
 *   +HEADER2  header2 block (name offset/length live here)
 *   +name   ROI name as UTF-16BE code units
 *
 * The sub-pixel float block preserves the true polyline geometry (tracking
 * works in float space); the legacy integer block is required by the format
 * but only used by very old readers.
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import { logger } from '../../utils/logger';
import { mapWithConcurrency } from '../../utils/concurrency';
import { sanitizeFilename } from './exportFileOperations';

// ---------------------------------------------------------------------------
//  Low-level encoder
// ---------------------------------------------------------------------------

export type RoiGeometry = 'polyline' | 'polygon';

export interface RoiPoint {
  x: number;
  y: number;
}

const MAGIC = 'Iout';
const VERSION = 227; // supports sub-pixel floats + header2 name; universally read
const HEADER_SIZE = 64;
const HEADER2_SIZE = 64;

// ROI type bytes (ij.gui.Roi constants)
const ROI_TYPE_POLYGON = 0;
const ROI_TYPE_POLYLINE = 5;

// options flags (RoiDecoder)
const SUB_PIXEL_RESOLUTION = 128;

// header2 field offsets (relative to the header2 block start)
const H2_NAME_OFFSET = 16;
const H2_NAME_LENGTH = 20;

/**
 * Write the low 16 bits of ``value`` as a big-endian short. Mirrors ImageJ's
 * ``putShort`` which casts to ``(short)`` — so out-of-int16-range coordinates
 * wrap identically instead of throwing (the sub-pixel float block carries the
 * real values, making the integer wrap cosmetic).
 */
function putShort(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt16BE(value & 0xffff, offset);
}

/**
 * Encode a single polyline/polygon into an ImageJ ``.roi`` byte buffer.
 *
 * @param points   Vertices in image-pixel space (sub-pixel floats preserved).
 * @param geometry ``'polyline'`` (open) or ``'polygon'`` (closed).
 * @param name     ROI name embedded in header2 (shown in RoiManager). Empty
 *                 string / undefined omits the name block.
 * @param position 1-based stack slice to associate the ROI with, or 0/undefined
 *                 for no association (ROI shows on any slice).
 */
export function encodeImageJRoi(
  points: RoiPoint[],
  geometry: RoiGeometry,
  name?: string,
  position?: number
): Buffer {
  const n = points.length;
  if (n < 2) {
    throw new Error(`ImageJ ROI requires at least 2 points, got ${n}`);
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
  buf.writeInt32BE(position && position > 0 ? position : 0, 56);
  buf.writeInt32BE(header2Offset, 60);

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

interface RawPolygon {
  id?: string;
  name?: string;
  geometry?: string;
  points?: Array<{ x: number; y: number }>;
  instanceId?: string;
  trackId?: string | null;
}

const FRAME_WRITE_CONCURRENCY = 8;

function safeParsePolygons(json: string | null | undefined): RawPolygon[] {
  if (!json) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as RawPolygon[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Cross-frame-stable ROI label. trackId keeps the same microtubule identically
 * named across every frame (the user-requested behaviour); the remaining
 * fallbacks only kick in for untracked polygons so a name is never empty.
 */
function roiLabel(p: RawPolygon, index: number): string {
  return (
    p.trackId ??
    p.name ??
    p.instanceId ??
    p.id ??
    `roi_${String(index + 1).padStart(4, '0')}`
  );
}

/**
 * Per-frame output folder: ``<videoLabel>/frame_<NNNN>``.
 *
 * The frame's own display name is unusable as a key — real MT frames are named
 * ``"<original>.nd2 (frame 1)"``, on which ``path.parse().name`` amputates the
 * ``.nd2 (frame 1)`` "extension" and collapses every frame to one folder. So we
 * key on the structured ``(parentVideoId, frameIndex)`` instead:
 *  - videoLabel comes from the container row's name (a clean filename), which
 *    also disambiguates multi-position ND2 splits (one container per position);
 *  - frameIndex gives a guaranteed-unique numeric suffix within a video.
 *
 * @param containerNames  parentVideoId → container display name.
 */
function frameFolderName(
  frame: RoiFrameInput,
  containerNames: Map<string, string>
): string {
  const containerName = frame.parentVideoId
    ? containerNames.get(frame.parentVideoId)
    : undefined;

  let videoLabel: string;
  if (containerName) {
    // Container names are real filenames (no "(frame N)" suffix), so stripping
    // the extension here is safe and yields a readable video folder.
    videoLabel = sanitizeFilename(path.parse(containerName).name);
  } else if (frame.parentVideoId) {
    videoLabel = `video_${frame.parentVideoId.slice(0, 8)}`;
  } else {
    videoLabel = 'video';
  }

  const frameLabel =
    typeof frame.frameIndex === 'number'
      ? `frame_${String(frame.frameIndex).padStart(4, '0')}`
      : sanitizeFilename(frame.id);

  return path.join(videoLabel, frameLabel);
}

/**
 * Write ImageJ ``.roi`` files for every segmented frame of a microtubule
 * export. Output layout (loose files, grouped per frame):
 *
 *   annotations/imagej/<frameName>/<roiLabel>.roi
 *
 * Both open polylines (→ ImageJ POLYLINE) and any closed polygons (→ POLYGON)
 * are emitted; MT projects are polyline-only in practice.
 *
 * @returns Counts for logging + a human-readable warning list (currently only
 *          "nothing to export", surfaced so a silently empty folder isn't
 *          mistaken for a bug).
 */
export async function exportImageJRois(
  frameImages: RoiFrameInput[],
  exportDir: string,
  projectId: string,
  options: { shouldAbort?: () => boolean } = {}
): Promise<{ frames: number; rois: number; warnings: string[] }> {
  const baseDir = path.join(exportDir, 'annotations', 'imagej');

  // Container rows (carried in the same images array) supply a clean, human
  // readable video-folder label — build the lookup before filtering them out.
  const containerNames = new Map<string, string>();
  for (const f of frameImages) {
    if (f.isVideoContainer && f.name) {
      containerNames.set(f.id, f.name);
    }
  }

  // Frames that actually carry segmentation geometry. Video container rows
  // never hold polygons, so skip them.
  const frames = frameImages.filter(
    f => !f.isVideoContainer && !!f.segmentation?.polygons
  );

  let framesWritten = 0;
  let roisWritten = 0;

  await mapWithConcurrency(
    frames,
    FRAME_WRITE_CONCURRENCY,
    async frame => {
      // Normalise to concrete {geometry, points, label} items and drop
      // degenerate geometry (polyline < 2 pts / polygon < 3 pts).
      const items = safeParsePolygons(frame.segmentation?.polygons)
        .map((p, index) => {
          const geometry = (p.geometry ?? 'polygon') as RoiGeometry;
          const points = Array.isArray(p.points) ? p.points : [];
          return { geometry, points, label: roiLabel(p, index) };
        })
        .filter(
          it => it.points.length >= (it.geometry === 'polyline' ? 2 : 3)
        );

      if (items.length === 0) {
        return;
      }

      const frameDir = path.join(baseDir, frameFolderName(frame, containerNames));
      await fs.mkdir(frameDir, { recursive: true });

      const usedNames = new Set<string>();
      let frameRois = 0;

      await Promise.all(
        items.map(async ({ geometry, points, label }) => {
          // Ensure a unique on-disk filename within the frame folder.
          const fileBase = sanitizeFilename(label);
          let candidate = fileBase;
          let dupe = 2;
          while (usedNames.has(candidate.toLowerCase())) {
            candidate = `${fileBase}_${dupe++}`;
          }
          usedNames.add(candidate.toLowerCase());

          const buf = encodeImageJRoi(points, geometry, label);
          await fs.writeFile(path.join(frameDir, `${candidate}.roi`), buf);
          frameRois++;
        })
      );

      if (frameRois > 0) {
        framesWritten++;
        roisWritten += frameRois;
      }
    },
    {
      shouldAbort: options.shouldAbort,
      abortMessage: 'Export cancelled by user',
    }
  );

  const warnings: string[] = [];
  if (roisWritten === 0) {
    warnings.push(
      'ImageJ ROI export: no microtubule polylines were found to export.'
    );
  }

  logger.info('ImageJ ROI export complete', 'imagejRoiEncoder', {
    projectId,
    frames: framesWritten,
    rois: roisWritten,
  });

  return { frames: framesWritten, rois: roisWritten, warnings };
}
