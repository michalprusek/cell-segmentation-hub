import express, { Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { validationResult, body, param } from 'express-validator';
import { ExportController } from '../controllers/exportController';

// Validation middleware for express-validator
const validateRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
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
  [param('projectId').isUUID(), param('jobId').isUUID()],
  validateRequest,
  exportController.getExportStatus
);

// Issue a short-lived signed download token (for native browser downloads)
router.post(
  '/projects/:projectId/export/:jobId/download-token',
  authenticate,
  [param('projectId').isUUID(), param('jobId').isUUID()],
  validateRequest,
  exportController.getDownloadToken
);

// Download export.
//
// This route accepts EITHER a JWT in the Authorization header (legacy XHR
// path) OR a short-lived signed token in the ?token= query string (native
// browser download path). The auth check is delegated to the controller so
// the standard `authenticate` middleware does not block ?token= requests
// (browsers cannot attach an Authorization header on <a href> downloads).
const optionalJwtAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (typeof req.query.token === 'string' && req.query.token.length > 0) {
    // Token in query — controller will verify it.
    next();
    return;
  }
  // Otherwise fall through to the standard JWT middleware.
  authenticate(req, res, next);
};

router.get(
  '/projects/:projectId/export/:jobId/download',
  optionalJwtAuth,
  [param('projectId').isUUID(), param('jobId').isUUID()],
  validateRequest,
  exportController.downloadExport
);

// Cancel export job
router.post(
  '/projects/:projectId/export/:jobId/cancel',
  authenticate,
  [param('projectId').isUUID(), param('jobId').isUUID()],
  validateRequest,
  exportController.cancelExport
);

// Get export history
router.get(
  '/projects/:projectId/export/history',
  authenticate,
  [param('projectId').isUUID()],
  validateRequest,
  exportController.getExportHistory
);

// Get available export formats
router.get('/export/formats', authenticate, exportController.getExportFormats);

export { router as exportRoutes };
