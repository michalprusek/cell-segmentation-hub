import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import { Request, Response, NextFunction } from 'express';

// All mocks BEFORE source imports
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

import { ZodError, ZodIssue } from 'zod';
import { ResponseHelper } from '../../utils/response';
import { errorHandler, ApiError, notFoundHandler } from '../error';

// -------------------------------------------------------------------------
// Helper factories
// -------------------------------------------------------------------------

/** Build a minimal Prisma error object */
const buildPrismaError = (code: string, meta?: Record<string, unknown>): Error => {
  const err = new Error(`Prisma error ${code}`) as Error & {
    name: string;
    code: string;
    meta?: Record<string, unknown>;
  };
  err.name = 'PrismaClientKnownRequestError';
  err.code = code;
  err.meta = meta;
  return err;
};

/** Build a minimal Multer error object */
const buildMulterError = (code: string): Error => {
  const err = new Error(`Multer error ${code}`) as Error & {
    name: string;
    code: string;
  };
  err.name = 'MulterError';
  err.code = code;
  return err;
};

/** Build a ZodError with a single issue */
const buildZodError = (path: string[], message: string): ZodError => {
  const issue: ZodIssue = {
    code: 'custom',
    path,
    message,
  };
  return new ZodError([issue]);
};

describe('Error Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      method: 'GET',
      path: '/api/test',
    };

    mockRes = {
      status: vi.fn().mockReturnThis() as unknown as Response['status'],
      json: vi.fn().mockReturnThis() as unknown as Response['json'],
      send: vi.fn().mockReturnThis() as unknown as Response['send'],
      headersSent: false,
    };

    mockNext = vi.fn() as NextFunction;
  });

  // -----------------------------------------------------------------------
  // errorHandler
  // -----------------------------------------------------------------------
  describe('errorHandler', () => {
    it('delegates to the default Express error handler when headers already sent', () => {
      (mockRes as { headersSent: boolean }).headersSent = true;
      const err = new Error('test error');

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(err);
      expect(ResponseHelper.internalError).not.toHaveBeenCalled();
    });

    it('handles ZodError with field path mapping', () => {
      const zodErr = buildZodError(['email'], 'Invalid email');

      errorHandler(zodErr, mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        expect.objectContaining({ email: expect.arrayContaining(['Invalid email']) }),
        expect.any(String)
      );
    });

    it('handles nested ZodError path as dot-notation key', () => {
      const zodErr = buildZodError(['user', 'email'], 'Required');

      errorHandler(zodErr, mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        expect.objectContaining({ 'user.email': expect.arrayContaining(['Required']) }),
        expect.any(String)
      );
    });

    it('handles Prisma P2002 (unique constraint) with 409', () => {
      const err = buildPrismaError('P2002', { target: ['email'] });

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.conflict).toHaveBeenCalledWith(
        mockRes,
        expect.stringContaining('email address'),
        expect.any(String)
      );
    });

    it('handles Prisma P2025 (record not found) with 404', () => {
      const err = buildPrismaError('P2025');

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.notFound).toHaveBeenCalledWith(
        mockRes,
        expect.any(String),
        expect.any(String)
      );
    });

    it('handles Prisma P2003 (foreign key constraint) with conflict', () => {
      const err = buildPrismaError('P2003');

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.conflict).toHaveBeenCalledWith(
        mockRes,
        expect.stringContaining('related records'),
        expect.any(String)
      );
    });

    it('handles JsonWebTokenError with 401', () => {
      const err = new Error('jwt malformed');
      err.name = 'JsonWebTokenError';

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(
        mockRes,
        'Invalid authentication token',
        expect.any(String)
      );
    });

    it('handles TokenExpiredError with 401', () => {
      const err = new Error('jwt expired');
      err.name = 'TokenExpiredError';

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.unauthorized).toHaveBeenCalledWith(
        mockRes,
        'Authentication token has expired',
        expect.any(String)
      );
    });

    it('handles MulterError LIMIT_FILE_SIZE with validation error', () => {
      const err = buildMulterError('LIMIT_FILE_SIZE');

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        expect.stringContaining('size'),
        expect.any(String)
      );
    });

    it('handles MulterError LIMIT_FILE_COUNT with validation error', () => {
      const err = buildMulterError('LIMIT_FILE_COUNT');

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        expect.stringContaining('Too many files'),
        expect.any(String)
      );
    });

    it('handles ApiError using its custom statusCode', () => {
      const err = new ApiError('Custom message', 422, 'CUSTOM_CODE');

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.error).toHaveBeenCalledWith(
        mockRes,
        err,
        422,
        undefined,
        expect.any(String)
      );
    });

    it('handles ENOENT error with 404', () => {
      const err = new Error('ENOENT: no such file or directory');

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.notFound).toHaveBeenCalledWith(
        mockRes,
        'File not found',
        expect.any(String)
      );
    });

    it('falls back to 500 for unknown errors', () => {
      const err = new Error('Something completely unexpected');

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.internalError).toHaveBeenCalledWith(
        mockRes,
        err,
        undefined,
        expect.any(String)
      );
    });
  });

  // -----------------------------------------------------------------------
  // ApiError
  // -----------------------------------------------------------------------
  describe('ApiError', () => {
    it('constructs with message and statusCode', () => {
      const err = new ApiError('test message', 418);
      expect(err.message).toBe('test message');
      expect(err.statusCode).toBe(418);
      expect(err.name).toBe('ApiError');
    });

    it('defaults statusCode to 400 when not provided', () => {
      const err = new ApiError('bad');
      expect(err.statusCode).toBe(400);
    });

    it('ApiError.badRequest() returns 400', () => {
      const err = ApiError.badRequest('bad request');
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('bad request');
    });

    it('ApiError.unauthorized() returns 401', () => {
      const err = ApiError.unauthorized('no access');
      expect(err.statusCode).toBe(401);
    });

    it('ApiError.forbidden() returns 403', () => {
      const err = ApiError.forbidden('forbidden');
      expect(err.statusCode).toBe(403);
    });

    it('ApiError.notFound() returns 404', () => {
      const err = ApiError.notFound('not found');
      expect(err.statusCode).toBe(404);
    });

    it('ApiError.conflict() returns 409', () => {
      const err = ApiError.conflict('conflict');
      expect(err.statusCode).toBe(409);
    });

    it('ApiError.internalError() returns 500', () => {
      const err = ApiError.internalError('internal');
      expect(err.statusCode).toBe(500);
    });

    it('is an instance of Error', () => {
      const err = new ApiError('err');
      expect(err).toBeInstanceOf(Error);
    });
  });

  // -----------------------------------------------------------------------
  // notFoundHandler
  // -----------------------------------------------------------------------
  describe('notFoundHandler', () => {
    it('calls ResponseHelper.notFound with method and path info', () => {
      // Request.path is read-only in Express types — build a fresh object
      const req = { method: 'DELETE', path: '/api/projects/99' } as Request;

      notFoundHandler(req, mockRes as Response, mockNext);

      expect(ResponseHelper.notFound).toHaveBeenCalledWith(
        mockRes,
        expect.stringContaining('DELETE'),
      );
    });

    it('includes the requested path in the 404 message', () => {
      const req = { method: 'POST', path: '/api/unknown' } as Request;

      notFoundHandler(req, mockRes as Response, mockNext);

      expect(ResponseHelper.notFound).toHaveBeenCalledWith(
        mockRes,
        expect.stringContaining('/api/unknown'),
      );
    });
  });
});
