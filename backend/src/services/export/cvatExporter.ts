/**
 * CVAT-for-images 1.1 annotation export for microtubule projects.
 *
 * Emits one `annotations/cvat/<video>.xml` per video container. Each microtubule
 * polyline becomes a `<polyline label="…" points="x,y;…">`; the label is the
 * assigned tubulin **type class** (resolved from the project's mtTypeLabels
 * palette), or `microtubule` when untyped. The cross-frame `track_id` is carried
 * as a polyline attribute so CVAT users can regroup a microtubule over frames.
 *
 * CVAT is the natural annotation-tool format for per-instance polyline tracks
 * with class labels (COCO/YOLO express class only as a flat category and are not
 * emitted for MT projects). The pure `buildCvatXml` builder is unit-tested; the
 * thin `exportCvatAnnotations` wrapper does the palette fetch + file IO.
 */
import * as path from 'path';
import { promises as fs } from 'fs';
import { logger } from '../../utils/logger';
import { sanitizeFilename } from './exportFileOperations';
import { getLabels as getMtTypeLabels } from '../mtTypeLabelService';

/** Class name used for microtubules with no assigned type label. */
export const DEFAULT_CVAT_LABEL = 'microtubule';
/** Colour for the default (untyped) label + any label missing a palette colour. */
const DEFAULT_LABEL_COLOR = '#999999';

export interface CvatFrameInput {
  id: string;
  name: string;
  width?: number | null;
  height?: number | null;
  parentVideoId?: string | null;
  frameIndex?: number | null;
  isVideoContainer?: boolean;
  segmentation?: { polygons?: string | null } | null;
}

/** Minimal palette entry: class name + colour. */
export interface CvatTypeLabel {
  name: string;
  color: string;
}

export interface CvatVideoBuild {
  xml: string;
  images: number;
  polylines: number;
}

interface RawPolygon {
  geometry?: string;
  points?: Array<{ x: number; y: number }>;
  trackId?: string | null;
  instanceId?: string | null;
  mtType?: string;
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      default:
        return '&quot;';
    }
  });
}

/** Lenient parse of a frame's polygons JSON to an array (empty on null/corrupt). */
function parseFramePolygons(json: string | null | undefined): RawPolygon[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as RawPolygon[]) : [];
  } catch {
    return [];
  }
}

function isFinitePoint(p: unknown): p is { x: number; y: number } {
  return (
    typeof p === 'object' &&
    p !== null &&
    Number.isFinite((p as { x: number }).x) &&
    Number.isFinite((p as { y: number }).y)
  );
}

/** Format a point list as CVAT's `x1,y1;x2,y2` (6 dp, trailing zeros trimmed). */
function formatPoints(points: Array<{ x: number; y: number }>): string {
  const fmt = (n: number) =>
    Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/\.?0+$/, '');
  return points.map(p => `${fmt(p.x)},${fmt(p.y)}`).join(';');
}

/**
 * Build the CVAT-for-images 1.1 XML for ONE video's frames. Pure (no IO), so the
 * exact document is unit-testable. Resolves each polyline's `mtType` id to a
 * class name via `labelById` (default `microtubule` when untyped/unknown), and
 * declares every used label in `<meta>` so the XML imports cleanly into CVAT.
 */
