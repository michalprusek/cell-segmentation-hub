import axios, { AxiosInstance } from 'axios';
import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type { Express } from 'express-serve-static-core';
import type { EssayJob } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { assertSafeStorageSegment } from '../utils/storagePath';
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
  /**
   * Background-ring reach as a multiple of mtWidth (2 = out to 10 px for a
   * 5 px band). Mirrors `margin_multiplier` in the shared measurement
   * (backend/segmentation/models/mt_measure.py), which the project export
   * uses too. Replaced bgGap/bgWidth on 2026-08-13 along with the
   * gap-plus-width ring they described.
   */
  bgMargin?: number;
  /**
   * Substring naming the channel each role uses. They are separate because the
   * module segments IRM (what the v7 checkpoint was trained on) and reads the
   * intensities off TIRF — conflating them is the defect fixed 2026-08.
   */
  irmName?: string;
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
  deviceReason?: string;
  failures?: number;
  error?: string | null;
}

const exportDir = (): string => path.resolve(process.env.EXPORT_DIR || './exports');

/** Coerce a worker-reported progress into the 0-100 invariant. */
const clampProgress = (n: number): number =>
  Math.min(100, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

/**
 * Coerce the worker's device report into the domain the UI knows how to render.
 *
 * `readWorkerStatus` parses status.json with an unchecked cast, so everything
 * downstream — the DB column and the badge in the UI — trusts whatever the
 * worker wrote. `progress` already gets clamped on this boundary; `device` got
 * nothing.
 *
 * Neither `cpu-degraded` nor `cpu-busy` is a device the worker runs on: both
 * are `cpu` plus the worker's `deviceReason`, folded into the existing
 * free-form column so the UI can distinguish three situations the bare `CPU`
 * badge could not — no GPU on this host (nothing to say), the GPU broke (tell
 * an admin), and the shared card was busy for the whole wait (nothing anyone
 * can act on). Folding avoids a migration for a display-only distinction.
 * The incident that motivated all of this is written down once, in `GpuProbe`
 * in backend/essays/essays_api.py.
 *
 * The reason must stay separate from the device on the worker side, because
 * `_await_gpu`'s device goes straight into `evaluate.py --device`.
 */
export const coerceDevice = (
  device: unknown,
  reason: unknown
): 'cuda' | 'cpu' | 'cpu-degraded' | 'cpu-busy' | undefined => {
  if (device !== 'cuda' && device !== 'cpu') {
    return undefined;
  }
  if (device !== 'cpu') {
    return device;
  }
  if (reason === 'fault') {
    return 'cpu-degraded';
  }
  if (reason === 'busy') {
    return 'cpu-busy';
  }
  return 'cpu';
};

/**
 * Strip path components and unsafe chars; guarantee a lowercase `.nd2` suffix.
 * The extension is forced lowercase so the module's `*.nd2` glob never silently
 * skips an uppercase-extension well.
 */
export function sanitizeNd2Name(original: string): string {
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
/** Days a not-cleanly-finished run's input is kept so it can be re-run.
 *  0 or negative turns the TTL off and keeps them until the job is deleted. */
export const ESSAYS_INPUT_RETENTION_DAYS = Number.parseInt(
  process.env.ESSAYS_INPUT_RETENTION_DAYS ?? '7',
  10
);

/**
 * Whether a finished job's input .nd2 files are worth keeping for a re-run.
 *
 * A run that finished CLEANLY is deleted as it always was: the zip is the whole
 * artifact and the input is tens of GB. Anything else is kept, because that is
 * precisely the run someone will want to repeat.
 *
 * Note the condition is "did it finish cleanly", NOT "is the status failed".
 * evaluate.py exits 0 even when individual wells failed to read or segment, so a
 * PARTIAL run is stored as `completed` carrying an `error` — which is the case
 * the user actually reported ("nebyla paměť na segmentaci všech jamek"). Keying
 * on status alone would delete the input for exactly the runs worth repeating.
 */
export function shouldKeepInput(job: {
  status: string;
  error?: string | null;
}): boolean {
  if (job.status !== 'completed' && job.status !== 'failed') {
    return false;
  }
  return job.status === 'failed' || Boolean(job.error);
}

/** Whether a kept input has outlived the retention window.
 *  The boundary counts as still inside it — a TTL that fires early deletes the
 *  input on the day the user comes back for it. */
export function isRetentionExpired(
  finishedAt: Date,
  retentionDays: number,
  now: Date = new Date()
): boolean {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return false;
  }
  const ageMs = now.getTime() - finishedAt.getTime();
  return ageMs > retentionDays * 24 * 60 * 60 * 1000;
}

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
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    // Sweep orphaned upload temp files (aborted/rejected uploads never reach
    // submitJob's rename) so the shared volume can't fill up unbounded.
    const sweep = setInterval(() => {
      this.sweepStaging().catch((e) =>
        logger.warn(`essays staging sweep failed: ${String(e)}`, CTX)
      );
      // Inputs kept for a re-run are tens of GB each; without a TTL they only
      // ever accumulate.
      this.sweepExpiredInputs().catch((e) =>
        logger.warn(`essays retention sweep failed: ${String(e)}`, CTX)
      );
    }, STAGING_SWEEP_INTERVAL_MS);
    if (typeof sweep.unref === 'function') {
      sweep.unref();
    }
  }

  static getInstance(): EssaysService {
    if (!EssaysService.instance) {
      EssaysService.instance = new EssaysService();
    }
    return EssaysService.instance;
  }

  /**
   * Where one job's files live.
   *
   * Both segments are guarded here rather than at the call sites. `submitJob`
   * never needed it — it generates the jobId itself — but `rerunJob` and the
   * listing take one straight off the URL, and a `..` there would walk out of
   * the uploads volume. The route does validate `isUUID()`, but that lives in
   * another file and a defence you cannot see from the call site is one a future
   * edit can remove silently. This is the single funnel every essays path goes
   * through, so guarding it covers all of them at once.
   */
  private jobDir(userId: string, jobId: string): string {
    return path.join(
      this.uploadDir,
      'essays',
      assertSafeStorageSegment(userId, 'essays userId'),
      assertSafeStorageSegment(jobId, 'essays jobId')
    );
  }

  /** Stage the uploaded files, create the job row, dispatch to the worker. */
  async submitJob(
    userId: string,
    files: Express.Multer.File[],
    options: EssayJobOptions,
    folderName?: string
  ): Promise<{ jobId: string }> {
    // Array.isArray, not a truthiness test: `files` originates in
    // `req.files`, whose shape depends on which multer mode the route wired up
    // (`.array()` gives an array, `.fields()` an object). Taking `.length` of
    // anything else silently yields `undefined` — or, for a string, its
    // character count, which would land in the `fileCount` column as a number
    // that describes nothing. Reject the shape here rather than downstream.
    if (!Array.isArray(files) || files.length === 0) {
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
        if ((e as { code?: string }).code !== 'EXDEV') {
          throw e;
        }
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

  /**
   * Re-run a finished job from the input already on disk.
   *
   * The point of the feature: a run that did not finish cleanly used to leave
   * nothing to repeat, so the same 9.9 GB folder was uploaded again. The input
   * now survives such a run (see shouldKeepInput), and this hands it back to the
   * worker under the SAME job id.
   *
   * Reusing the row rather than creating a new one is deliberate. A new row
   * would have to point at another row's input directory, and then neither of
   * them could safely delete it without reference counting — a lot of machinery
   * for a button. The cost is that a partial run's existing zip is replaced by
   * the new run's; the UI says so before asking.
   *
   * No options are stored or replayed because none are ever sent: the page
   * posts files and a folder name only, so every run uses the worker's
   * defaults and a re-run reproduces the original exactly. If an options UI is
   * ever added, it must persist them on the row and pass them here, or a re-run
   * will quietly differ from the run it repeats.
   */
  async rerunJob(
    userId: string,
    jobId: string
  ): Promise<
    { ok: true } | { ok: false; reason: 'not_found' | 'in_flight' | 'input_gone' }
  > {
    const job = await prisma.essayJob.findFirst({ where: { id: jobId, userId } });
    if (!job) {
      return { ok: false, reason: 'not_found' };
    }
    // Re-queueing a job the worker still holds would dispatch the same id twice
    // and let two runs write one output dir.
    if (job.status !== 'completed' && job.status !== 'failed') {
      return { ok: false, reason: 'in_flight' };
    }

    // Built from the ROW, not from the request: `job` was matched on both
    // `id` and `userId`, so its columns are the pair whose ownership has just
    // been proven. Passing the raw URL segments here instead would work
    // identically on every valid request and would leave the only thing
    // standing between a crafted `jobId` and the uploads volume a guard in
    // another file. jobDir still asserts the segments — this just means the
    // assertion can no longer be the sole defence.
    const dir = this.jobDir(job.userId, job.id);
    const inputDir = path.join(dir, 'input');
    const outputDir = path.join(dir, 'output');
    // Ask the disk, never infer from status: retention has a TTL and an operator
    // can always delete a directory. Telling the user now beats a job that
    // fails a minute later.
    try {
      await fs.access(inputDir);
    } catch {
      return { ok: false, reason: 'input_gone' };
    }

    await prisma.essayJob.update({
      where: { id: jobId },
      data: {
        status: 'queued',
        progress: 0,
        mtCount: 0,
        error: null,
        resultZipKey: null,
        completedAt: null,
      },
    });

    // A previous run's raw output would otherwise be zipped together with the
    // new one's.
    await fs
      .rm(outputDir, { recursive: true, force: true })
      .catch(() => {});
    await fs.mkdir(outputDir, { recursive: true }).catch(() => {});

    try {
      await this.http.post('/process', {
        jobId,
        inputDir,
        outDir: outputDir,
        options: {},
      });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const isTimeout =
        err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
      if (isTimeout) {
        // Same reasoning as submitJob: the worker enqueues before responding, so
        // a lost response does not mean the job was dropped. Leave it queued for
        // the reconciler; the staleness watchdog fails it if nothing happens.
        logger.warn(
          `essays /process POST timed out for rerun ${jobId}; leaving queued`,
          CTX
        );
        return { ok: true };
      }
      const msg = err.message || String(e);
      await prisma.essayJob.update({
        where: { id: jobId },
        data: { status: 'failed', error: `worker unreachable: ${msg}` },
      });
      throw new Error('Essays worker is unavailable; please try again later.');
    }

    logger.info(`essays job ${jobId} re-queued from existing input`, CTX);
    return { ok: true };
  }

  async listJobs(userId: string): Promise<(EssayJob & { canRerun: boolean })[]> {
    const jobs = await prisma.essayJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    // Answer from the DISK, not from the status. Retention has a TTL and an
    // operator can delete a directory, so a button derived from status alone
    // would offer a re-run that fails the moment it is clicked. Only terminal
    // jobs are stat'd, which is a handful per page.
    return Promise.all(
      jobs.map(async (job) => ({
        ...job,
        canRerun:
          (job.status === 'completed' || job.status === 'failed') &&
          (await this.hasInput(job.userId, job.id)),
      }))
    );
  }

  private async hasInput(userId: string, jobId: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.jobDir(userId, jobId), 'input'));
      return true;
    } catch {
      return false;
    }
  }

  async getJob(userId: string, jobId: string): Promise<EssayJob | null> {
    const job = await prisma.essayJob.findFirst({ where: { id: jobId, userId } });
    if (!job) {
      return null;
    }
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
    if (!job) {
      return false;
    }
    // Raw job dir is usually already gone (freed on completion); remove it if a
    // failed/in-progress job still has it. Addressed from the row, for the
    // reason spelled out in rerunJob.
    await fs
      .rm(this.jobDir(job.userId, job.id), { recursive: true, force: true })
      .catch(() => {});
    // Remove the persisted result zip (dismiss = delete the deliverable too).
    if (job.resultZipKey) {
      const base = path.resolve(this.uploadDir);
      const zp = path.resolve(base, job.resultZipKey);
      if (zp.startsWith(base + path.sep)) {
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
    if (!job || job.status !== 'completed' || !job.resultZipKey) {
      return null;
    }
    // resultZipKey is relative to the persistent uploads volume (essays-results/
    // <jobId>.zip) so the download survives a backend restart and is available
    // until the user dismisses the job.
    const base = path.resolve(this.uploadDir);
    const filePath = path.resolve(base, job.resultZipKey);
    if (!filePath.startsWith(base + path.sep)) {
      return null;
    }
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
    } catch (e) {
      // ENOENT is the normal case — the worker has not written yet. Anything
      // else (a torn/corrupt file, an EACCES from the uid-1001 shared mount)
      // used to be swallowed identically, and the staleness watchdog would then
      // fail the job with "Worker stopped reporting" — a false diagnosis of a
      // problem that was on our side of the handoff.
      if ((e as { code?: string }).code !== 'ENOENT') {
        logger.error(
          `essays: cannot read status.json for ${jobId}: ${String(e)}`,
          undefined,
          CTX
        );
      }
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
    if (!ws || typeof ws.state !== 'string') {
      return false;
    }

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
    const nextDevice = coerceDevice(ws.device, ws.deviceReason) ?? job.device;
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
    if (this.zipping.has(job.id)) {
      return;
    }
    this.zipping.add(job.id);
    try {
      // Re-read inside the guard — the captured `job` is a snapshot and both the
      // timer and getJob can reach finalize; bail if another path already zipped.
      const fresh = await prisma.essayJob.findUnique({ where: { id: job.id } });
      if (!fresh || (fresh.status === 'completed' && fresh.resultZipKey)) {
        return;
      }

      const outputDir = path.join(this.jobDir(job.userId, job.id), 'output');
      const zipBase = `${sanitizeFilename(job.name)}_${job.id.slice(0, 8)}`;
      // Zip the raw output. createZipArchive writes into EXPORT_DIR (the
      // container-ephemeral ./exports) — ensure it exists, then MOVE the archive
      // onto the persistent uploads volume so it survives a backend restart and
      // stays downloadable until the user dismisses the job.
      await fs.mkdir(exportDir(), { recursive: true });
      const stagedZip = await createZipArchive(outputDir, zipBase);

      const resultsDir = path.join(this.uploadDir, 'essays-results');
      await fs.mkdir(resultsDir, { recursive: true });
      const persistentZip = path.join(resultsDir, `${job.id}.zip`);
      try {
        await fs.rename(stagedZip, persistentZip);
      } catch {
        // EXPORT_DIR and the uploads volume are usually different devices —
        // fall back to copy + unlink on EXDEV.
        await fs.copyFile(stagedZip, persistentZip);
        await fs.rm(stagedZip, { force: true }).catch(() => {});
      }
      const resultZipKey = path.posix.join('essays-results', `${job.id}.zip`);

      await prisma.essayJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          progress: 100,
          mtCount: ws.mtCount ?? job.mtCount,
          device: coerceDevice(ws.device, ws.deviceReason) ?? job.device,
          // A completed run can still be partial: evaluate.py returns 0 even
          // when wells failed to read or segment. Carrying `error` on the
          // success path is what lets the UI say so without withholding the zip.
          error: ws.error ?? null,
          resultZipKey,
          completedAt: new Date(),
        },
      });
      logger.info(`essays job ${job.id} completed -> ${resultZipKey}`, CTX);

      // Free the raw OUTPUT now that the persisted zip is the sole download
      // artifact. The result zip lives outside the job dir (essays-results/) and
      // stays until the user dismisses the job.
      //
      // The INPUT is a separate decision. Deleting it unconditionally is what
      // forced a re-upload of the same 9.9 GB folder after every imperfect run,
      // so it survives when the run did not finish cleanly — see
      // shouldKeepInput, and note that a PARTIAL run is stored as 'completed'
      // with an error, not as 'failed'. A TTL sweep drops it later.
      const keepInput = shouldKeepInput({
        status: 'completed',
        error: ws.error ?? null,
      });
      const dir = this.jobDir(job.userId, job.id);
      const toRemove = keepInput ? [path.join(dir, 'output')] : [dir];
      for (const target of toRemove) {
        await fs
          .rm(target, { recursive: true, force: true })
          .catch((e) =>
            logger.warn(
              `essays job ${job.id}: post-zip cleanup failed for ${target}: ${String(e)}`,
              CTX
            )
          );
      }
      if (keepInput) {
        logger.info(
          `essays job ${job.id}: run was not clean, keeping input for re-run ` +
            `(retention ${ESSAYS_INPUT_RETENTION_DAYS}d)`,
          CTX
        );
      }
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
  /**
   * Drop input directories kept for a re-run once they outlive the window.
   *
   * Only touches `input/` — the result zip lives outside the job dir and stays
   * until the user dismisses the job, so expiry costs the download, not the
   * record. A job whose input is gone simply stops offering the re-run.
   */
  private async sweepExpiredInputs(): Promise<void> {
    if (ESSAYS_INPUT_RETENTION_DAYS <= 0) {
      return;
    }
    const finished = await prisma.essayJob.findMany({
      where: { status: { in: ['completed', 'failed'] } },
      select: { id: true, userId: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    for (const job of finished) {
      if (!isRetentionExpired(job.updatedAt, ESSAYS_INPUT_RETENTION_DAYS)) {
        // Ordered by updatedAt, so the first unexpired row ends the sweep.
        break;
      }
      const inputDir = path.join(this.jobDir(job.userId, job.id), 'input');
      try {
        await fs.access(inputDir);
      } catch {
        continue; // already gone
      }
      await fs.rm(inputDir, { recursive: true, force: true }).catch(() => {});
      logger.info(
        `essays job ${job.id}: input expired after ${ESSAYS_INPUT_RETENTION_DAYS}d, removed`,
        CTX
      );
    }
  }

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
