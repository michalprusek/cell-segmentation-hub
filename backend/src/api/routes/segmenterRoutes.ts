import { Router } from 'express';
import {
  createDataset,
  listDatasets,
  getDataset,
  deleteDataset,
  uploadImages,
  deleteImage,
  listClasses,
  createClass,
  updateClass,
  deleteClass,
  getAnnotation,
  upsertAnnotation,
  serveImageFile,
} from '../controllers/segmenterController';
import { authenticate } from '../../middleware/auth';
import { validateBody, validateParams } from '../../middleware/validation';
import {
  uploadImages as uploadImagesMiddleware,
  handleUploadError,
  validateUploadedFiles,
} from '../../middleware/upload';
import {
  createSegmenterDatasetSchema,
  segmenterDatasetIdSchema,
  segmenterClassParamsSchema,
  createSegmenterClassSchema,
  updateSegmenterClassSchema,
  segmenterImageIdSchema,
  segmenterAnnotationsPutSchema,
} from '../../types/validation';

/**
 * `/segmenter` — few-shot, active-learning polygon annotation module (P0:
 * dataset + image + class-registry + annotation CRUD; no ML yet). Mounted at
 * `/api/segmenter` in `setupRoutes()`. Every route requires authentication;
 * ownership is enforced in `segmenterService` (owner-only in P0 — no sharing).
 *
 * See docs/superpowers/specs/2026-07-09-segmenter-fewshot-al-design.md §9 and
 * docs/superpowers/plans/2026-07-09-segmenter-p0.md Tasks 2-3.
 */
const router = Router();

router.use(authenticate);

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

router.post(
  '/datasets',
  validateBody(createSegmenterDatasetSchema),
  createDataset
);

router.get('/datasets', listDatasets);

router.get(
  '/datasets/:id',
  validateParams(segmenterDatasetIdSchema),
  getDataset
);

router.delete(
  '/datasets/:id',
  validateParams(segmenterDatasetIdSchema),
  deleteDataset
);

/**
 * Upload one or more images into a dataset (multipart field: "images").
 * Reuses the same memory-storage multer as the main app's image upload.
 */
router.post(
  '/datasets/:id/images',
  validateParams(segmenterDatasetIdSchema),
  uploadImagesMiddleware,
  handleUploadError,
  validateUploadedFiles,
  uploadImages
);

// ---------------------------------------------------------------------------
// Class registry (mirrors the MT type-label palette pattern, but backed by a
// real per-row table rather than a JSON blob column).
// ---------------------------------------------------------------------------

router.get(
  '/datasets/:id/classes',
  validateParams(segmenterDatasetIdSchema),
  listClasses
);

router.post(
  '/datasets/:id/classes',
  validateParams(segmenterDatasetIdSchema),
  validateBody(createSegmenterClassSchema),
  createClass
);

router.put(
  '/datasets/:id/classes/:classId',
  // Must validate BOTH params — segmenterDatasetIdSchema alone would strip
  // `classId` off req.params (validateParams replaces req.params wholesale).
  validateParams(segmenterClassParamsSchema),
  validateBody(updateSegmenterClassSchema),
  updateClass
);

router.delete(
  '/datasets/:id/classes/:classId',
  validateParams(segmenterClassParamsSchema),
  deleteClass
);

// ---------------------------------------------------------------------------
// Images (top-level — not dataset-scoped in the path; ownership is still
// enforced via the dataset join inside the service).
// ---------------------------------------------------------------------------

router.delete(
  '/images/:imageId',
  validateParams(segmenterImageIdSchema),
  deleteImage
);

// Raw image bytes for the canvas background (owner-scoped in the service).
router.get(
  '/images/:imageId/file',
  validateParams(segmenterImageIdSchema),
  serveImageFile
);

router.get(
  '/images/:imageId/annotations',
  validateParams(segmenterImageIdSchema),
  getAnnotation
);

router.put(
  '/images/:imageId/annotations',
  validateParams(segmenterImageIdSchema),
  validateBody(segmenterAnnotationsPutSchema),
  upsertAnnotation
);

export default router;
