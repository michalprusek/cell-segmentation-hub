import express, { Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { validationResult, param } from 'express-validator';
import { EssaysController } from '../controllers/essaysController';
import { uploadEssaysFiles, handleUploadError } from '../../middleware/upload';

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
const essaysController = new EssaysController();

// Upload a folder of .nd2 wells and start a batch MT-assay job.
router.post(
  '/essays/upload',
  authenticate,
  uploadEssaysFiles,
  handleUploadError,
  essaysController.uploadEssays
);

// The caller's job history.
router.get('/essays/jobs', authenticate, essaysController.listJobs);

// A single job's live status.
router.get(
  '/essays/jobs/:jobId',
  authenticate,
  [param('jobId').isUUID()],
  validateRequest,
  essaysController.getJob
);

// Issue a short-lived signed token for a native browser download.
router.post(
  '/essays/jobs/:jobId/download-token',
  authenticate,
  [param('jobId').isUUID()],
  validateRequest,
  essaysController.getDownloadToken
);

// Download the result zip. Accepts EITHER the session cookie OR a ?token= (a
// native <a href> download cannot carry the cookie's auth), so the auth check is
// delegated to the controller when a token is present.
const optionalJwtAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (typeof req.query.token === 'string' && req.query.token.length > 0) {
    next();
    return;
  }
  authenticate(req, res, next);
};

router.get(
  '/essays/jobs/:jobId/download',
  optionalJwtAuth,
  [param('jobId').isUUID()],
  validateRequest,
  essaysController.downloadJob
);

// Delete a job and its artifacts.
router.delete(
  '/essays/jobs/:jobId',
  authenticate,
  [param('jobId').isUUID()],
  validateRequest,
  essaysController.deleteJob
);

export { router as essaysRoutes };
