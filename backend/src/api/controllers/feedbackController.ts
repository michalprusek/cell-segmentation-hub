import { Request, Response } from 'express';
import { promises as fs } from 'fs';
import * as FeedbackService from '../../services/feedbackService';
import { ResponseHelper, asyncHandler } from '../../utils/response';
import { logger } from '../../utils/logger';
import type { CreateFeedbackData } from '../../types/validation';

/**
 * POST /api/feedback
 *
 * Authenticated. Accepts multipart/form-data with text fields
 * (type, title, body) and an optional `attachment` — a screenshot OR the
 * microscopy video/ND2 the report is about (≤ 50 GB). Large files are
 * streamed to disk and stored under `feedback/<id>/`; only small images
 * are inlined into the notification email.
 *
 * Response shape on success:
 *   { id: string, emailQueued: boolean }
 *
 * The DB row commits before the email is queued, so a 201 from this
 * endpoint guarantees persistence. emailQueued=false means the
 * notification deferred — admins can replay later from `emailSentAt IS NULL`.
 */
export const createFeedback = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    return ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'Feedback');
  }

  const data = req.body as CreateFeedbackData;

  let attachment: FeedbackService.FeedbackAttachment | undefined;
  if (req.file) {
    // Only small images are read into memory (for the inline email). Large
    // files — videos / ND2 up to 50 GB — are NEVER buffered: reading a
    // multi-GB file into memory would exhaust the container's RAM. They stay
    // on disk and feedbackService moves them into feedback/<id>/.
    const isInlineImage =
      req.file.size <= FeedbackService.FEEDBACK_INLINE_EMAIL_MAX_BYTES &&
      (req.file.mimetype === 'image/png' || req.file.mimetype === 'image/jpeg');
    let buffer: Buffer | undefined;
    if (isInlineImage) {
      try {
        buffer = await fs.readFile(req.file.path);
      } catch (err) {
        // Failing to read the small image for inlining must not sink the
        // whole report — the file is already on disk and still gets stored +
        // referenced; we just skip the inline copy.
        logger.warn(
          `Feedback inline-image read failed; sending without inline copy: ${(err as Error).message}`,
          'FeedbackController'
        );
      }
    }
    attachment = {
      stagedPath: req.file.path,
      mime: req.file.mimetype,
      filename: req.file.originalname,
      sizeBytes: req.file.size,
      buffer,
    };
  }

  try {
    const result = await FeedbackService.createFeedback(
      req.user.id,
      req.user.email,
      data,
      attachment
    );

    logger.info('Feedback created', 'FeedbackController', {
      feedbackId: result.id,
      userId: req.user.id,
      type: data.type,
      hasAttachment: Boolean(attachment),
      attachmentBytes: attachment?.sizeBytes ?? 0,
      attachmentStored: result.attachmentStored,
      emailQueued: result.emailQueued,
    });

    return ResponseHelper.success(
      res,
      {
        id: result.id,
        emailQueued: result.emailQueued,
        attachmentStored: result.attachmentStored,
      },
      'Feedback submitted',
      201
    );
  } finally {
    // Safety net: on success feedbackService renames the staged file into
    // feedback/<id>/, so this unlink hits a now-missing path (ENOENT, ignored).
    // It only does real work when the move never happened, keeping the
    // staging dir free of orphans.
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => undefined);
    }
  }
});
