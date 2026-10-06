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
export const PROBLEM_TYPE_BASE = 'https://spherosegapp.utia.cas.cz/api/v1/problems/';

export const PROBLEM_TYPES = {
  'authentication-required': {
    status: 401,
    title: 'Authentication required',
    description:
      'No credentials were sent. Send an API key as `Authorization: Bearer <key>`; create one under Settings → API.',
  },
  'invalid-api-key': {
    status: 401,
    title: 'Invalid API key',
    description:
      'The key is malformed, unknown, revoked or expired. These cases are deliberately not distinguished.',
  },
  'credentials-in-url': {
    status: 400,
    title: 'Credentials must not be sent in the URL',
    description:
      'A key was sent as a query parameter. URLs are logged; treat that key as leaked, revoke it, and send keys only in the Authorization header.',
  },
  'rate-limit-exceeded': {
    status: 429,
    title: 'Rate limit exceeded',
    description:
      'Too many requests. Wait the number of seconds given in the Retry-After header.',
  },
  'too-many-concurrent-requests': {
    status: 429,
    title: 'Too many concurrent requests',
    description:
      'This key already has the maximum number of segmentations in flight. Wait for one to finish.',
  },
  'unsupported-media-type': {
    status: 415,
    title: 'Unsupported request media type',
    description:
      'The request body must be multipart/form-data with the image in a file part named `image`.',
  },
  'validation-failed': {
    status: 422,
    title: 'Request validation failed',
    description:
      'One or more request fields are invalid. `errors` lists every one as `{field, detail}`. A parameter the chosen model does not read is refused here rather than ignored.',
  },
  'unsupported-image': {
    status: 422,
    title: 'The image could not be read',
    description:
      'The upload is not a readable PNG, JPEG, TIFF or BMP image. The file is judged by its content, not its name.',
  },
  'payload-too-large': {
    status: 413,
    title: 'Upload too large',
    description:
      'The upload exceeds the size limit in bytes (`max_bytes`).',
  },
  'image-too-large': {
    status: 413,
    title: 'Image has too many pixels for a synchronous request',
    description:
      'The image has more pixels than a synchronous request accepts (`max_pixels`).',
  },
  'output-not-representable': {
    status: 422,
    title: 'The result cannot be represented in the requested format',
    description:
      'The result cannot be written in the requested format, for example more objects than a 16-bit label image can number.',
  },
  'not-acceptable': {
    status: 406,
    title: 'The requested output format does not match the Accept header',
    description:
      'The Accept header excludes the media type of the chosen `output_format`. Accept is a check on the format, not the way to choose it.',
  },
  'server-busy': {
    status: 503,
    title: 'Segmentation service is busy',
    description:
      'Too many segmentations are queued. Retry after the number of seconds in Retry-After.',
  },
  'segmentation-timeout': {
    status: 504,
    title: 'Segmentation did not finish in time',
    description:
      'The model did not finish in time.',
  },
  'segmentation-failed': {
    status: 502,
    title: 'Segmentation failed',
    description:
      'The segmentation service could not process the image.',
  },
  'not-found': {
    status: 404,
    title: 'Resource not found',
    description:
      'No such endpoint or resource in this API version.',
  },
  'internal-error': {
    status: 500,
    title: 'Internal server error',
    description:
      'An unexpected error. Nothing about the cause is disclosed; the server log has it.',
  },
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
