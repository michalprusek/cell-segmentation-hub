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
