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
    error.errors.forEach((err) => {
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
    ResponseHelper.unauthorized(res, 'Neplatný token', context);
    return;
  }

  if (error.name === 'TokenExpiredError') {
    ResponseHelper.unauthorized(res, 'Token vypršel', context);
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
    ResponseHelper.notFound(res, 'Soubor nebyl nalezen', context);
    return;
  }

  if (error.message.includes('EACCES')) {
    ResponseHelper.forbidden(res, 'Nedostatečná oprávnění k souboru', context);
    return;
  }

  if (error.message.includes('EMFILE') || error.message.includes('ENFILE')) {
    ResponseHelper.serviceUnavailable(res, 'Server je přetížený', context);
    return;
  }

  // Default to internal server error
  ResponseHelper.internalError(res, error, undefined, context);
};

/**
 * Handle Prisma database errors
 */
function handlePrismaError(error: PrismaError, res: Response, context: string): void {
  const { code, meta } = error;

  switch (code) {
    case 'P2002': {
      // Unique constraint violation
      const field = meta?.target?.[0] || 'pole';
      ResponseHelper.conflict(
        res,
        `Hodnota pro ${field} již existuje`,
        context
      );
      break;
    }

    case 'P2025':
      // Record not found
      ResponseHelper.notFound(
        res,
        'Záznam nebyl nalezen',
        context
      );
      break;

    case 'P2003':
      // Foreign key constraint violation
      ResponseHelper.conflict(
        res,
        'Nelze provést operaci kvůli vazbám na jiné záznamy',
        context
      );
      break;

    case 'P2011': {
      // Null constraint violation
      const nullField = meta?.column_name || 'povinné pole';
      ResponseHelper.validationError(
        res,
        `${nullField} je povinné`,
        context
      );
      break;
    }

    case 'P2012':
      // Missing required value
      ResponseHelper.validationError(
        res,
        'Chybí povinná hodnota',
        context
      );
      break;

    case 'P2014':
      // Invalid ID
      ResponseHelper.validationError(
        res,
        'Neplatné ID',
        context
      );
      break;

    default:
      logger.error(`Neznámá Prisma chyba: ${code}`, error, context);
      ResponseHelper.internalError(
        res,
        error,
        'Chyba databáze',
        context
      );
  }
}

/**
 * Handle Multer file upload errors
 */
function handleMulterError(error: MulterError, res: Response, context: string): void {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      ResponseHelper.validationError(
        res,
        'Soubor je příliš velký',
        context
      );
      break;

    case 'LIMIT_FILE_COUNT':
      ResponseHelper.validationError(
        res,
        'Příliš mnoho souborů',
        context
      );
      break;

    case 'LIMIT_UNEXPECTED_FILE':
      ResponseHelper.validationError(
        res,
        'Neočekávaný soubor',
        context
      );
      break;

    case 'LIMIT_FIELD_KEY':
      ResponseHelper.validationError(
        res,
        'Neplatný název pole',
        context
      );
      break;

    case 'LIMIT_FIELD_VALUE':
      ResponseHelper.validationError(
        res,
        'Hodnota pole je příliš dlouhá',
        context
      );
      break;

    case 'LIMIT_FIELD_COUNT':
      ResponseHelper.validationError(
        res,
        'Příliš mnoho polí',
        context
      );
      break;

    case 'LIMIT_PART_COUNT':
      ResponseHelper.validationError(
        res,
        'Příliš mnoho částí',
        context
      );
      break;

    default:
      ResponseHelper.internalError(
        res,
        error,
        'Chyba při nahrávání souboru',
        context
      );
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

  static unauthorized(message = 'Neautorizovaný přístup', code = 'UNAUTHORIZED'): ApiError {
    return new ApiError(message, 401, code);
  }

  static forbidden(message = 'Nedostatečná oprávnění', code = 'FORBIDDEN'): ApiError {
    return new ApiError(message, 403, code);
  }

  static notFound(message = 'Nenalezeno', code = 'NOT_FOUND'): ApiError {
    return new ApiError(message, 404, code);
  }

  static conflict(message = 'Konflikt', code = 'CONFLICT'): ApiError {
    return new ApiError(message, 409, code);
  }

  static internalError(message = 'Interní chyba serveru', code = 'INTERNAL_ERROR'): ApiError {
    return new ApiError(message, 500, code);
  }
}

/**
 * Middleware to handle 404 errors
 */
export const notFoundHandler = (req: Request, res: Response, _next: NextFunction): void => {
  ResponseHelper.notFound(res, `Endpoint ${req.method} ${req.path} nebyl nalezen`);
};