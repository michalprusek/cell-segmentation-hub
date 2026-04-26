// Simple types for backend (temporary until shared is set up properly)
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  message?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Canonical status set for any job-like operation that progresses through
 * pending → processing → completed | failed. Mirrors the frontend
 * `SegmentationStatus` so cross-stack contracts stay aligned. Exported as
 * both a const tuple (for runtime validators / Zod enums) and a derived
 * type (for static interfaces).
 *
 * Note: distinct from `QueueStatus` in `./queue.ts` which uses `'queued'`
 * (queue position) and adds `'cancelled'`. Do not merge — different
 * semantic axes (job state vs queue state).
 */
export const JOB_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Status union for cancellable jobs (e.g. exports). Superset of
 * `JobStatus` plus `'cancelled'`.
 */
export const CANCELLABLE_JOB_STATUSES = [
  ...JOB_STATUSES,
  'cancelled',
] as const;
export type CancellableJobStatus = (typeof CANCELLABLE_JOB_STATUSES)[number];
