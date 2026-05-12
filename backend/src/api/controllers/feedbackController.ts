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
 * (type, title, body) and an optional `attachment` (PNG/JPG ≤ 5 MB).
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
    // Multer's diskStorage gives us a path; we read it into a buffer here
    // so feedbackService can hand it to nodemailer in one shot. The temp
    // file is unlinked in the finally block to avoid filling /tmp.
    const buffer = await fs.readFile(req.file.path);
    attachment = {
      path: req.file.path,
      mime: req.file.mimetype,
      filename: req.file.originalname,
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
      emailQueued: result.emailQueued,
    });

    return ResponseHelper.success(
      res,
      { id: result.id, emailQueued: result.emailQueued },
      'Feedback submitted',
      201
    );
  } finally {
    // Best-effort cleanup of the temp upload — the buffered copy is
    // already in the queued email. Leaving the file on disk would slowly
    // fill /tmp/spheroseg-feedback-uploads.
    if (req.file?.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (err) {
        logger.warn(
          `Failed to unlink feedback temp file ${req.file.path}: ${(err as Error).message}`,
          'FeedbackController'
        );
      }
    }
  }
});
