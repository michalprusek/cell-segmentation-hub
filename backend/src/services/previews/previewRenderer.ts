import sharp from 'sharp';
import { createCanvas, createImageData } from 'canvas';
import { SHARP_INPUT_LIMITS } from '../../constants/imageLimits';
import {
  resolvePolygonColor,
  type Polygon,
} from '../visualization/visualizationGenerator';

/**
 * Longest side of a preview, in pixels. The grid card is ~250 CSS px wide, so
 * 512 is sharp on a 2x display; a larger source is never enlarged.
 */
export const PREVIEW_MAX_SIDE = 512;

/** Same red/blue the grid thumbnails have always used. */
const PREVIEW_POLYGON_COLORS = { external: '#FF0000', internal: '#0000FF' };

/** Widths in PREVIEW pixels: constant whatever the source resolution. */
const POLYGON_STROKE_PX = 1.5;
const POLYLINE_STROKE_PX = 2;
const POLYLINE_END_RADIUS_PX = 2;
const POLYGON_FILL_ALPHA = 0.3;
const JPEG_QUALITY = 0.82;

export interface PreviewSource {
  /** Absolute path of a file sharp can decode. */
  path: string;
  /** Width of the coordinate frame the polygons are stored in. Normally the
   *  decoded width of `path`; differs only when `path` is a stand-in (a BMP's
   *  upload thumbnail), whose pixels are smaller than the polygons' frame. */
  frameWidth?: number;
}

/**
 * Draw one preview: the image, scaled to fit PREVIEW_MAX_SIDE, with its
 * polygons over it. Returns JPEG bytes.
 *
 * Two deliberate departures from the generator this replaces
 * (`generateVisualization` at full resolution, then a 300x300 `cover` crop):
 *
 *  - It scales FIRST and draws the overlay in preview space. Measured on
 *    production images: a 4080x3072 JPEG went from 1 851 ms to 30 ms, and a
 *    1800x1764 16-bit frame with 311 polylines from 700 ms to 75 ms. Drawing
 *    in preview space also makes a line 1.5 preview pixels whatever the
 *    source size — a 2 px line at 4080 px, shrunk to 300, was 0.15 px.
 *  - It keeps the aspect ratio. The card crops with `object-cover` already;
 *    a square `cover` crop on top of that cut a 4:3 image twice.
 *
 * A high-bit-depth source is stretched over its own min..max, the window the
 * editor opens it with (ImageJ's default for a 16-bit image). Unstretched, a
 * real IRM frame (9 103..22 669 of 65 535) rendered as a flat grey square.
 * The stretch is scaled to 0..65535 because sharp's `grey16 -> b-w`
 * conversion divides by 256: a stretch to 0..255 came out black.
 */
export async function renderPreview(
  source: PreviewSource,
  polygons: Polygon[]
): Promise<Buffer> {
  const meta = await sharp(source.path, SHARP_INPUT_LIMITS).metadata();
  const sourceWidth = meta.width ?? 0;
  if (!sourceWidth || !meta.height) {
    throw new Error(`Preview source has no dimensions: ${source.path}`);
  }

  let pipeline = sharp(source.path, SHARP_INPUT_LIMITS);
  if (meta.depth && meta.depth !== 'uchar' && meta.depth !== 'char') {
    const stats = await sharp(source.path, SHARP_INPUT_LIMITS).stats();
    const colour = stats.channels.slice(0, Math.min(3, stats.channels.length));
    const lo = Math.min(...colour.map(c => c.min));
    const hi = Math.max(...colour.map(c => c.max));
    const gain = hi > lo ? 65535 / (hi - lo) : 0;
    pipeline = pipeline.linear(gain, -lo * gain);
  }

  const { data, info } = await pipeline
    .resize(PREVIEW_MAX_SIDE, PREVIEW_MAX_SIDE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#000000' })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const canvas = createCanvas(info.width, info.height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(
    createImageData(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
      info.width,
      info.height
    ),
    0,
    0
  );

  const scale = info.width / (source.frameWidth ?? sourceWidth);
  drawPreviewOverlay(ctx, polygons, scale);

  return canvas.toBuffer('image/jpeg', { quality: JPEG_QUALITY });
}

type Ctx = ReturnType<ReturnType<typeof createCanvas>['getContext']>;

function finitePoints(polygon: Polygon): Array<{ x: number; y: number }> {
  return (polygon.points ?? []).filter(
    p => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  );
}

/** Exported for tests. Draws in source coordinates through `scale`. */
export function drawPreviewOverlay(
  ctx: Ctx,
  polygons: Polygon[],
  scale: number
): void {
  ctx.resetTransform();
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const polygon of polygons) {
    const isPolyline = polygon.geometry === 'polyline';
    const points = finitePoints(polygon);
    if (points.length < (isPolyline ? 2 : 3)) {
      continue;
    }
    const color = resolvePolygonColor(polygon, PREVIEW_POLYGON_COLORS);

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = color;

    if (isPolyline) {
      ctx.lineWidth = POLYLINE_STROKE_PX / scale;
      ctx.stroke();
      ctx.fillStyle = color;
      for (const end of [points[0], points[points.length - 1]]) {
        ctx.beginPath();
        ctx.arc(end.x, end.y, POLYLINE_END_RADIUS_PX / scale, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = POLYGON_FILL_ALPHA;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = POLYGON_STROKE_PX / scale;
      ctx.stroke();
    }
  }

  ctx.resetTransform();
}
