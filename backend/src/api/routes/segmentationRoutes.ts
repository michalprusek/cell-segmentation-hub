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
import { buildKymograph } from '../../services/kymographService';
import { logger } from '../../utils/logger';
import {
  SEGMENTATION_MODELS,
  SEGMENTATION_MODEL_ERROR_MESSAGE,
} from '../../constants/segmentationModels';

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
 * @route POST /api/segmentation/videos/:videoId/tracks/propagate
 * @description Propagate a microtubule polyline into all following frames
 * @access Private
 */
router.post(
  '/videos/:videoId/tracks/propagate',
  [
    param('videoId').isUUID().withMessage('ID videa musí být platné UUID'),
    body('fromFrameIndex')
      .isInt({ min: 0 })
      .withMessage('fromFrameIndex musí být nezáporné číslo'),
    body('polyline').isObject().withMessage('polyline musí být objekt'),
    body('polyline.points')
      .isArray({ min: 2 })
      .withMessage('polyline musí mít alespoň 2 body'),
    body('polyline.points.*.x')
      .isNumeric()
      .withMessage('Souřadnice x musí být číslo'),
    body('polyline.points.*.y')
      .isNumeric()
      .withMessage('Souřadnice y musí být číslo'),
    body('polyline.trackId')
      .optional({ nullable: true })
      .isString()
      .withMessage('trackId musí být řetězec'),
    body('polyline.name')
      .optional({ nullable: true })
      .isString()
      .withMessage('name musí být řetězec'),
    body('polyline.geometry')
      .optional()
      .isIn(['polygon', 'polyline'])
      .withMessage('geometry musí být polygon nebo polyline'),
  ],
  handleValidation,
  segmentationController.propagateTrack
);

/**
 * @route DELETE /api/segmentation/videos/:videoId/tracks/:trackId
 * @description Delete a whole microtubule track across every frame of the video
 * @access Private
 */
router.delete(
  '/videos/:videoId/tracks/:trackId',
  [
    param('videoId').isUUID().withMessage('ID videa musí být platné UUID'),
    param('trackId')
      .isString()
      .trim()
      .notEmpty()
      .isLength({ max: 200 })
      .withMessage('trackId musí být neprázdný řetězec'),
  ],
  handleValidation,
  segmentationController.deleteTrack
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
      .isIn([...SEGMENTATION_MODELS])
      .withMessage(SEGMENTATION_MODEL_ERROR_MESSAGE),
    body('threshold')
      .optional()
      .isFloat({ min: 0.1, max: 0.9 })
      .withMessage('Threshold musí být mezi 0.1 a 0.9'),
    body('detectHoles')
      .optional()
      .isBoolean()
      .withMessage('Detect holes musí být boolean hodnota'),
    // Channel override for multi-channel video frames. Same shape as
    // batchQueueSchema.channel in validation.ts — alphanumeric + ._-
    // bounded to 64 chars to prevent unbounded path-rewrite input.
    body('channel')
      .optional()
      .isString()
      .isLength({ max: 64 })
      .matches(/^[A-Za-z0-9_.-]+$/)
      .withMessage('Channel musí být alfanumerický řetězec do 64 znaků'),
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

/**
 * @route POST /api/segmentation/kymograph
 * @description Build a kymograph for one microtubule polyline across all
 *   frames of its container video. The frontend KymographModal posts
 *   here; we orchestrate the per-frame polyline + channel-file
 *   resolution and delegate the sampling + rendering to the ML service.
 * @access Private
 */
router.post(
  '/kymograph',
  authenticate,
  [
    body('videoContainerId').isUUID(),
    body('polylineId').isString().notEmpty().isLength({ max: 128 }),
    body('frameIndex').isInt({ min: 0 }),
    // sourceChannel: alnum + underscore + dash only; rejected before the
    // service layer joins it into a filesystem path.
    body('sourceChannel')
      .isString()
      .matches(/^[A-Za-z0-9_-]{1,64}$/)
      .withMessage(
        'sourceChannel must be alnum / underscore / dash, up to 64 chars'
      ),
    // channelColor: optional hex `#RRGGBB`. When supplied, the ML
    // renderer uses a black→color gradient instead of viridis.
    body('channelColor')
      .optional()
      .isString()
      .matches(/^#[0-9A-Fa-f]{6}$/)
      .withMessage('channelColor must be #RRGGBB hex'),
    // detectVelocity: opt-in blob-motion analysis (velocity table + overlay).
    body('detectVelocity').optional().isBoolean(),
    // intensityWidth: signal-band width (kymograph columns) for the
    // background-subtracted intensity metric along each trajectory.
    body('intensityWidth').optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      // Authz: ensure the caller owns (or has accepted-share access to)
      // the project containing the requested video container before
      // even invoking the ML service.
      const userId = req.user?.id;
      if (!userId) {
        ResponseHelper.error(res, 'Unauthorized', 401);
        return;
      }
      const { prisma } = await import('../../db/prismaClient');
      const container = await prisma.image.findUnique({
        where: { id: req.body.videoContainerId },
        select: { projectId: true, isVideoContainer: true },
      });
      if (!container || !container.isVideoContainer) {
        ResponseHelper.error(res, 'Video container not found', 404);
        return;
      }
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      const project = await prisma.project.findFirst({
        where: {
          id: container.projectId,
          OR: [
            { userId },
            {
              shares: {
                some: {
                  status: 'accepted',
                  OR: [
                    { sharedWithId: userId },
                    ...(user?.email ? [{ email: user.email }] : []),
                  ],
                },
              },
            },
          ],
        },
        select: { id: true },
      });
      if (!project) {
        ResponseHelper.error(res, 'Access denied to this project', 403);
        return;
      }
      const result = await buildKymograph({
        videoContainerId: req.body.videoContainerId,
        polylineId: req.body.polylineId,
        frameIndex: req.body.frameIndex,
        sourceChannel: req.body.sourceChannel,
        channelColor: req.body.channelColor,
        detectVelocity: req.body.detectVelocity === true,
        intensityWidth:
          req.body.intensityWidth != null
            ? Number(req.body.intensityWidth)
            : undefined,
      });
      ResponseHelper.success(res, result);
    } catch (err) {
      const message = (err as Error).message;
      logger.error(
        `Kymograph build failed: ${message}`,
        err as Error,
        'SegmentationRoutes'
      );
      ResponseHelper.error(res, message, 500);
    }
  }
);

export { router as segmentationRoutes };
