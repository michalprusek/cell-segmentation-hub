import fs from 'fs/promises';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import { previewVersion } from '../previews/previewVersion';

/**
 * Storage garbage collector: mark (one consistent snapshot of the database)
 * and sweep (the upload tree), for every file kind whose deletion paths leak.
 *
 * Why a collector and not just better delete paths: the 2026-10-24 audit of
 * production found 74 900 files / 40.3 GB that no row reached — 27.6 GB from
 * projects deleted before #580 taught project deletion to remove files, 11.7
 * GB of video directories left by the batch delete, 27 632 superseded grid
 * thumbnails, 4 356 v1 playback proxies nothing serves, 195 MB of temp files.
 * Each delete path can be fixed, and the ones that matter are; but a leak that
 * nobody has found yet is only reclaimed by something that compares the disk
 * with the database. This is that thing.
 *
 * SAFETY, in the order the code applies it:
 *
 *  1. Only kinds this module understands are touched. Avatars, essays, API
 *     jobs, feedback attachments and `.pending-cleanup` have lifecycles of
 *     their own and are never entered; neither is any top-level directory not
 *     named here, so an operator's backup next to the data is safe.
 *  2. Inside a LIVE video container nothing is judged by reference: frames'
 *     non-source channel PNGs are referenced by no row at all (only the
 *     source channel is any frame's `originalPath`), and a channel removal can
 *     repoint a frame at one of them. Only explicitly dead shapes go: a frame
 *     directory whose index has no row, a v1 proxy, a stale `.partial`.
 *  3. No path that ANY row references — and no directory above one — is ever
 *     a candidate, whatever project it sits in.
 *  4. A grace period on the NEWEST mtime in the candidate's subtree. Files are
 *     written before their rows exist (a still upload, a 10-minute video
 *     extraction); 7 days for anything a user uploaded, 1 day for derived
 *     data, 1 hour for a superseded preview version.
 *  5. Refuse to plan at all on an empty database, and refuse to delete when
 *     the plan would remove more than half of the bytes it scanned.
 *  6. Right before each user-data deletion, re-check in the database that
 *     its owner row is still absent, and re-check the grace period.
 *
 * Every run writes a JSONL report (one line per candidate, then a summary) to
 * `<LOG_DIR>/storage-gc/`. Mode `dry-run` plans and reports without deleting.
 */

export type GcMode = 'off' | 'dry-run' | 'delete';

export type GcReason =
  | 'project-gone'
  | 'container-gone'
  | 'frame-gone'
  | 'unreferenced-upload'
  | 'superseded-seg-thumbnail'
  | 'v1-proxy'
  | 'stale-partial'
  | 'preview-image-gone'
  | 'preview-superseded'
  | 'converted-image-gone'
  | 'converted-expired'
  | 'temp'
  | 'staging'
  | 'segmenter-dataset-gone'
  | 'segmenter-image-gone'
  | 'export-expired'
  | 'empty-dir';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** User-uploaded data: long enough to cover any upload/extraction window and
 *  for an operator to notice a wrong rule from the reports. */
const USER_DATA_GRACE_MS = 7 * DAY;
const DERIVED_GRACE_MS = DAY;

export const GRACE_MS: Record<GcReason, number> = {
  'project-gone': USER_DATA_GRACE_MS,
  'container-gone': USER_DATA_GRACE_MS,
  'frame-gone': USER_DATA_GRACE_MS,
  'unreferenced-upload': USER_DATA_GRACE_MS,
  'segmenter-dataset-gone': USER_DATA_GRACE_MS,
  'segmenter-image-gone': USER_DATA_GRACE_MS,
  'superseded-seg-thumbnail': DERIVED_GRACE_MS,
  'v1-proxy': DERIVED_GRACE_MS,
  'stale-partial': DERIVED_GRACE_MS,
  'preview-image-gone': DERIVED_GRACE_MS,
  // Versioned: a superseded file is reachable only by a page listed before
  // the change, which the endpoint answers with the current file anyway.
  'preview-superseded': HOUR,
  'converted-image-gone': DERIVED_GRACE_MS,
  // The display cache's own TTL; this replaces the sweep that ran on every
  // single cache hit (imageService.cleanupConvertedCache).
  'converted-expired': 7 * DAY,
  temp: DERIVED_GRACE_MS,
  staging: DERIVED_GRACE_MS,
  // The export download is served from an in-memory job that lives 24 h
  // (exportService.JOB_TTL_MS) and not across a restart, so after 48 h no
  // request can reach the file.
  'export-expired': 2 * DAY,
  'empty-dir': DERIVED_GRACE_MS,
};

