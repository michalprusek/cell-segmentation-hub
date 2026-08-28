/**
 * exportService.yoloClasses.test.ts — the YOLO annotation branch end to end.
 *
 * Unlike `exportService.generation.test.ts`, this suite keeps `fs/promises`,
 * `FormatConverter` and `exportDocs` REAL and writes into a real temp
 * directory, because the bug this pins lived in the seam between them: the
 * converter can emit perfect class ids and the export still ship no file
 * saying what those ids mean, or ship one built from a different project type
 * than the labels were.
 *
 * The polygons come from `export/__tests__/fixtures/yolo_real_polygons.json` —
 * captured read-only from the production database, not invented here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks: everything EXCEPT fs, formatConverter and exportDocs ──────

vi.mock('../../db', () => ({
  prisma: { project: { findUnique: vi.fn() }, image: { update: vi.fn() } },
}));

vi.mock('../../db/prismaClient', () => ({
  prisma: { project: { findUnique: vi.fn() }, image: { update: vi.fn() } },
}));

vi.mock('../sharingService', () => ({
  hasProjectAccess: vi.fn().mockResolvedValue({ hasAccess: true }),
}));

vi.mock('../websocketService', () => ({
  WebSocketService: { getInstance: vi.fn(() => ({ emitToUser: vi.fn() })) },
}));

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// `canvas` is a native module built for another Node ABI on this host, so the
// visualization generator must never be loaded here.
vi.mock('../visualization/visualizationGenerator', () => ({
  VisualizationGenerator: vi.fn(),
}));

vi.mock('../metrics/metricsCalculator', () => ({
  MetricsCalculator: vi.fn(),
}));

vi.mock('../export/mtMetricsExporter', () => ({
  computeMTMetrics: vi.fn().mockResolvedValue({ rows: [], skipped: [] }),
  computeMTGeometry: vi.fn().mockReturnValue([]),
  writeMTMetrics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('archiver', () => ({ default: vi.fn() }));

// `src/test/setup.ts` stubs `fs/promises` for every backend suite. This one
// writes real files into a real temp directory — that IS the assertion — so it
// hands the real module back.
vi.mock('fs/promises', async () => {
  const actual =
    await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, default: actual };
});

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { promises as fs } from 'fs';
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { ExportService } from '../exportService';
import { generateAnnotationGuides } from '../export/exportDocs';
import type { Polygon } from '../export/formatConverter';

interface RealCase {
  imageId: string;
  projectType: string;
  imageWidth: number;
  imageHeight: number;
  polygons: Polygon[];
}

const real = JSON.parse(
  readFileSync(
    path.join(
      __dirname,
      '..',
      'export',
      '__tests__',
      'fixtures',
      'yolo_real_polygons.json'
    ),
    'utf8'
  )
) as Record<string, RealCase>;

const golden = JSON.parse(
  readFileSync(
    path.join(
      __dirname,
      '..',
      'export',
      '__tests__',
      'fixtures',
      'yolo_real_golden.json'
    ),
    'utf8'
  )
) as Record<string, string>;

let exportDir: string;
let service: ExportService;

const resetSingleton = (): void => {
  (ExportService as unknown as { instance: unknown }).instance = undefined;
};

beforeEach(async () => {
  resetSingleton();
  service = ExportService.getInstance();
  exportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yolo-classes-'));
  await fs.mkdir(path.join(exportDir, 'annotations', 'yolo'), {
    recursive: true,
  });
});

afterEach(async () => {
  service.destroy();
  resetSingleton();
  await fs.rm(exportDir, { recursive: true, force: true });
});

/** Run the real annotation stage for one image built from a real DB row. */
const runYolo = async (
  key: string,
  projectType: string,
  polygons?: Polygon[]
): Promise<void> => {
  const f = real[key];
  const images = [
    {
      id: f.imageId,
      name: 'real_image.png',
      width: f.imageWidth,
      height: f.imageHeight,
      segmentation: {
        polygons: JSON.stringify(polygons ?? f.polygons),
        imageWidth: f.imageWidth,
        imageHeight: f.imageHeight,
      },
    },
  ];
  await (
    service as unknown as {
      generateAnnotations(
        images: unknown[],
        exportDir: string,
        formats: string[],
        jobId?: string,
        onProgress?: unknown,
        projectType?: string | null
      ): Promise<void>;
    }
  ).generateAnnotations(images, exportDir, ['yolo'], undefined, undefined, projectType);
};

const readYolo = (file: string): Promise<string> =>
  fs.readFile(path.join(exportDir, 'annotations', 'yolo', file), 'utf8');

describe('ExportService — YOLO class files', () => {
  it('ships the class names beside the labels', async () => {
    await runYolo('spheroidInvasive', 'spheroid_invasive');

    const files = (
      await fs.readdir(path.join(exportDir, 'annotations', 'yolo'))
    ).sort();
    expect(files).toEqual(['classes.txt', 'data.yaml', 'real_image.txt']);
    expect(await readYolo('classes.txt')).toBe('cell\n');
    expect(await readYolo('data.yaml')).toContain('names:\n  0: cell\n');
  });

  it('leaves a real single-class label file byte-identical to the pre-fix export', async () => {
    await runYolo('spheroidWithHole', 'spheroid');
    expect(await readYolo('real_image.txt')).toBe(golden.spheroidWithHole);
  });

  it('threads the project type through, so ids and names agree', async () => {
    // Real coordinates, classes assigned here: the neurite model shipped
    // without production data (PR #371).
    const [first, second] = real.spheroidInvasive.polygons;
    await runYolo('spheroidInvasive', 'neurite', [
      { ...first, partClass: undefined },
      { ...first, id: 'n1', partClass: 'neurite' },
      { ...second, id: 's1', partClass: 'soma' },
    ]);

    const names = (await readYolo('classes.txt')).trim().split('\n');
    expect(names).toEqual(['cell', 'neurite', 'soma']);

    const ids = (await readYolo('real_image.txt'))
      .split('\n')
      .filter(l => l && !l.startsWith('#'))
      .map(l => Number(l.split(' ')[0]));
    expect(ids).toEqual([0, 1, 2]);
    expect(ids.map(id => names[id])).toEqual(['cell', 'neurite', 'soma']);
  });

  it('quotes the same class list in the format guide', async () => {
    await generateAnnotationGuides(
      exportDir,
      { annotationFormats: ['yolo'] },
      'neurite'
    );
    const guide = await readYolo('QUICK_SETUP.md');
    expect(guide).toContain('cell\nneurite\nsoma');
    // The stale example the guide used to print.
    expect(guide).not.toContain('cell_hole');
  });
});
