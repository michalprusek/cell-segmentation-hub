import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { authenticateApiKey } from '../../middleware/apiKeyAuth';
import {
  MODEL_REGISTRY,
  type KnownModelId,
} from '../../constants/modelRegistry';
import { describeModel, isKnownModel } from './models';
import { segmentRoute } from './segment';
import { logger } from '../../utils/logger';
import {
  V1_RATE_LIMIT_PER_MINUTE,
  V1_UNAUTHENTICATED_LIMIT_PER_MINUTE,
} from './limits';
import { buildOpenApi } from './openapi';
import {
  PROBLEM_TYPES,
  PROBLEM_TYPE_BASE,
  sendProblem,
  type ProblemCode,
} from './problem';

export { V1_RATE_LIMIT_PER_MINUTE, V1_UNAUTHENTICATED_LIMIT_PER_MINUTE };

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

/**
 * Before authentication, per IP. A well-formed but unknown key costs a
 * database read, and anyone can compute a valid checksum, so something has to
 * bound that for callers who have no key to be limited by. It sends no
 * RateLimit headers: those describe the per-key budget, and two policies on
 * one response is exactly the confusion the global limiter's exemption for
 * this path exists to remove.
 */

const v1IpRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: V1_UNAUTHENTICATED_LIMIT_PER_MINUTE,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn(`Rate limit exceeded on /api/v1 for IP ${req.ip}`, 'V1');
    sendProblem(res, 'rate-limit-exceeded', {
      detail:
        'Too many requests from this address. Retry after the number of seconds in the Retry-After header.',
      // Set by hand: with its headers switched off the limiter sends none,
      // and a 429 without Retry-After leaves the client guessing.
      headers: { 'Retry-After': '60' },
    });
  },
});

/** True for a request the global limiter in server.ts must leave to v1. */
export const isPublicApiPath = (path: string): boolean =>
  path === '/api/v1' || path.startsWith('/api/v1/');

const router = Router();

router.use(v1IpRateLimiter);

// --- public: the contract itself needs no key to read ----------------------

const openApiDocument = buildOpenApi();

router.get('/openapi.json', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(openApiDocument);
});

// Swagger UI over that document. `serveFiles` rather than `serve`: the app
// already mounts swagger-ui-express for its own spec at /api-docs, and the
// plain `serve` middleware shares one document between every mount.
router.use(
  '/docs',
  swaggerUi.serveFiles(openApiDocument, {}),
  swaggerUi.setup(openApiDocument, { customSiteTitle: 'SpheroSeg API v1' })
);

/** What a problem `type` URI resolves to (RFC 9457 §3.1.1). */
router.get('/problems/:code', (req: Request, res: Response) => {
  const code = req.params.code as ProblemCode;
  if (!Object.prototype.hasOwnProperty.call(PROBLEM_TYPES, code)) {
    sendProblem(res, 'not-found', { detail: 'No such problem type.' });
    return;
  }
  const { status, title, description } = PROBLEM_TYPES[code];
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    type: `${PROBLEM_TYPE_BASE}${code}`,
    code,
    title,
    status,
    description,
  });
});

// --- everything below needs an API key --------------------------------------

router.use(authenticateApiKey);
router.use(v1RateLimiter);

router.get('/models', (_req: Request, res: Response) => {
  res.json({
    data: (Object.keys(MODEL_REGISTRY) as KnownModelId[]).map(describeModel),
  });
});

router.get('/models/:id', (req: Request, res: Response) => {
  if (!isKnownModel(req.params.id)) {
    sendProblem(res, 'not-found', { detail: 'No such model.' });
    return;
  }
  res.json(describeModel(req.params.id));
});

router.post('/segment', ...segmentRoute);

// The detail does not echo the requested path. Nothing a browser would render
// is sent here (the media type is problem+json), but reflecting request input
// into a response buys the client nothing it does not already know.
router.use((_req: Request, res: Response) => {
  sendProblem(res, 'not-found', {
    detail:
      'No such endpoint in API version v1. Check the method and the path.',
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
