/**
 * Runtime-export tests for src/types/index.ts.
 *
 * Run with:
 *   NODE_OPTIONS=--max-old-space-size=4096 npx vitest run \
 *     src/types/__tests__/index.runtime.test.ts --reporter=dot
 *
 * SKIPPED (pure TS declarations — no runtime content):
 *   User, Profile, ApiError, AuthResponse, Project, ProjectFolder,
 *   NewProject, Image, UpdateProfile, SegmentationStatus, ExportJobStatus,
 *   PolygonData, SegmentationData, SegmentationResult, ProjectImage,
 *   VideoChannel, SpheroidMetric, ProjectType, KnownModelId
 *
 * TESTED (runtime values with real behaviour):
 *   PROJECT_TYPES const array membership
 *   isProjectType() type-guard — true/false paths + edge cases
 *   MODEL_TYPE_COMPATIBILITY map correctness per project type
 *   isModelCompatibleWithType() — compatible + incompatible + unknown
 *   getErrorMessage() — all major branches:
 *     plain Error, plain string, ApiError with statusCode, login 401,
 *     register 409, resource-code strings, camelCase normalisation,
 *     no-t fallbacks, unknown input
 */

import { describe, it, expect } from 'vitest';
import {
  PROJECT_TYPES,
  isProjectType,
  MODEL_TYPE_COMPATIBILITY,
  isModelCompatibleWithType,
  getErrorMessage,
} from '../index';

// ---------------------------------------------------------------------------
// PROJECT_TYPES
// ---------------------------------------------------------------------------

