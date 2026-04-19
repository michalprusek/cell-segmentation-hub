/**
 * Wound-healing time-series export.
 *
 * Invoked from ``exportService.generateMetrics`` only when the project
 * contains at least one image segmented with the wound model. The export
 * produces a per-frame wound-area-percentage measurement plus a line chart
 * embedded in the metrics workbook.
 *
 * Area convention (matches the retired VŠCHT wound-healing app):
 *     woundAreaPct = Σ(external polygon area) − Σ(hole area)
 *                   ──────────────────────────────────────────── × 100
 *                            image width × image height
 *
 * A polygon is treated as a hole (subtracted) only when it was tagged
 * ``type: 'internal'`` AND has a resolved ``parent_id`` pointing to a
 * surviving external polygon — requiring both prevents orphaned holes
 * (whose small parent was filtered out at < 50 px) from corrupting the
 * area calculation.
 */

import { promises as fsp } from 'fs';
import path from 'path';
import type ExcelJS from 'exceljs';
import { logger } from '../../utils/logger';
import type { ImageWithSegmentation } from '../metrics/metricsCalculator';
import { renderWoundAreaChart } from './woundChartRenderer';

export interface WoundTimePoint {
  order: number;
  imageId: string;
  imageName: string;
  woundAreaPct: number;
  polygonCount: number;
  createdAt: string | null;
  /**
   * Populated only when the row could not be computed (e.g. corrupt polygon
   * JSON, missing image dimensions). The sheet row shows this message so the
   * user can distinguish a real zero-area wound from a parsing failure.
   */
  note?: string;
}

/**
 * Minimal image shape required by the time-series computation.
 * Intentionally narrow: the full Prisma ``Image`` has many more fields, but
 * time-series only needs these. Accepting either ``Date`` or ``string`` on
 * ``createdAt`` tolerates both Prisma rows and already-serialized payloads.
 */
interface WoundSeriesImage extends ImageWithSegmentation {
  createdAt: Date | string;
  displayOrder: number | null;
}

interface ParsedPoint {
  x: number;
  y: number;
}

interface ParsedPolygon {
  id?: string;
  points: ParsedPoint[];
  type?: 'external' | 'internal';
  parent_id?: string | null;
}

function shoelaceArea(points: ParsedPoint[]): number {
  if (points.length < 3) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    sum += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(sum) / 2;
}

function computeWoundAreaPct(
  polygonsJson: string,
  width: number | undefined,
  height: number | undefined
): { pct: number; polygonCount: number; note?: string } {
  if (!width || !height) {
    return {
      pct: 0,
      polygonCount: 0,
      note: 'missing image dimensions',
    };
  }
  let polygons: ParsedPolygon[];
  try {
    const parsed = JSON.parse(polygonsJson);
    polygons = Array.isArray(parsed) ? parsed : parsed.polygons || [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to parse wound polygons JSON', 'woundTimeSeries', {
      error: message,
    });
    return {
      pct: 0,
      polygonCount: 0,
      note: `polygon JSON parse failed: ${message}`,
    };
  }

  let externalArea = 0;
  let internalArea = 0;
  for (const poly of polygons) {
    if (!Array.isArray(poly.points) || poly.points.length < 3) {
      continue;
    }
    const area = shoelaceArea(poly.points);
    // A polygon is a hole only if both conditions hold: the ML pipeline
    // tagged it as ``internal`` AND we resolved a concrete ``parent_id``.
    // Requiring both prevents orphaned children (whose small parent was
    // filtered out post-segmentation) from being subtracted from the
    // wrong wound — which would produce negative raw area clamped to 0.
    const isHole =
      poly.type === 'internal' &&
      typeof poly.parent_id === 'string' &&
      poly.parent_id.length > 0;
    if (isHole) {
      internalArea += area;
    } else {
      externalArea += area;
    }
  }

  const imageArea = width * height;
  const pct =
    imageArea > 0 ? ((externalArea - internalArea) / imageArea) * 100 : 0;
  return { pct: Math.max(0, pct), polygonCount: polygons.length };
}

export function shouldExportWoundTimeSeries(images: WoundSeriesImage[]): boolean {
  return images.some(img => img.segmentation?.model === 'wound');
}

export function buildWoundTimeSeries(images: WoundSeriesImage[]): WoundTimePoint[] {
  const sorted = [...images].sort((a, b) => {
    const aOrder = a.displayOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.displayOrder ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return aTime - bTime;
  });

  const points: WoundTimePoint[] = [];
  let orderCounter = 0;

  for (const img of sorted) {
    if (img.segmentation?.model !== 'wound') {
      continue;
    }
    const { pct, polygonCount, note } = computeWoundAreaPct(
      img.segmentation.polygons,
      img.width,
      img.height
    );
    points.push({
      order: orderCounter,
      imageId: img.id,
      imageName: img.name,
      woundAreaPct: parseFloat(pct.toFixed(3)),
      polygonCount,
      createdAt: img.createdAt ? new Date(img.createdAt).toISOString() : null,
      ...(note ? { note } : {}),
    });
    orderCounter += 1;
  }

  return points;
}

