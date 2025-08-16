import multer from 'multer';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { config } from '../utils/config';
import { SUPPORTED_MIME_TYPES, SUPPORTED_EXTENSIONS, MAX_FILE_SIZE } from '../storage/interface';
import { ResponseHelper } from '../utils/response';
import { logger } from '../utils/logger';

/**
 * Multer configuration for file uploads
 */
const upload = multer({
  storage: multer.memoryStorage(), // Store files in memory
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 20, // Maximum 20 files per request
    fields: 5, // Maximum 5 non-file fields
    fieldSize: 1024 // 1KB per field
  },
  fileFilter: (req, file, cb) => {
    // Check MIME type
    if (typeof file.mimetype !== 'string' || !(SUPPORTED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      logger.warn('File upload rejected - unsupported MIME type', 'UploadMiddleware', {
        filename: file.originalname,
        mimetype: file.mimetype,
        userId: req.user?.id
      });
      
      return cb(new Error(`Nepodporovaný formát souboru: ${file.mimetype}. Podporované: ${SUPPORTED_MIME_TYPES.join(', ')}`));
    }

    // Check file extension
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (!SUPPORTED_EXTENSIONS.includes(fileExtension as any)) {
      logger.warn('File upload rejected - unsupported extension', 'UploadMiddleware', {
        filename: file.originalname,
        extension: fileExtension,
        userId: req.user?.id
      });
      
      return cb(new Error(`Nepodporovaná přípona souboru. Podporované: ${SUPPORTED_EXTENSIONS.join(', ')}`));
    }

    cb(null, true);
  }
});

/**
 * Middleware for handling multiple file uploads
 */
export const uploadImages = upload.array('images', 20);

/**
 * Middleware for handling single file upload
 */
export const uploadSingleImage = upload.single('image');

/**
 * Error handler for multer upload errors
 */
export const handleUploadError = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (error instanceof multer.MulterError) {
    logger.error('Multer upload error', error, 'UploadMiddleware', {
      code: error.code,
      userId: req.user?.id,
      field: error.field
    });

    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        ResponseHelper.validationError(res, `Soubor je příliš velký. Maximální velikost: ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
        return;
      case 'LIMIT_FILE_COUNT':
        ResponseHelper.validationError(res, 'Příliš mnoho souborů. Maximálně lze nahrát 20 souborů najednou');
        return;
      case 'LIMIT_UNEXPECTED_FILE':
        ResponseHelper.validationError(res, `Neočekávané pole souboru: ${error.field}`);
        return;
      case 'LIMIT_FIELD_COUNT':
        ResponseHelper.validationError(res, 'Příliš mnoho polí v požadavku');
        return;
      case 'LIMIT_FIELD_KEY':
        ResponseHelper.validationError(res, 'Název pole je příliš dlouhý');
        return;
      case 'LIMIT_FIELD_VALUE':
        ResponseHelper.validationError(res, 'Hodnota pole je příliš dlouhá');
        return;
      default:
        ResponseHelper.validationError(res, `Chyba při nahrávání souboru: ${error.message}`);
        return;
    }
  }

  if (error instanceof Error) {
    logger.error('File upload error', error, 'UploadMiddleware', {
      userId: req.user?.id
    });
    
    ResponseHelper.validationError(res, error.message);
    return;
  }

  next(error);
};

/**
 * Middleware to validate uploaded files
 */
export const validateUploadedFiles = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      ResponseHelper.validationError(res, 'Je nutné vybrat alespoň jeden soubor');
      return;
    }

    // Additional validation can be added here
    // For example, checking for virus scanning results, duplicate files, etc.

    logger.info('Files validated successfully', 'UploadMiddleware', {
      fileCount: files.length,
      totalSize: files.reduce((sum, file) => sum + file.size, 0),
      userId: req.user?.id
    });

    next();
  } catch (error) {
    logger.error('File validation error', error instanceof Error ? error : undefined, 'UploadMiddleware', {
      userId: req.user?.id
    });
    
    ResponseHelper.internalError(res, error as Error);
  }
};