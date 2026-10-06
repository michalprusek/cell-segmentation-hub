/**
 * The numbers and names of the jobs API, with nothing else: `openapi.ts`
 * reads them and must stay free of the database and the filesystem. Why each
 * limit is what it is, is explained in `store.ts`.
 */
import { SYNC_MAX_PIXELS } from '../limits';

export const JOB_MAX_ITEMS = 20;
export const JOB_MAX_FILE_BYTES = 256 * 1024 * 1024;
export const JOB_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
export const JOB_MAX_PIXELS = 8192 * 8192;
export const JOB_ITEM_TIMEOUT_MS = 30 * 60 * 1000;
export const MAX_ACTIVE_JOBS_PER_USER = 5;
export const JOB_STORAGE_BUDGET_BYTES = 20 * 1024 * 1024 * 1024;
export const JOB_RESULT_TTL_MS = 24 * 60 * 60 * 1000;
/** How long an expired job's row (no files) stays visible before deletion. */
export const JOB_ROW_TTL_MS = 7 * 24 * 60 * 60 * 1000;


/** Models whose memory grows with the frame keep the synchronous ceiling. */
const NATIVE_RESOLUTION_MODELS: ReadonlySet<string> = new Set([
  'spheroid_disintegration',
]);

export function jobMaxPixels(modelId: string): number {
  return NATIVE_RESOLUTION_MODELS.has(modelId)
    ? SYNC_MAX_PIXELS
    : JOB_MAX_PIXELS;
}

export const ACTIVE_STATUSES = ['queued', 'processing'] as const;

export const JOB_STATUSES = [
  'queued',
  'processing',
  'succeeded',
  'partially_succeeded',
  'failed',
  'canceled',
  'expired',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
