import { promises as fs } from 'fs';
import path from 'path';
import type { ApiJob } from '@prisma/client';
import { prisma } from '../../../db';
import { logger } from '../../../utils/logger';
import type { KnownModelId } from '../../../constants/modelRegistry';
import { describeFailure, runSegmentation } from '../execute';
import { V1_MODELS } from '../models';
import {
  ACTIVE_STATUSES,
  JOB_ITEM_TIMEOUT_MS,
  JOB_RESULT_TTL_MS,
  JOB_ROW_TTL_MS,
  finalStatus,
  incomingDir,
  inputPath,
  jobDir,
  jobMaxPixels,
  jobsRoot,
  parseItems,
  removeQuietly,
  writeResult,
  type JobItem,
} from './store';

/**
 * Runs queued API jobs, one image at a time.
 *
 * It lives in the backend process and goes through the same single-slot ML
 * client as synchronous requests, so jobs add no parallelism of their own:
 * a job's images take turns with everything else, in arrival order.
 *
 * FAIRNESS is by `updatedAt`. Each tick takes ONE image from the active job
 * that has waited longest, and processing an image touches that job — so
 * with several jobs waiting the worker cycles through them instead of
 * finishing a 20-image job before starting anyone else's single image.
 *
 * DURABILITY: all state is in the row and on disk. An image that was
 * `processing` when the process died is put back to `queued` on start.
 */
const TICK_MS = 1000;
/** Pause after the ML queue was full, instead of retrying at once. */
const BUSY_BACKOFF_MS = 5000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
/**
 * An upload in the staging directory older than this belongs to no live
 * request. It MUST exceed `server.requestTimeout` (4 h, set in server.ts): a
 * multipart body's files are written one after another, and a file finished
 * early keeps its mtime while the later ones are still arriving — at one hour
 * a slow 20-file upload could have had its first file swept from under it.
 */
const STALE_UPLOAD_MS = 5 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let busy = false;
let notBefore = 0;
let lastSweep = 0;
/** Images a dead process left `processing` have not been re-queued yet. */
let needsRecovery = true;

const saveItems = (
  job: ApiJob,
  items: JobItem[],
  extra: Partial<ApiJob> = {}
): Promise<ApiJob | null> =>
  prisma.apiJob
    .update({
      where: { id: job.id },
      data: { items: JSON.stringify(items), ...extra },
    })
    // The job was deleted by its owner while it ran. Nothing left to record.
    .catch((error: { code?: string }) => {
      if (error.code === 'P2025') {
        return null;
      }
      throw error;
    });

async function finalize(
  job: ApiJob,
  items: JobItem[]
): Promise<ApiJob | null> {
  const now = new Date();
  const saved = await saveItems(job, items, {
    status: finalStatus(items),
    completedAt: now,
    expiresAt: new Date(now.getTime() + JOB_RESULT_TTL_MS),
    inputBytes: BigInt(0),
  });
  await removeQuietly(path.join(jobDir(job.id), 'input'));
  return saved;
}

/** Process at most one image. Exported for tests; `start()` calls it. */
export async function tick(): Promise<void> {
  const job = await prisma.apiJob.findFirst({
    where: { status: { in: [...ACTIVE_STATUSES] } },
    orderBy: { updatedAt: 'asc' },
  });
  if (!job) {
    return;
  }

  const items = parseItems(job);

  if (job.cancelRequested) {
    await finalize(job, cancelPending(items));
    return;
  }

  const item = items.find(i => i.status === 'queued');
  if (!item) {
    await finalize(job, items);
    return;
  }

  item.status = 'processing';
  const claimed = await saveItems(job, items, {
    status: 'processing',
    startedAt: job.startedAt ?? new Date(),
  });
  if (!claimed) {
    return;
  }

  const modelId = job.model as KnownModelId;
  const limits = {
    maxPixels: jobMaxPixels(job.model),
    timeoutMs: JOB_ITEM_TIMEOUT_MS,
  };
  const source = inputPath(job.id, item);
  try {
    const image = await fs.readFile(source);
    const result = await runSegmentation({
      image,
      originalName: item.filename,
      request: {
        modelId,
        model: V1_MODELS[modelId],
        parameters: JSON.parse(job.parameters),
        page: job.page,
        format: 'json',
      },
      ...limits,
    });
    await writeResult(job.id, item.index, result);
    item.status = 'succeeded';
    item.object_count = result.objects.length;
    item.width = result.image.width;
    item.height = result.image.height;
    item.warnings = [...new Set(result.warnings.map(w => w.code))];
    item.inference_ms = result.timing.inference_ms;
  } catch (error) {
    const failure = describeFailure(error, limits);
    if (failure?.code === 'server-busy') {
      // The ML queue is full of other work. Not this image's failure: put it
      // back and try again shortly.
      item.status = 'queued';
      notBefore = Date.now() + BUSY_BACKOFF_MS;
      await saveItems(job, items);
      return;
    }
    item.status = 'failed';
    if (failure) {
      item.error = {
        code: failure.code,
        detail: failure.options.detail ?? '',
      };
    } else {
      logger.error(
        `API job ${job.id} image ${item.index} failed unexpectedly`,
        error as Error,
        'ApiJobs'
      );
      item.error = {
        code: 'internal-error',
        detail: 'An unexpected error occurred while processing this image.',
      };
    }
  }
  // The input is gone as soon as it has been used, whatever the outcome.
  await removeQuietly(source);

  // A cancel that arrived while this image ran needs nothing here: the flag
  // is on the row and the next tick acts on it. A DELETE does: the row is
  // gone, so `saveItems` reports it, and `writeResult` may have re-created
  // the directory the route had just removed.
  const saved = items.some(i => i.status === 'queued')
    ? await saveItems(job, items)
    : await finalize(job, items);
  if (!saved) {
    await removeQuietly(jobDir(job.id));
  }
}

