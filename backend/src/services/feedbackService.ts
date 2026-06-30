/**
 * Feedback service — persists in-app bug reports / feature requests
 * and forwards a notification email to the project maintainer.
 *
 * Contract:
 *   - The DB row is the source of truth. createFeedback() resolves only
 *     after the row is committed.
 *   - An optional attachment is persisted to disk under
 *     `UPLOAD_DIR/feedback/<id>/` and referenced by `attachmentPath`. The
 *     form now accepts the actual microscopy file the report is about
 *     (video / ND2, up to 50 GB), so the attachment is NEVER emailed for
 *     large files — SMTP can't carry it. Only small screenshots are also
 *     inlined into the email; everything is reachable on the server disk.
 *   - The email is best-effort. If SMTP fails, the row already exists
 *     with `emailSentAt = NULL` so ops can replay later. We log and
 *     swallow so the user still gets a 201.
 *   - Reply-To is set to the submitter's email so the maintainer can
 *     reply directly from their mail client (no admin UI needed).
 *
 * UTIA SMTP has 2-10 min queue delays — `sendEmail()` handles queueing
 * internally and returns immediately, so this function does NOT block
 * on actual SMTP delivery. `emailSentAt` is therefore "queued at",
 * which is sufficient for the maintainer's use case.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '../db/prismaClient';
import { sendEmail } from './emailService';
import { renderFeedbackReceivedEmail } from '../templates/feedbackReceivedEmail';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import type { CreateFeedbackData } from '../types/validation';

/** Hard-coded per the product owner's request. Not configurable —
 *  changing it requires a deploy, which is the right friction level
 *  for a maintainer-only mailbox. */
export const FEEDBACK_RECIPIENT = '12bprusek@gym-nymburk.cz';

/** Images at or below this size are inlined into the notification email so
 *  a screenshot shows up directly in the maintainer's inbox. Anything
 *  larger — notably the multi-GB videos this form now accepts — is stored
 *  on disk and only referenced by path; the maintainer retrieves it from
 *  the server. */
export const FEEDBACK_INLINE_EMAIL_MAX_BYTES = 5 * 1024 * 1024;

export interface FeedbackAttachment {
  /** Absolute path where multer staged the upload (on the uploads volume,
   *  so the move into feedback/<id>/ is a same-filesystem rename). */
  stagedPath: string;
  /** MIME type. */
  mime: string;
  /** Original filename — basis for the stored filename + email reference. */
  filename: string;
  /** Size in bytes (from multer). */
  sizeBytes: number;
  /** Buffered content for an inline email attachment. Present ONLY for
   *  small images; undefined for large files, which are never read into
   *  memory — reading a multi-GB file would exhaust the container's RAM
   *  (and exceed Node's Buffer length limit). */
  buffer?: Buffer;
}

export interface CreateFeedbackResult {
  id: string;
  /** True if the email was successfully queued. Useful for the
   *  controller's response payload + tests. */
  emailQueued: boolean;
  /** True when an attachment was provided AND persisted to disk. False when
   *  one was provided but the move failed (the report is still saved — the
   *  caller should warn the user their file was not stored). Undefined when
   *  no attachment was provided. */
  attachmentStored?: boolean;
}

interface StoredAttachment {
  /** Path relative to UPLOAD_DIR, persisted in `attachmentPath`. */
  storageKey: string;
  /** Absolute path inside the backend container — surfaced in the email so
   *  the maintainer can retrieve the file from the server. */
  absolutePath: string;
}

/** Filesystem-safe filename: strip any directory component, then collapse
 *  anything outside [A-Za-z0-9._-] to `_`. Guards the stored name against
 *  path traversal and odd characters from the reporter's OS. */
function sanitizeFilename(name: string): string {
  const base = path.basename(name);
  // Strip leading/trailing underscores with two separately-anchored replaces.
  // The combined /^_+|_+$/ form has an ambiguous trailing-run match that trips
  // ReDoS scanners; anchoring each side keeps every pass strictly linear.
  const safe = base
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
  // A name that survives as "." or ".." would make path.join resolve to the
  // dir itself / its parent (rename onto a directory → EISDIR, attachment
  // silently lost), so collapse any all-dots result to the fallback.
  if (!safe || /^\.+$/.test(safe)) {
    return 'attachment';
  }
  return safe;
}

