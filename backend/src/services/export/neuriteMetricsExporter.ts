/**
 * Per-cell neuron biology for `neurite` projects: one sheet of neurites, one of
 * somas, and a developmental stage for every neuronal soma.
 *
 * The maths lives in the ML service (`POST /api/v1/neurite-metrics`, backed by
 * the vendored research pipeline). This module is the Node half: pull the
 * user's polygons out of each segmentation, ask the ML service for the tables,
 * and write them.
 *
 * TWO THINGS THE SHEETS DO NOT SAY OUT LOUD, and both change how a number reads
 * ------------------------------------------------------------------------------
 * 1. A neurite bridging two cells appears TWICE — once per soma, each holding
 *    HALF the length, both carrying the same `connection_id`. Counting rows is
 *    therefore not counting neurites, and `connection_id` is numbered from 1
 *    WITHIN EACH FRAME, so pair on `(frame, connection_id)` and never on the id
 *    alone.
 * 2. Somas the classifier rejected are kept with `soma_neuronal = 0` rather
 *    than deleted, so the rejection rate stays auditable. They are not cells
 *    and their rows are not measurements of cells — filter before averaging.
 *
 * Both are stated on the README sheet as well, because a spreadsheet outlives
 * every comment in this repository.
 */

import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';

import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import type { Semaphore } from '../../utils/concurrency';

/** One row of the neurite sheet, as the ML service returns it. */
export interface NeuriteRow {
  frame: string;
  soma_id: number;
  neurite_id: string;
  [column: string]: unknown;
}

/** One row of the soma sheet. */
export interface SomaRow {
  frame: string;
  soma_id: number;
  [column: string]: unknown;
}

export interface NeuriteMetricsOptions {
  /** Output formats. Excel gets both sheets plus a README sheet. */
  formats: ReadonlyArray<'excel' | 'csv' | 'json'>;
  /**
   * Run the soma classifier. Default true, and turning it off is a change to
   * the biology rather than the runtime: 47 % of expert `soma` polygons are not
   * neuronal cell bodies, and 76 % of detected connections lose an endpoint
   * once the classifier is applied.
   */
  classify?: boolean;
}

export interface NeuriteImageInput {
  id: string;
  name?: string | null;
  width?: number | null;
  height?: number | null;
  /** Isotropic XY pixel size. Without it a frame cannot be measured at all. */
  pixelSizeUm?: number | null;
  /**
   * `Image.originalPath`, stored RELATIVE to `UPLOAD_DIR`. Resolved against it
   * here so the ML container gets a path it can open directly — the same
   * convention `mtMetricsExporter` follows. Passing an already-absolute path
   * would land outside the storage root and be refused by the endpoint.
   */
  originalPath?: string | null;
  segmentation?: { polygons?: string | null } | null;
}

interface PolygonLike {
  id?: string;
  points?: Array<{ x: number; y: number }>;
  holes?: Array<Array<{ x: number; y: number }>>;
  partClass?: string;
  class?: string;
}

interface MLPolygon {
  polygon_id: string;
  points: number[][];
  holes?: number[][][];
}

interface MLResponse {
  neurites: NeuriteRow[];
  somas: SomaRow[];
  qc: Record<string, unknown>;
  soma_polygon_ids: Record<string, string>;
}

/** Frames skipped, with the reason, so the caller can surface it. */
export interface NeuriteMetricsResult {
  neurites: NeuriteRow[];
  somas: SomaRow[];
  skipped: Array<{ image: string; reason: string }>;
  /** Per-frame quality counters, keyed by frame name. */
  qc: Record<string, Record<string, unknown>>;
}

/**
 * Which polygons are neurites and which are somas.
 *
 * Reads `partClass` FIRST and `class` only as a fallback. That order is not
 * arbitrary: `class` is stripped on some paths and was invisible to the editor
 * until 2026-09-04, whereas `partClass` is on the `OPTIONAL_POLYGON_FIELDS`
 * whitelist and is what the neurite/soma wrapper writes precisely because of
 * that. A polygon carrying neither is not a modelling result and is ignored.
 */
function classOf(poly: PolygonLike): string | null {
  const value = poly.partClass ?? poly.class;
  return value === 'neurite' || value === 'soma' ? value : null;
}

