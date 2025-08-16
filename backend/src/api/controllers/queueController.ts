import { Request, Response } from 'express';
import { QueueService } from '../../services/queueService';
import { SegmentationService } from '../../services/segmentationService';
import { ImageService } from '../../services/imageService';
import { WebSocketService } from '../../services/websocketService';
import { logger } from '../../utils/logger';
import { ResponseHelper } from '../../utils/response';
import { prisma } from '../../db';

class QueueController {
  private queueService: QueueService;
  private imageService: ImageService;

  constructor() {
    this.imageService = new ImageService(prisma);
    const segmentationService = new SegmentationService(prisma, this.imageService);
    this.queueService = QueueService.getInstance(prisma, segmentationService, this.imageService);
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
   * Add single image to segmentation queue
   * POST /api/queue/images/:imageId
   */
  addImageToQueue = async (req: Request, res: Response): Promise<void> => {
    try {
      const { imageId } = req.params;
      const { model = 'hrnet', threshold = 0.5, priority = 0 } = req.body;
      
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Get image to validate ownership and get projectId
      const image = await this.imageService.getImageById(imageId as string, userId);
      
      if (!image) {
        ResponseHelper.notFound(res, 'Obrázek nenalezen nebo nemáte oprávnění');
        return;
      }

      const queueEntry = await this.queueService.addToQueue(
        imageId as string,
        image.projectId,
        userId,
        model,
        threshold,
        priority
      );

      // Emit WebSocket update
      const websocketService = WebSocketService.getInstance();
      websocketService.emitSegmentationUpdate(userId, {
        imageId: imageId as string,
        projectId: image.projectId,
        status: 'queued',
        queueId: queueEntry.id
      });

      // Emit queue stats update
      const stats = await this.queueService.getQueueStats(image.projectId, userId);
      websocketService.emitQueueStatsUpdate(image.projectId, {
        projectId: image.projectId,
        ...stats
      });

      ResponseHelper.success(res, queueEntry, 'Obrázek přidán do fronty pro segmentaci');

    } catch (error) {
      logger.error('Failed to add image to queue', error instanceof Error ? error : undefined, 'QueueController', {
        imageId: req.params.imageId,
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při přidávání do fronty';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Add multiple images to segmentation queue in batch
   * POST /api/queue/batch
   */
  addBatchToQueue = async (req: Request, res: Response): Promise<void> => {
    try {
      const { imageIds, projectId, model = 'hrnet', threshold = 0.5, priority = 0 } = req.body;
      
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Validate input
      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        ResponseHelper.validationError(res, 'Musíte zadat alespoň jeden obrázek');
        return;
      }

      if (imageIds.length > 100) {
        ResponseHelper.validationError(res, 'Můžete zpracovat maximálně 100 obrázků najednou');
        return;
      }

      // Verify project ownership
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          userId: userId
        }
      });

      if (!project) {
        ResponseHelper.notFound(res, 'Projekt nenalezen nebo nemáte oprávnění');
        return;
      }

      const queueEntries = await this.queueService.addBatchToQueue(
        imageIds,
        projectId,
        userId,
        model,
        threshold,
        priority
      );

      // Emit WebSocket updates
      const websocketService = WebSocketService.getInstance();
      
      // Emit individual image updates
      for (const entry of queueEntries) {
        websocketService.emitSegmentationUpdate(userId, {
          imageId: entry.imageId,
          projectId: entry.projectId,
          status: 'queued',
          queueId: entry.id
        });
      }

      // Emit queue stats update
      const stats = await this.queueService.getQueueStats(projectId, userId);
      websocketService.emitQueueStatsUpdate(projectId, {
        projectId,
        ...stats
      });

      ResponseHelper.success(res, {
        queuedCount: queueEntries.length,
        totalRequested: imageIds.length,
        queueEntries
      }, `${queueEntries.length} obrázků přidáno do fronty pro segmentaci`);

    } catch (error) {
      logger.error('Failed to add batch to queue', error instanceof Error ? error : undefined, 'QueueController', {
        userId: req.user?.id,
        requestedCount: req.body.imageIds?.length
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při přidávání batch do fronty';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Get queue statistics for project
   * GET /api/queue/projects/:projectId/stats
   */
  getQueueStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Verify project ownership
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          userId: userId
        }
      });

      if (!project) {
        ResponseHelper.notFound(res, 'Projekt nenalezen nebo nemáte oprávnění');
        return;
      }

      const stats = await this.queueService.getQueueStats(projectId, userId);

      ResponseHelper.success(res, stats, 'Statistiky fronty načteny');

    } catch (error) {
      logger.error('Failed to get queue stats', error instanceof Error ? error : undefined, 'QueueController', {
        projectId: req.params.projectId,
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při načítání statistik fronty';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Get queue items for project
   * GET /api/queue/projects/:projectId/items
   */
  getQueueItems = async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Verify project ownership
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          userId: userId
        }
      });

      if (!project) {
        ResponseHelper.notFound(res, 'Projekt nenalezen nebo nemáte oprávnění');
        return;
      }

      const items = await this.queueService.getQueueItems(projectId as string, userId);

      ResponseHelper.success(res, items, 'Položky fronty načteny');

    } catch (error) {
      logger.error('Failed to get queue items', error instanceof Error ? error : undefined, 'QueueController', {
        projectId: req.params.projectId,
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při načítání položek fronty';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Remove item from queue
   * DELETE /api/queue/items/:queueId
   */
  removeFromQueue = async (req: Request, res: Response): Promise<void> => {
    try {
      const { queueId } = req.params;
      
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Get queue item to get imageId and projectId for WebSocket updates
      const queueItem = await prisma.segmentationQueue.findFirst({
        where: {
          id: queueId,
          userId: userId
        }
      });

      if (!queueItem) {
        ResponseHelper.notFound(res, 'Položka fronty nenalezena');
        return;
      }

      if (!queueId) {
        ResponseHelper.badRequest(res, 'Queue ID is required');
        return;
      }
      await this.queueService.removeFromQueue(queueId, userId);

      // Emit WebSocket updates
      const websocketService = WebSocketService.getInstance();
      websocketService.emitSegmentationUpdate(userId, {
        imageId: queueItem.imageId,
        projectId: queueItem.projectId,
        status: 'no_segmentation'
      });

      // Emit queue stats update
      const stats = await this.queueService.getQueueStats(queueItem.projectId, userId);
      websocketService.emitQueueStatsUpdate(queueItem.projectId, {
        projectId: queueItem.projectId,
        ...stats
      });

      ResponseHelper.success(res, undefined, 'Položka odebrána z fronty');

    } catch (error) {
      logger.error('Failed to remove item from queue', error instanceof Error ? error : undefined, 'QueueController', {
        queueId: req.params.queueId,
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při odebírání z fronty';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Get overall queue statistics (admin endpoint)
   * GET /api/queue/stats
   */
  getOverallQueueStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      const stats = await this.queueService.getQueueStats();

      ResponseHelper.success(res, stats, 'Celkové statistiky fronty načteny');

    } catch (error) {
      logger.error('Failed to get overall queue stats', error instanceof Error ? error : undefined, 'QueueController', {
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při načítání celkových statistik';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Cleanup old queue entries
   * POST /api/queue/cleanup
   */
  cleanupQueue = async (req: Request, res: Response): Promise<void> => {
    try {
      const { daysOld = 7 } = req.body;
      
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      const deletedCount = await this.queueService.cleanupOldEntries(daysOld);

      ResponseHelper.success(res, { deletedCount }, `Vyčištěno ${deletedCount} starých záznamů z fronty`);

    } catch (error) {
      logger.error('Failed to cleanup queue', error instanceof Error ? error : undefined, 'QueueController', {
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při čištění fronty';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Get comprehensive health status of the segmentation pipeline
   * GET /api/queue/health
   */
  getQueueHealth = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      const healthStatus = await this.queueService.getQueueHealthStatus();

      if (healthStatus.healthy) {
        ResponseHelper.success(res, healthStatus, 'Segmentační pipeline je zdravý');
      } else {
        ResponseHelper.success(res, healthStatus, `Segmentační pipeline má problémy: ${healthStatus.issues.join(', ')}`);
      }

    } catch (error) {
      logger.error('Failed to get queue health', error instanceof Error ? error : undefined, 'QueueController', {
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při kontrole zdraví fronty';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };

  /**
   * Reset stuck queue items
   * POST /api/queue/reset-stuck
   */
  resetStuckItems = async (req: Request, res: Response): Promise<void> => {
    try {
      const { maxProcessingMinutes = 10 } = req.body;
      
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      const resetCount = await this.queueService.resetStuckItems(maxProcessingMinutes);

      ResponseHelper.success(res, { resetCount }, `Resetováno ${resetCount} zaseknutých položek`);

    } catch (error) {
      logger.error('Failed to reset stuck items', error instanceof Error ? error : undefined, 'QueueController', {
        userId: req.user?.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Chyba při resetování zaseknutých položek';
      ResponseHelper.internalError(res, error as Error, errorMessage);
    }
  };
}

export const queueController = new QueueController();