/**
 * Outcome of appending the WoundTimeSeries sheet to a workbook.
 * ``chartPng`` is null when the chart could not be rendered; in that case
 * ``chartError`` carries the human-readable reason so the caller can surface
 * it to the user. Callers commonly persist the PNG alongside the workbook —
 * see ``writeStandaloneWoundChart`` for the companion helper.
 */
export interface WoundTimeSeriesResult {
  count: number;
  chartPng: Buffer | null;
  chartError?: string;
}

/**
 * Append a WoundTimeSeries worksheet (+ embedded chart PNG) to an existing
 * ExcelJS workbook. Does nothing if no wound images are present.
 */
export async function appendWoundTimeSeriesSheet(
  workbook: ExcelJS.Workbook,
  images: WoundSeriesImage[]
): Promise<WoundTimeSeriesResult> {
  if (!shouldExportWoundTimeSeries(images)) {
    return { count: 0, chartPng: null };
  }
  const points = buildWoundTimeSeries(images);
  if (points.length === 0) {
    return { count: 0, chartPng: null };
  }

  const sheet = workbook.addWorksheet('WoundTimeSeries');
  sheet.columns = [
    { header: 'Order', key: 'order', width: 8 },
    { header: 'Image Name', key: 'imageName', width: 32 },
    { header: 'Wound Area (%)', key: 'woundAreaPct', width: 16 },
    { header: 'Polygons', key: 'polygonCount', width: 10 },
    { header: 'Created At (UTC)', key: 'createdAt', width: 24 },
    { header: 'Image ID', key: 'imageId', width: 38 },
    { header: 'Note', key: 'note', width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const p of points) {
    sheet.addRow({
      order: p.order,
      imageName: p.imageName,
      woundAreaPct: p.woundAreaPct,
      polygonCount: p.polygonCount,
      createdAt: p.createdAt,
      imageId: p.imageId,
      note: p.note ?? '',
    });
  }

  let chartPng: Buffer | null = null;
  let chartError: string | undefined;

  // Step 1: render the chart. On failure the sheet still gets its data rows
  // (they're already written above) — only the chart image is lost.
  try {
    chartPng = await renderWoundAreaChart(points);
  } catch (err) {
    chartError = err instanceof Error ? err.message : String(err);
    logger.warn(
      'Wound area chart render failed — TimeSeries sheet written without chart',
      'woundTimeSeries',
      { error: chartError }
    );
  }

  // Step 2: best-effort embed the chart into the sheet. A failure here
  // (e.g. ExcelJS rejects the buffer) must not invalidate ``chartPng`` —
  // the caller still wants to write it to disk as a standalone artifact.
  if (chartPng) {
    try {
      // ExcelJS's Buffer type lags behind recent @types/node which narrowed
      // Buffer to Buffer<ArrayBuffer>; node-canvas returns the runtime-
      // identical Buffer<ArrayBufferLike>. Cast keeps the types happy
      // without copying.
      const imageId = workbook.addImage({
        buffer: chartPng as unknown as ExcelJS.Buffer,
        extension: 'png',
      });
      // Anchor the chart to the right of the data, starting at column H row 1.
      sheet.addImage(imageId, {
        tl: { col: 7, row: 0 },
        ext: { width: 960, height: 480 },
      });
    } catch (err) {
      logger.warn(
        'Wound chart rendered but could not be embedded in workbook — standalone PNG still usable',
        'woundTimeSeries',
        { error: err instanceof Error ? err.message : String(err) }
      );
    }
  }

  return chartError !== undefined
    ? { count: points.length, chartPng, chartError }
    : { count: points.length, chartPng };
}

/**
 * Writes the rendered wound-area chart as a standalone PNG to
 * ``<exportDir>/wound_healing/wound_area_chart.png``.
 *
 * Extracted as its own function so the ``mkdir`` + ``writeFile`` logic is
 * unit-testable via ``fs.mkdtemp`` without spinning up the full export
 * service. Returns the resulting file path on success, or throws the
 * original filesystem error (caller wraps into a job warning).
 */
export async function writeStandaloneWoundChart(
  exportDir: string,
  chartPng: Buffer
): Promise<string> {
  const woundDir = path.join(exportDir, 'wound_healing');
  await fsp.mkdir(woundDir, { recursive: true });
  const chartPath = path.join(woundDir, 'wound_area_chart.png');
  await fsp.writeFile(chartPath, chartPng);
  return chartPath;
}
