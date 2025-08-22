import { Request, Response } from 'express';
import { QueueService } from '../../services/queueService';
import { SegmentationService } from '../../services/segmentationService';
import { ImageService } from '../../services/imageService';
import { WebSocketService } from '../../services/websocketService';
import { logger } from '../../utils/logger';
import { ResponseHelper } from '../../utils/response';
import { prisma } from '../../db';

// Import validation types
import { 
  AddImageToQueueData,
  BatchQueueData,
  CleanupQueueData,
  ResetStuckItemsData
} from '../../types/validation';

// Import queue-specific types
import {
  ImageIdParams,
  ProjectIdParams,
  QueueIdParams,
  BatchQueueResponse,
  QueueStatsResponse,
  QueueHealthResponse,
  ResetStuckItemsResponse,
  CleanupResponse,
  AddImageToQueueRequest,
  BatchQueueRequest,
  GetQueueStatsRequest,
  GetQueueItemsRequest,
  RemoveFromQueueRequest,
  ResetStuckItemsRequest,
  CleanupQueueRequest,
  QueueError,
  QueueTimeoutError,
  MLServiceUnavailableError,
  QueuePriority,
  QueueStatus
} from '../../types/queue';

// Import WebSocket types
import {
  SegmentationUpdateData,
  QueueStatsData
} from '../../types/websocket';

// Queue entry response type definition
interface QueueEntryResponse {
  id: string;
  imageId: string;
  projectId: string;
  userId: string;
  model: 'hrnet' | 'resunet_advanced' | 'resunet_small';
  threshold: number;
  detectHoles: boolean;
  priority: QueuePriority;
  status: QueueStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  retryCount: number;
  batchId?: string;
}

/**
 * Map queue entry from database to response format
 */
function mapQueueEntryToResponse(entry: any): QueueEntryResponse {
  return {
    id: entry.id,
    imageId: entry.imageId,
    projectId: entry.projectId,
    userId: entry.userId,
    model: entry.model,
    threshold: entry.threshold,
    detectHoles: entry.detectHoles ?? false,
    priority: entry.priority as QueuePriority,
    status: entry.status as QueueStatus,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt || entry.createdAt,
    startedAt: entry.startedAt || undefined,
    completedAt: entry.completedAt || undefined,
    error: entry.error || undefined,
    retryCount: entry.retryCount || 0,
    batchId: entry.batchId || undefined
  };
}

