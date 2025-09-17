import { Request, Response, NextFunction } from 'express';
import type { Express } from 'express-serve-static-core';
import { ZodSchema, ZodError } from 'zod';
import { ResponseHelper } from '../utils/response';
import { logger } from '../utils/logger';

export type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Middleware for validating request data using Zod schemas
 */
export const validate = <T>(
  schema: ZodSchema<T>,
  target: ValidationTarget = 'body'
): (req: Request, res: Response, next: NextFunction) => void => {
  return (req: Request, res: Response, next: NextFunction) => {
    const data = req[target];
    try {
      const validatedData = schema.parse(data);
      
      // Replace the original data with validated data
      (req as unknown as Record<string, unknown>)[target] = validatedData;
      
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors: Record<string, string[]> = {};
        
        error.errors.forEach((err) => {
          const path = err.path.join('.');
          if (!errors[path]) {
            errors[path] = [];
          }
          errors[path].push(err.message);
        });

        // Enhanced logging for validation errors with request details
        logger.warn('Validation failed', 'ValidationMiddleware', {
          target: target,
          url: req.url,
          method: req.method,
          userId: (req as Request & { user?: { id?: string } }).user?.id,
          validationErrors: errors,
          receivedData: data,
          errorCount: error.errors.length
        });

        return ResponseHelper.validationError(res, errors, 'Validation');
      }
      
      return ResponseHelper.internalError(res, error as Error, undefined, 'Validation');
    }
  };
};

/**
 * Validate request body
 */
export const validateBody = <T>(schema: ZodSchema<T>): (req: Request, res: Response, next: NextFunction) => void => {
  return validate(schema, 'body');
};

/**
 * Validate query parameters
 */
export const validateQuery = <T>(schema: ZodSchema<T>): (req: Request, res: Response, next: NextFunction) => void => {
  return validate(schema, 'query');
};

/**
 * Validate URL parameters
 */
export const validateParams = <T>(schema: ZodSchema<T>): (req: Request, res: Response, next: NextFunction) => void => {
  return validate(schema, 'params');
};

/**
 * Helper for validating file uploads
 */
export const validateFile = (
  options: {
    required?: boolean;
    maxSize?: number;
    allowedMimeTypes?: string[];
  } = {}
): (req: Request, res: Response, next: NextFunction) => void => {
  const {
    required = false,
    maxSize = 10 * 1024 * 1024, // 10MB default
    allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff']
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const file = req.file;

    // Check if file is required
    if (required && !file) {
      return ResponseHelper.validationError(res, 'Soubor je vyžadován', 'FileValidation');
    }

    // If no file and not required, continue
    if (!file && !required) {
      return next();
    }

    if (file) {
      // Check file size
      if (file.size > maxSize) {
        return ResponseHelper.validationError(
          res,
          `Soubor je příliš velký. Maximální velikost je ${maxSize / 1024 / 1024}MB`,
          'FileValidation'
        );
      }

      // Check MIME type
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return ResponseHelper.validationError(
          res,
          `Nepodporovaný typ souboru. Povolené typy: ${allowedMimeTypes.join(', ')}`,
          'FileValidation'
        );
      }
    }

    return next();
  };
};

/**
 * Helper for validating multiple files
 */
export const validateFiles = (
  options: {
    maxFiles?: number;
    maxSize?: number;
    allowedMimeTypes?: string[];
  } = {}
): (req: Request, res: Response, next: NextFunction) => void => {
  const {
    maxFiles = 10,
    maxSize = 10 * 1024 * 1024, // 10MB default
    allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff']
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const files = req.files as Express.Multer.File[] | undefined;

    if (!files || files.length === 0) {
      return ResponseHelper.validationError(res, 'Alespoň jeden soubor je vyžadován', 'FileValidation');
    }

    // Check number of files
    if (files.length > maxFiles) {
      return ResponseHelper.validationError(
        res,
        `Příliš mnoho souborů. Maximum je ${maxFiles}`,
        'FileValidation'
      );
    }

    // Validate each file
    for (const file of files) {
      // Check file size
      if (file.size > maxSize) {
        return ResponseHelper.validationError(
          res,
          `Soubor ${file.originalname} je příliš velký. Maximální velikost je ${maxSize / 1024 / 1024}MB`,
          'FileValidation'
        );
      }

      // Check MIME type
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return ResponseHelper.validationError(
          res,
          `Soubor ${file.originalname} má nepodporovaný typ. Povolené typy: ${allowedMimeTypes.join(', ')}`,
          'FileValidation'
        );
      }
    }

    return next();
  };
};