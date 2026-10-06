import { Response } from 'express';

/**
 * Error bodies for the public API: RFC 9457 Problem Details
 * (`application/problem+json`).
 *
 * The rest of the backend answers with `{ success: false, error, code }` and
 * mostly Czech messages, which is right for the app's own frontend — it
 * translates by `code`. A third-party client has no such table, so `/api/v1`
 * speaks the standard instead, in English, and nothing under `/api/v1` may
 * fall through to `ResponseHelper` or the global error handler.
 *
 * Every problem type this API can return is listed here, so the set is
 * closed and documentable. `type` URIs are identifiers and stay the same on
 * every deployment (RFC 9457 §3.1.1 recommends absolute URIs).
 */
const PROBLEM_TYPE_BASE = 'https://spherosegapp.utia.cas.cz/api/v1/problems/';

export const PROBLEM_TYPES = {
  'authentication-required': {
    status: 401,
    title: 'Authentication required',
  },
  'invalid-api-key': { status: 401, title: 'Invalid API key' },
  'credentials-in-url': {
    status: 400,
    title: 'Credentials must not be sent in the URL',
  },
  'rate-limit-exceeded': { status: 429, title: 'Rate limit exceeded' },
  'too-many-concurrent-requests': {
    status: 429,
    title: 'Too many concurrent requests',
  },
  'unsupported-media-type': {
    status: 415,
    title: 'Unsupported request media type',
  },
  'validation-failed': { status: 422, title: 'Request validation failed' },
  'unsupported-image': {
    status: 422,
    title: 'The image could not be read',
  },
  'payload-too-large': { status: 413, title: 'Upload too large' },
  'image-too-large': {
    status: 413,
    title: 'Image has too many pixels for a synchronous request',
  },
  'output-not-representable': {
    status: 422,
    title: 'The result cannot be represented in the requested format',
  },
  'not-acceptable': {
    status: 406,
    title: 'The requested output format does not match the Accept header',
  },
  'server-busy': { status: 503, title: 'Segmentation service is busy' },
  'segmentation-timeout': {
    status: 504,
    title: 'Segmentation did not finish in time',
  },
  'segmentation-failed': { status: 502, title: 'Segmentation failed' },
  'not-found': { status: 404, title: 'Resource not found' },
  'internal-error': { status: 500, title: 'Internal server error' },
} as const;

export type ProblemCode = keyof typeof PROBLEM_TYPES;

export interface ProblemOptions {
  detail?: string;
  headers?: Record<string, string>;
  /** Extension members (RFC 9457 §3.2). */
  extensions?: Record<string, unknown>;
}

export function sendProblem(
  res: Response,
  code: ProblemCode,
  options: ProblemOptions = {}
): void {
  const { status, title } = PROBLEM_TYPES[code];
  const body = {
    type: `${PROBLEM_TYPE_BASE}${code}`,
    title,
    status,
    ...(options.detail ? { detail: options.detail } : {}),
    // `type` is a URI and awkward to switch on; `code` is the same identifier
    // as a bare token.
    code,
    ...options.extensions,
  };

  for (const [name, value] of Object.entries(options.headers ?? {})) {
    res.setHeader(name, value);
  }

  // `res.send`, not `res.json`: server.ts wraps `res.json` to force
  // `application/json`, which would silently replace the problem media type.
  res
    .status(status)
    .type('application/problem+json')
    .send(JSON.stringify(body));
}
