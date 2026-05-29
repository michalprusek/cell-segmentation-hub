/**
 * error.gaps5.test.ts
 *
 * Covers branches still uncovered after error.test.ts:
 *
 *  A. handleFileSystemError — uncovered FS error codes
 *     - EACCES → 403 forbidden
 *     - EMFILE → 503 service unavailable
 *     - ENFILE → 503 service unavailable
 *
 *  B. handlePrismaError — uncovered Prisma codes
 *     - P2011 (null constraint) → validationError
 *     - P2012 (missing required) → validationError
 *     - P2014 (invalid ID) → validationError
 *     - default (unknown code) → internalError
 *
 *  C. handleMulterError — uncovered Multer codes
 *     - LIMIT_UNEXPECTED_FILE → validationError
 *     - LIMIT_FIELD_KEY → validationError
 *     - LIMIT_FIELD_VALUE → validationError
 *     - LIMIT_FIELD_COUNT → validationError
 *     - LIMIT_PART_COUNT → validationError
 *     - default (unknown code) → internalError
 */

import { describe, it, beforeEach, expect, vi } from 'vitest';
import type { Response } from 'express';

vi.mock('../../utils/response', () => ({
  __esModule: true,
  ResponseHelper: {
    validationError: vi.fn(),
    conflict: vi.fn(),
    notFound: vi.fn(),
    badRequest: vi.fn(),
    unauthorized: vi.fn(),
    forbidden: vi.fn(),
    internalError: vi.fn(),
    serviceUnavailable: vi.fn(),
    error: vi.fn(),
    rateLimit: vi.fn(),
  },
}));

vi.mock('../../utils/logger', () => ({
  __esModule: true,
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ResponseHelper } from '../../utils/response';
import { errorHandler } from '../error';

const RH = ResponseHelper as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

function makeRes(): Response {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function makeReq() {
  return { path: '/test', method: 'GET', headers: {} } as never;
}

const next = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── A. File system errors ────────────────────────────────────────────────────

describe('errorHandler — FS EACCES/EMFILE/ENFILE codes', () => {
  it('EACCES → 403 forbidden', () => {
    const err = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.forbidden).toHaveBeenCalledWith(
      res,
      'Insufficient file permissions',
      expect.any(String)
    );
  });

  it('EMFILE → 503 service unavailable', () => {
    const err = Object.assign(new Error('EMFILE: too many open files'), {
      code: 'EMFILE',
    });
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.serviceUnavailable).toHaveBeenCalledWith(
      res,
      'Server is overloaded',
      expect.any(String)
    );
  });

  it('ENFILE → 503 service unavailable', () => {
    const err = Object.assign(new Error('ENFILE: file table overflow'), {
      code: 'ENFILE',
    });
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.serviceUnavailable).toHaveBeenCalledWith(
      res,
      'Server is overloaded',
      expect.any(String)
    );
  });
});

// ─── B. Prisma errors ─────────────────────────────────────────────────────────

describe('errorHandler — Prisma codes', () => {
  function makePrismaErr(code: string, meta?: Record<string, unknown>) {
    return Object.assign(new Error(`Prisma ${code}`), {
      name: 'PrismaClientKnownRequestError',
      code,
      meta,
    });
  }

  it('P2011 (null constraint) → validationError', () => {
    const err = makePrismaErr('P2011', { field_name: 'email' });
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.validationError).toHaveBeenCalledWith(
      res,
      expect.stringContaining('email'),
      expect.any(String)
    );
  });

  it('P2012 (missing required) → validationError', () => {
    const err = makePrismaErr('P2012');
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.validationError).toHaveBeenCalledWith(
      res,
      'Required value is missing',
      expect.any(String)
    );
  });

  it('P2014 (invalid ID) → validationError', () => {
    const err = makePrismaErr('P2014');
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.validationError).toHaveBeenCalledWith(
      res,
      'Invalid ID provided',
      expect.any(String)
    );
  });

  it('unknown Prisma code → internalError', () => {
    const err = makePrismaErr('P9999');
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.internalError).toHaveBeenCalledWith(
      res,
      expect.any(Error),
      'Database operation failed',
      expect.any(String)
    );
  });
});

// ─── C. Multer errors ─────────────────────────────────────────────────────────

describe('errorHandler — Multer codes', () => {
  function makeMulterErr(code: string) {
    const err = Object.assign(new Error(`Multer ${code}`), {
      name: 'MulterError',
      code,
    });
    return err;
  }

  it('LIMIT_UNEXPECTED_FILE → validationError', () => {
    const err = makeMulterErr('LIMIT_UNEXPECTED_FILE');
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.validationError).toHaveBeenCalledWith(
      res,
      'Unexpected file field',
      expect.any(String)
    );
  });

  it('LIMIT_FIELD_KEY → validationError', () => {
    const err = makeMulterErr('LIMIT_FIELD_KEY');
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.validationError).toHaveBeenCalledWith(
      res,
      'Invalid field name',
      expect.any(String)
    );
  });

  it('LIMIT_FIELD_VALUE → validationError', () => {
    const err = makeMulterErr('LIMIT_FIELD_VALUE');
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.validationError).toHaveBeenCalledWith(
      res,
      'Field value is too long',
      expect.any(String)
    );
  });

  it('LIMIT_FIELD_COUNT → validationError', () => {
    const err = makeMulterErr('LIMIT_FIELD_COUNT');
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.validationError).toHaveBeenCalledWith(
      res,
      'Too many fields',
      expect.any(String)
    );
  });

  it('LIMIT_PART_COUNT → validationError', () => {
    const err = makeMulterErr('LIMIT_PART_COUNT');
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.validationError).toHaveBeenCalledWith(
      res,
      'Too many parts',
      expect.any(String)
    );
  });

  it('unknown Multer code → internalError', () => {
    const err = makeMulterErr('UNKNOWN_MULTER_CODE');
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);
    expect(RH.internalError).toHaveBeenCalledWith(
      res,
      expect.any(Error),
      'File upload failed',
      expect.any(String)
    );
  });
});