function toMLPolygon(poly: PolygonLike, index: number): MLPolygon | null {
  const points = poly.points;
  if (!Array.isArray(points) || points.length < 3) {
    return null;
  }
  return {
    polygon_id: poly.id ?? `poly_${index}`,
    points: points.map(p => [p.x, p.y]),
    ...(poly.holes?.length
      ? { holes: poly.holes.map(h => h.map(p => [p.x, p.y])) }
      : {}),
  };
}

/**
 * Ask the ML service for one frame's tables.
 *
 * Returns null and records a reason rather than throwing, so one unmeasurable
 * frame cannot take an entire project's export down with it.
 */
async function computeFrame(
  image: NeuriteImageInput,
  options: NeuriteMetricsOptions,
  skipped: Array<{ image: string; reason: string }>,
  mlGate?: Semaphore
): Promise<MLResponse | null> {
  const label = image.name ?? image.id;

  if (!image.segmentation?.polygons) {
    skipped.push({ image: label, reason: 'not segmented' });
    return null;
  }
  if (!image.width || !image.height) {
    skipped.push({ image: label, reason: 'frame dimensions unknown' });
    return null;
  }
  // A pixel size is not a nicety here. Every threshold in the staging rules is
  // in micrometres — "at least 2 um", "2x the soma diameter" — so guessing one
  // would not produce approximate stages, it would produce confident wrong
  // ones. Skipping says so instead.
  if (!image.pixelSizeUm || image.pixelSizeUm <= 0) {
    skipped.push({
      image: label,
      reason: 'pixel size unknown — staging thresholds are in micrometres',
    });
    return null;
  }

  let parsed: PolygonLike[];
  try {
    const raw: unknown = JSON.parse(image.segmentation.polygons);
    parsed = Array.isArray(raw)
      ? (raw as PolygonLike[])
      : ((raw as { polygons?: PolygonLike[] })?.polygons ?? []);
  } catch {
    skipped.push({ image: label, reason: 'segmentation JSON unreadable' });
    return null;
  }

  const somaPolygons: MLPolygon[] = [];
  const neuritePolygons: MLPolygon[] = [];
  parsed.forEach((poly, i) => {
    const kind = classOf(poly);
    if (!kind) {
      return;
    }
    const ml = toMLPolygon(poly, i);
    if (!ml) {
      return;
    }
    (kind === 'soma' ? somaPolygons : neuritePolygons).push(ml);
  });

  if (!somaPolygons.length) {
    // Every row is keyed by a soma, so there is nothing to report. Recorded as
    // a skip rather than an empty result: a frame with neurites and no cell
    // body is a segmentation the user probably wants to look at.
    skipped.push({ image: label, reason: 'no soma polygons' });
    return null;
  }

  const classify = options.classify !== false;
  if (classify && !image.originalPath) {
    skipped.push({
      image: label,
      reason: 'frame file unknown, and the soma classifier reads pixels',
    });
    return null;
  }

  const body = {
    frame: label,
    width: image.width,
    height: image.height,
    um_per_px: image.pixelSizeUm,
    soma_polygons: somaPolygons,
    neurite_polygons: neuritePolygons,
    classify,
    ...(classify && image.originalPath
      ? { image_path: path.join(config.UPLOAD_DIR, image.originalPath) }
      : {}),
  };

  const url = `${config.SEGMENTATION_SERVICE_URL}/api/v1/neurite-metrics`;
  // Sized to the work, not to a guess: the packaged 44 Mpx sample takes 38 s
  // with the classifier on a warm GPU, and the endpoint runs one frame at a
  // time behind a single-slot executor, so a queued request waits for whatever
  // is ahead of it as well.
  const megapixels = (image.width * image.height) / 1_000_000;
  const timeout = Math.min(
    15 * 60_000,
    Math.max(120_000, Math.round(megapixels * 4_000))
  );

  const send = async (): Promise<MLResponse | null> => {
    try {
      const response = await axios.post<MLResponse>(url, body, { timeout });
      return response.data;
    } catch (error) {
      const detail =
        axios.isAxiosError(error) &&
        typeof error.response?.data === 'object' &&
        error.response?.data !== null
          ? String(
              (error.response.data as { detail?: unknown }).detail ??
                error.message
            )
          : error instanceof Error
            ? error.message
            : String(error);
      logger.warn(
        `Neurite metrics failed for ${label}`,
        'neuriteMetricsExporter',
        { detail }
      );
      skipped.push({ image: label, reason: detail });
      return null;
    }
  };

  return mlGate ? mlGate.run(send) : send();
}

