/**
 * The record of who took data off the platform.
 *
 * Before this existed there was none: export jobs live in a `Map` inside the
 * backend process, keep the last ten per project and vanish on restart, and a
 * download was never recorded anywhere at all.
 *
 * Two rules govern everything here.
 *
 * **It never breaks an export.** Every write is fire-and-forget and swallows
 * its own errors. An audit row is worth less than the export it describes, so
 * a full disk or a lock timeout must cost the user a log line, not their data.
 * That is also why nothing here is awaited by its callers.
 *
 * **It appends, never updates.** One row per event, each carrying its own
 * actor and timestamp. A mutable row-per-job would have to read-modify-write
 * on every download — losing one of two concurrent downloads — and could only
 * name one person, when the whole point is to attribute a shared project's
 * download to whoever actually pulled the file.
 */

import { prisma } from '../db';
import { logger } from '../utils/logger';

const CTX = 'ExportAuditService';

/** What produced the file. */
export type ExportKind = 'project' | 'essays';

/** What happened to it. One job produces several rows. */
export type ExportEvent =
  | 'created'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'downloaded';

export interface ExportEventRecord {
  kind: ExportKind;
  event: ExportEvent;
  /** Who did THIS event — for a download, whoever pulled the file. */
  userId: string;
  jobId: string;
  /** Absent for essays jobs, which are not project-scoped. */
  projectId?: string | null;
  /** The requested export options, kept whole. */
  options?: unknown;
  imageCount?: number | null;
  /** Byte size of the archive, for a BIGINT column. A non-integral, negative
   *  or unsafe value is stored as NULL rather than failing: `BigInt(3.5)`
   *  THROWS, and inside this module's catch that would lose the whole row —
   *  actor, timestamp and job — over its least important field. */
  fileSizeBytes?: number | null;
  /** Failure message, or how a download was authorised. */
  detail?: string | null;
}

/**
 * Append one row. Returns a promise so tests can await the write; production
 * callers deliberately do not, and must not — see the module docstring.
 */
export async function recordExportEvent(
  record: ExportEventRecord
): Promise<void> {
  try {
    await prisma.exportLog.create({
      data: {
        kind: record.kind,
        event: record.event,
        userId: record.userId,
        jobId: record.jobId,
        projectId: record.projectId ?? null,
        // Prisma rejects `undefined` differently from `null` on a Json column;
        // normalise so an absent options object stores SQL NULL.
        options:
          record.options === undefined
            ? undefined
            : (record.options as never),
        imageCount: record.imageCount ?? null,
        fileSizeBytes:
          typeof record.fileSizeBytes === 'number' &&
          Number.isSafeInteger(record.fileSizeBytes) &&
          record.fileSizeBytes >= 0
            ? BigInt(record.fileSizeBytes)
            : null,
        detail: record.detail ?? null,
      },
    });
  } catch (error) {
    // Deliberately swallowed: see the module docstring. Logged at warn so a
    // systematically failing audit is visible without failing the export.
    logger.warn(
      `Failed to record export ${record.event} for job ${record.jobId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      CTX
    );
  }
}
