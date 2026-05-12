import multer from 'multer';
import path from 'path';
import * as os from 'os';
import { Request, Response, NextFunction } from 'express';
import type { Express } from 'express-serve-static-core';
import {
  SUPPORTED_MIME_TYPES,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_VIDEO_MIME_TYPES,
  SUPPORTED_VIDEO_EXTENSIONS,
} from '../storage/interface';

// Merged set used by the upload fileFilter — frames are extracted from
// videos by the video extractor service after the file lands on disk.
const ALL_SUPPORTED_MIME_TYPES = [
  ...SUPPORTED_MIME_TYPES,
  ...SUPPORTED_VIDEO_MIME_TYPES,
  'application/octet-stream', // ND2 has no registered MIME; checked by extension
] as readonly string[];

const ALL_SUPPORTED_EXTENSIONS = [
  ...SUPPORTED_EXTENSIONS,
  ...SUPPORTED_VIDEO_EXTENSIONS,
] as readonly string[];
import { getUploadLimitsForEnvironment } from '../config/uploadLimits';
import { ResponseHelper } from '../utils/response';
import { logger } from '../utils/logger';

// Get environment-specific upload limits
const uploadLimits = getUploadLimitsForEnvironment();

// Videos / microscopy stacks dwarf single images — a tile-scan ND2 or a
// long timelapse can easily reach 50 GB. Use the existing chunked-upload
// pipeline for images (20 MB cap stays tight) but expose a separate
// multer for the /videos route with a 100 GB ceiling.
const VIDEO_UPLOAD_MAX_BYTES = 100 * 1024 * 1024 * 1024;

// Shared multer fileFilter — accepts any MIME on the union of image +
// video supported types, falling through to extension validation for
// formats with no registered MIME (most notably ND2). Pulled out so the
// image-multer and the video-multer below can share it without touching
// the (private, untyped) ``upload.options`` field.
const sharedFileFilter: multer.Options['fileFilter'] = (req, file, cb) => {
  if (
    typeof file.mimetype !== 'string' ||
    !ALL_SUPPORTED_MIME_TYPES.includes(file.mimetype)
  ) {
    logger.warn(
      'File upload rejected - unsupported MIME type',
      'UploadMiddleware',
      {
        filename: file.originalname,
        mimetype: file.mimetype,
        userId: req.user?.id,
      }
    );
    return cb(
      new Error(
        `Nepodporovaný formát souboru: ${file.mimetype}. Podporované: ${ALL_SUPPORTED_MIME_TYPES.join(', ')}`
      )
    );
  }

  const fileExtension = path.extname(file.originalname).toLowerCase();
  if (!ALL_SUPPORTED_EXTENSIONS.includes(fileExtension)) {
    logger.warn(
      'File upload rejected - unsupported extension',
      'UploadMiddleware',
      {
        filename: file.originalname,
        extension: fileExtension,
        userId: req.user?.id,
      }
    );
    return cb(
      new Error(
        `Nepodporovaná přípona souboru. Podporované: ${ALL_SUPPORTED_EXTENSIONS.join(', ')}`
      )
    );
  }

  cb(null, true);
};

/**
 * Multer configuration for file uploads (images chunked-upload pipeline).
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: uploadLimits.MAX_FILE_SIZE_BYTES,
    files: uploadLimits.MAX_FILES_PER_REQUEST,
    fields: uploadLimits.MAX_FIELDS,
    fieldSize: uploadLimits.MAX_FIELD_SIZE_KB * 1024,
  },
  fileFilter: sharedFileFilter,
});

/**
 * Middleware for handling multiple file uploads
 */
export const uploadImages = upload.array(
  'images',
  uploadLimits.MAX_FILES_PER_REQUEST
);

/**
 * Middleware for handling single file upload (form field name: "image")
 */
export const uploadSingleImage = upload.single('image');

/**
 * Multer configuration dedicated to video uploads. Uses the same MIME
 * filter as ``upload`` but a much larger per-file budget so .nd2 stacks
 * and multi-page TIFFs aren't truncated at 20 MB.
 */
// Videos are buffered to a temp file on disk (not memory) so a 50 GB ND2
// can land safely even when the backend container has only a few GB of
// RAM. The videoUploadService then renames the temp file into the
// canonical projects/<pid>/images/<vid>/original.<ext> location and the
// extractor runs from there.
const VIDEO_UPLOAD_TMP_DIR =
  process.env.VIDEO_UPLOAD_TMP_DIR ?? path.join(os.tmpdir(), 'spheroseg-uploads');

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, VIDEO_UPLOAD_TMP_DIR),
    filename: (_req, file, cb) => {
      // Preserve the original extension so the extractor's format detection
      // (mp4 vs nd2 vs tiff stack) works against the temp path. Prefix
      // with a random token to avoid collisions across concurrent uploads.
      const ext = path.extname(file.originalname);
      const token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      cb(null, `${token}${ext}`);
    },
  }),
  limits: {
    fileSize: VIDEO_UPLOAD_MAX_BYTES,
    files: 1,
    fields: uploadLimits.MAX_FIELDS,
    fieldSize: uploadLimits.MAX_FIELD_SIZE_KB * 1024,
  },
  fileFilter: sharedFileFilter,
});

