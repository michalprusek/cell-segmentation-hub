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

/** Strip path components and unsafe chars; guarantee a .nd2 suffix. */
function sanitizeNd2Name(original: string): string {
  const safe = path.basename(original).replace(/[^A-Za-z0-9._-]/g, '_');
  return safe.toLowerCase().endsWith('.nd2') ? safe : `${safe}.nd2`;
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
      } catch {
        // Cross-device fallback — staging is same-fs by design, but be safe.
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
      const msg = e instanceof Error ? e.message : String(e);
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
      await this.reconcileJob(job).catch(() => {});
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
    });
    for (const job of active) {
      await this.reconcileJob(job).catch((e) =>
        logger.warn(`reconcile job ${job.id}: ${String(e)}`, CTX)
      );
    }
  }

  private async reconcileJob(job: EssayJob): Promise<void> {
    const ws = await this.readWorkerStatus(job.userId, job.id);
    if (!ws || !ws.state) return;

    if (ws.state === 'completed') {
      await this.finalize(job, ws);
      return;
    }
    if (ws.state === 'failed') {
      await prisma.essayJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: ws.error || 'processing failed',
          progress: ws.progress ?? job.progress,
        },
      });
      return;
    }
    // queued | waiting_gpu | running
    await prisma.essayJob.update({
      where: { id: job.id },
      data: {
        status: ws.state === 'queued' ? 'queued' : 'running',
        progress: ws.progress ?? job.progress,
        mtCount: ws.mtCount ?? job.mtCount,
        device: ws.device ?? job.device,
      },
    });
  }

  private async finalize(job: EssayJob, ws: WorkerStatus): Promise<void> {
    if (this.zipping.has(job.id)) return;
    if (job.status === 'completed' && job.resultZipKey) return;
    this.zipping.add(job.id);
    try {
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
    } finally {
      this.zipping.delete(job.id);
    }
  }
}
