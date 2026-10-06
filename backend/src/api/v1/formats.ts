import archiver from 'archiver';
import { encodeImageJRoi } from '../../services/export/imagejRoiEncoder';
import { encodePng16, encodeTiff16 } from './imageEncoders';
import type { OutputFormat, V1Model } from './models';
import { ringArea, type Point, type V1Object, type V1Warning } from './objects';
import { rasterizeLabels } from './raster';

/**
 * Everything a format needs to render one segmented image. Formats are pure:
 * the same result can be rendered into any of them, any number of times.
 */
export interface SegmentationResult {
  model: string;
  modelInfo: V1Model;
  image: {
    /** Basename of the upload, already sanitised. */
    filename: string;
    width: number;
    height: number;
    page: number;
    page_count: number;
  };
  parameters: Record<string, unknown>;
  objects: V1Object[];
  metrics?: Record<string, unknown>;
  warnings: V1Warning[];
  timing: { inference_ms: number };
}

export interface RenderedOutput {
  contentType: string;
  /** Suggested download name; `null` for the inline JSON representation. */
  filename: string | null;
  body: Buffer;
}

const stem = (filename: string): string =>
  filename.replace(/\.[^.]*$/, '') || 'image';

/**
 * The category an object is filed under in class-indexed formats: the part
 * for models whose objects are parts of an instance (sperm), else the class.
 */
export function categoriesFor(model: V1Model): readonly string[] {
  return model.parts ?? model.classes;
}

const categoryOf = (object: V1Object): string => object.part ?? object.class;

function zip(entries: Array<{ name: string; data: Buffer | string }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('warning', reject);
    archive.on('error', reject);
    for (const entry of entries) {
      // A fixed date: the same result must zip to the same bytes.
      archive.append(entry.data, { name: entry.name, date: new Date(0) });
    }
    void archive.finalize();
  });
}

// --- json -------------------------------------------------------------------

export function toJson(result: SegmentationResult): Record<string, unknown> {
  return {
    model: result.model,
    image: {
      width: result.image.width,
      height: result.image.height,
      page: result.image.page,
      page_count: result.image.page_count,
    },
    parameters: result.parameters,
    objects: result.objects,
    ...(result.metrics ? { metrics: result.metrics } : {}),
    warnings: result.warnings,
    timing: result.timing,
  };
}

// --- coco -------------------------------------------------------------------

const flat = (ring: Point[]): number[] => ring.flatMap(([x, y]) => [x, y]);

const bboxOf = (points: Point[]): [number, number, number, number] => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) {
      minX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  return [minX, minY, maxX - minX, maxY - minY];
};

/** Uncompressed COCO RLE: column-major runs, starting with a run of zeros. */
export function rleOf(
  mask: Uint16Array,
  label: number,
  width: number,
  height: number
): { size: [number, number]; counts: number[]; area: number } {
  const counts: number[] = [];
  let current = 0;
  let run = 0;
  let area = 0;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const bit = mask[y * width + x] === label ? 1 : 0;
      area += bit;
      if (bit === current) {
        run++;
      } else {
        counts.push(run);
        current = bit;
        run = 1;
      }
    }
  }
  counts.push(run);
  return { size: [height, width], counts, area };
}

/**
 * COCO instance annotations.
 *
 * A polygon WITHOUT holes is a standard polygon segmentation, `iscrowd: 0`.
 * COCO's polygon form cannot express a hole, so a polygon WITH holes is
 * written as uncompressed RLE, which requires `iscrowd: 1` — the same
 * convention the app's project export and CVAT use. An open POLYLINE has no
 * COCO representation at all; it is written as one coordinate list with
 * `area: 0` and `attributes.geometry: "polyline"`, an extension a COCO
 * consumer must opt in to.
 */
export function toCoco(result: SegmentationResult): Record<string, unknown> {
  const { width, height, filename } = result.image;
  const names = categoriesFor(result.modelInfo);
  const categories = names.map((name, index) => ({
    id: index + 1,
    name,
    supercategory: result.modelInfo.classes[0],
  }));

  const annotations = result.objects.map(object => {
    const base = {
      id: object.label,
      image_id: 1,
      category_id: names.indexOf(categoryOf(object)) + 1,
      bbox: bboxOf(object.points),
      attributes: {
        geometry: object.geometry,
        class: object.class,
        ...(object.part ? { part: object.part } : {}),
        ...(object.instance ? { instance: object.instance } : {}),
        ...(object.confidence !== undefined ? { confidence: object.confidence } : {}),
      },
    };
    if (object.geometry === 'polyline') {
      return { ...base, segmentation: [flat(object.points)], area: 0, iscrowd: 0 };
    }
    if (!object.holes?.length) {
      return {
        ...base,
        segmentation: [flat(object.points)],
        area: ringArea(object.points),
        iscrowd: 0,
      };
    }
    // Rasterised alone, so that an overlapping neighbour cannot eat into it.
    const mask = rasterizeLabels([{ ...object, label: 1 }], width, height);
    const { area, ...rle } = rleOf(mask, 1, width, height);
    return { ...base, segmentation: rle, area, iscrowd: 1 };
  });

  return {
    info: {
      description: `SpheroSeg segmentation (${result.model})`,
      version: '1.0',
    },
    images: [{ id: 1, file_name: filename, width, height }],
    categories,
    annotations,
  };
}

