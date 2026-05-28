/**
 * Routes for in-app bug reports and feature requests.
 *
 * Authenticated multipart/form-data submissions: type + title + body
 * text fields plus an optional `attachment` (a screenshot or the
 * video/ND2 the report is about, ≤ 50 GB).
 *
 * Middleware ordering matters:
 *   1. authenticate          — populates req.user so the rate limiter
 *                              can key on user id instead of IP.
 *   2. feedbackRateLimiter   — 5 / minute / user.
 *   3. uploadFeedbackAttachment — parses multipart, attaches req.file
 *                              and populates req.body with the text
 *                              fields. MUST run before validateBody.
 *   4. handleUploadError     — turns multer/file-filter errors into a
 *                              clear 400 before validateBody.
 *   5. cleanupStagedFileOnFailure — removes the staged upload if a later
 *                              middleware (e.g. validateBody) rejects, so
 *                              a 50 GB file can't be orphaned in _staging.
 *   6. validateBody          — Zod-validates the text fields.
 *   7. controller            — DB write + disk move + email queue.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { promises as fs } from 'fs';
import { authenticate } from '../../middleware/auth';
import { feedbackRateLimiter } from '../../middleware/rateLimiter';
import {
  uploadFeedbackAttachment,
  handleUploadError,
} from '../../middleware/upload';
import { validateBody } from '../../middleware/validation';
import { createFeedbackSchema } from '../../types/validation';
import * as feedbackController from '../controllers/feedbackController';

const router = Router();

/**
 * Multer streams the (up to 50 GB) attachment to disk before validateBody
 * runs. If body validation then rejects, the controller — which owns the
 * staged-file cleanup in its `finally` — is never reached, leaving an
 * orphan in the staging dir. This safety net unlinks it once the response
 * finishes with an error status. On success (201) the controller already
 * moved the file away, so this is a no-op (status < 400).
 */
const cleanupStagedFileOnFailure = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  res.on('finish', () => {
    if (res.statusCode >= 400 && req.file?.path) {
      fs.unlink(req.file.path).catch(() => undefined);
    }
  });
  next();
};

router.post(
  '/',
  authenticate,
  feedbackRateLimiter,
  uploadFeedbackAttachment,
  handleUploadError,
  cleanupStagedFileOnFailure,
  validateBody(createFeedbackSchema),
  feedbackController.createFeedback
);

export default router;
