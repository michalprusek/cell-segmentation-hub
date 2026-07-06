import { Request, Response } from 'express';
import {
  SegmentationService,
  VideoAccessError,
} from '../../services/segmentationService';
import { ImageService } from '../../services/imageService';
import { logger } from '../../utils/logger';
import { ResponseHelper } from '../../utils/response';
import { prisma } from '../../db';
import {
  SEGMENTATION_MODELS,
  SEGMENTATION_MODEL_ERROR_MESSAGE,
} from '../../constants/segmentationModels';

class SegmentationController {
  private segmentationService: SegmentationService;

  constructor() {
    const imageService = new ImageService(prisma);
    this.segmentationService = new SegmentationService(prisma, imageService);
  }

  /**
   * Validate that req.user exists and return userId
   */
  private validateUser(req: Request, res: Response): string | null {
    if (!req.user || !req.user.id) {
      ResponseHelper.unauthorized(res, 'User authentication required');
      return null;
    }
    return req.user.id;
  }

  /**
   * Validate required route parameters
   */
  private validateParams(
    params: Record<string, string | undefined>,
    required: string[],
    res: Response
  ): boolean {
    for (const param of required) {
      if (!params[param]) {
        ResponseHelper.validationError(
          res,
          `Missing required parameter: ${param}`
        );
        return false;
      }
    }
    return true;
  }

  /**
   * Get segmentation results for an image
   */
  getSegmentationResults = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { imageId } = req.params;
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      if (!imageId) {
        ResponseHelper.badRequest(res, 'Image ID is required');
        return;
      }

      logger.debug(
        'Controller: Fetching segmentation results',
        'SegmentationController',
        {
          imageId,
          userId,
        }
      );

      const results = await this.segmentationService.getSegmentationResults(
        imageId,
        userId
      );

