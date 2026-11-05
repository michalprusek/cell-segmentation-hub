import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { prisma } from '../../db';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import { assertSafeStorageSegment } from '../../utils/storagePath';
import { WebSocketService } from '../websocketService';
import { WebSocketEvent } from '../../types/websocket';
import type { Polygon } from '../visualization/visualizationGenerator';
import type { PreviewSource } from './previewRenderer';
import { previewUrl, previewVersion } from './previewVersion';
import { previewDirKey } from './previewFiles';
import { SHARP_INPUT_LIMITS } from '../../constants/imageLimits';

/**
 * Project-grid previews, rendered on demand and addressed by version.
 *
 * Layout: `projects/<projectId>/previews/<imageId>/<version>.jpg`. One
 * directory per image, holding the current version and nothing else once a
 * render settles — every successful render deletes its siblings. Under
 * `projects/<projectId>/` on purpose: deleting the project already removes
 * that tree (`accountFiles.addProjectDirs`), and the garbage collector only
 * has to compare directory names with live image ids.
 *
 * Nothing is rendered until something asks. The grid requests a preview with
 * `loading="lazy"`, so a 600-frame video costs 600 renders only if somebody
 * scrolls past every frame — the old eager scheme rendered every frame of
 * every segmentation, and re-rendered on every edit, whether or not anyone
 * ever looked. `warm()` still pre-renders after a write the user is likely
 * to come back to, at low priority, so the first view does not wait.
 */

/** Concurrent renders. sharp runs on libuv's pool; node-canvas drawing does
 *  not, so this also bounds how long the event loop can be held. */
const MAX_CONCURRENT_RENDERS = 2;
/** A source that failed to render is not retried on every request. */
const FAILURE_BACKOFF_MS = 10 * 60_000;
/** Change notifications for one burst (a batch of frames finishing, a track
 *  operation touching 300 siblings) are sent as one message per project. */
const NOTIFY_DEBOUNCE_MS = 250;

export interface PreviewFile {
  version: string;
  filePath: string;
}

export class PreviewUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewUnavailableError';
  }
}

const uploadDir = (): string => config.UPLOAD_DIR || './uploads';

interface PreviewRow {
  id: string;
  projectId: string;
  originalPath: string;
  thumbnailPath: string | null;
  mimeType: string | null;
  width: number | null;
  segmentation: { id: string; updatedAt: Date; polygons: string } | null;
}

async function loadRow(imageId: string): Promise<PreviewRow | null> {
  return prisma.image.findUnique({
    where: { id: imageId },
    select: {
      id: true,
      projectId: true,
      originalPath: true,
      thumbnailPath: true,
      mimeType: true,
      width: true,
      segmentation: { select: { id: true, updatedAt: true, polygons: true } },
    },
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const isBmp = (row: PreviewRow): boolean =>
  row.mimeType === 'image/bmp' || /\.bmp$/i.test(row.originalPath);
const isTiff = (row: PreviewRow): boolean =>
  row.mimeType === 'image/tiff' || /\.tiff?$/i.test(row.originalPath);

/**
 * The file to draw from. Normally the original; two kinds of original sharp
 * cannot read faithfully get a stand-in:
 *  - BMP (libvips has no BMP loader): the upload thumbnail, which the upload
 *    path decoded by hand. Its pixels are smaller than the polygons' frame,
 *    hence `frameWidth`.
 *  - a deeper-than-8-bit TIFF, which sharp reads as 8-bit by shifting right
 *    8 (see `imageService.getBrowserCompatibleImage`): the lossless 16-bit PNG
 *    the display endpoint caches in `converted/`, made by the same helper.
 */
async function resolveSource(row: PreviewRow): Promise<PreviewSource> {
  const original = path.join(uploadDir(), row.originalPath);
  if (isBmp(row)) {
    if (!row.thumbnailPath) {
      throw new PreviewUnavailableError('BMP without an upload thumbnail');
    }
    return {
      path: path.join(uploadDir(), row.thumbnailPath),
      frameWidth: row.width ?? undefined,
    };
  }
  if (isTiff(row)) {
    const { default: sharp } = await import('sharp');
    const meta = await sharp(original, SHARP_INPUT_LIMITS).metadata();
    if (meta.depth && meta.depth !== 'uchar' && meta.depth !== 'char') {
      const converted = path.join(
        uploadDir(),
        'converted',
        `${assertSafeStorageSegment(row.id, 'imageId')}.png`
      );
      if (!(await exists(converted))) {
        await fs.mkdir(path.dirname(converted), { recursive: true });
        const { convertImageForDisplay } = await import(
          '../video/pythonExtractor'
        );
        const result = await convertImageForDisplay(original, converted);
        if (!result.ok) {
          throw new PreviewUnavailableError(
            `Deep TIFF conversion failed: ${result.error ?? 'unknown error'}`
          );
        }
      }
      return { path: converted };
    }
  }
  return { path: original };
}

function parsePolygons(raw: string | undefined): Polygon[] {
  if (!raw) {return [];}
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Polygon[]) : [];
  } catch {
    return [];
  }
}

interface Waiter {
  key: string;
  go: () => void;
}

/** Two-level semaphore: a request for a preview somebody is waiting to see
 *  always goes before a speculative `warm()`. */
export class RenderQueue {
  private active = 0;
  private readonly waiting: { high: Waiter[]; low: Waiter[] } = {
    high: [],
    low: [],
  };

  constructor(private readonly limit: number) {}

  async run<T>(
    key: string,
    priority: 'high' | 'low',
    task: () => Promise<T>
  ): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>(go => this.waiting[priority].push({ key, go }));
    } else {
      this.active++;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.high.shift() ?? this.waiting.low.shift();
      if (next) {
        next.go(); // the slot passes straight to the next task
      } else {
        this.active--;
      }
    }
  }

  /**
   * Move a queued low-priority task to the high lane. A card on screen that
   * joins a render `warm()` already queued would otherwise wait behind the
   * whole backlog — after a track edit that is every frame of the video.
   */
  promote(key: string): void {
    const i = this.waiting.low.findIndex(w => w.key === key);
    if (i >= 0) {
      this.waiting.high.push(...this.waiting.low.splice(i, 1));
    }
  }

  get pending(): number {
    return this.waiting.high.length + this.waiting.low.length;
  }
}