/** Reasons whose owner row is re-checked right before deletion. */
const USER_DATA_REASONS = new Set<GcReason>([
  'project-gone',
  'container-gone',
  'frame-gone',
  'unreferenced-upload',
  'segmenter-dataset-gone',
  'segmenter-image-gone',
]);

/** Top-level names under UPLOAD_DIR that are not user folders. */
const RESERVED_TOP_LEVEL = new Set([
  'projects',
  'converted',
  'temp',
  'avatars',
  'essays',
  'essays-results',
  'api-jobs',
  'feedback',
  '.pending-cleanup',
  'images',
  'thumbnails',
]);
const USER_FOLDER_KINDS = new Set([
  'originals',
  'thumbnails',
  'segmentation_thumbnails',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `<channel>.p<peak>.webp` — channel names cannot contain a dot, so a v2
 *  file (`<channel>.p<peak>.v2.webp`) can never match. */
const V1_PROXY = /^[^.]+\.p\d+\.webp$/;
const FRAME_DIR = /^\d{4,}$/;

export interface LiveSnapshot {
  projectIds: Set<string>;
  imageIds: Set<string>;
  containerIds: Set<string>;
  /** containerId -> frame indexes that have a row. */
  frameIndexes: Map<string, Set<number>>;
  /** Every storage key any row points at, normalised. */
  referencedKeys: Set<string>;
  /** Every directory above a referenced key. */
  referencedDirs: Set<string>;
  /** imageId -> the preview version the listing hands out today. */
  previewVersions: Map<string, string>;
  segmenterDatasetIds: Set<string>;
  segmenterImageIds: Set<string>;
}

export interface GcCandidate {
  /** Path relative to its root (UPLOAD_DIR, or EXPORT_DIR for exports). */
  key: string;
  root: 'uploads' | 'exports';
  kind: 'file' | 'dir';
  reason: GcReason;
  bytes: number;
  files: number;
  newestMtimeMs: number;
}

export interface GcPlan {
  candidates: GcCandidate[];
  scannedBytes: number;
  scannedFiles: number;
}

/** Storage keys have been written as `a/b`, `/a/b`, `uploads/a/b` and an
 *  absolute container path over the years. */
export function normaliseKey(raw: string | null | undefined): string | null {
  if (!raw) {return null;}
  let key = raw.trim().replace(/\\/g, '/');
  key = key.replace(/^\/app\/uploads\//, '').replace(/^\/?uploads\//, '');
  key = key.replace(/^\/+/, '');
  return key.length > 0 ? path.posix.normalize(key) : null;
}

function addReference(snapshot: LiveSnapshot, raw: string | null): void {
  const key = normaliseKey(raw);
  if (!key) {return;}
  snapshot.referencedKeys.add(key);
  let dir = path.posix.dirname(key);
  while (dir !== '.' && dir !== '/' && !snapshot.referencedDirs.has(dir)) {
    snapshot.referencedDirs.add(dir);
    dir = path.posix.dirname(dir);
  }
}

export function emptySnapshot(): LiveSnapshot {
  return {
    projectIds: new Set(),
    imageIds: new Set(),
    containerIds: new Set(),
    frameIndexes: new Map(),
    referencedKeys: new Set(),
    referencedDirs: new Set(),
    previewVersions: new Map(),
    segmenterDatasetIds: new Set(),
    segmenterImageIds: new Set(),
  };
}

/** One consistent view of everything that keeps a file alive. */
export async function loadLiveSnapshot(): Promise<LiveSnapshot> {
  const [projects, images, datasets, segmenterImages] = await prisma.$transaction(
    async tx =>
      Promise.all([
        tx.project.findMany({ select: { id: true } }),
        tx.image.findMany({
          select: {
            id: true,
            originalPath: true,
            thumbnailPath: true,
            segmentationThumbnailPath: true,
            isVideoContainer: true,
            parentVideoId: true,
            frameIndex: true,
            segmentation: { select: { id: true, updatedAt: true } },
          },
        }),
        tx.segmenterDataset.findMany({ select: { id: true } }),
        tx.segmenterImage.findMany({ select: { id: true, storagePath: true } }),
      ]),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 120_000,
    }
  );

  const snapshot = emptySnapshot();
  for (const p of projects) {snapshot.projectIds.add(p.id);}
  for (const image of images) {
    snapshot.imageIds.add(image.id);
    if (image.isVideoContainer) {snapshot.containerIds.add(image.id);}
    if (image.parentVideoId && image.frameIndex !== null) {
      const set = snapshot.frameIndexes.get(image.parentVideoId) ?? new Set();
      set.add(image.frameIndex);
      snapshot.frameIndexes.set(image.parentVideoId, set);
    }
    addReference(snapshot, image.originalPath);
    addReference(snapshot, image.thumbnailPath);
    // Unused by the app since versioned previews, but still the rollback
    // target until the column is dropped — keep what it points at.
    addReference(snapshot, image.segmentationThumbnailPath);
    if (!image.isVideoContainer) {
      snapshot.previewVersions.set(
        image.id,
        previewVersion({
          originalPath: image.originalPath,
          segmentation: image.segmentation,
        })
      );
    }
  }
  for (const d of datasets) {snapshot.segmenterDatasetIds.add(d.id);}
  for (const si of segmenterImages) {
    snapshot.segmenterImageIds.add(si.id);
    addReference(snapshot, si.storagePath);
  }
  return snapshot;
}

interface Entry {
  name: string;
  isDir: boolean;
}

async function list(abs: string): Promise<Entry[]> {
  try {
    const entries = await fs.readdir(abs, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() || e.isFile())
      .map(e => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return [];
  }
}

/**
 * Size, file count and newest mtime of a file or a whole subtree.
 *
 * The newest FILE mtime, not a directory's: a directory's mtime moves
 * whenever an entry is added or removed — including by this collector
 * deleting a superseded file inside it — so counting it would keep pushing
 * the grace period out. Only an empty subtree falls back to its own mtime.
 */
async function measure(
  abs: string
): Promise<{ bytes: number; files: number; newestMtimeMs: number }> {
  let st;
  try {
    st = await fs.lstat(abs);
  } catch {
    return { bytes: 0, files: 0, newestMtimeMs: 0 };
  }
  if (!st.isDirectory()) {
    return { bytes: st.size, files: 1, newestMtimeMs: st.mtimeMs };
  }
  let bytes = 0;
  let files = 0;
  let newestFileMtimeMs = 0;
  for (const entry of await list(abs)) {
    const m = await measure(path.join(abs, entry.name));
    bytes += m.bytes;
    files += m.files;
    if (m.files > 0) {
      newestFileMtimeMs = Math.max(newestFileMtimeMs, m.newestMtimeMs);
    }
  }
  return {
    bytes,
    files,
    newestMtimeMs: files > 0 ? newestFileMtimeMs : st.mtimeMs,
  };
}

class Planner {
  readonly candidates: GcCandidate[] = [];
  scannedBytes = 0;
  scannedFiles = 0;

  constructor(
    private readonly uploadDir: string,
    private readonly snapshot: LiveSnapshot,
    private readonly now: number
  ) {}

  private abs(key: string): string {
    return path.join(this.uploadDir, key);
  }

  /** Never a candidate: anything a row points at, or a directory above one. */
  private protectedKey(key: string, kind: 'file' | 'dir'): boolean {
    return kind === 'file'
      ? this.snapshot.referencedKeys.has(key)
      : this.snapshot.referencedDirs.has(key) ||
          this.snapshot.referencedKeys.has(key);
  }

  async consider(
    key: string,
    kind: 'file' | 'dir',
    reason: GcReason,
    root: 'uploads' | 'exports' = 'uploads',
    absOverride?: string
  ): Promise<void> {
    if (root === 'uploads' && this.protectedKey(key, kind)) {return;}
    const m = await measure(absOverride ?? this.abs(key));
    if (this.now - m.newestMtimeMs < GRACE_MS[reason]) {return;}
    this.candidates.push({ key, root, kind, reason, ...m });
  }

  async tally(key: string): Promise<void> {
    const m = await measure(this.abs(key));
    this.scannedBytes += m.bytes;
    this.scannedFiles += m.files;
  }

  async emptyDir(key: string, depth: number): Promise<boolean> {
    if (depth < 2) {return false;}
    if ((await list(this.abs(key))).length > 0) {return false;}
    await this.consider(key, 'dir', 'empty-dir');
    return true;
  }

  // ── <userId>/<projectId>/{originals,thumbnails,segmentation_thumbnails} ──
  async userFolder(uid: string): Promise<void> {
    for (const project of await list(this.abs(uid))) {
      const pKey = path.posix.join(uid, project.name);
      if (!project.isDir || !UUID.test(project.name)) {continue;}
      if (!this.snapshot.projectIds.has(project.name)) {
        await this.consider(pKey, 'dir', 'project-gone');
        continue;
      }
      const kinds = await list(this.abs(pKey));
      if (kinds.length === 0) {
        await this.emptyDir(pKey, 2);
        continue;
      }
      for (const kindDir of kinds) {
        if (!kindDir.isDir || !USER_FOLDER_KINDS.has(kindDir.name)) {continue;}
        const kKey = path.posix.join(pKey, kindDir.name);
        const files = await list(this.abs(kKey));
        if (files.length === 0) {
          await this.emptyDir(kKey, 3);
          continue;
        }
        for (const file of files) {
          if (file.isDir) {continue;}
          await this.consider(
            path.posix.join(kKey, file.name),
            'file',
            kindDir.name === 'segmentation_thumbnails'
              ? 'superseded-seg-thumbnail'
              : 'unreferenced-upload'
          );
        }
      }
    }
    if ((await list(this.abs(uid))).length === 0) {
      // A user folder left empty by an account deletion.
      await this.consider(uid, 'dir', 'empty-dir');
    }
  }

  // ── projects/<projectId>/{images/<containerId>, previews/<imageId>} ──
  async projectsTree(): Promise<void> {
    for (const project of await list(this.abs('projects'))) {
      if (!project.isDir) {continue;}
      const pKey = path.posix.join('projects', project.name);
      if (project.name === 'segmenter') {
        await this.segmenter(pKey);
        continue;
      }
      if (!UUID.test(project.name)) {continue;}
      if (!this.snapshot.projectIds.has(project.name)) {
        await this.consider(pKey, 'dir', 'project-gone');
        continue;
      }
      for (const area of await list(this.abs(pKey))) {
        if (!area.isDir) {continue;}
        const aKey = path.posix.join(pKey, area.name);
        if (area.name === 'images') {await this.containers(aKey);}
        else if (area.name === 'previews') {await this.previews(aKey);}
      }
    }
  }

  private async containers(imagesKey: string): Promise<void> {
    const entries = await list(this.abs(imagesKey));
    if (entries.length === 0) {
      await this.emptyDir(imagesKey, 3);
      return;
    }
    for (const container of entries) {
      if (!container.isDir || !UUID.test(container.name)) {continue;}
      const cKey = path.posix.join(imagesKey, container.name);
      if (!this.snapshot.imageIds.has(container.name)) {
        await this.consider(cKey, 'dir', 'container-gone');
        continue;
      }
      const frames = this.snapshot.frameIndexes.get(container.name) ?? new Set();
      const framesKey = path.posix.join(cKey, 'frames');
      for (const frame of await list(this.abs(framesKey))) {
        if (!frame.isDir || !FRAME_DIR.test(frame.name)) {continue;}
        const fKey = path.posix.join(framesKey, frame.name);
        if (!frames.has(Number(frame.name))) {
          await this.consider(fKey, 'dir', 'frame-gone');
          continue;
        }
        const files = await list(this.abs(fKey));
        if (files.length === 0) {
          await this.emptyDir(fKey, 6);
          continue;
        }
        for (const file of files) {
          if (file.isDir) {continue;}
          if (V1_PROXY.test(file.name)) {
            await this.consider(path.posix.join(fKey, file.name), 'file', 'v1-proxy');
          } else if (file.name.endsWith('.partial')) {
            await this.consider(
              path.posix.join(fKey, file.name),
              'file',
              'stale-partial'
            );
          }
        }
      }
    }
  }

  private async previews(previewsKey: string): Promise<void> {
    for (const image of await list(this.abs(previewsKey))) {
      if (!image.isDir) {continue;}
      const iKey = path.posix.join(previewsKey, image.name);
      const current = this.snapshot.previewVersions.get(image.name);
      if (!current) {
        await this.consider(iKey, 'dir', 'preview-image-gone');
        continue;
      }
      for (const file of await list(this.abs(iKey))) {
        if (file.isDir || file.name === `${current}.jpg`) {continue;}
        await this.consider(
          path.posix.join(iKey, file.name),
          'file',
          'preview-superseded'
        );
      }
    }
  }

  private async segmenter(segKey: string): Promise<void> {
    for (const dataset of await list(this.abs(segKey))) {
      if (!dataset.isDir || !UUID.test(dataset.name)) {continue;}
      const dKey = path.posix.join(segKey, dataset.name);
      if (!this.snapshot.segmenterDatasetIds.has(dataset.name)) {
        await this.consider(dKey, 'dir', 'segmenter-dataset-gone');
        continue;
      }
      const imagesKey = path.posix.join(dKey, 'images');
      for (const image of await list(this.abs(imagesKey))) {
        if (!image.isDir || !UUID.test(image.name)) {continue;}
        if (!this.snapshot.segmenterImageIds.has(image.name)) {
          await this.consider(
            path.posix.join(imagesKey, image.name),
            'dir',
            'segmenter-image-gone'
          );
        }
      }
    }
  }

  // ── converted/<imageId>.png ──
  async converted(): Promise<void> {
    for (const file of await list(this.abs('converted'))) {
      if (file.isDir) {continue;}
      const key = path.posix.join('converted', file.name);
      const imageId = file.name.replace(/\.png$/, '');
      await this.consider(
        key,
        'file',
        this.snapshot.imageIds.has(imageId)
          ? 'converted-expired'
          : 'converted-image-gone'
      );
    }
  }

  /** Every file directly or indirectly under `dirKey`, past its grace. */
  async scratch(dirKey: string, reason: GcReason): Promise<void> {
    for (const entry of await list(this.abs(dirKey))) {
      await this.consider(
        path.posix.join(dirKey, entry.name),
        entry.isDir ? 'dir' : 'file',
        reason
      );
    }
  }
}

/**
 * Decide what would be deleted. Pure apart from reading the file system, so
 * the whole rule set is testable on a real directory tree.
 */
export async function planStorageGc(options: {
  uploadDir: string;
  exportDir?: string;
  snapshot: LiveSnapshot;
  now?: number;
}): Promise<GcPlan> {
  const { uploadDir, exportDir, snapshot } = options;
  const now = options.now ?? Date.now();
  if (snapshot.projectIds.size === 0 || snapshot.imageIds.size === 0) {
    // An empty answer from the database looks exactly like "everything is an
    // orphan". There is no reading of an empty snapshot under which deleting
    // is the safe choice.
    throw new Error('Refusing to plan a storage GC from an empty snapshot');
  }

  const planner = new Planner(uploadDir, snapshot, now);
  for (const top of await list(uploadDir)) {
    if (!top.isDir) {continue;}
    await planner.tally(top.name);
    if (UUID.test(top.name) && !RESERVED_TOP_LEVEL.has(top.name)) {
      await planner.userFolder(top.name);
    }
  }
  await planner.projectsTree();
  await planner.converted();
  await planner.scratch('temp', 'temp');
  await planner.scratch(path.posix.join('feedback', '_staging'), 'staging');

  if (exportDir) {
    for (const entry of await list(exportDir)) {
      await planner.consider(
        entry.name,
        entry.isDir ? 'dir' : 'file',
        'export-expired',
        'exports',
        path.join(exportDir, entry.name)
      );
    }
  }

  return {
    candidates: planner.candidates,
    scannedBytes: planner.scannedBytes,
    scannedFiles: planner.scannedFiles,
  };
}

/** The owner row a user-data candidate is waiting to see absent. */
function ownerOf(c: GcCandidate): { table: 'project' | 'image' | 'segmenterDataset' | 'segmenterImage'; id: string } | null {
  const parts = c.key.split('/');
  switch (c.reason) {
    case 'project-gone':
      // `<userId>/<projectId>` and `projects/<projectId>` alike.
      return { table: 'project', id: parts[1] };
    case 'container-gone':
      return { table: 'image', id: parts[3] };
    case 'segmenter-dataset-gone':
      return { table: 'segmenterDataset', id: parts[2] };
    case 'segmenter-image-gone':
      return { table: 'segmenterImage', id: parts[4] };
    default:
      return null;
  }
}

async function ownerStillAbsent(c: GcCandidate): Promise<boolean> {
  if (c.reason === 'unreferenced-upload') {
    const key = c.key;
    const hit = await prisma.image.findFirst({
      where: {
        OR: [
          { originalPath: { endsWith: key } },
          { thumbnailPath: { endsWith: key } },
        ],
      },
      select: { id: true },
    });
    return !hit;
  }
  if (c.reason === 'frame-gone') {
    const parts = c.key.split('/');
    const hit = await prisma.image.findFirst({
      where: { parentVideoId: parts[3], frameIndex: Number(parts[5]) },
      select: { id: true },
    });
    return !hit;
  }
  const owner = ownerOf(c);
  if (!owner) {return true;}
  const where = { where: { id: owner.id }, select: { id: true } } as const;
  const row =
    owner.table === 'project'
      ? await prisma.project.findUnique(where)
      : owner.table === 'image'
        ? await prisma.image.findUnique(where)
        : owner.table === 'segmenterDataset'
          ? await prisma.segmenterDataset.findUnique(where)
          : await prisma.segmenterImage.findUnique(where);
  return !row;
}

export interface GcSummary {
  mode: GcMode;
  startedAt: string;
  durationMs: number;
  scannedFiles: number;
  scannedBytes: number;
  planned: Record<string, { count: number; files: number; bytes: number }>;
  deletedFiles: number;
  deletedBytes: number;
  skipped: number;
  aborted?: string;
  reportPath?: string;
}

/** Above this fraction of the scanned bytes, a plan is assumed to be wrong. */
const MAX_DELETE_FRACTION = 0.5;
const REPORTS_KEPT = 30;

function reportDir(): string {
  return path.join(process.env.LOG_DIR || '/app/logs', 'storage-gc');
}

async function writeReport(
  startedAt: string,
  mode: GcMode,
  candidates: GcCandidate[],
  summary: GcSummary
): Promise<string | undefined> {
  try {
    const dir = reportDir();
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${startedAt.replace(/[:.]/g, '-')}-${mode}.jsonl`);
    const lines = candidates.map(c =>
      JSON.stringify({
        ...c,
        newestMtime: new Date(c.newestMtimeMs).toISOString(),
      })
    );
    lines.push(JSON.stringify({ summary }));
    await fs.writeFile(file, lines.join('\n') + '\n');
    const reports = (await fs.readdir(dir)).filter(n => n.endsWith('.jsonl')).sort();
    for (const old of reports.slice(0, Math.max(0, reports.length - REPORTS_KEPT))) {
      await fs.rm(path.join(dir, old), { force: true });
    }
    return file;
  } catch (error) {
    logger.warn('Could not write the storage GC report', 'StorageGc', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

export async function runStorageGc(
  mode: GcMode,
  options: { uploadDir?: string; exportDir?: string; now?: () => number } = {}
): Promise<GcSummary> {
  const now = options.now ?? Date.now;
  const started = now();
  const startedAt = new Date(started).toISOString();
  const uploadDir = path.resolve(options.uploadDir ?? config.UPLOAD_DIR ?? './uploads');
  const exportDir = path.resolve(
    options.exportDir ?? process.env.EXPORT_DIR ?? './exports'
  );
  const summary: GcSummary = {
    mode,
    startedAt,
    durationMs: 0,
    scannedFiles: 0,
    scannedBytes: 0,
    planned: {},
    deletedFiles: 0,
    deletedBytes: 0,
    skipped: 0,
  };
  if (mode === 'off') {return summary;}

  const snapshot = await loadLiveSnapshot();
  const plan = await planStorageGc({ uploadDir, exportDir, snapshot, now: started });
  summary.scannedFiles = plan.scannedFiles;
  summary.scannedBytes = plan.scannedBytes;
  let plannedBytes = 0;
  for (const c of plan.candidates) {
    const bucket = (summary.planned[c.reason] ??= { count: 0, files: 0, bytes: 0 });
    bucket.count++;
    bucket.files += c.files;
    bucket.bytes += c.bytes;
    if (c.root === 'uploads') {plannedBytes += c.bytes;}
  }

  if (plan.scannedBytes > 0 && plannedBytes / plan.scannedBytes > MAX_DELETE_FRACTION) {
    summary.aborted = `plan would delete ${plannedBytes} of ${plan.scannedBytes} scanned bytes`;
  }

  if (mode === 'delete' && !summary.aborted) {
    for (const c of plan.candidates) {
      const abs =
        c.root === 'exports' ? path.join(exportDir, c.key) : path.join(uploadDir, c.key);
      // Re-check the grace period on what is there NOW, and for user data
      // that the owner is still gone: the snapshot is minutes old by here.
      const fresh = await measure(abs);
      if (fresh.files === 0 && c.kind === 'file') {continue;}
      if (now() - fresh.newestMtimeMs < GRACE_MS[c.reason]) {
        summary.skipped++;
        continue;
      }
      if (USER_DATA_REASONS.has(c.reason) && !(await ownerStillAbsent(c))) {
        summary.skipped++;
        continue;
      }
      try {
        if (c.kind === 'dir' && c.reason === 'empty-dir') {
          await fs.rmdir(abs); // fails, harmlessly, if something arrived
        } else {
          await fs.rm(abs, { recursive: c.kind === 'dir', force: true });
        }
        summary.deletedFiles += fresh.files;
        summary.deletedBytes += fresh.bytes;
      } catch (error) {
        summary.skipped++;
        logger.warn('Storage GC could not delete', 'StorageGc', {
          key: c.key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  summary.durationMs = now() - started;
  summary.reportPath = await writeReport(startedAt, mode, plan.candidates, summary);
  if (summary.aborted) {
    logger.error(
      `Storage GC (${mode}) ABORTED: ${summary.aborted}`,
      undefined,
      'StorageGc',
      { ...summary }
    );
  } else {
    logger.info(`Storage GC (${mode}) finished`, 'StorageGc', { ...summary });
  }
  return summary;
}

const FIRST_RUN_DELAY_MS = 10 * 60_000;
const INTERVAL_MS = 6 * HOUR;
let timer: NodeJS.Timeout | null = null;
let running = false;

export function storageGcMode(): GcMode {
  const raw = (process.env.STORAGE_GC_MODE || 'dry-run').toLowerCase();
  return raw === 'off' || raw === 'delete' ? raw : 'dry-run';
}

/** Start the periodic collector. Cannot throw, does not block the start. */
export function startStorageGc(): void {
  const mode = storageGcMode();
  if (mode === 'off' || timer) {return;}
  const run = (): void => {
    if (running) {return;}
    running = true;
    runStorageGc(mode)
      .catch(error =>
        logger.error(
          'Storage GC run failed',
          error instanceof Error ? error : new Error(String(error)),
          'StorageGc'
        )
      )
      .finally(() => {
        running = false;
      });
  };
  const first = setTimeout(() => {
    run();
    timer = setInterval(run, INTERVAL_MS);
    timer.unref?.();
  }, FIRST_RUN_DELAY_MS);
  first.unref?.();
  timer = first;
  logger.info(`Storage GC scheduled (${mode})`, 'StorageGc', {
    firstRunInMs: FIRST_RUN_DELAY_MS,
    intervalMs: INTERVAL_MS,
  });
}

export function stopStorageGc(): void {
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
}
