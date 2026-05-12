/**
 * Feedback service — persists in-app bug reports / feature requests
 * and forwards a notification email to the project maintainer.
 *
 * Contract:
 *   - The DB row is the source of truth. createFeedback() resolves only
 *     after the row is committed.
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

import { prisma } from '../db/prismaClient';
import { sendEmail } from './emailService';
import { renderFeedbackReceivedEmail } from '../templates/feedbackReceivedEmail';
import { logger } from '../utils/logger';
import type { CreateFeedbackData } from '../types/validation';

/** Hard-coded per the product owner's request. Not configurable —
 *  changing it requires a deploy, which is the right friction level
 *  for a maintainer-only mailbox. */
export const FEEDBACK_RECIPIENT = '12bprusek@gym-nymburk.cz';

export interface FeedbackAttachment {
  /** Absolute filesystem path where multer stored the file. */
  path: string;
  /** MIME type ('image/png' | 'image/jpeg'). */
  mime: string;
  /** Original filename for the email attachment + DB hint. */
  filename: string;
  /** Buffered content — read by the controller after multer disk-write
   *  so we can hand it to nodemailer without re-reading from disk. */
  buffer: Buffer;
}

export interface CreateFeedbackResult {
  id: string;
  /** True if the email was successfully queued. Useful for the
   *  controller's response payload + tests. */
  emailQueued: boolean;
}

export async function createFeedback(
  userId: string,
  userEmail: string,
  data: CreateFeedbackData,
  attachment?: FeedbackAttachment
): Promise<CreateFeedbackResult> {
  const row = await prisma.feedback.create({
    data: {
      userId,
      type: data.type,
      title: data.title,
      body: data.body,
      attachmentPath: attachment?.path ?? null,
      attachmentMime: attachment?.mime ?? null,
    },
    select: { id: true },
  });

  let emailQueued = false;
  try {
    const { subject, html, text } = renderFeedbackReceivedEmail({
      feedbackId: row.id,
      type: data.type,
      title: data.title,
      body: data.body,
      submitterEmail: userEmail,
      hasAttachment: Boolean(attachment),
    });

    await sendEmail({
      to: FEEDBACK_RECIPIENT,
      replyTo: userEmail,
      subject,
      html,
      text,
      attachments: attachment
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

  return { id: row.id, emailQueued };
}
