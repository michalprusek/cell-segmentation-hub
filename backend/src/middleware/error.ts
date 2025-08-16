import { Request, Response, NextFunction } from 'express';
import { ResponseHelper } from '../utils/response';
import { logger } from '../utils/logger';
import { ZodError } from 'zod';

/**
 * Global error handling middleware
 */
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
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

    return ResponseHelper.validationError(res, errors, context);
  }

  // Handle Prisma errors
  if (error.name === 'PrismaClientKnownRequestError') {
    return handlePrismaError(error as any, res, context);
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return ResponseHelper.unauthorized(res, 'Neplatný token', context);
  }

  if (error.name === 'TokenExpiredError') {
    return ResponseHelper.unauthorized(res, 'Token vypršel', context);
  }

  // Handle multer errors (file upload)
  if (error.name === 'MulterError') {
    return handleMulterError(error as any, res, context);
  }

  // Handle custom API errors
  if (error instanceof ApiError) {
    return ResponseHelper.error(res, error, error.statusCode, undefined, context);
  }

  // Handle generic errors based on message patterns
  if (error.message.includes('ENOENT')) {
    return ResponseHelper.notFound(res, 'Soubor nebyl nalezen', context);
  }

  if (error.message.includes('EACCES')) {
    return ResponseHelper.forbidden(res, 'Nedostatečná oprávnění k souboru', context);
  }

  if (error.message.includes('EMFILE') || error.message.includes('ENFILE')) {
    return ResponseHelper.serviceUnavailable(res, 'Server je přetížený', context);
  }

  // Default to internal server error
  return ResponseHelper.internalError(res, error, undefined, context);
};

/**
 * Handle Prisma database errors
 */
function handlePrismaError(error: any, res: Response, context: string) {
  const { code, meta } = error;

  switch (code) {
    case 'P2002':
      // Unique constraint violation
      const field = meta?.target?.[0] || 'pole';
      return ResponseHelper.conflict(
        res,
        `Hodnota pro ${field} již existuje`,
        context
      );

    case 'P2025':
      // Record not found
      return ResponseHelper.notFound(
        res,
        'Záznam nebyl nalezen',
        context
      );

    case 'P2003':
      // Foreign key constraint violation
      return ResponseHelper.conflict(
        res,
        'Nelze provést operaci kvůli vazbám na jiné záznamy',
        context
      );

    case 'P2011':
      // Null constraint violation
      const nullField = meta?.column_name || 'povinné pole';
      return ResponseHelper.validationError(
        res,
        `${nullField} je povinné`,
        context
      );

    case 'P2012':
      // Missing required value
      return ResponseHelper.validationError(
        res,
        'Chybí povinná hodnota',
        context
      );

    case 'P2014':
      // Invalid ID
      return ResponseHelper.validationError(
        res,
        'Neplatné ID',
        context
      );

    default:
      logger.error(`Neznámá Prisma chyba: ${code}`, error, context);
      return ResponseHelper.internalError(
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
function handleMulterError(error: any, res: Response, context: string) {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return ResponseHelper.validationError(
        res,
        'Soubor je příliš velký',
        context
      );

    case 'LIMIT_FILE_COUNT':
      return ResponseHelper.validationError(
        res,
        'Příliš mnoho souborů',
        context
      );

    case 'LIMIT_UNEXPECTED_FILE':
      return ResponseHelper.validationError(
        res,
        'Neočekávaný soubor',
        context
      );

    case 'LIMIT_FIELD_KEY':
      return ResponseHelper.validationError(
        res,
        'Neplatný název pole',
        context
      );

    case 'LIMIT_FIELD_VALUE':
      return ResponseHelper.validationError(
        res,
        'Hodnota pole je příliš dlouhá',
        context
      );

    case 'LIMIT_FIELD_COUNT':
      return ResponseHelper.validationError(
        res,
        'Příliš mnoho polí',
        context
      );

    case 'LIMIT_PART_COUNT':
      return ResponseHelper.validationError(
        res,
        'Příliš mnoho částí',
        context
      );

    default:
      return ResponseHelper.internalError(
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

  constructor(message: string, statusCode: number = 400, code: string = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  static badRequest(message: string, code: string = 'BAD_REQUEST') {
    return new ApiError(message, 400, code);
  }

  static unauthorized(message: string = 'Neautorizovaný přístup', code: string = 'UNAUTHORIZED') {
    return new ApiError(message, 401, code);
  }

  static forbidden(message: string = 'Nedostatečná oprávnění', code: string = 'FORBIDDEN') {
    return new ApiError(message, 403, code);
  }

  static notFound(message: string = 'Nenalezeno', code: string = 'NOT_FOUND') {
    return new ApiError(message, 404, code);
  }

  static conflict(message: string = 'Konflikt', code: string = 'CONFLICT') {
    return new ApiError(message, 409, code);
  }

  static internalError(message: string = 'Interní chyba serveru', code: string = 'INTERNAL_ERROR') {
    return new ApiError(message, 500, code);
  }
}

/**
 * Middleware to handle 404 errors
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
  return ResponseHelper.notFound(res, `Endpoint ${req.method} ${req.path} nebyl nalezen`);
};