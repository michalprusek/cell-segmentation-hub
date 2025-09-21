import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { ImageService } from './imageService';
import { WebSocketService } from './websocketService';
import { SegmentationUpdateData, QueueStatsData } from '../types/websocket';

export interface CancellationResult {
  success: boolean;
  message: string;
  httpStatus: number;
  cancelledCount?: number;
  errorType?: 'NOT_FOUND' | 'CANNOT_CANCEL' | 'INTERNAL_ERROR';
}

export interface QueueItemCancellation {
  id: string;
  imageId: string;
  projectId: string;
  status: string;
}

/**
 * Centralized service for handling all types of cancellation operations
 * Implements SSOT pattern for cancellation logic across the application
 */
export class CancellationService {
  private prisma: PrismaClient;
  private imageService: ImageService;
  private websocketService: WebSocketService | null;

  constructor(prisma: PrismaClient, imageService: ImageService) {
    this.prisma = prisma;
    this.imageService = imageService;
    // WebSocket service will be connected later if available
    try {
      this.websocketService = WebSocketService.getInstance();
    } catch (error) {
      // WebSocket service not initialized yet, will be set later
      this.websocketService = null;
    }
  }

  /**
   * Atomically cancel a single queue item with proper validation and error handling
   */
  async cancelQueueItem(queueId: string, userId: string): Promise<CancellationResult> {
    try {
      // Use transaction to ensure atomicity
      const result = await this.prisma.$transaction(async (tx) => {
        // Find and validate the queue item with explicit status check
        const queueItem = await tx.segmentationQueue.findFirst({
          where: {
            id: queueId,
            userId,
          },
          select: {
            id: true,
            imageId: true,
            projectId: true,
            status: true,
          }
        });

        if (!queueItem) {
          return {
            success: false,
            message: 'Queue item not found or access denied',
            httpStatus: 404,
            errorType: 'NOT_FOUND' as const
          };
        }

        // Validate that item can be cancelled
        if (queueItem.status === 'processing') {
          return {
            success: false,
            message: 'Cannot cancel item that is currently being processed',
            httpStatus: 409,
            errorType: 'CANNOT_CANCEL' as const
          };
        }

        if (queueItem.status !== 'queued') {
          return {
            success: false,
            message: `Cannot cancel item with status: ${queueItem.status}`,
            httpStatus: 409,
            errorType: 'CANNOT_CANCEL' as const
          };
        }

        // Perform atomic deletion
        await tx.segmentationQueue.delete({
          where: { id: queueId }
        });

        return {
          success: true,
          message: 'Queue item cancelled successfully',
          httpStatus: 200,
          item: queueItem
        };
      });

      // If transaction failed, return the error result
      if (!result.success || !('item' in result)) {
        return result;
      }

      // Post-transaction operations (outside transaction to avoid deadlocks)
      try {
        // Update image status back to no_segmentation
        await this.imageService.updateSegmentationStatus(
          result.item.imageId,
          'no_segmentation',
          userId
        );

        // Emit WebSocket updates
        await this.emitCancellationUpdates(userId, [result.item]);

        logger.info('Queue item cancelled successfully', 'CancellationService', {
          queueId,
          imageId: result.item.imageId,
          projectId: result.item.projectId
        });

        return {
          success: true,
          message: 'Queue item cancelled successfully',
          httpStatus: 200,
          cancelledCount: 1
        };
      } catch (postError) {
        logger.error('Post-cancellation operations failed', postError instanceof Error ? postError : undefined, 'CancellationService', {
          queueId,
          imageId: result.item.imageId
        });

        // Item was deleted from queue but cleanup failed
        // This is still a success from user perspective
        return {
          success: true,
          message: 'Queue item cancelled (with minor cleanup issues)',
          httpStatus: 200,
          cancelledCount: 1
        };
      }

    } catch (error) {
      logger.error('Failed to cancel queue item', error instanceof Error ? error : undefined, 'CancellationService', {
        queueId,
        userId
      });

      return {
        success: false,
        message: 'Internal server error during cancellation',
        httpStatus: 500,
        errorType: 'INTERNAL_ERROR'
      };
    }
  }