      if (results) {
        logger.debug(
          'Controller: Segmentation results found',
          'SegmentationController',
          {
            imageId,
            polygonCount: results.polygons?.length || 0,
            hasResults: !!results,
          }
        );
        ResponseHelper.success(res, results, 'Výsledky segmentace načteny');
      } else {
        logger.debug(
          'Controller: No segmentation results found',
          'SegmentationController',
          {
            imageId,
            userId,
          }
        );
        ResponseHelper.notFound(res, 'Výsledky segmentace nenalezeny');
      }
    } catch (error) {
      logger.error(
        'Failed to get segmentation results',
        error instanceof Error ? error : undefined,
        'SegmentationController',
        {
          imageId: req.params.imageId,
          userId: req.user?.id,
        }
      );

      const errorMessage =
        error instanceof Error ? error.message : 'Chyba při načítání výsledků';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Update segmentation results for an image
   */
  updateSegmentationResults = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { imageId } = req.params;
      const { polygons, imageWidth, imageHeight } = req.body;

      // Validate user authentication
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Validate required parameters
      if (!this.validateParams(req.params, ['imageId'], res)) {
        return;
      }

      if (!polygons || !Array.isArray(polygons)) {
        ResponseHelper.validationError(res, 'Polygony musí být pole');
        return;
      }

      const result = await this.segmentationService.updateSegmentationResults(
        imageId as string,
        polygons,
        userId,
        imageWidth,
        imageHeight
      );

      ResponseHelper.success(res, result, 'Výsledky segmentace aktualizovány');
    } catch (error) {
      logger.error(
        'Failed to update segmentation results',
        error instanceof Error ? error : undefined,
        'SegmentationController',
        {
          imageId: req.params.imageId,
          userId: req.user?.id,
        }
      );

      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Chyba při aktualizaci výsledků';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Delete segmentation results for an image
   */
  deleteSegmentationResults = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { imageId } = req.params;

      // Validate user authentication
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Validate required parameters
      if (!this.validateParams(req.params, ['imageId'], res)) {
        return;
      }

      await this.segmentationService.deleteSegmentationResults(
        imageId as string,
        userId
      );

      ResponseHelper.success(res, undefined, 'Výsledky segmentace smazány');
    } catch (error) {
      logger.error(
        'Failed to delete segmentation results',
        error instanceof Error ? error : undefined,
        'SegmentationController',
        {
          imageId: req.params.imageId,
          userId: req.user?.id,
        }
      );

      const errorMessage =
        error instanceof Error ? error.message : 'Chyba při mazání výsledků';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Delete segmentation annotations for many images at once (bulk action from
   * the project page; the images themselves are kept).
   */
  deleteSegmentationBatch = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { imageIds } = req.body;
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }
      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        ResponseHelper.validationError(res, 'imageIds musí být neprázdné pole');
        return;
      }

      const result = await this.segmentationService.deleteSegmentationBatch(
        imageIds,
        userId
      );

      ResponseHelper.success(res, result, 'Anotace smazány');
    } catch (error) {
      logger.error(
        'Failed to batch-delete segmentation annotations',
        error instanceof Error ? error : undefined,
        'SegmentationController',
        { userId: req.user?.id }
      );
      ResponseHelper.internalError(
        res,
        error as Error,
        'Chyba při mazání anotací'
      );
    }
  };

  /**
   * Map a track-operation error to the right HTTP status: ownership failures are
   * 404 and geometry-shape failures are validation errors, so they don't leak as
   * generic 500s.
   */
  private handleTrackOpError(
    error: unknown,
    res: Response,
    fallbackMessage: string
  ): void {
    // Ownership failures are a typed error (not a substring match, which would
    // silently drift-break if the message is reworded).
    if (error instanceof VideoAccessError) {
      ResponseHelper.notFound(res, 'Video nenalezeno nebo bez přístupu');
      return;
    }
    // Geometry-shape failure (also gated at the route, so this is defensive).
    if (error instanceof Error && /at least 2( finite)? points/i.test(error.message)) {
      ResponseHelper.validationError(res, error.message);
      return;
    }
    ResponseHelper.internalError(res, error as Error, fallbackMessage);
  }

  /**
   * Propagate a microtubule polyline into all following frames of a video.
   */
  propagateTrack = async (req: Request, res: Response): Promise<void> => {
    try {
      const { videoId } = req.params;
      const { fromFrameIndex, polyline } = req.body;

      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }
      if (!this.validateParams(req.params, ['videoId'], res)) {
        return;
      }

      const result =
        await this.segmentationService.propagateTrackGeometryForward(
          videoId as string,
          Number(fromFrameIndex),
          polyline,
          userId
        );

      ResponseHelper.success(
        res,
        result,
        'Mikrotubulus propagován do dalších snímků'
      );
    } catch (error) {
      logger.error(
        'Failed to propagate microtubule track',
        error instanceof Error ? error : undefined,
        'SegmentationController',
        { videoId: req.params.videoId, userId: req.user?.id }
      );
      this.handleTrackOpError(error, res, 'Chyba při propagaci mikrotubulu');
    }
  };

  /**
   * Delete a whole microtubule track (every frame of the video).
   */
  deleteTrack = async (req: Request, res: Response): Promise<void> => {
    try {
      const { videoId, trackId } = req.params;

      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }
      if (!this.validateParams(req.params, ['videoId', 'trackId'], res)) {
        return;
      }

      const result = await this.segmentationService.deleteTrackAcrossVideo(
        videoId as string,
        trackId as string,
        userId
      );

      ResponseHelper.success(res, result, 'Track mikrotubulu smazán');
    } catch (error) {
      logger.error(
        'Failed to delete microtubule track',
        error instanceof Error ? error : undefined,
        'SegmentationController',
        { videoId: req.params.videoId, userId: req.user?.id }
      );
      this.handleTrackOpError(error, res, 'Chyba při mazání tracku');
    }
  };

  /**
   * Batch process multiple images
   */
  batchSegment = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        imageIds,
        model = 'hrnet',
        threshold = 0.5,
        detectHoles = true,
        channel,
      } = req.body;

      // Validate user authentication
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Validate parameters
      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        ResponseHelper.validationError(
          res,
          'Musíte zadat alespoň jeden obrázek'
        );
        return;
      }

      // Defense-in-depth re-check. The express-validator on the route
      // already rejects invalid models on the HTTP path, but if anyone
      // later wires this method onto a different route without the
      // same validator chain we still refuse. Single source of truth
      // in constants/segmentationModels.ts.
      if (!(SEGMENTATION_MODELS as readonly string[]).includes(model)) {
        ResponseHelper.validationError(res, SEGMENTATION_MODEL_ERROR_MESSAGE);
        return;
      }

      if (threshold < 0.1 || threshold > 0.9) {
        ResponseHelper.validationError(
          res,
          'Threshold musí být mezi 0.1 a 0.9'
        );
        return;
      }

      if (imageIds.length > 50) {
        ResponseHelper.validationError(
          res,
          'Můžete zpracovat maximálně 50 obrázků najednou'
        );
        return;
      }

      logger.info('Starting batch segmentation', 'SegmentationController', {
        imageCount: imageIds.length,
        model,
        threshold,
        detectHoles,
        userId,
      });

      const result = await this.segmentationService.batchProcess(
        imageIds,
        model,
        threshold,
        userId,
        detectHoles,
        // Channel override for multi-channel video frames (TIRF_640
        // vs TIRF_488 etc). Validated by the route at body('channel').
        typeof channel === 'string' && channel.length > 0
          ? channel
          : undefined
      );

      ResponseHelper.success(res, result, 'Dávkové zpracování dokončeno');
    } catch (error) {
      logger.error(
        'Batch segmentation failed',
        error instanceof Error ? error : undefined,
        'SegmentationController',
        {
          userId: req.user?.id,
        }
      );

      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Chyba při dávkovém zpracování';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Batch fetch segmentation results for multiple images
   * This is a critical performance optimization for large projects
   */
  batchGetSegmentationResults = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { imageIds } = req.body;

      // Validate user authentication
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Validate parameters
      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        ResponseHelper.validationError(
          res,
          'Image IDs must be provided as an array'
        );
        return;
      }

      // Limit batch size to prevent memory issues
      if (imageIds.length > 1000) {
        ResponseHelper.validationError(
          res,
          'Maximum 1000 images per batch request'
        );
        return;
      }

      // Fetch all segmentation results in a single efficient query
      const results =
        await this.segmentationService.getBatchSegmentationResults(
          imageIds,
          userId
        );

      ResponseHelper.success(
        res,
        results,
        'Batch segmentation results fetched'
      );
    } catch (error) {
      logger.error(
        'Failed to batch fetch segmentation results',
        error instanceof Error ? error : undefined,
        'SegmentationController',
        {
          imageCount: req.body.imageIds?.length,
          userId: req.user?.id,
        }
      );

      const errorMessage =
        error instanceof Error ? error.message : 'Error fetching batch results';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };
}

export const segmentationController = new SegmentationController();
