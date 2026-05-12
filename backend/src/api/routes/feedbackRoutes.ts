/**
 * Routes for in-app bug reports and feature requests.
 *
 * Authenticated multipart/form-data submissions: type + title + body
 * text fields plus an optional `attachment` image (PNG/JPG ≤ 5 MB).
 *
 * Middleware ordering matters:
 *   1. authenticate          — populates req.user so the rate limiter
 *                              can key on user id instead of IP.
 *   2. feedbackRateLimiter   — 5 / minute / user.
 *   3. uploadFeedbackAttachment — parses multipart, attaches req.file
 *                              and populates req.body with the text
 *                              fields. MUST run before validateBody.
 *   4. validateBody          — Zod-validates the text fields.
 *   5. controller            — DB write + email queue.
 */

import { Router } from 'express';
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

router.post(
  '/',
  authenticate,
  feedbackRateLimiter,
  uploadFeedbackAttachment,
  // handleUploadError catches Multer/file-filter errors (oversize file,
  // bad MIME) before validateBody is even reached, so the client gets a
  // clear 400 instead of a generic 500.
  handleUploadError,
  validateBody(createFeedbackSchema),
  feedbackController.createFeedback
);

export default router;