describe('PROJECT_TYPES', () => {
  it('contains exactly the seven known project types', () => {
    expect([...PROJECT_TYPES]).toEqual([
      'spheroid',
      'spheroid_invasive',
      'wound',
      'sperm',
      'microtubules',
      'microcapsule',
      'neurite',
    ]);
  });

  it('is a readonly tuple (length 7)', () => {
    expect(PROJECT_TYPES).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// isProjectType
// ---------------------------------------------------------------------------

describe('isProjectType()', () => {
  it.each([...PROJECT_TYPES])('returns true for known type "%s"', type => {
    expect(isProjectType(type)).toBe(true);
  });

  it('returns false for an unknown string', () => {
    expect(isProjectType('unknown_type')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isProjectType('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isProjectType(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isProjectType(undefined)).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isProjectType(42)).toBe(false);
  });

  it('returns false for an object', () => {
    expect(isProjectType({})).toBe(false);
  });

  it('is case-sensitive (uppercase fails)', () => {
    expect(isProjectType('Spheroid')).toBe(false);
    expect(isProjectType('SPERM')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MODEL_TYPE_COMPATIBILITY
// ---------------------------------------------------------------------------

describe('MODEL_TYPE_COMPATIBILITY', () => {
  it('spheroid accepts the 5 general models and excludes spheroid_disintegration', () => {
    const models = MODEL_TYPE_COMPATIBILITY.spheroid;
    expect(models).toContain('hrnet');
    expect(models).toContain('cbam_resunet');
    expect(models).toContain('unet_spherohq');
    expect(models).toContain('segformer');
    expect(models).toContain('mamba_unet');
    expect(models).not.toContain('spheroid_disintegration');
  });

  it('spheroid_invasive is locked to spheroid_disintegration only', () => {
    const models = MODEL_TYPE_COMPATIBILITY.spheroid_invasive;
    expect([...models]).toEqual(['spheroid_disintegration']);
  });

  it('wound uses only the wound model', () => {
    expect([...MODEL_TYPE_COMPATIBILITY.wound]).toEqual(['wound']);
  });

  it('sperm uses only the sperm model', () => {
    expect([...MODEL_TYPE_COMPATIBILITY.sperm]).toEqual(['sperm']);
  });

  it('microtubules uses only the microtubule model', () => {
    expect([...MODEL_TYPE_COMPATIBILITY.microtubules]).toEqual(['microtubule']);
  });

  it('has an entry for every known project type', () => {
    for (const type of PROJECT_TYPES) {
      expect(MODEL_TYPE_COMPATIBILITY).toHaveProperty(type);
    }
  });
});

// ---------------------------------------------------------------------------
// isModelCompatibleWithType
// ---------------------------------------------------------------------------

describe('isModelCompatibleWithType()', () => {
  it('returns true when model is in the compatibility list', () => {
    expect(isModelCompatibleWithType('hrnet', 'spheroid')).toBe(true);
    expect(isModelCompatibleWithType('wound', 'wound')).toBe(true);
    expect(isModelCompatibleWithType('sperm', 'sperm')).toBe(true);
    expect(isModelCompatibleWithType('microtubule', 'microtubules')).toBe(true);
    expect(
      isModelCompatibleWithType('spheroid_disintegration', 'spheroid_invasive')
    ).toBe(true);
  });

  it('returns false for cross-type mismatches', () => {
    expect(isModelCompatibleWithType('sperm', 'spheroid')).toBe(false);
    expect(isModelCompatibleWithType('wound', 'sperm')).toBe(false);
    expect(isModelCompatibleWithType('hrnet', 'wound')).toBe(false);
    expect(
      isModelCompatibleWithType('spheroid_disintegration', 'spheroid')
    ).toBe(false);
    expect(isModelCompatibleWithType('microtubule', 'spheroid')).toBe(false);
  });

  it('returns false for completely unknown model string', () => {
    expect(isModelCompatibleWithType('ghost_model', 'spheroid')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(isModelCompatibleWithType('HRNet', 'spheroid')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getErrorMessage
// ---------------------------------------------------------------------------

describe('getErrorMessage()', () => {
  // --- plain Error instance ---

  it('returns message from a plain Error instance', () => {
    const result = getErrorMessage(new Error('something broke'));
    expect(result).toBe('something broke');
  });

  it('returns message from an Error instance when t is provided but no statusCode', () => {
    const t = (k: string) => `translated:${k}`;
    const result = getErrorMessage(new Error('direct error'), t);
    expect(result).toBe('direct error');
  });

  // --- plain string ---

  it('returns a plain string unchanged when it has no resource code', () => {
    expect(getErrorMessage('simple error text')).toBe('simple error text');
  });

  it('normalises camelCase string to readable text', () => {
    // "someErrorMessage" → "Some error message"
    const result = getErrorMessage('someErrorMessage');
    expect(result).toBe('Some error message');
  });

  // --- ApiError with HTTP status codes (with t) ---

  it('returns t("errors.validation") for status 400', () => {
    const t = (k: string) => `t:${k}`;
    const err = { response: { status: 400, data: {} }, message: '' };
    expect(getErrorMessage(err, t)).toBe('t:errors.validation');
  });

  // --- The server's own message on an input error -------------------------
  //
  // The backend failure envelope is `{ success: false, error, code }` — the
  // message lives in `error`, NOT `message` (`backend/src/utils/response.ts`).
  // Reading the wrong field and then discarding it turned a precise diagnosis
  // into "Invalid request" at all 86 call sites of this helper. The fixture
  // below is the real 400 body observed in production on 2026-09-05.

  const DIMENSION_MISMATCH =
    'Dimension mismatch: the source is 2048×2048 but the target video is 1924×1476. Channels must share the same pixel grid.';

  const apiFailure = (status: number, error?: string) => ({
    response: {
      status,
      data: { success: false, error, code: 'GENERIC_ERROR' },
    },
    message: 'Request failed with status code ' + status,
  });

  // 405 and 410 are here because the first draft of the predicate enumerated
  // 400/409/422 plus `> 422`, which dropped every 4xx below 422 that was not
  // one of the three named ones.
  it.each([400, 402, 405, 409, 410, 422, 451])(
    'surfaces the server message on %i instead of the generic string',
    status => {
      const t = (k: string) => `t:${k}`;
      expect(getErrorMessage(apiFailure(status, DIMENSION_MISMATCH), t)).toBe(
        DIMENSION_MISMATCH
      );
    }
  );

  it('still surfaces it with no translation function', () => {
    expect(getErrorMessage(apiFailure(400, DIMENSION_MISMATCH))).toBe(
      DIMENSION_MISMATCH
    );
  });

  it('falls back to the generic string when the body carries no message', () => {
    // A 4xx with an empty body is the case the per-status text was written
    // for, and it must keep working.
    const t = (k: string) => `t:${k}`;
    expect(getErrorMessage(apiFailure(400), t)).toBe('t:errors.validation');
  });

  it('still reads a legacy `data.message` body', () => {
    // Not every producer uses ResponseHelper; accept both spellings.
    const t = (k: string) => `t:${k}`;
    const err = {
      response: { status: 400, data: { message: 'legacy shape' } },
      message: '',
    };
    expect(getErrorMessage(err, t)).toBe('legacy shape');
  });

  it.each([401, 403, 429])(
    'keeps the generic sentence on %i even when a message is present',
    status => {
      // The status IS the whole story here, and the generic sentence is the
      // better-written one. 401 additionally must not leak "Unauthorized".
      const t = (k: string) => `t:${k}`;
      const out = getErrorMessage(
        { ...apiFailure(status, 'raw server text'), config: { url: '/api/x' } },
        t
      );
      expect(out).not.toBe('raw server text');
      expect(out.startsWith('t:errors.')).toBe(true);
    }
  );

  it('keeps the generic sentence on 500 — a server message is an internal', () => {
    const t = (k: string) => `t:${k}`;
    expect(
      getErrorMessage(apiFailure(500, 'ENOENT: /app/secret/path'), t)
    ).toBe('t:errors.server');
  });

  it('returns t("errors.sessionExpired") for status 401 (non-login URL)', () => {
    const t = (k: string) => `t:${k}`;
    const err = {
      response: { status: 401, data: {} },
      message: '',
      config: { url: '/api/profile' },
    };
    expect(getErrorMessage(err, t)).toBe('t:errors.sessionExpired');
  });

  it('returns t("errors.invalidCredentials") for 401 on login URL', () => {
    const t = (k: string) => `t:${k}`;
    const err = {
      response: { status: 401, data: {} },
      message: '',
      config: { url: '/auth/login' },
    };
    expect(getErrorMessage(err, t)).toBe('t:errors.invalidCredentials');
  });

  it('returns t("errors.invalidCredentials") for 401 on signin URL', () => {
    const t = (k: string) => `t:${k}`;
    const err = {
      response: { status: 401, data: {} },
      message: '',
      config: { url: '/auth/signin' },
    };
    expect(getErrorMessage(err, t)).toBe('t:errors.invalidCredentials');
  });

  it('returns t("errors.forbidden") for status 403', () => {
    const t = (k: string) => `t:${k}`;
    const err = { response: { status: 403, data: {} }, message: '' };
    expect(getErrorMessage(err, t)).toBe('t:errors.forbidden');
  });

  it('returns t("errors.notFound") for status 404', () => {
    const t = (k: string) => `t:${k}`;
    const err = { response: { status: 404, data: {} }, message: '' };
    expect(getErrorMessage(err, t)).toBe('t:errors.notFound');
  });

  it('returns t("errors.conflict") for status 409 (non-registration URL)', () => {
    const t = (k: string) => `t:${k}`;
    const err = {
      response: { status: 409, data: {} },
      message: '',
      config: { url: '/api/projects' },
    };
    expect(getErrorMessage(err, t)).toBe('t:errors.conflict');
  });

  it('returns t("errors.emailAlreadyExists") for 409 on register URL', () => {
    const t = (k: string) => `t:${k}`;
    const err = {
      response: { status: 409, data: {} },
      message: '',
      config: { url: '/auth/register' },
    };
    expect(getErrorMessage(err, t)).toBe('t:errors.emailAlreadyExists');
  });

  it('returns t("errors.emailAlreadyExists") for 409 on signup URL', () => {
    const t = (k: string) => `t:${k}`;
    const err = {
      response: { status: 409, data: {} },
      message: '',
      config: { url: '/auth/signup' },
    };
    expect(getErrorMessage(err, t)).toBe('t:errors.emailAlreadyExists');
  });

  it('returns t("errors.validation") for status 422', () => {
    const t = (k: string) => `t:${k}`;
    const err = { response: { status: 422, data: {} }, message: '' };
    expect(getErrorMessage(err, t)).toBe('t:errors.validation');
  });

  it('returns t("errors.tooManyRequests") for status 429', () => {
    const t = (k: string) => `t:${k}`;
    const err = { response: { status: 429, data: {} }, message: '' };
    expect(getErrorMessage(err, t)).toBe('t:errors.tooManyRequests');
  });

  it('returns t("errors.server") for status 500', () => {
    const t = (k: string) => `t:${k}`;
    const err = { response: { status: 500, data: {} }, message: '' };
    expect(getErrorMessage(err, t)).toBe('t:errors.server');
  });

  it('returns t("errors.serverUnavailable") for status 502/503/504', () => {
    const t = (k: string) => `t:${k}`;
    for (const status of [502, 503, 504]) {
      const err = { response: { status, data: {} }, message: '' };
      expect(getErrorMessage(err, t)).toBe('t:errors.serverUnavailable');
    }
  });

  it('returns t("errors.clientError") for generic 4xx', () => {
    const t = (k: string) => `t:${k}`;
    const err = { response: { status: 418, data: {} }, message: '' };
    expect(getErrorMessage(err, t)).toBe('t:errors.clientError');
  });

  it('returns t("errors.server") for generic 5xx', () => {
    const t = (k: string) => `t:${k}`;
    const err = { response: { status: 599, data: {} }, message: '' };
    expect(getErrorMessage(err, t)).toBe('t:errors.server');
  });

  // --- ApiError with HTTP status codes (without t) ---

  it('returns hardcoded string for 400 without t', () => {
    const err = { response: { status: 400, data: {} }, message: '' };
    expect(getErrorMessage(err)).toBe(
      'Invalid request. Please check your input.'
    );
  });

  it('returns hardcoded string for 401 without t (non-login URL)', () => {
    const err = {
      response: { status: 401, data: {} },
      message: '',
      config: { url: '/api/data' },
    };
    expect(getErrorMessage(err)).toBe(
      'Your session has expired. Please sign in again.'
    );
  });

  it('returns hardcoded string for 403 without t', () => {
    const err = { response: { status: 403, data: {} }, message: '' };
    expect(getErrorMessage(err)).toBe(
      'You do not have permission to perform this action.'
    );
  });

  it('returns hardcoded string for 404 without t', () => {
    const err = { response: { status: 404, data: {} }, message: '' };
    expect(getErrorMessage(err)).toBe('The requested resource was not found.');
  });

  it('returns hardcoded string for 409 without t', () => {
    const err = { response: { status: 409, data: {} }, message: '' };
    expect(getErrorMessage(err)).toBe(
      'A conflict occurred. Please refresh and try again.'
    );
  });

  it('returns hardcoded string for 422 without t', () => {
    const err = { response: { status: 422, data: {} }, message: '' };
    expect(getErrorMessage(err)).toBe(
      'Validation error. Please check your input.'
    );
  });

  it('returns hardcoded string for 429 without t', () => {
    const err = { response: { status: 429, data: {} }, message: '' };
    expect(getErrorMessage(err)).toBe(
      'Too many requests. Please wait a moment and try again.'
    );
  });

  it('returns hardcoded string for 500 without t', () => {
    const err = { response: { status: 500, data: {} }, message: '' };
    expect(getErrorMessage(err)).toBe('Server error. Please try again later.');
  });

  it('returns hardcoded string for 503 without t', () => {
    const err = { response: { status: 503, data: {} }, message: '' };
    expect(getErrorMessage(err)).toBe(
      'Service temporarily unavailable. Please try again later.'
    );
  });

  // --- resource code in message string ---

  it('resolves "resource code 401" in string to session-expired message without t', () => {
    const result = getErrorMessage('Failed with resource code 401');
    expect(result).toBe('Your session has expired. Please sign in again.');
  });

  it('resolves "resource code 404" in string to not-found message without t', () => {
    const result = getErrorMessage('Failed with resource code 404');
    expect(result).toBe('The requested resource was not found.');
  });

  it('resolves "resource code 500" in string using t()', () => {
    const t = (k: string) => `t:${k}`;
    const result = getErrorMessage('Error resource code 500', t);
    expect(result).toBe('t:errors.server');
  });

  it('resolves "resource code 502" in string to serverUnavailable without t', () => {
    const result = getErrorMessage('resource code 503');
    expect(result).toBe(
      'Service temporarily unavailable. Please try again later.'
    );
  });

  it('resolves "resource code 418" (generic 4xx) in string without t', () => {
    const result = getErrorMessage('resource code 418');
    expect(result).toBe('Request error. Please try again.');
  });

  it('resolves "resource code 599" (generic 5xx) in string without t', () => {
    const result = getErrorMessage('resource code 599');
    expect(result).toBe('Server error. Please try again later.');
  });

  // --- resource code in object message field ---

  it('resolves resource code embedded in object .message field', () => {
    const err = { message: 'Proxy error resource code 403' };
    expect(getErrorMessage(err)).toBe(
      'You do not have permission to perform this action.'
    );
  });

  it('resolves resource code in object .message using t()', () => {
    const t = (k: string) => `t:${k}`;
    const err = { message: 'resource code 429' };
    expect(getErrorMessage(err, t)).toBe('t:errors.tooManyRequests');
  });

  // --- camelCase normalisation in object message ---

  it('normalises camelCase object message to readable text', () => {
    const err = { message: 'someErrorMessage' };
    const result = getErrorMessage(err);
    expect(result).toBe('Some error message');
  });

  // --- response.data.message takes priority over message ---

  it('prefers response.data.message over top-level message', () => {
    const err = {
      message: 'top-level',
      response: { data: { message: 'detailed message' }, status: undefined },
    };
    expect(getErrorMessage(err)).toBe('detailed message');
  });

  // --- unknown / null / undefined ---

  it('returns t("errors.unknown") for null with t provided', () => {
    const t = (k: string) => `t:${k}`;
    expect(getErrorMessage(null, t)).toBe('t:errors.unknown');
  });

  it('returns t("errors.unknown") for undefined with t provided', () => {
    const t = (k: string) => `t:${k}`;
    expect(getErrorMessage(undefined, t)).toBe('t:errors.unknown');
  });

  it('returns "An unknown error occurred" for null without t', () => {
    expect(getErrorMessage(null)).toBe('An unknown error occurred');
  });

  it('returns "An unknown error occurred" for undefined without t', () => {
    expect(getErrorMessage(undefined)).toBe('An unknown error occurred');
  });

  it('returns "An unknown error occurred" for a number without t', () => {
    expect(getErrorMessage(123)).toBe('An unknown error occurred');
  });
});