export async function computeNeuriteMetrics(
  images: NeuriteImageInput[],
  options: NeuriteMetricsOptions,
  mlGate?: Semaphore
): Promise<NeuriteMetricsResult> {
  const neurites: NeuriteRow[] = [];
  const somas: SomaRow[] = [];
  const skipped: Array<{ image: string; reason: string }> = [];
  const qc: Record<string, Record<string, unknown>> = {};

  // Sequential on purpose. The ML endpoint serialises on a one-slot executor
  // anyway, so firing frames in parallel would only queue them there while
  // holding N decoded frames in Node's heap.
  for (const image of images) {
    const result = await computeFrame(image, options, skipped, mlGate);
    if (!result) {
      continue;
    }
    neurites.push(...result.neurites);
    somas.push(...result.somas);
    qc[image.name ?? image.id] = result.qc;
  }

  return { neurites, somas, skipped, qc };
}

/**
 * Column order for the two sheets.
 *
 * Fixed rather than derived from the first row's keys: a frame with no bridging
 * neurite never populates `bridge_partner_soma`, so a key-derived header would
 * silently change shape between exports of the same project.
 */
export const NEURITE_HEADERS = [
  'frame',
  'soma_id',
  'neurite_id',
  'length_um',
  'extent_um',
  'staging_length_um',
  'bridge_path_um',
  'n_tips',
  'n_branch_points',
  'n_root_attachments',
  'n_bridged_gaps',
  'is_bridge',
  'bridge_partner_soma',
  'connection_id',
  'n_bridge_partners',
  'cost_margin',
] as const;

export const SOMA_HEADERS = [
  'frame',
  'soma_id',
  'stage',
  'stage_reason',
  'soma_neuronal',
  'p_not_soma',
  'soma_diameter_um',
  'soma_area_um2',
  'n_neurites',
  'n_bridging_neurites',
  'longest_neurite_um',
  'second_longest_um',
  'longest_cable_um',
  'second_longest_cable_um',
  'total_neurite_length_um',
  'total_tips',
  'touches_border',
  'centroid_x_px',
  'centroid_y_px',
] as const;

/** What a reader has to know before averaging anything in these sheets. */
const README_LINES: ReadonlyArray<[string, string]> = [
  [
    'One row per PRIMARY NEURITE',
    'A primary neurite is a process leaving a soma, not a drawn polygon. One polygon can host several; one neurite can span several.',
  ],
  [
    'A bridging neurite appears TWICE',
    'Once per soma, each row holding HALF the length, both carrying the same connection_id. Counting rows is not counting neurites.',
  ],
  [
    'connection_id restarts every frame',
    'Pair the two halves on (frame, connection_id). Never on connection_id alone.',
  ],
  [
    'length_um vs extent_um',
    'length_um is CABLE: every branch of this half summed. extent_um is REACH: the longest soma-to-tip path. They differ on any branched neurite, and 51 % of somas have one.',
  ],
  [
    'Staging reads REACH, not cable',
    'staging_length_um is extent_um, or the whole soma-to-soma path for a bridging neurite. Staging on cable instead put 21 % of cells in stage 3 against 14 % on extent.',
  ],
  [
    'Soma diameter is the MAJOR AXIS',
    'Of the fitted ellipse, not the area-equivalent diameter. The major axis runs 1.42x larger here, which makes the "2x diameter" threshold stricter. Both raw quantities are in the sheet, so the choice can be re-made without re-running.',
  ],
  [
    'soma_neuronal = 0 rows are NOT cells',
    'The classifier rejected them: growth cones, fragments, dead cells. They are kept so the rejection rate stays auditable. Filter them out before averaging.',
  ],
  [
    'The classifier is confocal-only',
    'Balanced accuracy 0.901, so roughly one instance in ten is misjudged, and it has never been run on spinning disk.',
  ],
  [
    'There is no ground truth for the assignment',
    'Which soma a neurite belongs to rests on synthetic tests, a cross-check against an independent geodesic watershed (0.844 agreement) and visual review.',
  ],
  [
    'Fasciculated neurites are one object',
    'Two processes running together cannot be separated from a binary mask, and no graph reasoning recovers two.',
  ],
];