/**
 * Queue Controller
 * 
 * Handles all queue-related HTTP endpoints with full TypeScript typing
 */
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
  private validateUser(req: { user?: { id: string; email: string } }, res: Response): string | null {
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
  addImageToQueue = async (req: AddImageToQueueRequest, res: Response): Promise<void> => {
    try {
      const { imageId } = req.params;
      const { model, threshold, priority, detectHoles } = req.body;
      
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Get image to validate ownership and get projectId
      const image = await this.imageService.getImageById(imageId, userId);
      
      if (!image) {
        ResponseHelper.notFound(res, 'Obrázek nenalezen nebo nemáte oprávnění');
        return;
      }

      const queueEntry = await this.queueService.addToQueue(
        imageId,
        image.projectId,
        userId,
        model || 'hrnet',
        threshold || 0.5,
        priority || 0,
        detectHoles !== undefined ? detectHoles : true
      );

      // Emit WebSocket update with proper typing
      const websocketService = WebSocketService.getInstance();
      const segmentationUpdate: SegmentationUpdateData = {
        imageId: imageId,
        projectId: image.projectId,
        status: 'queued',
        queueId: queueEntry.id
      };
      websocketService.emitSegmentationUpdate(userId, segmentationUpdate);

      // Emit queue stats update
      const stats = await this.queueService.getQueueStats(image.projectId, userId);
      const queueStatsUpdate: QueueStatsData = {
        projectId: image.projectId,
        ...stats
      };
      websocketService.emitQueueStatsUpdate(image.projectId, queueStatsUpdate);

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
  addBatchToQueue = async (req: BatchQueueRequest, res: Response): Promise<void> => {
    try {
      const { 
        imageIds, 
        projectId, 
        model = 'hrnet', 
        threshold = 0.5, 
        priority = 0, 
        forceResegment = false, 
        detectHoles = true 
      } = req.body;
      
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Input validation is handled by Zod schema, but keep runtime checks for safety
      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        ResponseHelper.validationError(res, 'Musíte zadat alespoň jeden obrázek');
        return;
      }

      if (imageIds.length > 100) {
        ResponseHelper.validationError(res, 'Můžete zpracovat maximálně 100 obrázků najednou');
        return;
      }

      // Verify project ownership or sharing access
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        ResponseHelper.unauthorized(res, 'Uživatel nenalezen');
        return;
      }

      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          OR: [
            // Owned projects
            { userId: userId },
            // Shared projects
            {
              shares: {
                some: {
                  OR: [
                    { sharedWithId: userId, status: 'accepted' },
                    { email: user.email, status: { in: ['pending', 'accepted'] } }
                  ]
                }
              }
            }
          ]
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
        priority,
        forceResegment,
        detectHoles
      );

      // Emit WebSocket updates
      const websocketService = WebSocketService.getInstance();
      
      // Emit individual image updates with re-segmentation context
      for (const entry of queueEntries) {
        const segmentationUpdate: SegmentationUpdateData = {
          imageId: entry.imageId,
          projectId: entry.projectId,
          status: 'queued',
          queueId: entry.id
        };
        websocketService.emitSegmentationUpdate(userId, segmentationUpdate);
      }

      // Emit queue stats update
      const stats = await this.queueService.getQueueStats(projectId, userId);
      const queueStatsUpdate: QueueStatsData = {
        projectId,
        ...stats
      };
      websocketService.emitQueueStatsUpdate(projectId, queueStatsUpdate);

      const response: BatchQueueResponse = {
        queuedCount: queueEntries.length,
        totalRequested: imageIds.length,
        queueEntries: queueEntries.map(entry => mapQueueEntryToResponse(entry))
      };

      ResponseHelper.success(res, response, `${queueEntries.length} obrázků přidáno do fronty pro segmentaci`);

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
  getQueueStats = async (req: GetQueueStatsRequest, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Verify project ownership or sharing access
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        ResponseHelper.unauthorized(res, 'Uživatel nenalezen');
        return;
      }

      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          OR: [
            // Owned projects
            { userId: userId },
            // Shared projects
            {
              shares: {
                some: {
                  OR: [
                    { sharedWithId: userId, status: 'accepted' },
                    { email: user.email, status: { in: ['pending', 'accepted'] } }
                  ]
                }
              }
            }
          ]
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
  getQueueItems = async (req: GetQueueItemsRequest, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      
      const userId = this.validateUser(req, res);
      if (!userId) {
        return;
      }

      // Verify project ownership or sharing access
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        ResponseHelper.unauthorized(res, 'Uživatel nenalezen');
        return;
      }

      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          OR: [
            // Owned projects
            { userId: userId },
            // Shared projects
            {
              shares: {
                some: {
                  OR: [
                    { sharedWithId: userId, status: 'accepted' },
                    { email: user.email, status: { in: ['pending', 'accepted'] } }
                  ]
                }
              }
            }
          ]
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
  removeFromQueue = async (req: RemoveFromQueueRequest, res: Response): Promise<void> => {
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
      const segmentationUpdate: SegmentationUpdateData = {
        imageId: queueItem.imageId,
        projectId: queueItem.projectId,
        status: 'no_segmentation'
      };
      websocketService.emitSegmentationUpdate(userId, segmentationUpdate);

      // Emit queue stats update
      const stats = await this.queueService.getQueueStats(queueItem.projectId, userId);
      const queueStatsUpdate: QueueStatsData = {
        projectId: queueItem.projectId,
        ...stats
      };
      websocketService.emitQueueStatsUpdate(queueItem.projectId, queueStatsUpdate);

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
  cleanupQueue = async (req: CleanupQueueRequest, res: Response): Promise<void> => {
    try {
      const { daysOld } = req.body;
      
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
  resetStuckItems = async (req: ResetStuckItemsRequest, res: Response): Promise<void> => {
    try {
      const { maxProcessingMinutes } = req.body;
      
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