  /**
   * Cancel multiple queue items with batch optimization and partial failure handling
   */
  async cancelMultipleQueueItems(queueIds: string[], userId: string): Promise<CancellationResult> {
    if (queueIds.length === 0) {
      return {
        success: false,
        message: 'No queue items to cancel',
        httpStatus: 400,
        errorType: 'NOT_FOUND'
      };
    }

    try {
      const results = await this.prisma.$transaction(async (tx) => {
        // Get all valid queue items in one query
        const queueItems = await tx.segmentationQueue.findMany({
          where: {
            id: { in: queueIds },
            userId,
          },
          select: {
            id: true,
            imageId: true,
            projectId: true,
            status: true,
          }
        });

        if (queueItems.length === 0) {
          return {
            success: false,
            message: 'No valid queue items found',
            httpStatus: 404,
            errorType: 'NOT_FOUND' as const
          };
        }

        // Separate cancellable from non-cancellable items
        const cancellableItems = queueItems.filter(item => item.status === 'queued');
        const processingItems = queueItems.filter(item => item.status === 'processing');

        if (cancellableItems.length === 0) {
          return {
            success: false,
            message: 'All items are currently being processed and cannot be cancelled',
            httpStatus: 409,
            errorType: 'CANNOT_CANCEL' as const,
            processingCount: processingItems.length
          };
        }

        // Delete all cancellable items atomically
        await tx.segmentationQueue.deleteMany({
          where: {
            id: { in: cancellableItems.map(item => item.id) }
          }
        });

        return {
          success: true,
          message: 'Queue items cancelled successfully',
          httpStatus: 200,
          cancelledItems: cancellableItems,
          processingCount: processingItems.length
        };
      });

      if (!results.success || !('cancelledItems' in results)) {
        return results;
      }

      // Post-transaction cleanup
      try {
        // Update image statuses
        for (const item of results.cancelledItems) {
          await this.imageService.updateSegmentationStatus(
            item.imageId,
            'no_segmentation',
            userId
          );
        }

        // Emit WebSocket updates
        await this.emitCancellationUpdates(userId, results.cancelledItems);

        const message = results.processingCount > 0
          ? `Cancelled ${results.cancelledItems.length} items. ${results.processingCount} items are processing and cannot be cancelled.`
          : `Cancelled ${results.cancelledItems.length} items successfully`;

        logger.info('Multiple queue items cancelled', 'CancellationService', {
          cancelledCount: results.cancelledItems.length,
          processingCount: results.processingCount,
          userId
        });

        return {
          success: true,
          message,
          httpStatus: results.processingCount > 0 ? 207 : 200, // 207 for partial success
          cancelledCount: results.cancelledItems.length
        };

      } catch (postError) {
        logger.error('Post-cancellation cleanup failed for batch operation', postError instanceof Error ? postError : undefined, 'CancellationService', {
          cancelledCount: results.cancelledItems.length,
          userId
        });

        return {
          success: true,
          message: `Cancelled ${results.cancelledItems.length} items (with minor cleanup issues)`,
          httpStatus: 200,
          cancelledCount: results.cancelledItems.length
        };
      }

    } catch (error) {
      logger.error('Failed to cancel multiple queue items', error instanceof Error ? error : undefined, 'CancellationService', {
        queueIds: queueIds.slice(0, 5), // Log first 5 IDs to avoid spam
        queueCount: queueIds.length,
        userId
      });

      return {
        success: false,
        message: 'Internal server error during batch cancellation',
        httpStatus: 500,
        errorType: 'INTERNAL_ERROR'
      };
    }
  }

  /**
   * Cancel all queue items for a project belonging to a user
   */
  async cancelProjectQueue(projectId: string, userId: string): Promise<CancellationResult> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Get all user's queue items for the project
        const queueItems = await tx.segmentationQueue.findMany({
          where: {
            projectId,
            userId,
          },
          select: {
            id: true,
            imageId: true,
            projectId: true,
            status: true,
          }
        });

        if (queueItems.length === 0) {
          return {
            success: false,
            message: 'No queue items found for this project',
            httpStatus: 404,
            errorType: 'NOT_FOUND' as const
          };
        }

        // Separate by status
        const cancellableItems = queueItems.filter(item => item.status === 'queued');
        const processingItems = queueItems.filter(item => item.status === 'processing');

        if (cancellableItems.length === 0) {
          return {
            success: false,
            message: 'All items are currently being processed',
            httpStatus: 409,
            errorType: 'CANNOT_CANCEL' as const,
            processingCount: processingItems.length
          };
        }

        // Delete cancellable items
        await tx.segmentationQueue.deleteMany({
          where: {
            id: { in: cancellableItems.map(item => item.id) }
          }
        });