/** Move the staged upload into its permanent feedback/<id>/ directory.
 *  Same-volume rename (the staging dir lives on the uploads volume); falls
 *  back to copy+unlink only if staging and destination ever diverge. */
async function persistAttachment(
  feedbackId: string,
  attachment: FeedbackAttachment
): Promise<StoredAttachment> {
  const safe = sanitizeFilename(attachment.filename);
  const destDir = path.join(config.UPLOAD_DIR, 'feedback', feedbackId);
  await fs.mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, safe);

  try {
    await fs.rename(attachment.stagedPath, destPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'EXDEV') {
      throw err;
    }
    await fs.copyFile(attachment.stagedPath, destPath);
    await fs.unlink(attachment.stagedPath).catch(() => undefined);
  }

  return {
    storageKey: path.posix.join('feedback', feedbackId, safe),
    absolutePath: destPath,
  };
}

export async function createFeedback(
  userId: string,
  userEmail: string,
  data: CreateFeedbackData,
  attachment?: FeedbackAttachment
): Promise<CreateFeedbackResult> {
  // The row is created first (attachmentPath unknown until we have the id);
  // attachmentMime is set upfront so the row records that a file was sent
  // even if the disk move later fails.
  const row = await prisma.feedback.create({
    data: {
      userId,
      type: data.type,
      title: data.title,
      body: data.body,
      attachmentPath: null,
      attachmentMime: attachment?.mime ?? null,
    },
    select: { id: true },
  });

  // Persist the file to disk before the email so the notification can quote
  // a real path. A move failure must not lose the report — the row is
  // already committed; log, drop the staged file, and continue.
  let stored: StoredAttachment | null = null;
  if (attachment) {
    try {
      stored = await persistAttachment(row.id, attachment);
      await prisma.feedback.update({
        where: { id: row.id },
        data: { attachmentPath: stored.storageKey },
      });
    } catch (err) {
      logger.error(
        'Feedback attachment persist failed; row kept without stored file',
        err as Error,
        'FeedbackService',
        { feedbackId: row.id, userId }
      );
      await fs.unlink(attachment.stagedPath).catch(() => undefined);
    }
  }

  let emailQueued = false;
  try {
    const { subject, html, text } = renderFeedbackReceivedEmail({
      feedbackId: row.id,
      type: data.type,
      title: data.title,
      body: data.body,
      submitterEmail: userEmail,
      attachment:
        attachment && stored
          ? {
              filename: attachment.filename,
              sizeBytes: attachment.sizeBytes,
              storageKey: stored.storageKey,
              absolutePath: stored.absolutePath,
              inlined: Boolean(attachment.buffer),
            }
          : undefined,
      // A file was submitted but the disk move failed — tell the maintainer
      // so they can ask the reporter to re-send instead of assuming none.
      attachmentFailed: Boolean(attachment) && !stored,
    });

    await sendEmail({
      to: FEEDBACK_RECIPIENT,
      replyTo: userEmail,
      subject,
      html,
      text,
      // Inline only the small-image buffer; large files live on disk and the
      // email body points at them.
      attachments:
        attachment?.buffer && stored
          ? [
              {
                filename: attachment.filename,
                content: attachment.buffer,
                contentType: attachment.mime,
              },
            ]
          : undefined,
    });

    // `sendEmail` queues on UTIA SMTP — at this point the message is
    // either queued or sent. Either way, mark the row.
    await prisma.feedback.update({
      where: { id: row.id },
      data: { emailSentAt: new Date() },
    });
    emailQueued = true;
  } catch (err) {
    // Swallow: the DB row is enough for the user's report to survive.
    // Surfacing this as an HTTP 500 would be misleading — from the
    // user's POV, their feedback IS recorded.
    logger.error(
      'Feedback email queue failed; DB row persisted',
      err as Error,
      'FeedbackService',
      { feedbackId: row.id, userId }
    );
  }

  return {
    id: row.id,
    emailQueued,
    attachmentStored: attachment ? Boolean(stored) : undefined,
  };
}
