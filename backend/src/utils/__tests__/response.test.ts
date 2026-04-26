import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { Response } from 'express';
import { ResponseHelper, calculatePagination } from '../response';
import { logger } from '../logger';

// The helper internally calls `logger.warn` / `logger.error`. The logger
// module reads runtime config at import; for these tests we stub out only
// the methods we care about so the assertions don't get noisy.
vi.mock('../logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res) as Response['status'];
  res.json = vi.fn().mockReturnValue(res) as Response['json'];
  return res as Response;
};

describe('ResponseHelper.success', () => {
  it('writes 200 by default with success=true and data field', () => {
    const res = mockRes();
    ResponseHelper.success(res, { id: 'abc' }, 'OK');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: 'abc' },
      message: 'OK',
    });
  });

  it('honours an explicit status code (e.g. 201 Created)', () => {
    const res = mockRes();
    ResponseHelper.success(res, { id: 'x' }, 'Created', 201);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('ResponseHelper error variants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('badRequest writes 400 with code BAD_REQUEST and the message in `error`', () => {
    const res = mockRes();
    ResponseHelper.badRequest(res, 'Project ID is required');

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Project ID is required',
      code: 'BAD_REQUEST',
      details: undefined,
    });
  });

  it('unauthorized writes 401 with code UNAUTHORIZED', () => {
    const res = mockRes();
    ResponseHelper.unauthorized(res, 'No token');

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'No token',
      code: 'UNAUTHORIZED',
      details: undefined,
    });
  });

  it('forbidden writes 403 with code FORBIDDEN', () => {
    const res = mockRes();
    ResponseHelper.forbidden(res);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = (res.json as Mock).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(body.code).toBe('FORBIDDEN');
    expect(body.success).toBe(false);
  });

  it('notFound writes 404 with code NOT_FOUND', () => {
    const res = mockRes();
    ResponseHelper.notFound(res, 'Export file not found');

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Export file not found',
      code: 'NOT_FOUND',
      details: undefined,
    });
  });

  it('conflict writes 409 with code CONFLICT', () => {
    const res = mockRes();
    ResponseHelper.conflict(res);

    expect(res.status).toHaveBeenCalledWith(409);
    const body = (res.json as Mock).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(body.code).toBe('CONFLICT');
  });

  it('rateLimit writes 429 with code RATE_LIMIT_EXCEEDED', () => {
    const res = mockRes();
    ResponseHelper.rateLimit(res);

    expect(res.status).toHaveBeenCalledWith(429);
    const body = (res.json as Mock).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('internalError writes 500 with code INTERNAL_ERROR and logs the cause', () => {
    const res = mockRes();
    const cause = new Error('boom');
    ResponseHelper.internalError(res, cause, 'Failed to start export');

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Failed to start export',
      code: 'INTERNAL_ERROR',
      details: undefined,
    });
  });

  it('serviceUnavailable writes 503 with code SERVICE_UNAVAILABLE', () => {
    const res = mockRes();
    ResponseHelper.serviceUnavailable(res);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = (res.json as Mock).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('validationError accepts a string message', () => {
    const res = mockRes();
    ResponseHelper.validationError(res, 'Invalid email');

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Invalid email',
      code: 'VALIDATION_ERROR',
      details: undefined,
    });
  });

  it('validationError accepts a structured field-error map', () => {
    const res = mockRes();
    const fieldErrors = { email: ['required'], password: ['too short'] };
    ResponseHelper.validationError(res, fieldErrors);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      details: fieldErrors,
    });
  });
});

describe('ResponseHelper.error: contract for downstream consumers', () => {
  it('always writes the message in `error` field — frontend errorUtils reads this', () => {
    // Frontend `src/lib/errorUtils.ts:43` does
    //   responseData.error || responseData.message
    // so the migrated controller responses must keep `error` populated.
    const res = mockRes();
    ResponseHelper.badRequest(res, 'X');
    const body = (res.json as Mock).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(body.error).toBe('X');
  });

  it('error(res, msg, 500) without an Error param still logs at error level', () => {
    // Locks the `if (logError || statusCode >= 500)` branch in response.ts:71.
    // Even without a passed-in Error, a 500 response must take the error-log
    // path (not the warn path). A future refactor swapping `||` for `&&`
    // would break this — this test catches it.
    (logger.error as Mock).mockClear();
    (logger.warn as Mock).mockClear();

    const res = mockRes();
    ResponseHelper.error(res, 'Service down', 500);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('ResponseHelper.paginated', () => {
  it('writes 200 + body shape that list endpoints depend on', () => {
    // Frontend list views read `response.pagination.totalPages` — locking
    // the body shape here protects every paginated endpoint from a refactor
    // that renames `pagination` to `meta` or similar.
    const res = mockRes();
    const data = [{ id: 'a' }, { id: 'b' }];
    const pagination = { page: 1, limit: 10, total: 2, totalPages: 1 };
    ResponseHelper.paginated(res, data, pagination, 'OK');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data,
      pagination,
      message: 'OK',
    });
  });

  it('honours an explicit status code (e.g. 206 Partial Content)', () => {
    const res = mockRes();
    ResponseHelper.paginated(
      res,
      [],
      { page: 1, limit: 10, total: 0, totalPages: 0 },
      undefined,
      206
    );
    expect(res.status).toHaveBeenCalledWith(206);
  });
});

describe('calculatePagination', () => {
  it('computes offset and totalPages correctly for first page', () => {
    expect(calculatePagination(1, 10, 25)).toEqual({
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3,
      offset: 0,
      hasNext: true,
      hasPrev: false,
    });
  });

  it('marks last page hasNext=false', () => {
    const p = calculatePagination(3, 10, 25);
    expect(p.hasNext).toBe(false);
    expect(p.hasPrev).toBe(true);
    expect(p.offset).toBe(20);
  });

  it('handles zero total cleanly (no division-by-zero)', () => {
    expect(calculatePagination(1, 10, 0)).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
      offset: 0,
      hasNext: false,
      hasPrev: false,
    });
  });
});