        return {
          success: true,
          message: 'Project queue cancelled successfully',
          httpStatus: 200,
          cancelledItems: cancellableItems,
          processingCount: processingItems.length
        };
      });

      if (!result.success || !('cancelledItems' in result)) {
        return result;
      }

      // Post-transaction cleanup
      try {
        // Update image statuses
        for (const item of result.cancelledItems) {
          await this.imageService.updateSegmentationStatus(
            item.imageId,
            'no_segmentation',
            userId
          );
        }

        // Emit WebSocket updates
        await this.emitCancellationUpdates(userId, result.cancelledItems);

        logger.info('Project queue cancelled', 'CancellationService', {
          projectId,
          cancelledCount: result.cancelledItems.length,
          processingCount: result.processingCount,
          userId
        });

        const message = result.processingCount > 0
          ? `Cancelled ${result.cancelledItems.length} items. ${result.processingCount} items are still processing.`
          : `Cancelled all ${result.cancelledItems.length} queued items for project`;

        return {
          success: true,
          message,
          httpStatus: result.processingCount > 0 ? 207 : 200,
          cancelledCount: result.cancelledItems.length
        };

      } catch (postError) {
        logger.error('Post-cancellation cleanup failed for project', postError instanceof Error ? postError : undefined, 'CancellationService', {
          projectId,
          cancelledCount: result.cancelledItems.length
        });

        return {
          success: true,
          message: `Cancelled ${result.cancelledItems.length} items (with minor cleanup issues)`,
          httpStatus: 200,
          cancelledCount: result.cancelledItems.length
        };
      }

    } catch (error) {
      logger.error('Failed to cancel project queue', error instanceof Error ? error : undefined, 'CancellationService', {
        projectId,
        userId
      });

      return {
        success: false,
        message: 'Internal server error during project cancellation',
        httpStatus: 500,
        errorType: 'INTERNAL_ERROR'
      };
    }
  }

  /**
   * Emit WebSocket updates for cancelled items
   * Optimized to batch updates by project
   */
  private async emitCancellationUpdates(userId: string, cancelledItems: QueueItemCancellation[]): Promise<void> {
    if (!this.websocketService || cancelledItems.length === 0) {
      return;
    }

    try {
      // Group items by project for efficient WebSocket updates
      const projectGroups = cancelledItems.reduce((groups, item) => {
        if (!groups[item.projectId]) {
          groups[item.projectId] = [];
        }
        groups[item.projectId].push(item);
        return groups;
      }, {} as Record<string, QueueItemCancellation[]>);

      // Emit updates for each project
      for (const [projectId, items] of Object.entries(projectGroups)) {
        // Emit individual segmentation updates
        for (const item of items) {
          const segmentationUpdate: SegmentationUpdateData = {
            imageId: item.imageId,
            projectId: item.projectId,
            status: 'no_segmentation'
          };
          this.websocketService.emitSegmentationUpdate(userId, segmentationUpdate);
        }

        // Emit queue stats update for the project
        // Note: This requires access to QueueService.getQueueStats
        // For now, just emit a basic update
        const queueStatsUpdate: QueueStatsData = {
          projectId,
          total: 0, // Will be updated by client refresh
          queued: 0,
          processing: 0
        };
        this.websocketService.emitQueueStatsUpdate(projectId, queueStatsUpdate);
      }

      logger.debug('WebSocket cancellation updates emitted', 'CancellationService', {
        userId,
        itemCount: cancelledItems.length,
        projectCount: Object.keys(projectGroups).length
      });

    } catch (error) {
      logger.error('Failed to emit WebSocket cancellation updates', error instanceof Error ? error : undefined, 'CancellationService', {
        userId,
        itemCount: cancelledItems.length
      });
      // Don't throw - this is not critical for cancellation success
    }
  }

  /**
   * Validate cancellation request parameters
   */
  static validateCancellationRequest(queueId: string, userId: string): { valid: boolean; error?: string } {
    if (!queueId) {
      return { valid: false, error: 'Queue ID is required' };
    }

    if (!userId) {
      return { valid: false, error: 'User ID is required' };
    }

    // Basic UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(queueId)) {
      return { valid: false, error: 'Invalid queue ID format' };
    }

    if (!uuidRegex.test(userId)) {
      return { valid: false, error: 'Invalid user ID format' };
    }

    return { valid: true };
  }
}