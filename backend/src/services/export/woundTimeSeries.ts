/**
 * Wound-healing time-series export.
 *
 * Invoked from ``exportService.generateMetrics`` only when the project
 * contains at least one image segmented with the wound model. The export
 * produces a per-frame wound-area-percentage measurement plus a line chart
 * embedded in the metrics workbook.
 *
 * Area convention (matches the retired VŠCHT wound-healing app):
 *     woundAreaPct = Σ(external polygon area) − Σ(internal polygon area)
 *                   ───────────────────────────────────────────────────── × 100
 *                                image width × image height
 *
 * Internal polygons (parent_id set) represent free cells inside a wound —
 * same semantics as the legacy "+/−" polygon operation.
 */

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
}

interface ImageLike extends ImageWithSegmentation {
  createdAt?: Date | string | null;
  displayOrder?: number | null;
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
): { pct: number; polygonCount: number } {
  if (!width || !height) {
    return { pct: 0, polygonCount: 0 };
  }
  let polygons: ParsedPolygon[];
  try {
    const parsed = JSON.parse(polygonsJson);
    polygons = Array.isArray(parsed) ? parsed : parsed.polygons || [];
  } catch (err) {
    logger.warn('Failed to parse wound polygons JSON', 'woundTimeSeries', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { pct: 0, polygonCount: 0 };
  }

  let externalArea = 0;
  let internalArea = 0;
  for (const poly of polygons) {
    if (!Array.isArray(poly.points) || poly.points.length < 3) {
      continue;
    }
    const area = shoelaceArea(poly.points);
    if (poly.type === 'internal' || poly.parent_id) {
      internalArea += area;
    } else {
      externalArea += area;
    }
  }

  const imageArea = width * height;
  const pct = imageArea > 0 ? ((externalArea - internalArea) / imageArea) * 100 : 0;
  return { pct: Math.max(0, pct), polygonCount: polygons.length };
}

export function shouldExportWoundTimeSeries(images: ImageLike[]): boolean {
  return images.some(img => img.segmentation?.model === 'wound');
}

export function buildWoundTimeSeries(images: ImageLike[]): WoundTimePoint[] {
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
    const { pct, polygonCount } = computeWoundAreaPct(
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
    });
    orderCounter += 1;
  }

  return points;
}

/**
 * Append a WoundTimeSeries worksheet (+ embedded chart PNG) to an existing
 * ExcelJS workbook. Does nothing if no wound images are present.
 */
export async function appendWoundTimeSeriesSheet(
  workbook: ExcelJS.Workbook,
  images: ImageLike[]
): Promise<number> {
  if (!shouldExportWoundTimeSeries(images)) {
    return 0;
  }
  const points = buildWoundTimeSeries(images);
  if (points.length === 0) {
    return 0;
  }

  const sheet = workbook.addWorksheet('WoundTimeSeries');
  sheet.columns = [
    { header: 'Order', key: 'order', width: 8 },
    { header: 'Image Name', key: 'imageName', width: 32 },
    { header: 'Wound Area (%)', key: 'woundAreaPct', width: 16 },
    { header: 'Polygons', key: 'polygonCount', width: 10 },
    { header: 'Created At (UTC)', key: 'createdAt', width: 24 },
    { header: 'Image ID', key: 'imageId', width: 38 },
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
    });
  }

  try {
    const pngBuffer = await renderWoundAreaChart(points);
    // ExcelJS's Buffer type lags behind recent @types/node which narrowed
    // Buffer to Buffer<ArrayBuffer>; node-canvas returns the runtime-identical
    // Buffer<ArrayBufferLike>. Cast keeps the types happy without copying.
    const imageId = workbook.addImage({
      buffer: pngBuffer as unknown as ExcelJS.Buffer,
      extension: 'png',
    });
    // Anchor the chart to the right of the data, starting at column H row 1.
    sheet.addImage(imageId, {
      tl: { col: 7, row: 0 },
      ext: { width: 960, height: 480 },
    });
  } catch (err) {
    logger.warn(
      'Wound area chart render failed — TimeSeries sheet written without chart',
      'woundTimeSeries',
      { error: err instanceof Error ? err.message : String(err) }
    );
  }

  return points.length;
}
