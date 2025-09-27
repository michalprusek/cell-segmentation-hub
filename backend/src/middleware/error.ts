import { Request, Response, NextFunction } from 'express';
import { ResponseHelper } from '../utils/response';
import { logger } from '../utils/logger';
import { ZodError } from 'zod';

// Interface for Prisma errors
interface PrismaError extends Error {
  code: string;
  meta?: {
    target?: string[];
    field_name?: string;
    [key: string]: unknown;
  };
}

// Interface for Multer upload errors
interface MulterError extends Error {
  code: string;
  field?: string;
  storageErrors?: Error[];
}

/**
 * Global error handling middleware
 */
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // If response was already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(error);
  }

  const context = `${req.method} ${req.path}`;

  // Handle different types of errors
  if (error instanceof ZodError) {
    // Validation errors
    const errors: Record<string, string[]> = {};
    error.errors.forEach(err => {
      const path = err.path.join('.');
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push(err.message);
    });

    ResponseHelper.validationError(res, errors, context);
    return;
  }

  // Handle Prisma errors
  if (error.name === 'PrismaClientKnownRequestError') {
    handlePrismaError(error as PrismaError, res, context);
    return;
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    ResponseHelper.unauthorized(res, 'Invalid authentication token', context);
    return;
  }

  if (error.name === 'TokenExpiredError') {
    ResponseHelper.unauthorized(
      res,
      'Authentication token has expired',
      context
    );
    return;
  }

  // Handle multer errors (file upload)
  if (error.name === 'MulterError') {
    handleMulterError(error as MulterError, res, context);
    return;
  }

  // Handle custom API errors
  if (error instanceof ApiError) {
    ResponseHelper.error(res, error, error.statusCode, undefined, context);
    return;
  }

  // Handle generic errors based on message patterns
  if (error.message.includes('ENOENT')) {
    ResponseHelper.notFound(res, 'File not found', context);
    return;
  }

  if (error.message.includes('EACCES')) {
    ResponseHelper.forbidden(res, 'Insufficient file permissions', context);
    return;
  }

  if (error.message.includes('EMFILE') || error.message.includes('ENFILE')) {
    ResponseHelper.serviceUnavailable(res, 'Server is overloaded', context);
    return;
  }

  // Default to internal server error
  ResponseHelper.internalError(res, error, undefined, context);
};

/**
 * Handle Prisma database errors
 */
function handlePrismaError(
  error: PrismaError,
  res: Response,
  context: string
): void {
  const { code, meta } = error;

  switch (code) {
    case 'P2002': {
      // Unique constraint violation
      const field = meta?.target?.[0] || 'field';
      const fieldMap: Record<string, string> = {
        email: 'email address',
        username: 'username',
        name: 'name',
      };
      const friendlyField = fieldMap[field] || field;
      ResponseHelper.conflict(
        res,
        `This ${friendlyField} is already in use`,
        context
      );
      break;
    }

    case 'P2025':
      // Record not found
      ResponseHelper.notFound(
        res,
        'The requested resource was not found',
        context
      );
      break;

    case 'P2003':
      // Foreign key constraint violation
      ResponseHelper.conflict(
        res,
        'Cannot perform operation due to related records',
        context
      );
      break;

    case 'P2011': {
      // Null constraint violation
      const nullField = meta?.field_name || 'required field';
      ResponseHelper.validationError(res, `${nullField} is required`, context);
      break;
    }

    case 'P2012':
      // Missing required value
      ResponseHelper.validationError(res, 'Required value is missing', context);
      break;

    case 'P2014':
      // Invalid ID
      ResponseHelper.validationError(res, 'Invalid ID provided', context);
      break;

    default:
      logger.error(`Unknown Prisma error: ${code}`, error, context);
      ResponseHelper.internalError(
        res,
        error,
        'Database operation failed',
        context
      );
  }
}

/**
 * Handle Multer file upload errors
 */
function handleMulterError(
  error: MulterError,
  res: Response,
  context: string
): void {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      ResponseHelper.validationError(
        res,
        'File size exceeds the maximum limit',
        context
      );
      break;

    case 'LIMIT_FILE_COUNT':
      ResponseHelper.validationError(res, 'Too many files uploaded', context);
      break;

    case 'LIMIT_UNEXPECTED_FILE':
      ResponseHelper.validationError(res, 'Unexpected file field', context);
      break;

    case 'LIMIT_FIELD_KEY':
      ResponseHelper.validationError(res, 'Invalid field name', context);
      break;

    case 'LIMIT_FIELD_VALUE':
      ResponseHelper.validationError(res, 'Field value is too long', context);
      break;

    case 'LIMIT_FIELD_COUNT':
      ResponseHelper.validationError(res, 'Too many fields', context);
      break;

    case 'LIMIT_PART_COUNT':
      ResponseHelper.validationError(res, 'Too many parts', context);
      break;

    default:
      ResponseHelper.internalError(res, error, 'File upload failed', context);
  }
}

/**
 * Custom API Error class
 */
export class ApiError extends Error {
  public statusCode: number;
  public code: string;

  constructor(message: string, statusCode = 400, code = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  static badRequest(message: string, code = 'BAD_REQUEST'): ApiError {
    return new ApiError(message, 400, code);
  }

  static validationError(message: string, code = 'VALIDATION_ERROR'): ApiError {
    return new ApiError(message, 400, code);
  }

  static unauthorized(
    message = 'Neautorizovaný přístup',
    code = 'UNAUTHORIZED'
  ): ApiError {
    return new ApiError(message, 401, code);
  }

  static forbidden(
    message = 'Nedostatečná oprávnění',
    code = 'FORBIDDEN'
  ): ApiError {
    return new ApiError(message, 403, code);
  }

  static notFound(message = 'Nenalezeno', code = 'NOT_FOUND'): ApiError {
    return new ApiError(message, 404, code);
  }

  static conflict(message = 'Konflikt', code = 'CONFLICT'): ApiError {
    return new ApiError(message, 409, code);
  }

  static internalError(
    message = 'Internal server error',
    code = 'INTERNAL_ERROR'
  ): ApiError {
    return new ApiError(message, 500, code);
  }
}

/**
 * Middleware to handle 404 errors
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  ResponseHelper.notFound(res, `Endpoint ${req.method} ${req.path} not found`);
};
