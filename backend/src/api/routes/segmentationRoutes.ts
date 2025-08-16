import { Router, Request, Response, NextFunction } from 'express';
import { segmentationController } from '../controllers/segmentationController';
import { authenticate } from '../../middleware/auth';
import { validationResult, ValidationError, body, param } from 'express-validator';
import { ResponseHelper } from '../../utils/response';

// Middleware to handle express-validator results
const handleValidation = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMap = errors.array().reduce((acc, error: any) => {
      const field = error.path || error.param || 'unknown';
      if (!acc[field]) acc[field] = [];
      acc[field].push(error.msg);
      return acc;
    }, {} as Record<string, string[]>);
    ResponseHelper.validationError(res, errorMap);
    return;
  }
  next();
};

const router = Router();

// Apply authentication to all segmentation routes
router.use(authenticate);

/**
 * @route GET /api/segmentation/health
 * @description Check if segmentation service is healthy
 * @access Private
 */
router.get('/health', segmentationController.checkHealth);

/**
 * @route GET /api/segmentation/models
 * @description Get available segmentation models
 * @access Private
 */
router.get('/models', segmentationController.getAvailableModels);

/**
 * @route POST /api/segmentation/images/:imageId/segment
 * @description Request segmentation for a single image
 * @access Private
 */
router.post(
  '/images/:imageId/segment',
  [
    param('imageId').isUUID().withMessage('ID obrázku musí být platné UUID'),
    body('model')
      .optional()
      .isIn(['hrnet', 'resunet_advanced', 'resunet_small'])
      .withMessage('Model musí být hrnet, resunet_advanced nebo resunet_small'),
    body('threshold')
      .optional()
      .isFloat({ min: 0.1, max: 0.9 })
      .withMessage('Threshold musí být mezi 0.1 a 0.9')
  ],
  handleValidation,
  segmentationController.segmentImage
);

/**
 * @route GET /api/segmentation/images/:imageId/results
 * @description Get segmentation results for an image
 * @access Private
 */
router.get(
  '/images/:imageId/results',
  [
    param('imageId').isUUID().withMessage('ID obrázku musí být platné UUID')
  ],
  handleValidation,
  segmentationController.getSegmentationResults
);

/**
 * @route PUT /api/segmentation/images/:imageId/results
 * @description Update segmentation results for an image
 * @access Private
 */
router.put(
  '/images/:imageId/results',
  [
    param('imageId').isUUID().withMessage('ID obrázku musí být platné UUID'),
    body('polygons').isArray().withMessage('Polygony musí být pole'),
    body('polygons.*.id').isString().withMessage('ID polygonu musí být řetězec'),
    body('polygons.*.points').isArray().withMessage('Body polygonu musí být pole'),
    body('polygons.*.type').isIn(['external', 'internal']).withMessage('Typ polygonu musí být external nebo internal')
  ],
  handleValidation,
  segmentationController.updateSegmentationResults
);

/**
 * @route DELETE /api/segmentation/images/:imageId/results
 * @description Delete segmentation results for an image
 * @access Private
 */
router.delete(
  '/images/:imageId/results',
  [
    param('imageId').isUUID().withMessage('ID obrázku musí být platné UUID')
  ],
  handleValidation,
  segmentationController.deleteSegmentationResults
);

/**
 * @route POST /api/segmentation/batch
 * @description Process multiple images in batch
 * @access Private
 */
router.post(
  '/batch',
  [
    body('imageIds')
      .isArray({ min: 1, max: 50 })
      .withMessage('Musíte zadat 1-50 obrázků')
      .custom((imageIds) => {
        if (Array.isArray(imageIds) && new Set(imageIds).size !== imageIds.length) {
          throw new Error('Duplicitní ID obrázků nejsou povoleny');
        }
        return true;
      }),
    body('imageIds.*')
      .isUUID()
      .withMessage('Všechna ID obrázků musí být platná UUID'),
    body('model')
      .optional()
      .isIn(['hrnet', 'resunet_advanced', 'resunet_small'])
      .withMessage('Model musí být hrnet, resunet_advanced nebo resunet_small'),
    body('threshold')
      .optional()
      .isFloat({ min: 0.1, max: 0.9 })
      .withMessage('Threshold musí být mezi 0.1 a 0.9')
  ],
  handleValidation,
  segmentationController.batchSegment
);

/**
 * @route GET /api/segmentation/projects/:projectId/stats
 * @description Get segmentation statistics for a project
 * @access Private
 */
router.get(
  '/projects/:projectId/stats',
  [
    param('projectId').isUUID().withMessage('ID projektu musí být platné UUID')
  ],
  handleValidation,
  segmentationController.getProjectStats
);

export { router as segmentationRoutes };