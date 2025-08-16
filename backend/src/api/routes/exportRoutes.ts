import express, { Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { validationResult } from 'express-validator';
import { body, param } from 'express-validator';
import { ExportController } from '../controllers/exportController';

// Validation middleware for express-validator
const validateRequest = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

const router = express.Router();
const exportController = new ExportController();

// Start export job
router.post(
  '/projects/:projectId/export',
  authenticate,
  [
    param('projectId').isUUID(),
    body('options').isObject(),
    body('options.includeOriginalImages').optional().isBoolean(),
    body('options.includeVisualizations').optional().isBoolean(),
    body('options.annotationFormats').optional().isArray(),
    body('options.metricsFormats').optional().isArray(),
  ],
  validateRequest,
  exportController.startExport
);

// Get export status
router.get(
  '/projects/:projectId/export/:jobId/status',
  authenticate,
  [
    param('projectId').isUUID(),
    param('jobId').isUUID(),
  ],
  validateRequest,
  exportController.getExportStatus
);

// Download export
router.get(
  '/projects/:projectId/export/:jobId/download',
  authenticate,
  [
    param('projectId').isUUID(),
    param('jobId').isUUID(),
  ],
  validateRequest,
  exportController.downloadExport
);

// Cancel export job
router.post(
  '/projects/:projectId/export/:jobId/cancel',
  authenticate,
  [
    param('projectId').isUUID(),
    param('jobId').isUUID(),
  ],
  validateRequest,
  exportController.cancelExport
);

// Get export history
router.get(
  '/projects/:projectId/export/history',
  authenticate,
  [
    param('projectId').isUUID(),
  ],
  validateRequest,
  exportController.getExportHistory
);

// Get available export formats
router.get(
  '/export/formats',
  authenticate,
  exportController.getExportFormats
);

export { router as exportRoutes };