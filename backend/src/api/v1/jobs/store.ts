import { promises as fs } from 'fs';
import path from 'path';
import type { ApiJob } from '@prisma/client';
import { prisma } from '../../../db';
import { config } from '../../../utils/config';
import { ACTIVE_STATUSES, type JobStatus } from './limits';

export * from './limits';
import { V1_MODELS, type V1Model } from '../models';
import type { SegmentationResult } from '../formats';
import type { KnownModelId } from '../../../constants/modelRegistry';

/**
 * Asynchronous jobs: state in `api_jobs`, files under
 * `<UPLOAD_DIR>/api-jobs/<jobId>/`.
 *
 * LIMITS, and why each is what it is:
 *
 *  - JOB_MAX_PIXELS 8192 x 8192: four times the synchronous ceiling. The
 *    models that tile (microtubule, neurite/soma) or resize to a fixed input
 *    are flat in GPU memory whatever the frame, so the cost of a larger frame
 *    is time, which a job can afford.
 *  - `spheroid_disintegration` is the exception: it runs at the frame's
 *    native resolution with no tiling, so a larger frame is more GPU memory,
 *    not just more time. It keeps the synchronous ceiling even in a job.
 *  - JOB_MAX_FILE_BYTES 256 MiB: an 8192^2 frame is 128 MiB as 16-bit grey
 *    and 192 MiB as 8-bit RGB, uncompressed.
 *  - JOB_STORAGE_BUDGET_BYTES bounds what waiting jobs may hold on the disk
 *    the app's own uploads live on.
 *  - Results are kept JOB_RESULT_TTL_MS after a job finishes; inputs are
 *    deleted as soon as each image has been processed.
 */
export type ItemStatus =
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface JobItem {
  index: number;
  filename: string;
  /** Extension sniffed from the content at upload; names the input file. */
  ext: string;
  bytes: number;
  status: ItemStatus;
  error?: { code: string; detail: string };
  object_count?: number;
  width?: number;
  height?: number;
  warnings?: string[];
  inference_ms?: number;
}

export const isActive = (status: string): boolean =>
  (ACTIVE_STATUSES as readonly string[]).includes(status);

// --- files ------------------------------------------------------------------

export const jobsRoot = (): string =>
  path.join(config.UPLOAD_DIR, 'api-jobs');
export const incomingDir = (): string => path.join(jobsRoot(), '_incoming');
export const jobDir = (jobId: string): string => path.join(jobsRoot(), jobId);
export const inputPath = (jobId: string, item: JobItem): string =>
  path.join(jobDir(jobId), 'input', `${item.index}.${item.ext}`);
export const resultPath = (jobId: string, index: number): string =>
  path.join(jobDir(jobId), 'result', `${index}.json`);

export async function removeQuietly(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
}

/** A stored result: everything but `modelInfo`, which is code, not data. */
export async function writeResult(
  jobId: string,
  index: number,
  result: SegmentationResult
): Promise<void> {
  const { modelInfo: _omit, ...stored } = result;
  const target = resultPath(jobId, index);
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Written under another name and renamed, so a reader never sees half a
  // file and a crash mid-write leaves no result rather than a corrupt one.
  await fs.writeFile(`${target}.tmp`, JSON.stringify(stored));
  await fs.rename(`${target}.tmp`, target);
}

export async function readResult(
  jobId: string,
  index: number
): Promise<SegmentationResult | null> {
  try {
    const stored = JSON.parse(
      await fs.readFile(resultPath(jobId, index), 'utf8')
    ) as Omit<SegmentationResult, 'modelInfo'>;
    const modelInfo: V1Model | undefined =
      V1_MODELS[stored.model as KnownModelId];
    return modelInfo ? { ...stored, modelInfo } : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// --- rows -------------------------------------------------------------------

export const parseItems = (job: ApiJob): JobItem[] =>
  JSON.parse(job.items) as JobItem[];

/**
 * The job's overall status once no item is left to run. `canceled` means an
 * image was actually skipped — a cancel that arrives after the last image
 * has run changes nothing and the job is recorded by what it produced.
 */
export function finalStatus(items: JobItem[]): JobStatus {
  const succeeded = items.filter(i => i.status === 'succeeded').length;
  if (items.some(i => i.status === 'canceled')) {
    return 'canceled';
  }
  if (succeeded === items.length) {
    return 'succeeded';
  }
  return succeeded === 0 ? 'failed' : 'partially_succeeded';
}

/** `prisma`, or the transaction a caller is already inside. */
type Db = Pick<typeof prisma, 'apiJob'>;

export async function countActiveJobs(
  userId: string,
  db: Db = prisma
): Promise<number> {
  return db.apiJob.count({
    where: { userId, status: { in: [...ACTIVE_STATUSES] } },
  });
}

export async function activeInputBytes(db: Db = prisma): Promise<number> {
  const sum = await db.apiJob.aggregate({
    _sum: { inputBytes: true },
    where: { status: { in: [...ACTIVE_STATUSES] } },
  });
  return Number(sum._sum.inputBytes ?? 0);
}

/** The public representation of a job. `base` is e.g. `/api/v1`. */
export function describeJob(
  job: ApiJob,
  base: string,
  options: { withItems: boolean } = { withItems: true }
): Record<string, unknown> {
  const items = parseItems(job);
  const count = (status: ItemStatus): number =>
    items.filter(i => i.status === status).length;
  const self = `${base}/jobs/${job.id}`;
  const available = job.status !== 'expired';
  return {
    id: job.id,
    status: job.status,
    model: job.model,
    parameters: JSON.parse(job.parameters),
    page: job.page,
    counts: {
      total: items.length,
      queued: count('queued'),
      processing: count('processing'),
      succeeded: count('succeeded'),
      failed: count('failed'),
      canceled: count('canceled'),
    },
    created_at: job.createdAt.toISOString(),
    started_at: job.startedAt?.toISOString() ?? null,
    completed_at: job.completedAt?.toISOString() ?? null,
    expires_at: job.expiresAt?.toISOString() ?? null,
    urls: { self, cancel: `${self}/cancel` },
    ...(options.withItems
      ? {
          items: items.map(item => ({
            index: item.index,
            filename: item.filename,
            status: item.status,
            ...(item.error ? { error: item.error } : {}),
            ...(item.status === 'succeeded'
              ? {
                  object_count: item.object_count,
                  width: item.width,
                  height: item.height,
                  warnings: item.warnings ?? [],
                  inference_ms: item.inference_ms,
                  ...(available
                    ? { result_url: `${self}/results/${item.index}` }
                    : {}),
                }
              : {}),
          })),
        }
      : {}),
  };
}
