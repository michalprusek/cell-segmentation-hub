import { Router, Request, Response, NextFunction } from 'express';
import { segmentationController } from '../controllers/segmentationController';
import { authenticate } from '../../middleware/auth';
import {
  validationResult,
  body,
  param,
  ValidationError,
} from 'express-validator';
import { ResponseHelper } from '../../utils/response';

// Middleware to handle express-validator results
const handleValidation = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMap = errors.array().reduce(
      (acc, error) => {
        const validationError = error as ValidationError & {
          path?: string;
          param?: string;
          msg: string;
        };
        const field =
          validationError.path || validationError.param || 'unknown';
        if (!acc[field]) {
          acc[field] = [];
        }
        acc[field].push(validationError.msg);
        return acc;
      },
      {} as Record<string, string[]>
    );
    ResponseHelper.validationError(res, errorMap);
    return;
  }
  next();
};

const router = Router();

// Apply authentication to all segmentation routes
router.use(authenticate);

/**
 * @route GET /api/segmentation/images/:imageId/results
 * @description Get segmentation results for an image
 * @access Private
 */
router.get(
  '/images/:imageId/results',
  [param('imageId').isUUID().withMessage('ID obrázku musí být platné UUID')],
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
    body('polygons.*.id')
      .isString()
      .withMessage('ID polygonu musí být řetězec'),
    body('polygons.*.points')
      .isArray()
      .withMessage('Body polygonu musí být pole'),
    body('polygons.*.type')
      .isIn(['external', 'internal'])
      .withMessage('Typ polygonu musí být external nebo internal'),
    body('imageWidth')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Šířka obrázku musí být kladné číslo'),
    body('imageHeight')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Výška obrázku musí být kladné číslo'),
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
  [param('imageId').isUUID().withMessage('ID obrázku musí být platné UUID')],
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
      .custom(imageIds => {
        if (
          Array.isArray(imageIds) &&
          new Set(imageIds).size !== imageIds.length
        ) {
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
      .withMessage('Threshold musí být mezi 0.1 a 0.9'),
    body('detectHoles')
      .optional()
      .isBoolean()
      .withMessage('Detect holes musí být boolean hodnota'),
  ],
  handleValidation,
  segmentationController.batchSegment
);

/**
 * @route POST /api/segmentation/batch/results
 * @description Batch fetch segmentation results for multiple images (Performance optimization)
 * @access Private
 */
router.post(
  '/batch/results',
  [
    body('imageIds')
      .isArray({ min: 1, max: 1000 })
      .withMessage('Must provide 1-1000 image IDs')
      .custom(imageIds => {
        if (
          Array.isArray(imageIds) &&
          new Set(imageIds).size !== imageIds.length
        ) {
          throw new Error('Duplicate image IDs are not allowed');
        }
        return true;
      }),
    body('imageIds.*')
      .isUUID()
      .withMessage('All image IDs must be valid UUIDs'),
  ],
  handleValidation,
  segmentationController.batchGetSegmentationResults
);

export { router as segmentationRoutes };
