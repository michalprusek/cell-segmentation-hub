/**
 * The record of who acted as whom.
 *
 * Impersonation makes an admin's actions indistinguishable from the user's —
 * that is its entire purpose, and it is also what makes it dangerous. This
 * table is the only thing that tells the two apart afterwards, so a support
 * tool without it is a back door.
 *
 * It follows `exportAuditService` deliberately, and for the same two reasons:
 *
 * **It never breaks the operation.** Every write is fire-and-forget and
 * swallows its own errors. `recordImpersonationEvent` returns a promise so
 * tests can await it; production call sites do not.
 *
 * **It appends, never updates.** One row per event ("start" / "stop" /
 * "denied"), each with its own actor and timestamp, correlated by
 * `sessionId`. A mutable row-per-session would need a read-modify-write and
 * could only name one person.
 *
 * One deliberate difference from the export log: BOTH e-mails are
 * denormalised, because either account can be deleted and the row has to stay
 * readable when either join is gone.
 */

import { prisma } from '../db';
import { logger } from '../utils/logger';

const CTX = 'ImpersonationAuditService';

/** What happened. */
export type ImpersonationEvent =
  /** A session was minted for the target. */
  | 'start'
  /** The admin returned to their own session. */
  | 'stop'
  /**
   * An impersonation was REFUSED inside `startImpersonation` — an attempt at
   * another admin, an unknown target, or the admin's own account. The most
   * interesting rows in a log whose purpose is attribution: without them a
   * probe for valid user ids leaves no trace.
   *
   * NOT every refusal reaches here. A caller who is not an admin at all is
   * turned away by `requireAdmin` one layer earlier, before any service code
   * runs; that refusal is a `logger.warn`, not a row. Recording it would mean
   * a database write on every 403 of the whole admin surface, including
   * ordinary 403s from a stale tab. Read this table as "what admins did",
   * and access.log as "who knocked".
   */
  | 'denied';

export interface ImpersonationEventRecord {
  event: ImpersonationEvent;
  /** The real actor. Null only where the request carried no usable identity. */
  adminId: string | null;
  /** Whose account was (to be) acted as. Null when the target did not resolve. */
  targetId: string | null;
  /**
   * Correlates the rows of one impersonation. Generated at "start" and
   * carried in the session's JWT and Redis refresh record; a "denied" row
   * that never became a session still gets one so the row is addressable.
   */
  sessionId: string;
  ip?: string | null;
  userAgent?: string | null;
  detail?: string | null;
}

/** Look up an e-mail without ever letting the failure cost us the row. */
async function emailFor(userId: string | null): Promise<string | null> {
  if (!userId) {
    return null;
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Append one row. Returns a promise so tests can await the write; production
 * callers deliberately do not, and must not — see the module docstring.
 */
export async function recordImpersonationEvent(
  record: ImpersonationEventRecord
): Promise<void> {
  const [adminEmail, targetEmail] = await Promise.all([
    emailFor(record.adminId),
    emailFor(record.targetId),
  ]);

  try {
    await prisma.impersonationLog.create({
      data: {
        event: record.event,
        adminId: record.adminId,
        adminEmail,
        targetId: record.targetId,
        targetEmail,
        sessionId: record.sessionId,
        // Truncated at write time: both are attacker-controlled headers and
        // this is a TEXT column with no length limit of its own.
        ip: record.ip ? record.ip.slice(0, 100) : null,
        userAgent: record.userAgent ? record.userAgent.slice(0, 300) : null,
        detail: record.detail ?? null,
      },
    });
  } catch (error) {
    // Deliberately swallowed: see the module docstring. Logged at warn so a
    // systematically failing audit is visible without breaking support work.
    logger.warn(
      `Failed to record impersonation ${record.event} (session ${record.sessionId}): ${
        error instanceof Error ? error.message : String(error)
      }`,
      CTX
    );
  }
}