export function buildCvatXml(
  frames: CvatFrameInput[],
  taskName: string,
  labelById: Map<string, CvatTypeLabel>
): CvatVideoBuild {
  const ordered = [...frames].sort(
    (a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0)
  );

  // Resolve a polyline's class name + remember the colour for the label meta.
  const usedLabelColors = new Map<string, string>();
  const resolveLabel = (mtType: string | undefined): string => {
    const entry = mtType ? labelById.get(mtType) : undefined;
    const name = entry?.name ?? DEFAULT_CVAT_LABEL;
    if (!usedLabelColors.has(name)) {
      usedLabelColors.set(name, entry?.color ?? DEFAULT_LABEL_COLOR);
    }
    return name;
  };

  const imageBlocks: string[] = [];
  let images = 0;
  let polylines = 0;

  for (const frame of ordered) {
    if (frame.isVideoContainer) continue;
    const parsed = parseFramePolygons(frame.segmentation?.polygons);
    const polys = parsed
      .filter(p => (p.geometry ?? 'polyline') === 'polyline')
      .map(p => ({
        label: resolveLabel(p.mtType),
        points: Array.isArray(p.points) ? p.points.filter(isFinitePoint) : [],
        trackId: p.trackId ?? null,
      }))
      .filter(p => p.points.length >= 2);
    if (polys.length === 0) continue;

    const frameId =
      typeof frame.frameIndex === 'number' ? frame.frameIndex : images;
    const frameName =
      typeof frame.frameIndex === 'number'
        ? `frame_${String(frame.frameIndex).padStart(4, '0')}`
        : sanitizeFilename(frame.id);
    const width = frame.width ?? 0;
    const height = frame.height ?? 0;

    const polylineLines = polys.map(p => {
      const attr = p.trackId
        ? `\n        <attribute name="track_id">${xmlEscape(String(p.trackId))}</attribute>\n      `
        : '';
      polylines++;
      return `      <polyline label="${xmlEscape(p.label)}" source="manual" occluded="0" points="${formatPoints(p.points)}" z_order="0">${attr}</polyline>`;
    });

    imageBlocks.push(
      `  <image id="${frameId}" name="${xmlEscape(frameName)}" width="${width}" height="${height}">\n${polylineLines.join('\n')}\n  </image>`
    );
    images++;
  }

  // Declare every used label (name + colour + polyline type + track_id attr).
  const labelMeta = [...usedLabelColors.entries()]
    .map(
      ([name, color]) =>
        `        <label>\n          <name>${xmlEscape(name)}</name>\n          <color>${xmlEscape(color)}</color>\n          <type>polyline</type>\n          <attributes>\n            <attribute>\n              <name>track_id</name>\n              <input_type>text</input_type>\n              <mutable>false</mutable>\n              <default_value></default_value>\n              <values></values>\n            </attribute>\n          </attributes>\n        </label>`
    )
    .join('\n');

  const xml =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<annotations>\n` +
    `  <version>1.1</version>\n` +
    `  <meta>\n` +
    `    <task>\n` +
    `      <name>${xmlEscape(taskName)}</name>\n` +
    `      <labels>\n${labelMeta}\n      </labels>\n` +
    `    </task>\n` +
    `  </meta>\n` +
    `${imageBlocks.join('\n')}\n` +
    `</annotations>\n`;

  return { xml, images, polylines };
}

export interface CvatExportResult {
  /** Number of `.xml` files written (one per video with ≥1 polyline). */
  files: number;
  /** Total polylines written across all files. */
  polylines: number;
  warnings: string[];
}

const NO_VIDEO_KEY = '__novideo__';

/**
 * Write one CVAT-for-images 1.1 XML per video container under
 * `annotations/cvat/`. Never rejects on routine bad data (returns warnings) —
 * only a genuine cancellation is fatal, matching the ImageJ exporter's contract.
 */
export async function exportCvatAnnotations(
  frameImages: CvatFrameInput[],
  exportDir: string,
  projectId: string,
  options: { shouldAbort?: () => boolean } = {}
): Promise<CvatExportResult> {
  const baseDir = path.join(exportDir, 'annotations', 'cvat');
  const warnings: string[] = [];

  const labelById = new Map<string, CvatTypeLabel>();
  for (const label of await getMtTypeLabels(projectId)) {
    labelById.set(label.id, { name: label.name, color: label.color });
  }

  const containerNames = new Map<string, string>();
  for (const f of frameImages) {
    if (f.isVideoContainer && f.name) containerNames.set(f.id, f.name);
  }

  const byVideo = new Map<string, CvatFrameInput[]>();
  for (const f of frameImages) {
    if (f.isVideoContainer || !f.segmentation?.polygons) continue;
    const key = f.parentVideoId ?? NO_VIDEO_KEY;
    const arr = byVideo.get(key);
    if (arr) arr.push(f);
    else byVideo.set(key, [f]);
  }

  let files = 0;
  let polylines = 0;
  const usedNames = new Set<string>();

  for (const [videoKey, videoFrames] of byVideo) {
    if (options.shouldAbort?.()) {
      throw new Error('Export cancelled by user');
    }
    const rawName = containerNames.get(videoKey);
    const label = rawName
      ? sanitizeFilename(path.parse(rawName).name)
      : videoKey === NO_VIDEO_KEY
        ? 'video'
        : `video_${videoKey.slice(0, 8)}`;

    const build = buildCvatXml(videoFrames, label, labelById);
    if (build.polylines === 0) continue;

    let fileName = `${label}.xml`;
    let extra = 2;
    while (usedNames.has(fileName.toLowerCase())) {
      fileName = `${label}_${extra++}.xml`;
    }
    usedNames.add(fileName.toLowerCase());

    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, fileName), build.xml, 'utf-8');
    files++;
    polylines += build.polylines;
  }

  logger.info('CVAT export complete', 'cvatExporter', {
    projectId,
    files,
    polylines,
  });
  return { files, polylines, warnings };
}