// Ensure the tmp dir exists at boot — diskStorage will throw EEXIST/ENOENT
// otherwise on first upload.
import { mkdirSync } from 'fs';
try {
  mkdirSync(VIDEO_UPLOAD_TMP_DIR, { recursive: true });
} catch (err) {
  logger.warn(
    `Failed to ensure video tmp dir ${VIDEO_UPLOAD_TMP_DIR}: ${(err as Error).message}`,
    'UploadMiddleware'
  );
}

/**
 * Middleware for a single video upload (form field name: "video"). The
 * MIME check is shared with image uploads; only the field name and the
 * per-file size budget differ.
 */
export const uploadSingleVideo = videoUpload.single('video');

// Feedback attachments are end-user screenshots — strictly image/png or
// image/jpeg, capped at 5 MB. Disk storage keeps memory pressure low and
// matches the videoUpload pattern (uniform error surfaces).
const FEEDBACK_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const FEEDBACK_ATTACHMENT_TMP_DIR =
  process.env.FEEDBACK_TMP_DIR ??
  path.join(os.tmpdir(), 'spheroseg-feedback-uploads');

try {
  mkdirSync(FEEDBACK_ATTACHMENT_TMP_DIR, { recursive: true });
} catch (err) {
  logger.warn(
    `Failed to ensure feedback tmp dir ${FEEDBACK_ATTACHMENT_TMP_DIR}: ${(err as Error).message}`,
    'UploadMiddleware'
  );
}

const ALLOWED_FEEDBACK_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
const ALLOWED_FEEDBACK_EXTENSIONS = ['.png', '.jpg', '.jpeg'] as const;

const feedbackAttachmentFileFilter: multer.Options['fileFilter'] = (
  req,
  file,
  cb
) => {
  // Defence in depth: MIME, then extension. A motivated attacker can lie
  // about either one alone but matching both narrows the abuse surface.
  if (
    typeof file.mimetype !== 'string' ||
    !(ALLOWED_FEEDBACK_MIME_TYPES as readonly string[]).includes(file.mimetype)
  ) {
    return cb(
      new Error(
        `Unsupported attachment type: ${file.mimetype}. Allowed: ${ALLOWED_FEEDBACK_MIME_TYPES.join(', ')}`
      )
    );
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!(ALLOWED_FEEDBACK_EXTENSIONS as readonly string[]).includes(ext)) {
    return cb(
      new Error(
        `Unsupported attachment extension: ${ext}. Allowed: ${ALLOWED_FEEDBACK_EXTENSIONS.join(', ')}`
      )
    );
  }
  cb(null, true);
};

const feedbackUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FEEDBACK_ATTACHMENT_TMP_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const token =
        Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      cb(null, `${token}${ext}`);
    },
  }),
  limits: {
    fileSize: FEEDBACK_ATTACHMENT_MAX_BYTES,
    files: 1,
    // No body-form text fields larger than a feedback body could ever be.
    fields: 10,
    fieldSize: 64 * 1024,
  },
  fileFilter: feedbackAttachmentFileFilter,
});

/**
 * Multer middleware for the optional drag-and-drop attachment on the
 * feedback form. Form field name: "attachment". Single image only.
 */
export const uploadFeedbackAttachment = feedbackUpload.single('attachment');

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
      field: error.field,
    });

    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        ResponseHelper.validationError(
          res,
          `Soubor je příliš velký. Maximální velikost: ${uploadLimits.MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`
        );
        return;
      case 'LIMIT_FILE_COUNT':
        ResponseHelper.validationError(
          res,
          `Příliš mnoho souborů. Maximálně lze nahrát ${uploadLimits.MAX_FILES_PER_REQUEST} souborů najednou`
        );
        return;
      case 'LIMIT_UNEXPECTED_FILE':
        ResponseHelper.validationError(
          res,
          `Neočekávané pole souboru: ${error.field}`
        );
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
        ResponseHelper.validationError(
          res,
          `Chyba při nahrávání souboru: ${error.message}`
        );
        return;
    }
  }

  if (error instanceof Error) {
    logger.error('File upload error', error, 'UploadMiddleware', {
      userId: req.user?.id,
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
    // Multer can expose req.files either as Express.Multer.File[] (with
    // upload.array/any) or as { [fieldname]: Express.Multer.File[] }
    // (with upload.fields). Guard explicitly so a misconfigured route
    // can't slip an attacker-controlled object shape past the size and
    // length checks below (CodeQL js/type-confusion-through-parameter-
    // tampering).
    if (!Array.isArray(req.files) || req.files.length === 0) {
      ResponseHelper.validationError(
        res,
        'Je nutné vybrat alespoň jeden soubor'
      );
      return;
    }
    const files: Express.Multer.File[] = req.files;

    // Additional validation can be added here
    // For example, checking for virus scanning results, duplicate files, etc.

    logger.info('Files validated successfully', 'UploadMiddleware', {
      fileCount: files.length,
      totalSize: files.reduce((sum, file) => sum + file.size, 0),
      userId: req.user?.id,
    });

    next();
  } catch (error) {
    logger.error(
      'File validation error',
      error instanceof Error ? error : undefined,
      'UploadMiddleware',
      {
        userId: req.user?.id,
      }
    );

    ResponseHelper.internalError(res, error as Error);
  }
};