// --- label masks ------------------------------------------------------------

export const MAX_MASK_LABEL = 0xffff;

// --- yolo -------------------------------------------------------------------

const unit = (value: number, size: number): string =>
  Math.min(1, Math.max(0, value / size)).toFixed(6);

/** One `class x1 y1 x2 y2 ...` line per polygon, coordinates in [0, 1]. */
export function toYoloLabels(result: SegmentationResult): string {
  const { width, height } = result.image;
  const names = categoriesFor(result.modelInfo);
  return result.objects
    .filter(object => object.geometry === 'polygon')
    .map(object =>
      [
        names.indexOf(categoryOf(object)),
        ...object.points.flatMap(([x, y]) => [unit(x, width), unit(y, height)]),
      ].join(' ')
    )
    .map(line => `${line}\n`)
    .join('');
}

// --- imagej -----------------------------------------------------------------

const roiPoints = (ring: Point[]): Array<{ x: number; y: number }> =>
  ring.map(([x, y]) => ({ x, y }));

export function toRoiEntries(
  result: SegmentationResult
): Array<{ name: string; data: Buffer }> {
  const digits = Math.max(4, String(result.objects.length).length);
  const entries: Array<{ name: string; data: Buffer }> = [];
  for (const object of result.objects) {
    const base = `${String(object.label).padStart(digits, '0')}-${categoryOf(object)}`;
    entries.push({
      name: `${base}.roi`,
      data: encodeImageJRoi(roiPoints(object.points), object.geometry, base),
    });
    // The encoder has no composite ROI, so a hole is its own polygon. In
    // ImageJ: select the object and its holes and use Edit > Selection > XOR.
    (object.holes ?? []).forEach((hole, index) => {
      const name = `${base}-hole${index + 1}`;
      entries.push({
        name: `${name}.roi`,
        data: encodeImageJRoi(roiPoints(hole), 'polygon', name),
      });
    });
  }
  return entries;
}

// --- dispatch ---------------------------------------------------------------

export class FormatNotRepresentableError extends Error {}

export async function render(
  result: SegmentationResult,
  format: OutputFormat
): Promise<RenderedOutput> {
  const name = stem(result.image.filename);
  switch (format) {
    case 'json':
      return {
        contentType: 'application/json',
        filename: null,
        body: Buffer.from(JSON.stringify(toJson(result))),
      };
    case 'coco':
      return {
        contentType: 'application/json',
        filename: `${name}.coco.json`,
        body: Buffer.from(JSON.stringify(toCoco(result))),
      };
    case 'mask_png':
    case 'mask_tiff': {
      if (result.objects.length > MAX_MASK_LABEL) {
        throw new FormatNotRepresentableError(
          `A 16-bit label image holds at most ${MAX_MASK_LABEL} objects; this result has ${result.objects.length}.`
        );
      }
      const { width, height } = result.image;
      const labels = rasterizeLabels(result.objects, width, height);
      return format === 'mask_png'
        ? {
            contentType: 'image/png',
            filename: `${name}.labels.png`,
            body: encodePng16(labels, width, height),
          }
        : {
            contentType: 'image/tiff',
            filename: `${name}.labels.tif`,
            body: encodeTiff16(labels, width, height),
          };
    }
    case 'imagej_roi':
      return {
        contentType: 'application/zip',
        filename: `${name}.RoiSet.zip`,
        body: await zip(toRoiEntries(result)),
      };
    case 'yolo':
      return {
        contentType: 'application/zip',
        filename: `${name}.yolo.zip`,
        body: await zip([
          { name: `labels/${name}.txt`, data: toYoloLabels(result) },
          {
            name: 'classes.txt',
            data: categoriesFor(result.modelInfo).map(c => `${c}\n`).join(''),
          },
        ]),
      };
  }
}