function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>
): string {
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '';
    }
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(','),
    ...rows.map(row => headers.map(h => cell(row[h])).join(',')),
  ].join('\n');
}

export async function writeNeuriteMetrics(
  result: NeuriteMetricsResult,
  destDir: string,
  formats: ReadonlyArray<'excel' | 'csv' | 'json'>
): Promise<void> {
  if (!formats.length) {
    return;
  }
  // Written even when empty, unlike the MT exporter: for a neurite project
  // these ARE the metrics, and an absent file is indistinguishable from an
  // export that silently measured nothing. The skipped list says why.
  await fs.mkdir(destDir, { recursive: true });

  for (const format of formats) {
    if (format === 'csv') {
      await fs.writeFile(
        path.join(destDir, 'neurites.csv'),
        toCsv(NEURITE_HEADERS, result.neurites),
        'utf-8'
      );
      await fs.writeFile(
        path.join(destDir, 'somas.csv'),
        toCsv(SOMA_HEADERS, result.somas),
        'utf-8'
      );
    } else if (format === 'json') {
      await fs.writeFile(
        path.join(destDir, 'neurite_metrics.json'),
        JSON.stringify(
          {
            neurites: result.neurites,
            somas: result.somas,
            qc: result.qc,
            skipped: result.skipped,
          },
          null,
          2
        ),
        'utf-8'
      );
    } else if (format === 'excel') {
      await writeWorkbook(path.join(destDir, 'neurite_metrics.xlsx'), result);
    }
  }
}

async function writeWorkbook(
  filePath: string,
  result: NeuriteMetricsResult
): Promise<void> {
  // exceljs is CJS; mirror the dynamic-import idiom used by exportService.
  const excelMod = (await import('exceljs')) as unknown as {
    default?: typeof import('exceljs');
    Workbook?: typeof import('exceljs').Workbook;
  };
  const ExcelJS = excelMod.default ?? excelMod;
  const Workbook = ExcelJS.Workbook;
  if (!Workbook) {
    throw new Error('exceljs did not expose a Workbook constructor');
  }
  const workbook = new Workbook();

  const neuriteSheet = workbook.addWorksheet('Neurites');
  neuriteSheet.columns = NEURITE_HEADERS.map(h => ({
    header: h,
    key: h,
    width: 18,
  }));
  for (const row of result.neurites) {
    neuriteSheet.addRow(row);
  }
  neuriteSheet.getRow(1).font = { bold: true };

  const somaSheet = workbook.addWorksheet('Somas');
  somaSheet.columns = SOMA_HEADERS.map(h => ({ header: h, key: h, width: 18 }));
  for (const row of result.somas) {
    somaSheet.addRow(row);
  }
  somaSheet.getRow(1).font = { bold: true };

  // The README sheet is not decoration. Every caveat on it changes how a
  // number reads, and a spreadsheet is opened long after any conversation
  // about it has been forgotten.
  const readme = workbook.addWorksheet('README');
  readme.columns = [
    { header: 'Point', key: 'point', width: 42 },
    { header: 'What it means', key: 'detail', width: 110 },
  ];
  for (const [point, detail] of README_LINES) {
    readme.addRow({ point, detail });
  }
  readme.getRow(1).font = { bold: true };
  readme.getColumn('detail').alignment = { wrapText: true, vertical: 'top' };

  if (result.skipped.length) {
    const skipped = workbook.addWorksheet('Skipped frames');
    skipped.columns = [
      { header: 'Frame', key: 'image', width: 40 },
      { header: 'Reason', key: 'reason', width: 70 },
    ];
    for (const row of result.skipped) {
      skipped.addRow(row);
    }
    skipped.getRow(1).font = { bold: true };
  }

  await workbook.xlsx.writeFile(filePath);
}
