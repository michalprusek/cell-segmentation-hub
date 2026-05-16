import { Request, Response } from 'express';
import * as FolderService from '../../services/projectFolderService';
import { FolderError } from '../../services/projectFolderService';
import { ResponseHelper, asyncHandler } from '../../utils/response';
import { logger } from '../../utils/logger';
import type {
  CreateFolderData,
  UpdateFolderData,
  FolderItemsData,
} from '../../types/validation';

/**
 * Translates FolderError codes to HTTP responses. Keeps controller bodies
 * uniform so each handler is just (validate → call service → translate).
 */
function handleFolderError(
  res: Response,
  error: unknown,
  defaultMessage: string,
  context: string
): boolean {
  if (error instanceof FolderError) {
    switch (error.code) {
      case 'NOT_FOUND':
      case 'PARENT_NOT_FOUND':
        ResponseHelper.notFound(res, error.message, context);
        return true;
      case 'DUPLICATE_NAME':
        ResponseHelper.error(res, error.message, 409, undefined, context);
        return true;
      case 'CYCLE':
      case 'PROJECT_NOT_ACCESSIBLE':
      case 'INVALID_INPUT':
        ResponseHelper.badRequest(res, error.message, context);
        return true;
      case 'PARTIAL_FAILURE':
        // 207 Multi-Status: some operations succeeded, some failed.
        // Reserved for any future handler that throws this; the canonical
        // partial-success path for deleteFolder returns directly (below).
        res.status(207).json({
          success: false,
          error: error.message,
          code: 'PARTIAL_FAILURE',
          details: error.details ?? {},
        });
        return true;
    }
  }
  logger.error(defaultMessage, error as Error, context);
  ResponseHelper.internalError(
    res,
    error as Error,
    defaultMessage,
    context
  );
  return false;
}

export const listFolders = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'FolderController');
      return;
    }
    try {
      const folders = await FolderService.listUserFolders(req.user.id);
      ResponseHelper.success(res, folders, 'Složky byly načteny');
    } catch (error) {
      handleFolderError(res, error, 'Nepodařilo se načíst složky', 'FolderController');
    }
  }
);

export const createFolder = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'FolderController');
      return;
    }
    const data: CreateFolderData = req.body;
    try {
      const folder = await FolderService.createFolder(req.user.id, data);
      ResponseHelper.success(res, folder, 'Složka byla vytvořena', 201);
    } catch (error) {
      handleFolderError(res, error, 'Nepodařilo se vytvořit složku', 'FolderController');
    }
  }
);

export const updateFolder = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'FolderController');
      return;
    }
    const folderId = req.params.id;
    if (!folderId) {
      ResponseHelper.badRequest(res, 'Folder ID is required');
      return;
    }
    const patch: UpdateFolderData = req.body;
    try {
      const folder = await FolderService.updateFolder(req.user.id, folderId, patch);
      ResponseHelper.success(res, folder, 'Složka byla aktualizována');
    } catch (error) {
      handleFolderError(res, error, 'Nepodařilo se aktualizovat složku', 'FolderController');
    }
  }
);

export const deleteFolder = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'FolderController');
      return;
    }
    const folderId = req.params.id;
    if (!folderId) {
      ResponseHelper.badRequest(res, 'Folder ID is required');
      return;
    }
    try {
      const result = await FolderService.deleteFolder(req.user.id, folderId);
      // Partial-success path: at least one owned project failed to delete,
      // so the folder was intentionally left in place. 207 Multi-Status
      // signals "some succeeded, some didn't"; the body has the full
      // breakdown so the frontend can render an actionable toast.
      if (!result.folderDeleted) {
        res.status(207).json({
          success: false,
          message: 'Některé projekty se nepodařilo smazat; složka zůstala zachována',
          data: result,
          code: 'PARTIAL_FAILURE',
        });
        return;
      }
      ResponseHelper.success(res, result, 'Složka byla smazána');
    } catch (error) {
      handleFolderError(res, error, 'Nepodařilo se smazat složku', 'FolderController');
    }
  }
);

export const previewFolder = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'FolderController');
      return;
    }
    const folderId = req.params.id;
    if (!folderId) {
      ResponseHelper.badRequest(res, 'Folder ID is required');
      return;
    }
    try {
      const preview = await FolderService.getFolderContentsPreview(req.user.id, folderId);
      ResponseHelper.success(res, preview, 'Náhled obsahu složky');
    } catch (error) {
      handleFolderError(res, error, 'Nepodařilo se načíst náhled složky', 'FolderController');
    }
  }
);

export const moveProjectsToFolder = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      ResponseHelper.unauthorized(res, 'Uživatel není autentizován', 'FolderController');
      return;
    }
    // ":id" is the destination folder; the special string "root" moves to root
    // (no folder placement). The router validates the param shape, so by this
    // point we know it's either a uuid or the literal "root".
    const rawId = req.params.id;
    const folderId = rawId === 'root' ? null : rawId;
    const { projectIds }: FolderItemsData = req.body;
    try {
      const result = await FolderService.moveProjectsToFolder(
        req.user.id,
        folderId,
        projectIds
      );
      ResponseHelper.success(res, result, 'Projekty byly přesunuty');
    } catch (error) {
      handleFolderError(res, error, 'Nepodařilo se přesunout projekty', 'FolderController');
    }
  }
);
