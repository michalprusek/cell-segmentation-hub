import { PrismaClient, SegmentationQueue, Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import {
  SegmentationService,
  SegmentationResponse,
} from './segmentationService';
import { ImageService } from './imageService';
import { WebSocketService } from './websocketService';
import { batchProcessor } from '../utils/batchProcessor';
import { SegmentationUpdateData } from '../types/websocket';
import { QueueStatus } from '../types/queue';
import { scheduleTrackingForContainer } from './tracking/trackerService';
import {
  findSparseChannel,
  findStaticChannel,
  planSparseCollapse,
  planStaticCollapse,
  type StaticChannelLike,
} from './staticChannelProjection';
import { projectStaticChannelResult } from './staticChannelProjectionService';
import type { KnownModelId } from '../constants/modelRegistry';

export interface QueueStats {
  queued: number;
  processing: number;
  total: number;
}

export interface ParallelProcessingStats {
  activeStreams: number;
  maxConcurrentStreams: number;
  totalProcessingCapacity: number;
  currentThroughput: number;
  averageProcessingTime: number;
}

export interface QueueBatch {
  id: string;
  items: SegmentationQueue[];
  model: string;
  threshold: number;
  priority: number;
  estimatedProcessingTime: number;
}

export interface BatchConfig {
  hrnet: number;
  cbam_resunet: number;
}

/**
 * Retries a queue item gets before it is declared permanently failed — so 4
 * attempts in total. Was an inline `item.retryCount < 3` in two places that
 * had to agree.
 */
const MAX_QUEUE_RETRIES = 3;

/**
 * How long an image must have been sitting on 'processing' with no queue row
 * before the stuck-item sweep declares it dead. Sized above the worst-case
 * POST /segmentation/batch run, which segments without a queue row: 50 images
 * (the controller's cap) x ~4.5 s for microtubule is under four minutes.
 */
const ORPHAN_IMAGE_MIN_AGE_MS = 5 * 60 * 1000;

export interface QueueItem {
  id: string;
  imageId: string;
  projectId: string;
  userId: string;
  model: string;
  threshold: number;
  priority: number;
  status: string;
  createdAt: Date;
}

export class QueueService {
  private static instance: QueueService;
  private batchSizes: BatchConfig = {
    hrnet: 1, // Single image processing - batch endpoint has issues
    cbam_resunet: 1, // Single image processing - batch endpoint has issues
  };
  private websocketService: WebSocketService | null = null;
  private queueWorkerInstance: unknown = null; // Reference to QueueWorker for triggering
  private maxConcurrentBatches = 4; // Max concurrent batches (each batch=1 image due to BATCH_LIMITS)
  private activeBatches: Map<string, Date> = new Map(); // Track active batch processing
  private processingStats: ParallelProcessingStats = {
    activeStreams: 0,
    maxConcurrentStreams: 4,
    totalProcessingCapacity: 0,
    currentThroughput: 0,
    averageProcessingTime: 0,
  };

  constructor(
    private prisma: PrismaClient,
    private segmentationService: SegmentationService,
    private imageService: ImageService
  ) {
    // WebSocket service will be set after initialization
    this.websocketService = null;
  }

  /**
   * Helper method to process simple operations using shared BatchProcessor
   */
  private async processBatchOperations<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    operationName: string,
    batchSize = 10
  ): Promise<R[]> {
    return batchProcessor.processBatch(items, processor, {
      batchSize,
      concurrency: 3,
      onBatchComplete: (index, results) => {
        logger.debug(
          `${operationName} batch ${index + 1} completed, ${results.length} successful`
        );
      },
      onItemError: (item, error) => {
        logger.error(
          `${operationName} failed for item`,
          error instanceof Error ? error : new Error(String(error))
        );
      },
    });
  }

  public setWebSocketService(wsService: WebSocketService): void {
    this.websocketService = wsService;
    logger.info('WebSocket service connected to QueueService', 'QueueService');
  }

  public setQueueWorker(queueWorker: unknown): void {
    this.queueWorkerInstance = queueWorker;
    logger.info(
      'QueueWorker connected to QueueService for immediate processing',
      'QueueService'
    );
  }

  private triggerQueueProcessing(): void {
    if (
      this.queueWorkerInstance &&
      typeof (this.queueWorkerInstance as Record<string, unknown>)
        .triggerImmediateProcessing === 'function'
    ) {
      (
        this.queueWorkerInstance as Record<string, () => void>
      ).triggerImmediateProcessing();
    }
  }

  public static getInstance(
    prisma: PrismaClient,
    segmentationService?: SegmentationService,
    imageService?: ImageService
  ): QueueService {
    if (!QueueService.instance) {
      if (!segmentationService || !imageService) {
        throw new Error(
          'SegmentationService and ImageService are required for first initialization'
        );
      }
      QueueService.instance = new QueueService(
        prisma,
        segmentationService,
        imageService
      );
    }
    return QueueService.instance;
  }

  /**
   * Add image to segmentation queue
   */
  async addToQueue(
    imageId: string,
    projectId: string,
    userId: string,
    model = 'hrnet',
    threshold = 0.5,
    priority = 0,
    detectHoles = true
  ): Promise<SegmentationQueue> {
    try {
      // Check if image is already in queue
      const existingEntry = await this.prisma.segmentationQueue.findFirst({
        where: {
          imageId,
          status: { in: ['queued', 'processing'] },
        },
      });

      if (existingEntry) {
        logger.warn('Image already in queue', 'QueueService', {
          imageId,
          existingQueueId: existingEntry.id,
          existingStatus: existingEntry.status,
        });
        throw new Error('Image is already in segmentation queue');
      }

      // Create queue entry
      const queueEntry = await this.prisma.segmentationQueue.create({
        data: {
          imageId,
          projectId,
          userId,
          model,
          threshold,
          detectHoles,
          priority,
          status: 'queued',
        },
      });

      // Update image status
      await this.imageService.updateSegmentationStatus(
        imageId,
        'queued',
        userId
      );

      logger.info('Image added to segmentation queue', 'QueueService', {
        imageId,
        projectId,
        model,
        queueId: queueEntry.id,
      });

      // Trigger immediate processing for low latency
      this.triggerQueueProcessing();

      return queueEntry;
    } catch (error) {
      logger.error(
        'Failed to add image to queue',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          imageId,
          projectId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Add multiple images to queue in batch
   */
  /**
   * Drop frames whose segmentation will be projected from a sibling.
   *
   * Applies to two recorded facts, never to an inference from the pixels:
   *
   * - `staticSource` — one source image stamped onto every covered frame, so
   *   the whole container collapses to a single anchor.
   * - `sparseSource` — the microscope only refreshed this channel every N-th
   *   frame, so the frames in between hold a constant fill the acquisition
   *   software wrote for a timepoint it never imaged. Those collapse onto the
   *   last real frame before each of them. Segmenting one is not merely
   *   wasteful, it is wrong: the model would be fed a blank image and whatever
   *   came back would then be tracked against the real frames around it.
   *
   * "The pixels currently look identical" is deliberately not accepted as
   * evidence for either: that is a property of today's data, whereas the flags
   * are properties of how the channel was built and measured.
   *
   * Anything this cannot prove safe is left alone and segmented normally: a
   * frame outside a static channel's coverage, a frame whose alignment shift
   * was never recorded, a gap whose anchor is not in this batch, or any
   * container whose metadata does not parse.
   */
  private async collapseStaticChannelFrames(
    candidateIds: string[],
    channel?: string
  ): Promise<{ ids: string[]; skipped: number; containers: number }> {
    if (!channel || candidateIds.length < 2) {
      return { ids: candidateIds, skipped: 0, containers: 0 };
    }

    const frames = await this.prisma.image.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, frameIndex: true, parentVideoId: true },
    });

    const byContainer = new Map<string, typeof frames>();
    const loose: string[] = [];
    for (const f of frames) {
      if (!f.parentVideoId) {
        loose.push(f.id);
        continue;
      }
      const list = byContainer.get(f.parentVideoId) ?? [];
      list.push(f);
      byContainer.set(f.parentVideoId, list);
    }
    if (byContainer.size === 0) {
      return { ids: candidateIds, skipped: 0, containers: 0 };
    }

    const containers = await this.prisma.image.findMany({
      where: { id: { in: [...byContainer.keys()] } },
      select: { id: true, channels: true },
    });
    const channelsById = new Map(containers.map(c => [c.id, c.channels]));

    const keep = new Set(loose);
    let collapsedContainers = 0;
    for (const [containerId, containerFrames] of byContainer) {
      const declared = channelsById.get(
        containerId
      ) as unknown as StaticChannelLike[] | null;
      // Two ways a frame's pixels can already be somewhere else: the whole
      // channel is one stamped image (`staticSource`), or the microscope only
      // refreshed it every N-th frame and the rest are gaps (`sparseSource`).
      // The plans differ only in how many anchors there are.
      const staticMeta = findStaticChannel(declared, channel);
      const sparseMeta = staticMeta ? null : findSparseChannel(declared, channel);
      if (!staticMeta && !sparseMeta) {
        containerFrames.forEach(f => keep.add(f.id));
        continue;
      }
      const plan = staticMeta
        ? planStaticCollapse(staticMeta, containerFrames)
        : planSparseCollapse(sparseMeta!, containerFrames);
      plan.segment.forEach(f => keep.add(f.id));
      if (plan.projectFrom.size > 0) {
        collapsedContainers++;
      }
    }

    const ids = candidateIds.filter(id => keep.has(id));
    return {
      ids,
      skipped: candidateIds.length - ids.length,
      containers: collapsedContainers,
    };
  }


  async addBatchToQueue(
    imageIds: string[],
    projectId: string,
    userId: string,
    model = 'hrnet',
    threshold = 0.5,
    priority = 0,
    forceResegment = false,
    detectHoles = true,
    channel?: string
  ): Promise<SegmentationQueue[]> {
    try {
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      if (imageIds.length === 0) {
        return [];
      }

      // Bulk-load accessible images in one round trip. Previously this used
      // a per-imageId getImageById loop (2 queries each) + a transaction +
      // updateSegmentationStatus (2 more), totalling ~4*N queries — 40k for
      // a 10k-image batch. The bulk version is 4 queries regardless of size.
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      const accessibleImages = await this.prisma.image.findMany({
        where: {
          id: { in: imageIds },
          projectId,
          project: {
            OR: [
              { userId },
              {
                shares: {
                  some: {
                    OR: [
                      { sharedWithId: userId, status: 'accepted' },
                      {
                        email: user.email,
                        status: { in: ['pending', 'accepted'] },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
        select: { id: true, segmentationStatus: true },
      });

      // Filter: skip already-queued/processing rows unless forceResegment.
      // The same set drives both queue inserts and the status updateMany.
      const candidateIds = accessibleImages
        .filter(img => {
          if (forceResegment) {
            return true;
          }
          return (
            img.segmentationStatus !== 'queued' &&
            img.segmentationStatus !== 'processing'
          );
        })
        .map(img => img.id);

      // For force-resegment, identify rows that already have segmentation
      // results so we can wipe them inside the transaction.
      const idsNeedingSegmentationReset = forceResegment
        ? accessibleImages
            .filter(
              img =>
                img.segmentationStatus === 'completed' ||
                img.segmentationStatus === 'segmented'
            )
            .map(img => img.id)
        : [];

      // A channel built from ONE image shows the same picture on every frame it
      // covers, so queueing every frame asks for the identical segmentation N
      // times and then leaves the tracker to rediscover that the N answers are
      // the same objects. Queue one frame per container instead; the rest are
      // filled in from its result once it lands.
      const collapsed = await this.collapseStaticChannelFrames(
        candidateIds,
        channel
      );
      const queueableIds = collapsed.ids;
      if (collapsed.skipped > 0) {
        logger.info(
          `Static channel '${channel}': queueing ${queueableIds.length} frame(s) instead of ${candidateIds.length} — the other ${collapsed.skipped} show the same image and will be projected from it`,
          'QueueService',
          { batchId, channel, containers: collapsed.containers }
        );
      }

      if (queueableIds.length === 0) {
        logger.info(
          'Batch added to segmentation queue (no eligible images)',
          'QueueService',
          { batchId, totalImages: imageIds.length, queuedImages: 0, model }
        );
        return [];
      }

      // Single transaction: clear existing segs (if forced), insert queue
      // rows, flip image statuses, return the new rows.
      const queueEntries = await this.prisma.$transaction(async tx => {
        if (idsNeedingSegmentationReset.length > 0) {
          await tx.segmentation.deleteMany({
            where: { imageId: { in: idsNeedingSegmentationReset } },
          });
        }

        await tx.segmentationQueue.createMany({
          data: queueableIds.map(imageId => ({
            imageId,
            projectId,
            userId,
            model,
            threshold,
            detectHoles,
            priority,
            status: 'queued',
            batchId,
            channel: channel ?? null,
          })),
        });

        await tx.image.updateMany({
          where: { id: { in: queueableIds } },
          data: { segmentationStatus: 'queued' },
        });

        return tx.segmentationQueue.findMany({
          where: { batchId },
          orderBy: { createdAt: 'asc' },
        });
      });

      logger.info('Batch added to segmentation queue', 'QueueService', {
        batchId,
        totalImages: imageIds.length,
        queuedImages: queueEntries.length,
        model,
      });

      // Trigger immediate processing for low latency
      if (queueEntries.length > 0) {
        this.triggerQueueProcessing();
      }

      return queueEntries;
    } catch (error) {
      logger.error(
        'Failed to add batch to queue',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          projectId,
          userId,
          imageCount: imageIds.length,
        }
      );
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(
    projectId?: string,
    userId?: string
  ): Promise<QueueStats> {
    try {
      const whereClause: Prisma.SegmentationQueueWhereInput = {};

      if (projectId) {
        whereClause.projectId = projectId;
      }

      if (userId) {
        whereClause.userId = userId;
      }

      const [queued, processing] = await Promise.all([
        this.prisma.segmentationQueue.count({
          where: { ...whereClause, status: 'queued' },
        }),
        this.prisma.segmentationQueue.count({
          where: { ...whereClause, status: 'processing' },
        }),
      ]);
      const total = queued + processing;

      const stats = { queued, processing, total };

      // Emit queue stats via WebSocket if projectId is provided
      if (this.websocketService && projectId) {
        this.websocketService.emitQueueStatsUpdate(projectId, {
          projectId,
          queued,
          processing,
          total,
        });
      }

      return stats;
    } catch (error) {
      logger.error(
        'Failed to get queue stats',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          projectId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Get queue items for a project
   */
  async getQueueItems(projectId: string, userId: string): Promise<QueueItem[]> {
    try {
      const items = await this.prisma.segmentationQueue.findMany({
        where: {
          projectId,
          userId,
          status: { in: ['queued', 'processing'] },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      });

      return items.map(item => ({
        id: item.id,
        imageId: item.imageId,
        projectId: item.projectId,
        userId: item.userId,
        model: item.model,
        threshold: item.threshold,
        priority: item.priority,
        status: item.status,
        createdAt: item.createdAt,
      }));
    } catch (error) {
      logger.error(
        'Failed to get queue items',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          projectId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Remove item from queue
   */
  async removeFromQueue(queueId: string, userId: string): Promise<void> {
    try {
      const queueItem = await this.prisma.segmentationQueue.findFirst({
        where: {
          id: queueId,
          userId,
          status: { in: ['queued'] }, // Only allow removal of queued items
        },
      });

      if (!queueItem) {
        throw new Error('Queue item not found or cannot be removed');
      }

      // Remove from queue
      await this.prisma.segmentationQueue.delete({
        where: { id: queueId },
      });

      // Update image status back to no_segmentation
      await this.imageService.updateSegmentationStatus(
        queueItem.imageId,
        'no_segmentation',
        userId
      );

      logger.info('Item removed from queue', 'QueueService', {
        queueId,
        imageId: queueItem.imageId,
      });
    } catch (error) {
      logger.error(
        'Failed to remove item from queue',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          queueId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Get multiple batches for parallel processing
   * Returns up to maxBatches for concurrent execution
   */
  async getMultipleBatches(maxBatches = 4): Promise<QueueBatch[]> {
    const batches: QueueBatch[] = [];
    const processedImageIds = new Set<string>();

    // Heavy models that need the full GPU memory budget per inference must run
    // strictly serial — the queue worker would otherwise dispatch up to 4
    // concurrent /api/v1/segment requests which OOM the ML container.  When the
    // first batch we picked is one of these, cap the dispatch to a single
    // batch and let the next tick pick up the rest.
    const SERIAL_DISPATCH_MODELS = new Set(['microtubule', 'neurite_soma']);

    for (let i = 0; i < maxBatches; i++) {
      const batchItems = await this.getNextBatchExcluding(processedImageIds);
      if (batchItems.length === 0) {
        break; // No more items to process
      }

      const firstItem = batchItems[0];
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      batches.push({
        id: batchId,
        items: batchItems,
        model: firstItem.model,
        threshold: firstItem.threshold,
        priority: firstItem.priority,
        estimatedProcessingTime: this.estimateProcessingTime(
          batchItems.length,
          firstItem.model
        ),
      });

      // Mark these images as being processed to avoid duplicates
      batchItems.forEach(item => processedImageIds.add(item.imageId));

      if (SERIAL_DISPATCH_MODELS.has(firstItem.model)) {
        logger.info(
          'Serial-dispatch model picked — capping at 1 concurrent batch',
          'QueueService',
          { model: firstItem.model, batchId }
        );
        break;
      }
    }

    // Only log when there are actually batches to process (avoid spam when queue is empty)
    if (batches.length > 0) {
      logger.info(
        'Retrieved multiple batches for parallel processing',
        'QueueService',
        {
          batchCount: batches.length,
          totalItems: batches.reduce(
            (sum, batch) => sum + batch.items.length,
            0
          ),
          models: [...new Set(batches.map(batch => batch.model))],
        }
      );
    }

    return batches;
  }

  /**
   * Get next batch excluding specific image IDs (to avoid duplicate processing)
   */
  private async getNextBatchExcluding(
    excludeImageIds: Set<string>
  ): Promise<SegmentationQueue[]> {
    // Model batch size limits - SET TO 1 to always use single-image processing
    // This bypasses the buggy batch-segment endpoint and uses the reliable /segment endpoint
    // The 400 Bad Request errors from batch-segment are caused by Node.js form-data library
    // encoding issues with Python FastAPI. Single-image processing is more reliable.
    const BATCH_LIMITS = {
      hrnet: 1, // Always process one at a time for reliability
      cbam_resunet: 1, // Always process one at a time for reliability
      unet_spherohq: 1, // Always process one at a time for reliability
      spheroid_disintegration: 1, // Always process one at a time for reliability
    };

    // Get the highest priority item first, excluding specified image IDs
    const whereClause: Record<string, unknown> = {
      status: 'queued',
    };

    if (excludeImageIds.size > 0) {
      whereClause.imageId = {
        notIn: Array.from(excludeImageIds),
      };
    }

    // Queue fairness: when several users have pending work, avoid back-
    // to-back picks from the same user so a 200-frame video upload from
    // user A can't block user B for hours.  We look at the last 5
    // processed queue items and prefer a pending item from a user not
    // in that window.  Falls back to plain priority/createdAt order
    // when only one user is contending.
    const recentlyProcessed = await this.prisma.segmentationQueue.findMany({
      where: { status: { in: ['processing', 'completed'] } },
      orderBy: [{ completedAt: 'desc' }, { startedAt: 'desc' }],
      take: 5,
      select: { userId: true },
    });
    const recentUserIds = Array.from(
      new Set(recentlyProcessed.map(r => r.userId))
    );

    let firstItem = null;
    if (recentUserIds.length > 0) {
      firstItem = await this.prisma.segmentationQueue.findFirst({
        where: {
          ...whereClause,
          userId: { notIn: recentUserIds },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      });
    }
    if (!firstItem) {
      firstItem = await this.prisma.segmentationQueue.findFirst({
        where: whereClause,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      });
    }

    if (!firstItem) {
      return [];
    }

    // Get batch size limit for this model
    const batchLimit =
      BATCH_LIMITS[firstItem.model as keyof typeof BATCH_LIMITS] || 1;

    // Find all items with same model, threshold, and priority for batching
    let batch = await this.prisma.segmentationQueue.findMany({
      where: {
        status: 'queued',
        model: firstItem.model,
        threshold: firstItem.threshold,
        priority: firstItem.priority,
        imageId:
          excludeImageIds.size > 0
            ? {
                notIn: Array.from(excludeImageIds),
              }
            : undefined,
      },
      orderBy: [{ createdAt: 'asc' }],
      take: batchLimit,
    });

    // If no exact matches found but we have the first item, process it alone
    if (batch.length === 0) {
      batch = [firstItem];
    }

    return batch;
  }

  /**
   * Process a batch of queue items using ML service batch endpoint
   */
  async processBatch(batch: SegmentationQueue[]): Promise<void> {
    if (batch.length === 0) {
      return;
    }

    const firstItem = batch[0];
    if (!firstItem) {
      return; // Should never happen due to length check above
    }
    const model = firstItem.model;
    const threshold = firstItem.threshold;

    logger.info('Starting batch processing', 'QueueService', {
      batchSize: batch.length,
      model,
      threshold,
      itemIds: batch.map(item => item.id),
    });

    // Queue-item ids that have already reached a terminal state. The
    // batch-level catch below must not touch these again: their rows are
    // usually already deleted, and the P2025 from updating a deleted row used
    // to escape the recovery loop and leave every *later* item pinned to
    // 'processing'.
    const settledItemIds = new Set<string>();

    // The try starts HERE, above the claim, and not after it. The claim is what
    // writes 'processing' to both tables; a throw in it (or in the WebSocket
    // fan-out right after) used to escape with no recovery at all, which is the
    // very stall this method is guarding against.
    try {
      // Batch update all items to processing status
      const batchIds = batch.map(item => item.id);
      const imageIds = batch.map(item => item.imageId);
      const startedAt = new Date();

      // Use batch update for better performance
      await this.prisma.segmentationQueue.updateMany({
        where: { id: { in: batchIds } },
        data: {
          status: 'processing',
          startedAt: startedAt,
        },
      });

      // Batch update image statuses
      await this.prisma.image.updateMany({
        where: { id: { in: imageIds } },
        data: { segmentationStatus: 'processing' },
      });

      // Batch emit WebSocket notifications
      if (this.websocketService) {
        const notifications = batch.map(item => ({
          userId: item.userId,
          data: {
            imageId: item.imageId,
            projectId: item.projectId,
            status: 'processing' as QueueStatus,
            queueId: item.id,
          },
        }));

        // Group notifications by userId for efficient emission
        const groupedNotifications = notifications.reduce(
          (acc, notif) => {
            if (!acc[notif.userId]) {
              acc[notif.userId] = [];
            }
            acc[notif.userId].push(notif.data);
            return acc;
          },
          {} as Record<string, SegmentationUpdateData[]>
        );

        for (const [userId, updates] of Object.entries(groupedNotifications)) {
          // Emit all updates for this user at once
          updates.forEach(update => {
            this.websocketService?.emitSegmentationUpdate(userId, update);
          });
        }
      }

      // Check if this batch will empty the queue (making it the last batch)
      const remainingQueuedCount = await this.prisma.segmentationQueue.count({
        where: { status: 'queued' },
      });
      const isLastBatch = remainingQueuedCount === batch.length;

      if (isLastBatch) {
        logger.info(
          '🏁 Processing LAST BATCH - will coordinate thumbnail generation',
          'QueueService',
          {
            batchSize: batch.length,
            remainingQueuedCount,
            model,
            message:
              'Thumbnails will be generated synchronously to prevent race condition',
          }
        );
      } else {
        logger.info('Batch processing details', 'QueueService', {
          batchSize: batch.length,
          remainingQueuedCount,
          isLastBatch,
          model,
        });
      }

      // Prepare images for batch processing
      const imageData = [];
      for (const item of batch) {
        const image = await this.imageService.getImageById(
          item.imageId,
          item.userId
        );
        if (!image) {
          throw new Error(`Image not found: ${item.imageId}`);
        }
        imageData.push(image);
      }

      // Call appropriate segmentation service based on batch size
      let results: SegmentationResponse[];
      if (batch.length === 1) {
        // Single item - use individual segmentation endpoint for better compatibility
        const singleResult = await this.segmentationService.requestSegmentation(
          {
            imageId: firstItem.imageId,
            model: model as KnownModelId,
            threshold: threshold,
            userId: firstItem.userId,
            detectHoles: firstItem.detectHoles ?? false,
            channel: firstItem.channel ?? undefined,
          }
        );
        results = [singleResult];
      } else {
        // Multiple items - use batch segmentation endpoint
        results = await this.segmentationService.requestBatchSegmentation(
          imageData,
          model,
          threshold,
          firstItem.detectHoles ?? false
        );
      }

      // Process results for each item.
      //
      // Two rules hold for every iteration, and both exist because breaking
      // them stranded rows in 'processing' forever:
      //
      //  1. Every item reaches a terminal state exactly once. Skipping an
      //     index (the old `continue`) left BOTH segmentationQueue.status and
      //     image.segmentationStatus on 'processing' with nothing left to
      //     drive them, so the card spun forever.
      //  2. One item's failure never strands the rest. The loop body is
      //     wrapped per item; without that, a throw at index k skipped
      //     k+1..N entirely.
      let failedItemCount = 0;
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        if (!item) {
          // Nothing addressable — there is no row id to settle.
          logger.warn(
            `Batch processing: no queue item at index ${i}`,
            'QueueService'
          );
          continue;
        }

        try {
          const result = results[i];
          const image = imageData[i];

          if (!image || !result) {
            // A short/misaligned result array. Settle the item as a failure
            // rather than walking away from it.
            throw new Error(
              !image
                ? `Image data missing for ${item.imageId}`
                : 'ML service returned no result for this image'
            );
          }

          // An explicit per-item failure from the ML service is a failure, not
          // an empty detection. `success === false` carries an `error`; the
          // shapes are empty only because nothing ran. Falling through to the
          // "0 polygons" branch below would have recorded it as a clean
          // `no_segmentation` and deleted the queue row without a retry.
          if (result.success === false) {
            throw new Error(
              result.error || 'ML service reported a failure for this image'
            );
          }

          // Merge polylines into polygons (sperm + microtubule return both)
          const allPolygons = [
            ...(result.polygons || []),
            ...(result.polylines || []),
          ];

          if (allPolygons.length > 0) {
            // Success - save results and update image status
            // Prioritize image dimensions from ML service result, fallback to database
            const imageWidth = result.image_size?.width || image.width || null;
            const imageHeight =
              result.image_size?.height || image.height || null;

            await this.segmentationService.saveSegmentationResults(
              item.imageId,
              allPolygons,
              model,
              threshold,
              result.confidence || null,
              result.processing_time || null,
              imageWidth,
              imageHeight,
              item.userId,
              isLastBatch
            );

            // Update image status to segmented
            await this.imageService.updateSegmentationStatus(
              item.imageId,
              'segmented',
              item.userId
            );

            // Delete completed item from queue to prevent confusion
            await this.prisma.segmentationQueue.delete({
              where: { id: item.id },
            });
            // Terminal from here on. Everything below is best-effort
            // notification work, and a throw in it must not roll the item
            // back to 'queued' — the result is already saved.
            settledItemIds.add(item.id);

            // If this image is a video frame and its container's batch is
            // now fully segmented, run cross-frame tracking. Best-effort,
            // fire-and-forget. The split on error category matters: a DB
            // failure is real and gets logger.error; the scheduler itself
            // is fire-and-forget (no await) so its rejections are caught
            // inside scheduleTrackingForContainer.
            try {
              const imageMeta = await this.prisma.image.findUnique({
                where: { id: item.imageId },
                select: { parentVideoId: true },
              });
              if (imageMeta?.parentVideoId) {
                // A static channel needs no tracker: the other frames get this
                // frame's polylines verbatim, trackId included, so identity is
                // exact by construction. Running the tracker over them would be
                // paying to rediscover it — and on a 299-frame container that is
                // what overran its timeout and lost the answer entirely.
                const projected = await projectStaticChannelResult({
                  containerId: imageMeta.parentVideoId,
                  sourceImageId: item.imageId,
                  channel: item.channel ?? null,
                });
                if (!projected.applied) {
                  scheduleTrackingForContainer(imageMeta.parentVideoId);
                }
              }
            } catch (trackErr) {
              logger.error(
                `Failed to look up parentVideoId for tracking dispatch: ${(trackErr as Error).message}`,
                trackErr as Error,
                'QueueService',
                { imageId: item.imageId }
              );
            }

            // Emit success notification via WebSocket
            if (this.websocketService) {
              this.websocketService.emitSegmentationUpdate(item.userId, {
                imageId: item.imageId,
                projectId: item.projectId,
                status: 'segmented', // Changed from 'completed' to match database status
                queueId: item.id,
              });

              this.websocketService.emitSegmentationComplete(
                item.userId,
                item.imageId,
                item.projectId,
                allPolygons.length
              );
            }

            logger.info(
              'Batch item processed successfully and removed from queue',
              'QueueService',
              {
                queueId: item.id,
                imageId: item.imageId,
                polygonCount: allPolygons.length,
              }
            );
          } else {
            // No polygons found - save empty results but mark as no_segmentation, not segmented
            logger.warn(
              'ML service returned no polygons - marking as no_segmentation',
              'QueueService',
              {
                queueId: item.id,
                imageId: item.imageId,
                model,
                threshold,
                result,
              }
            );

            // Save empty segmentation results to database so frontend can read them
            // Prioritize image dimensions from ML service result, fallback to database
            const imageWidth = result?.image_size?.width || image.width || null;
            const imageHeight =
              result?.image_size?.height || image.height || null;

            await this.segmentationService.saveSegmentationResults(
              item.imageId,
              [], // Empty polygons array
              model,
              threshold,
              result?.confidence || null,
              result?.processing_time || null,
              imageWidth,
              imageHeight,
              item.userId,
              isLastBatch
            );

            // Update image status to no_segmentation (not segmented) since no polygons were detected
            await this.imageService.updateSegmentationStatus(
              item.imageId,
              'no_segmentation',
              item.userId
            );

            // Delete completed item from queue to prevent confusion
            await this.prisma.segmentationQueue.delete({
              where: { id: item.id },
            });
            // Terminal from here on. Everything below is best-effort
            // notification work, and a throw in it must not roll the item
            // back to 'queued' — the result is already saved.
            settledItemIds.add(item.id);

            if (this.websocketService) {
              this.websocketService.emitSegmentationUpdate(item.userId, {
                imageId: item.imageId,
                projectId: item.projectId,
                status: 'no_segmentation',
                queueId: item.id,
              });

              this.websocketService.emitSegmentationComplete(
                item.userId,
                item.imageId,
                item.projectId,
                0 // 0 polygons found
              );
            }

            logger.info(
              'Batch item completed with no polygons - empty result saved as no_segmentation and removed from queue',
              'QueueService',
              {
                queueId: item.id,
                imageId: item.imageId,
              }
            );
          }
        } catch (itemError) {
          // This item alone failed. Settling it here (rather than letting the
          // throw escape to the batch-level catch) keeps the remaining items
          // in this batch processing normally instead of stranding them.
          logger.error(
            'Batch item failed',
            itemError instanceof Error ? itemError : undefined,
            'QueueService',
            { queueId: item.id, imageId: item.imageId, model, threshold }
          );
          failedItemCount++;
          if (!settledItemIds.has(item.id)) {
            // If this throws in turn, the id stays OUT of settledItemIds on
            // purpose: the batch-level catch is then the one that has to
            // finish the job.
            await this.settleFailedItem(item, itemError);
            settledItemIds.add(item.id);
          }
        }
      }

      // "Every item was settled", not "every item succeeded" — per-item
      // failures no longer abort the batch, so the count has to be reported or
      // this line would read as a clean run over a batch that partly failed.
      logger.info('Batch processing completed', 'QueueService', {
        batchSize: batch.length,
        failedItemCount,
        model,
        threshold,
      });

      // Emit updated queue stats for all affected projects and users
      const projectUserPairs = batch.map(item => ({
        projectId: item.projectId,
        userId: item.userId,
      }));
      const uniquePairs = Array.from(
        new Map(
          projectUserPairs.map(pair => [
            `${pair.projectId}-${pair.userId}`,
            pair,
          ])
        ).values()
      );

      for (const { projectId, userId } of uniquePairs) {
        const stats = await this.getQueueStats(projectId, userId);
        logger.debug(
          'Emitted queue stats after batch completion',
          'QueueService',
          {
            projectId,
            userId,
            stats,
          }
        );
      }
    } catch (error) {
      logger.error(
        'Batch processing failed',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          batchSize: batch.length,
          model,
          threshold,
          itemIds: batch.map(item => item.id),
        }
      );

      // The batch as a whole failed (before or around the per-item loop).
      // Settle every item that has not already reached a terminal state —
      // skipping the settled ones is what keeps a P2025 ("record to update
      // not found") from aborting the recovery of the items after it.
      for (const item of batch) {
        if (!item || settledItemIds.has(item.id)) {
          continue;
        }
        try {
          await this.settleFailedItem(item, error);
        } catch (settleError) {
          // This loop is the last thing standing between a failed batch and a
          // row stuck on 'processing', so nothing is allowed to abort it.
          logger.error(
            'Failed to settle a queue item during batch recovery',
            settleError instanceof Error ? settleError : undefined,
            'QueueService',
            { queueId: item.id, imageId: item.imageId }
          );
        }
        settledItemIds.add(item.id);
      }

      // Don't re-throw - we've handled all items appropriately
    }
  }

  /**
   * Bring a single queue item to a terminal state after a failure: requeue it
   * for another attempt, or mark it permanently failed once the attempts run
   * out. Either way the item stops being 'processing'.
   *
   * Every DB call is guarded individually and on purpose. The row may already
   * be gone (deleted by the success path, or by a concurrent cancel), and a
   * Prisma P2025 thrown out of here used to abort the caller's recovery loop
   * and strand the remaining items of the batch in 'processing' forever — the
   * exact symptom this method exists to prevent.
   */
  private async settleFailedItem(
    item: SegmentationQueue,
    error: unknown
  ): Promise<void> {
    const message =
      error instanceof Error ? error.message : 'Processing failed';
    const canRetry = item.retryCount < MAX_QUEUE_RETRIES;

    let queueRowSettled = true;
    try {
      if (canRetry) {
        await this.prisma.segmentationQueue.update({
          where: { id: item.id },
          data: {
            status: 'queued',
            retryCount: item.retryCount + 1, // INCREMENT RETRY COUNT
            error: message,
            startedAt: null,
            completedAt: null,
          },
        });
      } else {
        // Max retries exceeded - remove from queue
        await this.prisma.segmentationQueue.delete({
          where: { id: item.id },
        });
      }
    } catch (dbError) {
      queueRowSettled = false;
      logger.warn(
        'Could not update queue row while settling a failed item',
        'QueueService',
        {
          queueId: item.id,
          imageId: item.imageId,
          canRetry,
          reason: dbError instanceof Error ? dbError.message : String(dbError),
        }
      );
    }

    // 'queued' only when the row was really put back. With no row there is
    // nothing left to run a retry, and 'queued' has no owner — resetStuckItems
    // sweeps 'processing', not 'queued', so the card would sit on "queued"
    // forever. 'queued' rather than 'no_segmentation' on the normal retry
    // matters for the opposite reason: "no segmentation" is what a finished,
    // empty run writes, so it made a pending retry look like a completed one.
    const status: QueueStatus =
      canRetry && queueRowSettled ? 'queued' : 'failed';

    let statusWritten = true;
    try {
      if (queueRowSettled) {
        await this.imageService.updateSegmentationStatus(
          item.imageId,
          status,
          item.userId
        );
      } else {
        // The row usually vanished because something else took this item over
        // — cancelBatch deletes the row and sets the image status itself. Only
        // correct an image still pinned to 'processing', which nothing else
        // would ever move.
        const { count } = await this.prisma.image.updateMany({
          where: { id: item.imageId, segmentationStatus: 'processing' },
          data: { segmentationStatus: status },
        });
        statusWritten = count > 0;
      }
    } catch (statusError) {
      statusWritten = false;
      logger.error(
        'Failed to update image status while settling a failed item',
        statusError instanceof Error ? statusError : undefined,
        'QueueService',
        { queueId: item.id, imageId: item.imageId, status }
      );
    }

    // No event for an image somebody else already settled — the emit would
    // fight whatever status they wrote.
    if (this.websocketService && statusWritten) {
      this.websocketService.emitSegmentationUpdate(item.userId, {
        imageId: item.imageId,
        projectId: item.projectId,
        status,
        ...(status === 'failed' ? { error: message } : {}),
        queueId: item.id,
      });
    }
  }

  /**
   * Process multiple batches concurrently using Promise.allSettled
   */
  async processMultipleBatches(batches: QueueBatch[]): Promise<void> {
    if (batches.length === 0) {
      return;
    }

    logger.info('Starting parallel batch processing', 'QueueService', {
      batchCount: batches.length,
      totalItems: batches.reduce((sum, batch) => sum + batch.items.length, 0),
      models: [...new Set(batches.map(batch => batch.model))],
    });

    // Update processing stats
    this.processingStats.activeStreams = batches.length;
    this.processingStats.totalProcessingCapacity = batches.reduce(
      (sum, batch) => sum + batch.items.length,
      0
    );

    // Track active batches
    const startTime = new Date();
    batches.forEach(batch => {
      this.activeBatches.set(batch.id, startTime);
    });

    // Process batches concurrently
    const batchPromises = batches.map(batch =>
      this.processSingleBatch(batch.items).catch(error => {
        logger.error(
          'Batch processing failed',
          error instanceof Error ? error : undefined,
          'QueueService',
          {
            batchId: batch.id,
            batchSize: batch.items.length,
            model: batch.model,
          }
        );
        return error; // Return error instead of throwing to continue with other batches
      })
    );

    // Wait for all batches to complete
    const results = await Promise.allSettled(batchPromises);

    // Clean up tracking
    batches.forEach(batch => {
      this.activeBatches.delete(batch.id);
    });

    // Update processing stats
    const endTime = new Date();
    const processingTime = endTime.getTime() - startTime.getTime();
    this.processingStats.activeStreams = 0;
    this.processingStats.averageProcessingTime = processingTime;
    this.processingStats.currentThroughput =
      this.processingStats.totalProcessingCapacity / (processingTime / 1000);

    // Log results
    const successCount = results.filter(
      result => result.status === 'fulfilled'
    ).length;
    const failureCount = results.filter(
      result => result.status === 'rejected'
    ).length;

    logger.info('Parallel batch processing completed', 'QueueService', {
      batchCount: batches.length,
      successCount,
      failureCount,
      totalProcessingTime: processingTime,
      throughput: this.processingStats.currentThroughput,
    });

    // Emit parallel processing status update
    if (this.websocketService) {
      this.emitParallelProcessingStatus();
    }
  }

  /**
   * Process a single batch (extracted from original processBatch method)
   */
  async processSingleBatch(batch: SegmentationQueue[]): Promise<void> {
    if (batch.length === 0) {
      return;
    }

    const firstItem = batch[0];
    if (!firstItem) {
      return; // Should never happen due to length check above
    }
    const model = firstItem.model;
    const threshold = firstItem.threshold;

    logger.info('Starting batch processing', 'QueueService', {
      batchSize: batch.length,
      model,
      threshold,
      itemIds: batch.map(item => item.id),
    });

    // Call the main processBatch method which contains the full logic
    return this.processBatch(batch);
  }

  /**
   * Legacy method for backward compatibility - get single batch
   */
  async getNextBatch(): Promise<SegmentationQueue[]> {
    const batches = await this.getMultipleBatches(1);
    return batches.length > 0 ? batches[0].items : [];
  }

  /**
   * Estimate processing time based on batch size and model
   */
  private estimateProcessingTime(batchSize: number, model: string): number {
    // Processing time estimates in milliseconds (based on analysis)
    const modelTimes = {
      hrnet: 196, // ~196ms per image
      cbam_resunet: 396, // ~396ms per image
      unet_spherohq: 1000, // ~1000ms per image
      spheroid_disintegration: 350, // ~350ms per image
    };

    const timePerImage = modelTimes[model as keyof typeof modelTimes] || 500;
    return batchSize * timePerImage;
  }

  /**
   * Get parallel processing statistics
   */
  async getParallelProcessingStats(): Promise<ParallelProcessingStats> {
    // Update active streams count
    this.processingStats.activeStreams = this.activeBatches.size;

    return {
      ...this.processingStats,
      // Add real-time metrics
      activeStreams: this.activeBatches.size,
      maxConcurrentStreams: this.maxConcurrentBatches,
    };
  }

  /**
   * Emit parallel processing status via WebSocket
   */
  private emitParallelProcessingStatus(): void {
    // Disabled - parallel processing notifications removed per user request
    // if (!this.websocketService) {
    //   return;
    // }
    // const stats = this.processingStats;
    // // Emit to all connected users (system-wide status)
    // this.websocketService.broadcastSystemMessage(
    //   `Parallel Processing: ${stats.activeStreams}/${stats.maxConcurrentStreams} streams active`,
    //   'info'
    // );
  }

  /**
   * Emit queue stats for all users/projects affected by a batch
   */
  private async emitQueueStatsForBatch(
    batch: SegmentationQueue[]
  ): Promise<void> {
    const projectUserPairs = batch.map(item => ({
      projectId: item.projectId,
      userId: item.userId,
    }));
    const uniquePairs = Array.from(
      new Map(
        projectUserPairs.map(pair => [`${pair.projectId}-${pair.userId}`, pair])
      ).values()
    );

    for (const { projectId, userId } of uniquePairs) {
      const stats = await this.getQueueStats(projectId, userId);
      logger.debug(
        'Emitted queue stats after batch completion',
        'QueueService',
        {
          projectId,
          userId,
          stats,
        }
      );
    }
  }

  /**
   * Get comprehensive health status of the queue system including parallel processing metrics
   */
  async getQueueHealthStatus(): Promise<{
    healthy: boolean;
    queueStats: {
      queued: number;
      processing: number;
      completed: number;
      failed: number;
      stuck: number; // Processing items older than 10 minutes
    };
    parallelStats: ParallelProcessingStats;
    oldestQueuedItem?: Date;
    mlServiceHealthy: boolean;
    issues: string[];
  }> {
    try {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

      // Get queue statistics
      const [queued, processing, completed, failed, stuck, oldestQueued] =
        await Promise.all([
          this.prisma.segmentationQueue.count({ where: { status: 'queued' } }),
          this.prisma.segmentationQueue.count({
            where: { status: 'processing' },
          }),
          this.prisma.segmentationQueue.count({
            where: { status: 'completed' },
          }),
          this.prisma.segmentationQueue.count({ where: { status: 'failed' } }),
          this.prisma.segmentationQueue.count({
            where: {
              status: 'processing',
              startedAt: { lt: tenMinutesAgo },
            },
          }),
          this.prisma.segmentationQueue.findFirst({
            where: { status: 'queued' },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          }),
        ]);

      // Check ML service health
      const mlServiceHealthy =
        await this.segmentationService.checkServiceHealth();

      // Identify issues
      const issues: string[] = [];

      if (stuck > 0) {
        issues.push(`${stuck} items stuck in processing for over 10 minutes`);
      }

      if (!mlServiceHealthy) {
        issues.push('ML service is not responding');
      }

      if (queued > 100) {
        issues.push(`High queue backlog: ${queued} items waiting`);
      }

      if (
        oldestQueued &&
        now.getTime() - oldestQueued.createdAt.getTime() > 30 * 60 * 1000
      ) {
        issues.push('Oldest queued item is over 30 minutes old');
      }

      const healthy = issues.length === 0;

      // Get parallel processing stats
      const parallelStats = await this.getParallelProcessingStats();

      return {
        healthy,
        queueStats: {
          queued,
          processing,
          completed,
          failed,
          stuck,
        },
        parallelStats,
        oldestQueuedItem: oldestQueued?.createdAt,
        mlServiceHealthy,
        issues,
      };
    } catch (error) {
      logger.error(
        'Failed to get queue health status',
        error instanceof Error ? error : undefined,
        'QueueService'
      );
      return {
        healthy: false,
        queueStats: {
          queued: 0,
          processing: 0,
          completed: 0,
          failed: 0,
          stuck: 0,
        },
        parallelStats: {
          activeStreams: 0,
          maxConcurrentStreams: 4,
          totalProcessingCapacity: 0,
          currentThroughput: 0,
          averageProcessingTime: 0,
        },
        mlServiceHealthy: false,
        issues: ['Failed to check queue health'],
      };
    }
  }

  /**
   * Reset stuck items (processing items older than specified minutes)
   * Also handles items stuck in processing-queued loop
   */
  async resetStuckItems(maxProcessingMinutes = 10): Promise<number> {
    try {
      const cutoffTime = new Date();
      cutoffTime.setMinutes(cutoffTime.getMinutes() - maxProcessingMinutes);

      // Find stuck items: processing with old startedAt OR processing with null startedAt (never started)
      const stuckItems = await this.prisma.segmentationQueue.findMany({
        where: {
          status: 'processing',
          OR: [{ startedAt: { lt: cutoffTime } }, { startedAt: null }],
        },
      });

      // Also reset images stuck in 'processing' that have no active queue
      // entry. The age filter is required and has its OWN floor rather than
      // reusing cutoffTime: POST /segmentation/batch segments directly, with no
      // queue row, so a run that started a second ago matches every other term
      // here — and the worker's deadlock path calls this with
      // maxProcessingMinutes = 0, which would put cutoffTime at "now" and sweep
      // a healthy in-flight run out from under itself. That call is aggressive
      // on purpose about the QUEUE rows above; these images are not its target.
      const orphanCutoff = new Date(
        Math.min(cutoffTime.getTime(), Date.now() - ORPHAN_IMAGE_MIN_AGE_MS)
      );
      const stuckImages = await this.prisma.image.findMany({
        where: {
          segmentationStatus: 'processing',
          updatedAt: { lt: orphanCutoff },
          queueEntries: { none: { status: { in: ['processing', 'queued'] } } },
        },
        select: { id: true, project: { select: { userId: true } } },
      });
      for (const img of stuckImages) {
        // 'failed', not 'no_segmentation'. This image's run never finished, and
        // 'no_segmentation' is exactly what a *successful* run over a blank
        // frame writes — reusing it here made a dead worker indistinguishable
        // from an image that genuinely has nothing on it, for both the user and
        // for us reading the table afterwards.
        await this.imageService.updateSegmentationStatus(
          img.id,
          'failed',
          img.project.userId
        );
        logger.warn(
          'Reset orphaned image from processing to failed',
          'QueueService',
          { imageId: img.id }
        );
      }

      let resetCount = 0;
      let failedCount = 0;

      for (const item of stuckItems) {
        if (item.retryCount >= MAX_QUEUE_RETRIES) {
          // Max retries exceeded - mark as failed and remove
          await this.prisma.segmentationQueue.delete({
            where: { id: item.id },
          });

          await this.imageService.updateSegmentationStatus(
            item.imageId,
            'failed',
            item.userId
          );

          logger.warn(
            'Stuck item exceeded max retries - marked as failed',
            'QueueService',
            {
              queueId: item.id,
              imageId: item.imageId,
              retryCount: item.retryCount,
            }
          );

          failedCount++;
        } else {
          // Reset to queued with incremented retry count
          await this.prisma.segmentationQueue.update({
            where: { id: item.id },
            data: {
              status: 'queued',
              retryCount: item.retryCount + 1,
              startedAt: null,
              error: `Reset due to timeout (attempt ${item.retryCount + 1})`,
            },
          });

          await this.imageService.updateSegmentationStatus(
            item.imageId,
            'queued',
            item.userId
          );

          resetCount++;
        }
      }

      if (resetCount > 0 || failedCount > 0) {
        logger.warn('Handled stuck queue items', 'QueueService', {
          resetCount,
          failedCount,
          maxProcessingMinutes,
        });
      }

      return resetCount + failedCount;
    } catch (error) {
      logger.error(
        'Failed to reset stuck items',
        error instanceof Error ? error : undefined,
        'QueueService'
      );
      throw error;
    }
  }

  /**
   * Cleanup completed and failed queue entries older than specified days
   */
  async cleanupOldEntries(daysOld = 7): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await this.prisma.segmentationQueue.deleteMany({
        where: {
          status: { in: ['completed', 'failed'] },
          completedAt: { lt: cutoffDate },
        },
      });

      logger.info('Cleaned up old queue entries', 'QueueService', {
        deletedCount: result.count,
        daysOld,
      });

      return result.count;
    } catch (error) {
      logger.error(
        'Failed to cleanup old queue entries',
        error instanceof Error ? error : undefined,
        'QueueService'
      );
      throw error;
    }
  }

  /**
   * Cancel batch processing for a specific user and batch
   * @param batchId Batch ID to cancel
   * @param userId User ID requesting cancellation
   * @returns Number of cancelled queue items
   */
  async cancelBatch(batchId: string, userId: string): Promise<number> {
    try {
      logger.info('Cancelling batch', 'QueueService', { batchId, userId });

      // Find all queued items for this batch and user
      const queuedItems = await this.prisma.segmentationQueue.findMany({
        where: {
          batchId,
          userId,
          status: 'queued',
        },
        include: {
          image: true,
        },
      });

      if (queuedItems.length === 0) {
        logger.info(
          'No queued items found for batch cancellation',
          'QueueService',
          { batchId, userId }
        );
        return 0;
      }

      // Delete queued items
      const deleteResult = await this.prisma.segmentationQueue.deleteMany({
        where: {
          batchId,
          userId,
          status: 'queued',
        },
      });

      // Update affected images' segmentation status to 'no_segmentation'
      const imageIds = queuedItems.map(item => item.imageId);
      await this.prisma.image.updateMany({
        where: {
          id: { in: imageIds },
        },
        data: {
          segmentationStatus: 'no_segmentation',
        },
      });

      // Emit cancellation events via WebSocket
      if (this.websocketService) {
        for (const item of queuedItems) {
          this.websocketService.emitToUser(userId, 'segmentation:cancelled', {
            imageId: item.imageId,
            batchId,
            message: 'Batch processing cancelled by user',
          });
        }

        // Update queue stats for affected projects
        const projectIds = [
          ...new Set(queuedItems.map(item => item.image.projectId)),
        ];
        for (const projectId of projectIds) {
          const stats = await this.getQueueStats(projectId);
          this.websocketService.emitQueueStatsUpdate(projectId, stats);
        }
      }

      logger.info('Batch cancelled successfully', 'QueueService', {
        batchId,
        userId,
        cancelledCount: deleteResult.count,
        affectedImages: imageIds.length,
      });

      return deleteResult.count;
    } catch (error) {
      logger.error(
        'Failed to cancel batch',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          batchId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Cancel all segmentation tasks for a specific user across all projects
   * This will cancel all queued and processing segmentations
   */
  async cancelAllUserSegmentations(userId: string): Promise<{
    cancelledCount: number;
    affectedProjects: string[];
    affectedBatches: string[];
  }> {
    try {
      logger.info('Cancelling all user segmentations', 'QueueService', {
        userId,
      });

      // Find all queued and processing items for this user
      const queuedItems = await this.prisma.segmentationQueue.findMany({
        where: {
          userId,
          status: {
            in: ['queued', 'processing'],
          },
        },
        include: {
          image: true,
        },
      });

      if (queuedItems.length === 0) {
        logger.info('No active segmentations found for user', 'QueueService', {
          userId,
        });
        return {
          cancelledCount: 0,
          affectedProjects: [],
          affectedBatches: [],
        };
      }

      // Group by status to handle differently
      const processingItems = queuedItems.filter(
        item => item.status === 'processing'
      );

      // Delete all queued items
      const deleteResult = await this.prisma.segmentationQueue.deleteMany({
        where: {
          userId,
          status: 'queued',
        },
      });

      // Mark processing items as cancelled (they'll be handled by the ML service)
      if (processingItems.length > 0) {
        await this.prisma.segmentationQueue.updateMany({
          where: {
            userId,
            status: 'processing',
          },
          data: {
            status: 'cancelled',
          },
        });
      }

      // Update affected images' segmentation status
      const imageIds = queuedItems.map(item => item.imageId);
      if (imageIds.length > 0) {
        await this.prisma.image.updateMany({
          where: {
            id: { in: imageIds },
          },
          data: {
            segmentationStatus: 'no_segmentation',
          },
        });
      }

      // Collect affected batches and projects
      const affectedBatches = [
        ...new Set(
          queuedItems
            .filter(item => item.batchId)
            .map(item => item.batchId)
            .filter(Boolean)
        ),
      ];
      const affectedProjects = [
        ...new Set(queuedItems.map(item => item.image.projectId)),
      ];

      // Emit cancellation events via WebSocket
      if (this.websocketService) {
        // Send bulk cancellation notification
        this.websocketService.emitToUser(
          userId,
          'segmentation:bulk-cancelled',
          {
            cancelledCount: queuedItems.length,
            affectedProjects,
            affectedBatches,
            message: 'All segmentations cancelled by user',
          }
        );

        // Send individual cancellation events for each image
        for (const item of queuedItems) {
          this.websocketService.emitToUser(userId, 'segmentation:cancelled', {
            imageId: item.imageId,
            batchId: item.batchId,
            message: 'Segmentation cancelled by user',
          });
        }

        // Update queue stats for all affected projects
        for (const projectId of affectedProjects) {
          const stats = await this.getQueueStats(projectId);
          this.websocketService.emitQueueStatsUpdate(projectId, stats);
        }
      }

      // Cancel processing in ML service if needed
      if (processingItems.length > 0) {
        try {
          // Call ML service to cancel active jobs
          logger.info(
            'Requesting ML service to cancel processing jobs',
            'QueueService',
            {
              userId,
              jobCount: processingItems.length,
            }
          );
        } catch (mlError) {
          logger.error(
            'Failed to cancel ML processing',
            mlError instanceof Error ? mlError : undefined,
            'QueueService'
          );
        }
      }

      logger.info(
        'All user segmentations cancelled successfully',
        'QueueService',
        {
          userId,
          cancelledCount: queuedItems.length,
          deletedCount: deleteResult.count,
          processingCancelled: processingItems.length,
          affectedProjects: affectedProjects.length,
          affectedBatches: affectedBatches.length,
        }
      );

      return {
        cancelledCount: queuedItems.length,
        affectedProjects,
        affectedBatches,
      };
    } catch (error) {
      logger.error(
        'Failed to cancel all user segmentations',
        error instanceof Error ? error : undefined,
        'QueueService',
        {
          userId,
        }
      );
      throw error;
    }
  }
}
