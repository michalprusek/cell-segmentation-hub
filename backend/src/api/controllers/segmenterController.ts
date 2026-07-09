import { Request, Response } from 'express';
import * as SegmenterService from '../../services/segmenterService';
import { SegmenterError } from '../../services/segmenterService';
import { ResponseHelper, asyncHandler } from '../../utils/response';
import { logger } from '../../utils/logger';
import type {
  CreateSegmenterDatasetData,
  CreateSegmenterClassData,
  UpdateSegmenterClassData,
  SegmenterAnnotationsPutData,
} from '../../types/validation';

/**
 * Translates `SegmenterError` codes to HTTP responses, mirroring
 * `projectFolderController.handleFolderError` — keeps every handler body a
 * uniform (validate → call service → translate) shape.
 */
function handleSegmenterError(
  res: Response,
  error: unknown,
  defaultMessage: string,
  context: string
): void {
  if (error instanceof SegmenterError) {
    switch (error.code) {
      case 'NOT_FOUND':
        ResponseHelper.notFound(res, error.message, context);
        return;
      case 'INVALID_INPUT':
        ResponseHelper.badRequest(res, error.message, context);
        return;
    }
  }
  logger.error(defaultMessage, error as Error, context);
  ResponseHelper.internalError(res, error as Error, defaultMessage, context);
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

export const createDataset = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    const { name }: CreateSegmenterDatasetData = req.body;
    try {
      const dataset = await SegmenterService.createDataset(req.user.id, name);
      ResponseHelper.success(res, dataset, 'Dataset byl vytvořen', 201);
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se vytvořit dataset',
        'SegmenterController'
      );
    }
  }
);

export const listDatasets = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    try {
      const datasets = await SegmenterService.listDatasets(req.user.id);
      ResponseHelper.success(res, datasets, 'Datasety byly načteny');
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se načíst datasety',
        'SegmenterController'
      );
    }
  }
);

export const getDataset = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    try {
      const dataset = await SegmenterService.getDataset(
        req.user.id,
        req.params.id
      );
      ResponseHelper.success(res, dataset, 'Dataset byl načten');
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se načíst dataset',
        'SegmenterController'
      );
    }
  }
);

export const deleteDataset = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    try {
      await SegmenterService.deleteDataset(req.user.id, req.params.id);
      ResponseHelper.success(res, undefined, 'Dataset byl smazán');
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se smazat dataset',
        'SegmenterController'
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const uploadImages = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    // Runtime validation before the type assertion — `req.files` can be
    // `undefined`, an array (upload.array — our case), or a fieldname map
    // (upload.fields), so a bare cast would be unsound.
    const rawFiles = req.files;
    if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
      ResponseHelper.badRequest(res, 'Je nutné vybrat alespoň jeden soubor');
      return;
    }
    const files: SegmenterService.SegmenterImageUploadInput[] = rawFiles.map(
      f => ({
        originalname: f.originalname,
        buffer: f.buffer,
        mimetype: f.mimetype,
        size: f.size,
      })
    );

    try {
      const images = await SegmenterService.uploadImages(
        req.user.id,
        req.params.id,
        files
      );
      ResponseHelper.success(res, images, 'Obrázky byly nahrány', 201);
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se nahrát obrázky',
        'SegmenterController'
      );
    }
  }
);

export const deleteImage = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    try {
      await SegmenterService.deleteImage(req.user.id, req.params.imageId);
      ResponseHelper.success(res, undefined, 'Obrázek byl smazán');
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se smazat obrázek',
        'SegmenterController'
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Class registry
// ---------------------------------------------------------------------------

export const listClasses = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    try {
      const classes = await SegmenterService.listClasses(
        req.user.id,
        req.params.id
      );
      ResponseHelper.success(res, { classes }, 'Třídy byly načteny');
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se načíst třídy',
        'SegmenterController'
      );
    }
  }
);

export const createClass = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    const { name, color }: CreateSegmenterClassData = req.body;
    try {
      const classes = await SegmenterService.createClass(
        req.user.id,
        req.params.id,
        {
          name,
          color,
        }
      );
      ResponseHelper.success(res, { classes }, 'Třída byla vytvořena', 201);
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se vytvořit třídu',
        'SegmenterController'
      );
    }
  }
);

export const updateClass = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    const patch: UpdateSegmenterClassData = req.body;
    try {
      const classes = await SegmenterService.updateClass(
        req.user.id,
        req.params.id,
        req.params.classId,
        patch
      );
      ResponseHelper.success(res, { classes }, 'Třída byla upravena');
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se upravit třídu',
        'SegmenterController'
      );
    }
  }
);

export const deleteClass = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    try {
      const result = await SegmenterService.deleteClass(
        req.user.id,
        req.params.id,
        req.params.classId
      );
      ResponseHelper.success(res, result, 'Třída byla smazána');
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se smazat třídu',
        'SegmenterController'
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

export const getAnnotation = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    try {
      const annotation = await SegmenterService.getAnnotation(
        req.user.id,
        req.params.imageId
      );
      ResponseHelper.success(res, annotation, 'Anotace byla načtena');
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se načíst anotaci',
        'SegmenterController'
      );
    }
  }
);

export const serveImageFile = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    try {
      const { buffer, mimeType, filename } =
        await SegmenterService.getImageFile(req.user.id, req.params.imageId);
      res.set({
        'Content-Type': mimeType,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'private, max-age=3600',
        ETag: `"${req.params.imageId}"`,
        'Content-Disposition': `inline; filename="${filename}"`,
      });
      res.send(buffer);
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se načíst obrázek',
        'SegmenterController'
      );
    }
  }
);

export const upsertAnnotation = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(
        res,
        'Uživatel není autentizován',
        'SegmenterController'
      );
      return;
    }
    const { polygons, imageWidth, imageHeight }: SegmenterAnnotationsPutData =
      req.body;
    try {
      const annotation = await SegmenterService.upsertAnnotation(
        req.user.id,
        req.params.imageId,
        { polygons, imageWidth, imageHeight }
      );
      ResponseHelper.success(res, annotation, 'Anotace byla uložena');
    } catch (error) {
      handleSegmenterError(
        res,
        error,
        'Nepodařilo se uložit anotaci',
        'SegmenterController'
      );
    }
  }
);
