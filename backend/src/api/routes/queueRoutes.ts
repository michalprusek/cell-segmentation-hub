import { Router, Request, Response, NextFunction } from 'express';
import { queueController } from '../controllers/queueController';
import { authenticate } from '../../middleware/auth';
import { validateBody } from '../../middleware/validation';
// validateParams unused - available for future use
import {
  addImageToQueueSchema,
  batchQueueSchema,
} from '../../types/validation';
// resetStuckItemsSchema, cleanupQueueSchema unused - available for future use
import {
  validationResult,
  ValidationError,
  body,
  param,
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
          param?: string;
          msg: string;
        };
        const field = validationError.param || 'unknown';
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

// All routes require authentication
router.use(authenticate);

/**
 * @route POST /api/queue/images/:imageId
 * @description Add single image to segmentation queue
 * @access Private
 */
router.post(
  '/images/:imageId',
  [param('imageId').isUUID().withMessage('ID obrázku musí být platné UUID')],
  handleValidation,
  validateBody(addImageToQueueSchema),
  queueController.addImageToQueue
);

/**
 * @route POST /api/queue/batch
 * @description Add multiple images to segmentation queue in batch
 * @access Private
 */
router.post(
  '/batch',
  validateBody(batchQueueSchema),
  queueController.addBatchToQueue
);

/**
 * @route GET /api/queue/projects/:projectId/stats
 * @description Get queue statistics for a project
 * @access Private
 */
router.get(
  '/projects/:projectId/stats',
  [param('projectId').isUUID().withMessage('ID projektu musí být platné UUID')],
  handleValidation,
  queueController.getQueueStats
);

/**
 * @route GET /api/queue/projects/:projectId/items
 * @description Get queue items for a project
 * @access Private
 */
router.get(
  '/projects/:projectId/items',
  [param('projectId').isUUID().withMessage('ID projektu musí být platné UUID')],
  handleValidation,
  queueController.getQueueItems
);

/**
 * @route DELETE /api/queue/items/:queueId
 * @description Remove item from segmentation queue
 * @access Private
 */
router.delete(
  '/items/:queueId',
  [param('queueId').isUUID().withMessage('ID fronty musí být platné UUID')],
  handleValidation,
  queueController.removeFromQueue
);

/**
 * @route GET /api/queue/stats
 * @description Get overall queue statistics
 * @access Private
 */
router.get('/stats', queueController.getOverallQueueStats);

/**
 * @route GET /api/queue/health
 * @description Get comprehensive health status of segmentation pipeline
 * @access Private
 */
router.get('/health', queueController.getQueueHealth);

/**
 * @route POST /api/queue/reset-stuck
 * @description Reset stuck queue items
 * @access Private
 */
router.post(
  '/reset-stuck',
  [
    body('maxProcessingMinutes')
      .optional()
      .isInt({ min: 1, max: 60 })
      .withMessage('Maximální čas zpracování musí být mezi 1 a 60 minutami'),
  ],
  handleValidation,
  queueController.resetStuckItems
);

/**
 * @route POST /api/queue/cleanup
 * @description Cleanup old queue entries
 * @access Private
 */
router.post(
  '/cleanup',
  [
    body('daysOld')
      .optional()
      .isInt({ min: 1, max: 30 })
      .withMessage('Počet dní musí být mezi 1 a 30'),
  ],
  handleValidation,
  queueController.cleanupQueue
);

/**
 * @route POST /api/queue/cancel-all-user
 * @description Cancel all segmentation tasks for the current user
 * @access Private
 */
router.post(
  '/cancel-all-user',
  handleValidation,
  queueController.cancelAllUserSegmentations
);

export { router as queueRoutes };
