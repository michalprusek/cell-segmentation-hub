import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { Readable } from 'stream';
import { z } from 'zod';

// All mocks BEFORE source imports
vi.mock('../../utils/response', () => ({
  __esModule: true,
  ResponseHelper: {
    validationError: vi.fn(),
    internalError: vi.fn(),
    badRequest: vi.fn(),
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
import { validate, validateFile, validateFiles } from '../validation';

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
const makeMockFile = (
  overrides: Partial<Express.Multer.File> = {}
): Express.Multer.File => ({
  fieldname: 'file',
  originalname: 'test.jpg',
  encoding: '7bit',
  mimetype: 'image/jpeg',
  size: 1024 * 100, // 100 KB
  destination: '/tmp',
  filename: 'test.jpg',
  path: '/tmp/test.jpg',
  buffer: Buffer.alloc(0),
  stream: new Readable(),
  ...overrides,
});

describe('Validation Middleware', () => {
  let mockReq: Partial<Request> & { body?: unknown; query?: unknown; params?: unknown };
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      body: {},
      query: {},
      params: {},
      method: 'POST',
      url: '/api/test',
      file: undefined,
      files: undefined,
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
  // validate()
  // -----------------------------------------------------------------------
  describe('validate', () => {
    it('passes validated data to next() when schema validates successfully', () => {
      const schema = z.object({ name: z.string() });
      mockReq.body = { name: 'Alice' };

      validate(schema)(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(ResponseHelper.validationError).not.toHaveBeenCalled();
      // Validated data replaces req.body
      expect((mockReq as Request).body).toEqual({ name: 'Alice' });
    });

    it('coerces and transforms values via Zod schema', () => {
      const schema = z.object({ count: z.coerce.number() });
      mockReq.body = { count: '5' }; // string → number after coerce

      validate(schema)(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq as Request).body).toEqual({ count: 5 });
    });

    it('returns validation error with field mappings on ZodError', () => {
      const schema = z.object({ email: z.string().email() });
      mockReq.body = { email: 'not-an-email' };

      validate(schema)(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        expect.objectContaining({ email: expect.any(Array) }),
        'Validation'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('validates against the query target', () => {
      const schema = z.object({ page: z.coerce.number().min(1) });
      mockReq.query = { page: '2' };

      validate(schema, 'query')(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq as Request).query).toEqual({ page: 2 });
    });

    it('validates against the params target', () => {
      const schema = z.object({ id: z.string().uuid() });
      mockReq.params = { id: '123e4567-e89b-12d3-a456-426614174000' };

      validate(schema, 'params')(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('returns validation error when params fail schema', () => {
      const schema = z.object({ id: z.string().uuid() });
      mockReq.params = { id: 'not-a-uuid' };

      validate(schema, 'params')(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.validationError).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 500 on a non-Zod error thrown during parsing', () => {
      // Create a schema that throws an unexpected error during parse
      const schema = z.object({ name: z.string() });
      vi.spyOn(schema, 'parse').mockImplementation(() => {
        throw new Error('Unexpected crash');
      });

      mockReq.body = { name: 'Alice' };

      validate(schema)(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.internalError).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // validateFile()
  // -----------------------------------------------------------------------
  describe('validateFile', () => {
    it('returns error when file is required but missing', () => {
      mockReq.file = undefined;

      validateFile({ required: true })(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        'Soubor je vyžadován',
        'FileValidation'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('calls next() when file is not required and no file is present', () => {
      mockReq.file = undefined;

      validateFile({ required: false })(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(ResponseHelper.validationError).not.toHaveBeenCalled();
    });

    it('returns error when file exceeds maxSize', () => {
      mockReq.file = makeMockFile({ size: 20 * 1024 * 1024 }); // 20 MB

      validateFile({ required: true, maxSize: 5 * 1024 * 1024 })(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        expect.stringContaining('příliš velký'),
        'FileValidation'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns error for an invalid MIME type', () => {
      mockReq.file = makeMockFile({ mimetype: 'application/pdf' });

      validateFile({
        required: true,
        allowedMimeTypes: ['image/jpeg', 'image/png'],
      })(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        expect.stringContaining('Nepodporovaný typ'),
        'FileValidation'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('calls next() for a valid file', () => {
      mockReq.file = makeMockFile({
        mimetype: 'image/png',
        size: 1024 * 512,
      });

      validateFile({
        required: true,
        maxSize: 10 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png'],
      })(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(ResponseHelper.validationError).not.toHaveBeenCalled();
    });

    it('calls next() when no file provided and not required (default behaviour)', () => {
      mockReq.file = undefined;

      // Default: required = false
      validateFile()(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // validateFiles()
  // -----------------------------------------------------------------------
  describe('validateFiles', () => {
    it('returns error when no files are provided', () => {
      mockReq.files = [];

      validateFiles()(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        'Alespoň jeden soubor je vyžadován',
        'FileValidation'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns error when files is undefined', () => {
      mockReq.files = undefined;

      validateFiles()(mockReq as Request, mockRes as Response, mockNext);

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        'Alespoň jeden soubor je vyžadován',
        'FileValidation'
      );
    });

    it('returns error when the number of files exceeds maxFiles', () => {
      mockReq.files = [
        makeMockFile({ originalname: 'a.jpg' }),
        makeMockFile({ originalname: 'b.jpg' }),
        makeMockFile({ originalname: 'c.jpg' }),
      ];

      validateFiles({ maxFiles: 2 })(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        expect.stringContaining('Příliš mnoho souborů'),
        'FileValidation'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns error when an individual file is too large', () => {
      mockReq.files = [
        makeMockFile({ originalname: 'big.jpg', size: 50 * 1024 * 1024 }),
      ];

      validateFiles({ maxSize: 10 * 1024 * 1024 })(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        expect.stringContaining('big.jpg'),
        'FileValidation'
      );
    });

    it('returns error when an individual file has an unsupported MIME type', () => {
      mockReq.files = [
        makeMockFile({ originalname: 'doc.pdf', mimetype: 'application/pdf' }),
      ];

      validateFiles({ allowedMimeTypes: ['image/jpeg'] })(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(ResponseHelper.validationError).toHaveBeenCalledWith(
        mockRes,
        expect.stringContaining('doc.pdf'),
        'FileValidation'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('calls next() for a valid array of files', () => {
      mockReq.files = [
        makeMockFile({ originalname: 'img1.jpg', mimetype: 'image/jpeg', size: 512 * 1024 }),
        makeMockFile({ originalname: 'img2.png', mimetype: 'image/png', size: 256 * 1024 }),
      ];

      validateFiles({
        maxFiles: 5,
        maxSize: 10 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png'],
      })(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(ResponseHelper.validationError).not.toHaveBeenCalled();
    });

    it('validates exactly maxFiles files without error', () => {
      mockReq.files = [
        makeMockFile({ originalname: 'a.jpg' }),
        makeMockFile({ originalname: 'b.jpg' }),
      ];

      validateFiles({ maxFiles: 2 })(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });
  });
});
