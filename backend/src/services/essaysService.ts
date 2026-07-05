import axios, { AxiosInstance } from 'axios';
import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type { Express } from 'express-serve-static-core';
import type { EssayJob } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import {
  createZipArchive,
  sanitizeFilename,
} from './export/exportFileOperations';

const CTX = 'EssaysService';
const RECONCILE_INTERVAL_MS = 5000;
// A job whose row has not advanced for this long (worker crashed / redeployed /
// status.json unreadable) is declared dead by the watchdog. Comfortably above
// the worker's 30-min GPU-wait ceiling so a legitimately-waiting job is safe.
const STALE_JOB_MS = 60 * 60 * 1000;
// Orphaned upload temp files (rejected filter, size trip, client abort) are
// swept on this cadence once older than the max age.
const STAGING_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const STAGING_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Options the frontend may pass through to the module's evaluate.py. */
export interface EssayJobOptions {
  threshold?: number;
  mtWidth?: number;
  bgGap?: number;
  bgWidth?: number;
  tirfName?: string;
  solutionName?: string;
  limitWells?: number;
  noOverlays?: boolean;
  noJson?: boolean;
}

/** Shape of the worker's status.json (see backend/essays/essays_api.py). */
interface WorkerStatus {
  state?: string; // queued | waiting_gpu | running | completed | failed | unknown
  progress?: number;
  wellsTotal?: number;
  wellsDone?: number;
  positionsDone?: number;
  mtCount?: number;
  device?: string;
  error?: string | null;
}

const exportDir = (): string => path.resolve(process.env.EXPORT_DIR || './exports');