export class PreviewService {
  private readonly queue = new RenderQueue(MAX_CONCURRENT_RENDERS);
  /** One render per (image, version), however many requests arrive for it. */
  private readonly inFlight = new Map<string, Promise<PreviewFile>>();
  private readonly failedUntil = new Map<string, number>();
  private readonly warming = new Set<string>();
  private pendingImages = new Set<string>();
  private pendingContainers = new Set<string>();
  private notifyTimer: NodeJS.Timeout | null = null;

  /**
   * The current preview of an image, rendering it if this version has never
   * been drawn. `null` when the image does not exist.
   */
  async ensurePreview(
    imageId: string,
    priority: 'high' | 'low' = 'high'
  ): Promise<PreviewFile | null> {
    const row = await loadRow(imageId);
    if (!row) {return null;}

    const version = previewVersion({
      originalPath: row.originalPath,
      segmentation: row.segmentation,
    });
    const dir = path.join(uploadDir(), previewDirKey(row.projectId, row.id));
    const filePath = path.join(dir, `${version}.jpg`);
    if (await exists(filePath)) {
      return { version, filePath };
    }

    const key = `${row.id}:${version}`;
    const running = this.inFlight.get(key);
    if (running) {
      if (priority === 'high') {
        this.queue.promote(key);
      }
      return running;
    }

    const failedUntil = this.failedUntil.get(key);
    if (failedUntil !== undefined && failedUntil > Date.now()) {
      throw new PreviewUnavailableError('Rendering failed recently');
    }

    const render = this.queue
      .run(key, priority, async () => {
        // Another request may have finished this version while we queued.
        if (await exists(filePath)) {return { version, filePath };}

        const source = await resolveSource(row);
        // Loaded on first render, not at import: sharp and node-canvas are
        // native modules every importer of this service would otherwise pull
        // in just to call notifyChanged().
        const { renderPreview } = await import('./previewRenderer');
        const jpeg = await renderPreview(
          source,
          parsePolygons(row.segmentation?.polygons)
        );
        await fs.mkdir(dir, { recursive: true });
        // Write-then-rename: a reader never sees a half-written file, and a
        // crash leaves only a dot-file the garbage collector removes.
        const tmp = path.join(
          dir,
          `.${version}.${randomBytes(4).toString('hex')}.tmp`
        );
        await fs.writeFile(tmp, jpeg);
        await fs.rename(tmp, filePath);
        await this.pruneOtherVersions(dir, `${version}.jpg`);
        return { version, filePath };
      })
      .then(
        result => {
          this.failedUntil.delete(key);
          return result;
        },
        (error: unknown) => {
          this.rememberFailure(key);
          logger.warn('Preview render failed', 'PreviewService', {
            imageId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error instanceof PreviewUnavailableError
            ? error
            : new PreviewUnavailableError(
                error instanceof Error ? error.message : String(error)
              );
        }
      )
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, render);
    return render;
  }

  private rememberFailure(key: string): void {
    const now = Date.now();
    // Bounded: expired entries go whenever the map grows past a few thousand,
    // so a project full of undecodable files cannot grow it without limit.
    if (this.failedUntil.size >= 5000) {
      for (const [k, until] of this.failedUntil) {
        if (until <= now) {this.failedUntil.delete(k);}
      }
    }
    this.failedUntil.set(key, now + FAILURE_BACKOFF_MS);
  }

  /** Delete every finished version but `keep`. In-flight dot-files stay. */
  private async pruneOtherVersions(dir: string, keep: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter(name => name !== keep && !name.startsWith('.'))
        .map(name => fs.rm(path.join(dir, name), { force: true }))
    );
  }

