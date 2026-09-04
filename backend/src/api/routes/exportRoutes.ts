import express, { Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { downloadTokenAuth } from '../../middleware/downloadAuth';
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
    // Microtubule kymograph export: how wide a line is sampled along each
    // microtubule (px, PERPENDICULAR to it) and how the samples across that
    // width collapse to one value. Absent = 1 / mean, i.e. the single-pixel
    // line profile this export has always built. Bounds mirror the ML
    // `KymographRequest.line_width` (1…51) — outside them the model 422s.
    // `toInt` because the controller casts `req.body` straight to the options
    // object: a numeric STRING passes `isInt` but would then be dropped as
    // "not a finite number" by `kymographService`, i.e. the user would ask for
    // a band and silently get width 1.
    body('options.mtKymographs.lineWidth')
      .optional()
      .isInt({ min: 1, max: 51 })
      .toInt(),
    body('options.mtKymographs.lineReduce').optional().isIn(['mean', 'max']),
    // Absolute intensity floor for detected trajectories, in raw sample units.
    // Float and unbounded above for the same reasons as the modal's copy: the
    // measurement is a band mean, and a 16-bit frame can need a floor in the
    // thousands.
    body('options.mtKymographs.minIntensityMinusBg')
      .optional()
      .isFloat({ min: 0 })
      .toFloat(),
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
// This route accepts EITHER the session cookie OR a short-lived signed token
// in the ?token= query string (native browser download path — a <a href>
// download cannot attach the session's credential). `downloadTokenAuth` is
// shared with the essays download so the two routers, and the controllers
// behind them, cannot drift on what counts as a token.
router.get(
  '/projects/:projectId/export/:jobId/download',
  downloadTokenAuth,
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