/** Coerce a worker-reported progress into the 0-100 invariant. */
const clampProgress = (n: number): number =>
  Math.min(100, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

/**
 * Strip path components and unsafe chars; guarantee a lowercase `.nd2` suffix.
 * The extension is forced lowercase so the module's `*.nd2` glob never silently
 * skips an uppercase-extension well.
 */
function sanitizeNd2Name(original: string): string {
  const safe = path.basename(original).replace(/[^A-Za-z0-9._-]/g, '_');
  return safe.toLowerCase().endsWith('.nd2')
    ? `${safe.slice(0, -4)}.nd2`
    : `${safe}.nd2`;
}

/**
 * Orchestrates Automated Essays jobs: stages the uploaded .nd2 folder, hands it
 * to the essays worker, reconciles the worker's status.json into the DB row on a
 * timer (so runs progress even with no client polling), and zips the output on
 * completion. Job state lives in Postgres; the worker is a stateless GPU runner.
 */
export class EssaysService {
  private static instance: EssaysService;
  private http: AxiosInstance;
  private uploadDir: string;
  private zipping = new Set<string>(); // jobIds mid-zip — dedupe concurrent finalize

  private constructor() {
    this.http = axios.create({
      baseURL: config.ESSAYS_SERVICE_URL,
      timeout: 30000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    this.uploadDir = config.UPLOAD_DIR || '/app/uploads';

    // Progress jobs even when nobody is polling — WS completion events are
    // unreliable in this codebase, so a background poll is the dependable path.
    const timer = setInterval(() => {
      this.reconcile().catch((e) =>
        logger.warn(`essays reconcile failed: ${String(e)}`, CTX)
      );
    }, RECONCILE_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();

    // Sweep orphaned upload temp files (aborted/rejected uploads never reach
    // submitJob's rename) so the shared volume can't fill up unbounded.
    const sweep = setInterval(() => {
      this.sweepStaging().catch((e) =>
        logger.warn(`essays staging sweep failed: ${String(e)}`, CTX)
      );
    }, STAGING_SWEEP_INTERVAL_MS);
    if (typeof sweep.unref === 'function') sweep.unref();
  }

  static getInstance(): EssaysService {
    if (!EssaysService.instance) EssaysService.instance = new EssaysService();
    return EssaysService.instance;
  }

  private jobDir(userId: string, jobId: string): string {
    return path.join(this.uploadDir, 'essays', userId, jobId);
  }

  /** Stage the uploaded files, create the job row, dispatch to the worker. */
  async submitJob(
    userId: string,
    files: Express.Multer.File[],
    options: EssayJobOptions,
    folderName?: string
  ): Promise<{ jobId: string }> {
    if (!files || files.length === 0) {
      throw new Error('No .nd2 files provided');
    }
    const jobId = randomUUID();
    const dir = this.jobDir(userId, jobId);
    const inputDir = path.join(dir, 'input');
    const outputDir = path.join(dir, 'output');
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    // Move each streamed temp file into input/ under a safe, unique basename.
    const usedNames = new Set<string>();
    for (const f of files) {
      let base = sanitizeNd2Name(f.originalname);
      if (usedNames.has(base)) {
        const parsed = path.parse(base);
        base = `${parsed.name}_${usedNames.size}${parsed.ext}`;
      }
      usedNames.add(base);
      const dest = path.join(inputDir, base);
      try {
        await fs.rename(f.path, dest);
      } catch (e) {
        // Only fall back to copy on a genuine cross-device move (EXDEV) —
        // staging is same-fs by design. Any other error (EACCES/ENOSPC) is real
        // and must not be masked by a second, more confusing copyFile error.
        if ((e as { code?: string }).code !== 'EXDEV') throw e;
        await fs.copyFile(f.path, dest);
        await fs.unlink(f.path).catch(() => {});
      }
    }

    const name =
      folderName?.trim() ||
      `essays_${new Date().toISOString().slice(0, 10)}`;

    await prisma.essayJob.create({
      data: {
        id: jobId,
        userId,
        name,
        status: 'queued',
        progress: 0,
        fileCount: files.length,
        inputKey: path.posix.join('essays', userId, jobId, 'input'),
        outputKey: path.posix.join('essays', userId, jobId, 'output'),
      },
    });

    // The essays container mounts the same host uploads dir at the same
    // /app/uploads path, so these absolute paths resolve identically there.
    try {
      await this.http.post('/process', {
        jobId,
        inputDir,
        outDir: outputDir,
        options,
      });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const isTimeout =
        err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
      if (isTimeout) {
        // The worker writes status.json and enqueues BEFORE responding 202, so a
        // lost/slow response does NOT mean the job was dropped. Leave it queued
        // and let the reconciler adjudicate from status.json — marking it failed
        // here would abandon a job the worker is actually running. If the worker
        // never received it, the staleness watchdog fails it after STALE_JOB_MS.
        logger.warn(
          `essays /process POST timed out for ${jobId}; leaving queued for the reconciler`,
          CTX
        );
        return { jobId };
      }
      const msg = err.message || String(e);
      await prisma.essayJob.update({
        where: { id: jobId },
        data: { status: 'failed', error: `worker unreachable: ${msg}` },
      });
      throw new Error('Essays worker is unavailable; please try again later.');
    }

    return { jobId };
  }

  async listJobs(userId: string): Promise<EssayJob[]> {
    return prisma.essayJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getJob(userId: string, jobId: string): Promise<EssayJob | null> {
    const job = await prisma.essayJob.findFirst({ where: { id: jobId, userId } });
    if (!job) return null;
    // Opportunistic reconcile so a direct GET reflects the latest worker state
    // even between background ticks.
    if (job.status === 'queued' || job.status === 'running') {
      await this.reconcileJob(job).catch((e) =>
        logger.warn(`getJob reconcile ${jobId}: ${String(e)}`, CTX)
      );
      return prisma.essayJob.findFirst({ where: { id: jobId, userId } });
    }
    return job;
  }

  async deleteJob(userId: string, jobId: string): Promise<boolean> {
    const job = await prisma.essayJob.findFirst({ where: { id: jobId, userId } });
    if (!job) return false;
    await fs
      .rm(this.jobDir(userId, jobId), { recursive: true, force: true })
      .catch(() => {});
    if (job.resultZipKey) {
      const zp = path.resolve(exportDir(), job.resultZipKey);
      if (zp.startsWith(exportDir() + path.sep)) {
        await fs.rm(zp, { force: true }).catch(() => {});
      }
    }
    await prisma.essayJob.delete({ where: { id: jobId } });
    return true;
  }

  /** Resolve a completed job's zip for download, with a path-traversal guard. */
  async resolveDownload(
    userId: string,
    jobId: string
  ): Promise<{ filePath: string; downloadName: string } | null> {
    const job = await prisma.essayJob.findFirst({ where: { id: jobId, userId } });
    if (!job || job.status !== 'completed' || !job.resultZipKey) return null;
    const filePath = path.resolve(exportDir(), job.resultZipKey);
    if (!filePath.startsWith(exportDir() + path.sep)) return null;
    try {
      await fs.access(filePath);
    } catch {
      return null;
    }
    return {
      filePath,
      downloadName: `${sanitizeFilename(job.name)}_results.zip`,
    };
  }

  private async readWorkerStatus(
    userId: string,
    jobId: string
  ): Promise<WorkerStatus | null> {
    const p = path.join(this.jobDir(userId, jobId), 'status.json');
    try {
      return JSON.parse(await fs.readFile(p, 'utf8')) as WorkerStatus;
    } catch {
      return null;
    }
  }

  private async reconcile(): Promise<void> {
    const active = await prisma.essayJob.findMany({
      where: { status: { in: ['queued', 'running'] } },
      take: 200, // bound the per-tick work; a backlog can't unbound the loop
    });
    const now = Date.now();
    for (const job of active) {
      try {
        const changed = await this.reconcileJob(job);
        // Watchdog: a job whose row has not advanced past the deadline means the
        // worker crashed / was redeployed / its status.json is unreadable —
        // fail it so it leaves the active set instead of spinning forever.
        if (!changed && now - job.updatedAt.getTime() > STALE_JOB_MS) {
          await prisma.essayJob.update({
            where: { id: job.id },
            data: {
              status: 'failed',
              error: 'Worker stopped reporting (job timed out).',
            },
          });
          logger.error(
            `essays job ${job.id} timed out (idle > ${STALE_JOB_MS}ms) — marked failed`,
            undefined,
            CTX
          );
        }
      } catch (e) {
        logger.warn(`reconcile job ${job.id}: ${String(e)}`, CTX);
      }
    }
  }

  /** Returns true iff it advanced the row (used by the staleness watchdog). */
  private async reconcileJob(job: EssayJob): Promise<boolean> {
    const ws = await this.readWorkerStatus(job.userId, job.id);
    if (!ws || typeof ws.state !== 'string') return false;

    if (ws.state === 'completed') {
      await this.finalize(job, ws);
      return true;
    }
    if (ws.state === 'failed') {
      await prisma.essayJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: ws.error || 'processing failed',
          progress: clampProgress(ws.progress ?? job.progress),
        },
      });
      logger.error(
        `essays job ${job.id} failed: ${ws.error || 'processing failed'}`,
        undefined,
        CTX
      );
      return true;
    }
    // queued | waiting_gpu | running. Update ONLY when something changed, so the
    // row's updatedAt tracks real progress and the watchdog can detect a frozen
    // (but still readable) status.json from a dead worker.
    const nextStatus = ws.state === 'queued' ? 'queued' : 'running';
    const nextProgress = clampProgress(ws.progress ?? job.progress);
    const nextMt = ws.mtCount ?? job.mtCount;
    const nextDevice = ws.device ?? job.device;
    if (
      job.status === nextStatus &&
      job.progress === nextProgress &&
      job.mtCount === nextMt &&
      job.device === nextDevice
    ) {
      return false;
    }
    await prisma.essayJob.update({
      where: { id: job.id },
      data: {
        status: nextStatus,
        progress: nextProgress,
        mtCount: nextMt,
        device: nextDevice,
      },
    });
    return true;
  }

  private async finalize(job: EssayJob, ws: WorkerStatus): Promise<void> {
    if (this.zipping.has(job.id)) return;
    this.zipping.add(job.id);
    try {
      // Re-read inside the guard — the captured `job` is a snapshot and both the
      // timer and getJob can reach finalize; bail if another path already zipped.
      const fresh = await prisma.essayJob.findUnique({ where: { id: job.id } });
      if (!fresh || (fresh.status === 'completed' && fresh.resultZipKey)) return;

      const outputDir = path.join(this.jobDir(job.userId, job.id), 'output');
      const zipBase = `${sanitizeFilename(job.name)}_${job.id.slice(0, 8)}`;
      // createZipArchive opens the zip without creating EXPORT_DIR — ensure it
      // exists (a fresh container has no ./exports).
      await fs.mkdir(exportDir(), { recursive: true });
      const zipPath = await createZipArchive(outputDir, zipBase);
      await prisma.essayJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          progress: 100,
          mtCount: ws.mtCount ?? job.mtCount,
          device: ws.device ?? job.device,
          resultZipKey: path.basename(zipPath),
          completedAt: new Date(),
        },
      });
      logger.info(
        `essays job ${job.id} completed -> ${path.basename(zipPath)}`,
        CTX
      );
      // Free the (potentially tens-of-GB) input .nd2 files + raw output now that
      // the zip in EXPORT_DIR is the sole download artifact — the job dir is no
      // longer needed. Best-effort; a leftover is swept later regardless.
      await fs
        .rm(this.jobDir(job.userId, job.id), { recursive: true, force: true })
        .catch((e) =>
          logger.warn(
            `essays job ${job.id}: post-zip cleanup failed: ${String(e)}`,
            CTX
          )
        );
    } catch (e) {
      // A zip failure must NOT loop forever (the job would stay 'running' and be
      // re-attempted every tick). Mark it failed so it reaches a terminal state
      // and the user sees the truth; the raw output survives on disk.
      logger.error(
        `essays finalize (zip) failed for ${job.id}: ${String(e)}`,
        undefined,
        CTX
      );
      await prisma.essayJob
        .update({
          where: { id: job.id },
          data: {
            status: 'failed',
            error: 'Results could not be packaged for download.',
          },
        })
        .catch(() => {});
    } finally {
      this.zipping.delete(job.id);
    }
  }

  /** Remove orphaned upload temp files older than STAGING_MAX_AGE_MS. */
  private async sweepStaging(): Promise<void> {
    const stagingDir = path.join(this.uploadDir, 'essays', '_staging');
    let entries: string[];
    try {
      entries = await fs.readdir(stagingDir);
    } catch {
      return; // no staging dir yet
    }
    const cutoff = Date.now() - STAGING_MAX_AGE_MS;
    for (const name of entries) {
      const p = path.join(stagingDir, name);
      try {
        const st = await fs.stat(p);
        if (st.isFile() && st.mtimeMs < cutoff) {
          await fs.rm(p, { force: true });
        }
      } catch {
        /* ignore per-file errors */
      }
    }
  }
}
