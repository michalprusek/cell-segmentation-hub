import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateApiKey } from '../../middleware/apiKeyAuth';
import { MODEL_REGISTRY } from '../../constants/modelRegistry';
import { logger } from '../../utils/logger';
import { sendProblem } from './problem';

/**
 * The public, versioned API: `/api/v1`.
 *
 * Everything here is authenticated by API key and answers errors as RFC 9457
 * problem documents. The router is self-contained on purpose — it ends in its
 * own 404 and its own error handler, so a request under `/api/v1` can never
 * reach the app's Czech-language `ResponseHelper` defaults or its
 * `{ success: false }` envelope.
 *
 * VERSIONING: the major version is in the path and `v1` only ever changes
 * additively (new endpoints, new optional parameters, new response fields).
 * Clients must ignore fields they do not know.
 *
 * NAME COLLISION: the ML service's own routes are also `/api/v1/*`, on its
 * own port. They are unrelated. nginx must never gain a `location /api/v1/`
 * pointing at `ml_service` — that service has no authentication at all.
 */

/** Requests per key per minute. Inference endpoints add their own limits. */
export const V1_RATE_LIMIT_PER_MINUTE = 120;

const v1RateLimiter = rateLimit({
  windowMs: 60_000,
  limit: V1_RATE_LIMIT_PER_MINUTE,
  // `RateLimit` + `RateLimit-Policy` as structured fields. This is an IETF
  // draft (draft-ietf-httpapi-ratelimit-headers), not an RFC; `Retry-After`
  // on the 429 is the part that is standard (RFC 6585 §4).
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Mounted after `authenticateApiKey`, so the key is always there. Keyed by
  // key, not by user: one runaway script must not lock out the same person's
  // other integrations.
  keyGenerator: (req: Request) => `apikey:${req.apiKey?.id}`,
  handler: (req: Request, res: Response) => {
    logger.warn(`Rate limit exceeded for API key ${req.apiKey?.prefix}`, 'V1');
    sendProblem(res, 'rate-limit-exceeded', {
      detail: `At most ${V1_RATE_LIMIT_PER_MINUTE} requests per minute per API key. Retry after the number of seconds in the Retry-After header.`,
    });
  },
});

const router = Router();

router.use(authenticateApiKey);
router.use(v1RateLimiter);

router.get('/models', (_req: Request, res: Response) => {
  res.json({
    data: Object.entries(MODEL_REGISTRY).map(([id, entry]) => ({
      id,
      project_types: entry.compatibleProjectTypes,
    })),
  });
});

router.use((req: Request, res: Response) => {
  sendProblem(res, 'not-found', {
    detail: `No such endpoint: ${req.method} ${req.baseUrl}${req.path}`,
  });
});

// Four parameters: that is how Express recognises an error handler.
router.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, error, 'V1');
  if (res.headersSent) {
    return;
  }
  // No `detail`: RFC 9457 §5 — an error message is implementation detail.
  sendProblem(res, 'internal-error');
});

export default router;