/** Everything not yet run becomes `canceled`; finished images keep their results. */
function cancelPending(items: JobItem[]): JobItem[] {
  for (const item of items) {
    if (item.status === 'queued' || item.status === 'processing') {
      item.status = 'canceled';
    }
  }
  return items;
}

/** An image left `processing` by a dead process goes back to the queue. */
export async function recoverInterrupted(): Promise<number> {
  const jobs = await prisma.apiJob.findMany({ where: { status: 'processing' } });
  let recovered = 0;
  for (const job of jobs) {
    const items = parseItems(job);
    for (const item of items) {
      if (item.status === 'processing') {
        item.status = 'queued';
        recovered++;
      }
    }
    await saveItems(job, items);
  }
  return recovered;
}

/** Delete expired results, long-expired rows and abandoned uploads. */
export async function sweep(now = new Date()): Promise<void> {
  const expired = await prisma.apiJob.findMany({
    where: { expiresAt: { lte: now }, status: { not: 'expired' } },
    select: { id: true },
  });
  for (const { id } of expired) {
    await removeQuietly(jobDir(id));
    await prisma.apiJob
      .update({ where: { id }, data: { status: 'expired' } })
      .catch(() => undefined);
  }

  await prisma.apiJob.deleteMany({
    where: {
      status: 'expired',
      expiresAt: { lte: new Date(now.getTime() - JOB_ROW_TTL_MS) },
    },
  });

  // Uploads whose request died before a job was created for them.
  const entries = await fs.readdir(incomingDir()).catch(() => [] as string[]);
  for (const name of entries) {
    const file = path.join(incomingDir(), name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && now.getTime() - stat.mtimeMs > STALE_UPLOAD_MS) {
      await removeQuietly(file);
    }
  }
}

async function run(): Promise<void> {
  if (busy || Date.now() < notBefore) {
    return;
  }
  busy = true;
  try {
    if (needsRecovery) {
      const recovered = await recoverInterrupted();
      needsRecovery = false;
      if (recovered > 0) {
        logger.info(
          `Re-queued ${recovered} interrupted API job image(s)`,
          'ApiJobs'
        );
      }
    }
    if (Date.now() - lastSweep > SWEEP_EVERY_MS) {
      lastSweep = Date.now();
      await sweep();
    }
    await tick();
  } catch (error) {
    logger.error('API job worker tick failed', error as Error, 'ApiJobs');
    notBefore = Date.now() + BUSY_BACKOFF_MS;
  } finally {
    busy = false;
  }
}

/**
 * Start the worker. This NEVER throws and touches no database.
 *
 * It used to re-queue interrupted images right here, with the server's
 * critical start-up `try` around it. On 2026-10-06 the code reached
 * production one step ahead of its migration: `api_jobs` did not exist, the
 * query threw, the server treated that as fatal and crash-looped — twelve
 * restarts, about four minutes with the whole app down, for a table only the
 * public API's job endpoints read. Recovery is now the first thing a tick
 * does, where a failure is logged and retried and costs nothing but jobs.
 */
export function startJobWorker(): void {
  if (timer) {
    return;
  }
  needsRecovery = true;
  timer = setInterval(() => void run(), TICK_MS);
  // Do not keep the process alive for this alone.
  timer.unref();
  void fs
    .mkdir(incomingDir(), { recursive: true })
    .catch((error: Error) =>
      logger.error('Cannot create the API job directory', error, 'ApiJobs')
    );
  logger.info(`API job worker started (${jobsRoot()})`, 'ApiJobs');
}

/** One pass of the worker loop. Exported for tests. */
export const runOnce = run;

/** Put the loop's module-level state back to "just loaded". Tests only. */
export function resetJobWorkerForTests(): void {
  stopJobWorker();
  busy = false;
  notBefore = 0;
  lastSweep = Date.now();
  needsRecovery = true;
}

export function stopJobWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
