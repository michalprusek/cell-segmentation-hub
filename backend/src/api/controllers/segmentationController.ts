import { Request, Response } from 'express';
import { SegmentationService } from '../../services/segmentationService';
import { ImageService } from '../../services/imageService';
import { logger } from '../../utils/logger';
import { ResponseHelper } from '../../utils/response';
import { prisma } from '../../db';

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
  private validateParams(params: Record<string, string | undefined>, required: string[], res: Response): boolean {
    for (const param of required) {
      if (!params[param]) {
        ResponseHelper.validationError(res, `Missing required parameter: ${param}`);
        return false;
      }
    }
    return true;
  }

  /**
   * Get available segmentation models
   */
  getAvailableModels = async (req: Request, res: Response): Promise<void> => {
    try {
      const models = await this.segmentationService.getAvailableModels();
      
      ResponseHelper.success(res, models, 'Dostupné modely načteny');
    } catch (error) {
      logger.error('Failed to get available models', error instanceof Error ? error : undefined, 'SegmentationController');
      ResponseHelper.internalError(res, error as Error, 'Chyba při načítání dostupných modelů');
    }
  };

  /**
   * Check segmentation service health
   */
  checkHealth = async (req: Request, res: Response): Promise<void> => {
    try {
      const isHealthy = await this.segmentationService.checkServiceHealth();
      
      if (isHealthy) {
        ResponseHelper.success(res, { healthy: true }, 'Segmentační služba je dostupná');
      } else {
        ResponseHelper.serviceUnavailable(res, 'Segmentační služba není dostupná');
      }
    } catch (error) {
      logger.error('Failed to check service health', error instanceof Error ? error : undefined, 'SegmentationController');
      ResponseHelper.serviceUnavailable(res, 'Chyba při kontrole segmentační služby');
    }
  };

  /**
   * Request segmentation for a single image
   */
  segmentImage = async (req: Request, res: Response): Promise<void> => {
    try {
      const { imageId } = req.params;
      const { model = 'hrnet', threshold = 0.5 } = req.body;
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Validate parameters
      if (!['hrnet', 'resunet_advanced', 'resunet_small'].includes(model)) {
        ResponseHelper.validationError(res, 'Neplatný model');
        return;
      }

      if (threshold < 0.1 || threshold > 0.9) {
        ResponseHelper.validationError(res, 'Threshold musí být mezi 0.1 a 0.9');
        return;
      }

      if (!imageId) {
        ResponseHelper.badRequest(res, 'Image ID is required');
        return;
      }

      logger.info('Starting image segmentation', 'SegmentationController', {
        imageId,
        model,
        threshold,
        userId
      });

      const result = await this.segmentationService.requestSegmentation({
        imageId,
        model,
        threshold,
        userId
      });

      ResponseHelper.success(res, result, 'Segmentace dokončena');

    } catch (error) {
      logger.error('Segmentation failed', error instanceof Error ? error : undefined, 'SegmentationController', { 
        imageId: req.params.imageId,
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při segmentaci obrázku';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Get segmentation results for an image
   */
  getSegmentationResults = async (req: Request, res: Response): Promise<void> => {
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

      logger.debug('Controller: Fetching segmentation results', 'SegmentationController', {
        imageId,
        userId
      });

      const results = await this.segmentationService.getSegmentationResults(imageId, userId);

      if (results) {
        logger.debug('Controller: Segmentation results found', 'SegmentationController', {
          imageId,
          polygonCount: results.polygons?.length || 0,
          hasResults: !!results
        });
        ResponseHelper.success(res, results, 'Výsledky segmentace načteny');
      } else {
        logger.debug('Controller: No segmentation results found', 'SegmentationController', {
          imageId,
          userId
        });
        ResponseHelper.notFound(res, 'Výsledky segmentace nenalezeny');
      }

    } catch (error) {
      logger.error('Failed to get segmentation results', error instanceof Error ? error : undefined, 'SegmentationController', {
        imageId: req.params.imageId,
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při načítání výsledků';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Update segmentation results for an image
   */
  updateSegmentationResults = async (req: Request, res: Response): Promise<void> => {
    try {
      const { imageId } = req.params;
      const { polygons } = req.body;
      
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

      const result = await this.segmentationService.updateSegmentationResults(imageId as string, polygons, userId);

      ResponseHelper.success(res, result, 'Výsledky segmentace aktualizovány');

    } catch (error) {
      logger.error('Failed to update segmentation results', error instanceof Error ? error : undefined, 'SegmentationController', {
        imageId: req.params.imageId,
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při aktualizaci výsledků';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Delete segmentation results for an image
   */
  deleteSegmentationResults = async (req: Request, res: Response): Promise<void> => {
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

      await this.segmentationService.deleteSegmentationResults(imageId as string, userId);

      ResponseHelper.success(res, undefined, 'Výsledky segmentace smazány');

    } catch (error) {
      logger.error('Failed to delete segmentation results', error instanceof Error ? error : undefined, 'SegmentationController', {
        imageId: req.params.imageId,
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při mazání výsledků';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Batch process multiple images
   */
  batchSegment = async (req: Request, res: Response): Promise<void> => {
    try {
      const { imageIds, model = 'hrnet', threshold = 0.5 } = req.body;
      
      // Validate user authentication
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Validate parameters
      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        ResponseHelper.validationError(res, 'Musíte zadat alespoň jeden obrázek');
        return;
      }

      if (!['hrnet', 'resunet_advanced', 'resunet_small'].includes(model)) {
        ResponseHelper.validationError(res, 'Neplatný model');
        return;
      }

      if (threshold < 0.1 || threshold > 0.9) {
        ResponseHelper.validationError(res, 'Threshold musí být mezi 0.1 a 0.9');
        return;
      }

      if (imageIds.length > 50) {
        ResponseHelper.validationError(res, 'Můžete zpracovat maximálně 50 obrázků najednou');
        return;
      }

      logger.info('Starting batch segmentation', 'SegmentationController', {
        imageCount: imageIds.length,
        model,
        threshold,
        userId
      });

      const result = await this.segmentationService.batchProcess(
        imageIds,
        model,
        threshold,
        userId
      );

      ResponseHelper.success(res, result, 'Dávkové zpracování dokončeno');

    } catch (error) {
      logger.error('Batch segmentation failed', error instanceof Error ? error : undefined, 'SegmentationController', {
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při dávkovém zpracování';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Get segmentation statistics for a project
   */
  getProjectStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      
      // Validate user authentication
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }
      
      // Validate required parameters
      if (!this.validateParams(req.params, ['projectId'], res)) {
        return;
      }

      if (!projectId || !userId) {
        ResponseHelper.badRequest(res, 'Missing required parameters');
        return;
      }
      
      const stats = await this.segmentationService.getProjectSegmentationStats(projectId, userId);

      ResponseHelper.success(res, stats, 'Statistiky segmentace načteny');

    } catch (error) {
      logger.error('Failed to get segmentation stats', error instanceof Error ? error : undefined, 'SegmentationController', {
        projectId: req.params.projectId,
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při načítání statistik';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };
}

export const segmentationController = new SegmentationController();