  /** Pre-render at low priority; failures are left for the request path. */
  warm(imageIds: Iterable<string>): void {
    for (const imageId of imageIds) {
      if (this.warming.has(imageId)) {continue;}
      this.warming.add(imageId);
      this.ensurePreview(imageId, 'low')
        .catch(() => undefined)
        .finally(() => this.warming.delete(imageId));
    }
  }

  /**
   * Tell every open project page that these images have a new preview, and
   * pre-render them. Correctness does NOT depend on this being called — the
   * listing always returns the current URL — but without it a page that is
   * already open keeps showing the previous picture until it re-lists.
   */
  notifyChanged(imageIds: Iterable<string>): void {
    for (const id of imageIds) {this.pendingImages.add(id);}
    this.scheduleNotify();
  }

  /** Every frame of a video container changed (a cross-frame track edit, a
   *  static-channel share, tracking, a channel removal). Resolved to frame
   *  ids when the notification is sent, so callers need not collect them. */
  notifyContainerChanged(containerId: string | null | undefined): void {
    if (!containerId) {return;}
    this.pendingContainers.add(containerId);
    this.scheduleNotify();
  }

  private scheduleNotify(): void {
    if (this.notifyTimer) {return;}
    if (this.pendingImages.size === 0 && this.pendingContainers.size === 0) {
      return;
    }
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      const images = [...this.pendingImages];
      const containers = [...this.pendingContainers];
      this.pendingImages = new Set();
      this.pendingContainers = new Set();
      this.flushNotify(images, containers).catch(error =>
        logger.warn('Preview change notification failed', 'PreviewService', {
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }, NOTIFY_DEBOUNCE_MS);
    this.notifyTimer.unref?.();
  }

  private async flushNotify(
    imageIds: string[],
    containerIds: string[]
  ): Promise<void> {
    const rows = await prisma.image.findMany({
      where: {
        isVideoContainer: false,
        OR: [
          { id: { in: imageIds } },
          { parentVideoId: { in: containerIds } },
        ],
      },
      select: {
        id: true,
        projectId: true,
        originalPath: true,
        segmentation: { select: { id: true, updatedAt: true } },
      },
    });

    let ws: WebSocketService | null = null;
    try {
      ws = WebSocketService.getInstance();
    } catch {
      ws = null;
    }

    const byProject = new Map<string, PreviewChange[]>();
    for (const row of rows) {
      const list = byProject.get(row.projectId) ?? [];
      list.push({
        imageId: row.id,
        previewUrl: previewUrl(
          row.id,
          previewVersion({
            originalPath: row.originalPath,
            segmentation: row.segmentation,
          })
        ),
      });
      byProject.set(row.projectId, list);
    }
    for (const [projectId, previews] of byProject) {
      ws?.emitToProject(projectId, WebSocketEvent.IMAGE_PREVIEWS_UPDATED, {
        projectId,
        previews,
      });
    }
    this.warm(rows.map(r => r.id));
  }

  /** For monitoring and tests. */
  status(): { inFlight: number; queued: number } {
    return { inFlight: this.inFlight.size, queued: this.queue.pending };
  }
}

export interface PreviewChange {
  imageId: string;
  previewUrl: string;
}

export const previewService = new PreviewService();
