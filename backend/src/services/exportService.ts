import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import archiver from 'archiver';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../utils/logger';
import { VisualizationGenerator } from './visualization/visualizationGenerator';
import { MetricsCalculator } from './metrics/metricsCalculator';
import { FormatConverter } from './export/formatConverter';
import { WebSocketService } from './websocketService';
import * as SharingService from './sharingService';
import { batchProcessor } from '../utils/batchProcessor';
// import { Queue } from 'bull';
// import { RedisClient } from '../redis/client';

export interface ExportOptions {
  includeOriginalImages?: boolean;
  includeVisualizations?: boolean;
  visualizationOptions?: {
    showNumbers?: boolean;
    polygonColors?: {
      external?: string;
      internal?: string;
    };
    strokeWidth?: number;
    fontSize?: number;
    transparency?: number;
  };
  annotationFormats?: ('coco' | 'yolo' | 'json')[];
  metricsFormats?: ('excel' | 'csv' | 'json')[];
  includeDocumentation?: boolean;
  selectedImageIds?: string[];
  pixelToMicrometerScale?: number;
}

// Define type for project with images and segmentation data
type ProjectWithImages = Prisma.ProjectGetPayload<{
  select: {
    id: true;
    title: true;
    images: {
      select: {
        id: true;
        name: true;
        originalPath: true;
        thumbnailPath: true;
        segmentationThumbnailPath: true;
        width: true;
        height: true;
        fileSize: true;
        mimeType: true;
        projectId: true;
        segmentationStatus: true;
        createdAt: true;
        updatedAt: true;
        segmentation: true;
      };
    };
  };
}>;

// Define type for individual image with segmentation
type ImageWithSegmentation = Prisma.ImageGetPayload<{
  include: {
    segmentation: true;
  };
}>;

// Define type for visualizationOptions parameter
type VisualizationOptions = ExportOptions['visualizationOptions'];

export interface ExportJob {
  id: string;
  projectId: string;
  userId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message?: string;
  filePath?: string;
  createdAt: Date;
  completedAt?: Date;
  options: ExportOptions;
  bullJobId?: string;
  projectName?: string;
}

export class ExportService {
  private static instance: ExportService;
  private exportQueue: unknown; // Queue - Bull queue type disabled
  private wsService: WebSocketService | null = null;
  private visualizationGenerator: VisualizationGenerator;
  private metricsCalculator: MetricsCalculator;
  private formatConverter: FormatConverter;

  // Helper to check if an export job has been cancelled
  private isJobCancelled(jobId: string): boolean {
    const job = this.exportJobs.get(jobId);
    return job?.status === 'cancelled' || false;
  }
  private exportJobs: Map<string, ExportJob>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_JOBS = 1000; // Maximum number of jobs to keep in memory

  constructor() {
    // Queue temporarily disabled - requires Redis configuration
    // this.exportQueue = new Queue('export-queue', {
    //   redis: RedisClient.getConfig(),
    // });
    this.visualizationGenerator = new VisualizationGenerator();
    this.metricsCalculator = new MetricsCalculator();
    this.formatConverter = new FormatConverter();
    this.exportJobs = new Map();

    // this.setupQueueHandlers();
    this.setupJobCleanup();
  }

  static getInstance(): ExportService {
    if (!ExportService.instance) {
      ExportService.instance = new ExportService();
    }
    return ExportService.instance;
  }

  setWebSocketService(wsService: WebSocketService): void {
    this.wsService = wsService;
    logger.info('WebSocketService connected to ExportService');
  }

  private sendToUser(
    userId: string,
    event: string,
    data: Record<string, unknown>
  ): void {
    if (this.wsService) {
      try {
        // Use the WebSocketService emitToUser method for all export events
        this.wsService.emitToUser(userId, event, data);

        if (event === 'export:started') {
          logger.debug('Export started notification sent', 'ExportService', {
            userId,
            jobId: data.jobId,
          });
        } else if (event === 'export:progress') {
          logger.debug('Export progress update sent', 'ExportService', {
            userId,
            progress: data.progress,
          });
        } else if (event === 'export:completed') {
          logger.info('Export completed notification sent', 'ExportService', {
            userId,
            jobId: data.jobId,
          });
        } else if (event === 'export:failed') {
          logger.error(
            'Export failed notification sent',
            new Error(String(data.error)),
            'ExportService',
            { userId, jobId: data.jobId }
          );
        }
      } catch (error) {
        logger.error(
          'Failed to send WebSocket message',
          error instanceof Error ? error : new Error(String(error)),
          'ExportService',
          { userId, event, data }
        );
      }
    } else {
      logger.warn(
        'WebSocketService not available for export notification',
        'ExportService',
        { userId, event }
      );
    }
  }

  private setupQueueHandlers(): void {
    // Queue processing temporarily disabled
    return;
    /*
    this.exportQueue.process(async (job) => {
      const { jobId, projectId, userId, options } = job.data;
      await this.processExportJob(jobId, projectId, userId, options);
    });

    this.exportQueue.on('progress', (job, progress) => {
      const { jobId, userId } = job.data;
      this.updateJobProgress(jobId, progress);
      this.sendToUser(userId, 'export:progress', { jobId, progress });
    });

    this.exportQueue.on('completed', (job) => {
      const { jobId, userId } = job.data;
      const exportJob = this.exportJobs.get(jobId);
      if (exportJob) {
        exportJob.status = 'completed';
        exportJob.completedAt = new Date();
        this.sendToUser(userId, 'export:completed', { jobId });
      }
    });

    this.exportQueue.on('failed', (job, error) => {
      const { jobId, userId } = job.data;
      logger.error(`Export job ${jobId} failed:`, error instanceof Error ? error : new Error(String(error)));
      const exportJob = this.exportJobs.get(jobId);
      if (exportJob) {
        exportJob.status = 'failed';
        exportJob.message = error.message;
        this.sendToUser(userId, 'export:failed', { jobId, error: error.message });
      }
    });
    */
  }

  async startExportJob(
    projectId: string,
    userId: string,
    options: ExportOptions,
    projectName?: string
  ): Promise<string> {
    // Check if user has access to this project (owner or shared)
    const accessCheck = await SharingService.hasProjectAccess(
      projectId,
      userId
    );
    if (!accessCheck.hasAccess) {
      throw new Error(
        'Access denied: You do not have permission to export this project'
      );
    }

    const jobId = uuidv4();

    // Get project name if not provided
    let finalProjectName = projectName;
    if (!finalProjectName) {
      try {
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { title: true },
        });
        finalProjectName = project?.title;
      } catch (error) {
        logger.warn(
          'Failed to fetch project name for export',
          error instanceof Error ? error.message : String(error),
          'ExportService'
        );
      }
    }

    // Create job record
    const job: ExportJob = {
      id: jobId,
      projectId,
      userId,
      status: 'pending',
      progress: 0,
      createdAt: new Date(),
      options,
      projectName: finalProjectName,
    };

    this.exportJobs.set(jobId, job);

    // Queue disabled - process directly
    // await this.exportQueue.add('export', {
    //   jobId,
    //   projectId,
    //   userId,
    //   options,
    // });

    // Process export directly without queue
    this.processExportJob(jobId, projectId, userId, options).catch(err => {
      logger.error(
        'Export job failed with unhandled error',
        err instanceof Error ? err : new Error(String(err)),
        'ExportService',
        {
          jobId,
          projectId,
          userId,
          options,
        }
      );

      // Mark job as failed if it exists
      const job = this.exportJobs.get(jobId);
      if (job) {
        job.status = 'failed';
        job.message =
          err instanceof Error ? err.message : 'Unknown error occurred';
        job.completedAt = new Date();

        // Notify user of failure
        this.sendToUser(userId, 'export:failed', {
          jobId,
          error: job.message,
        });
      }
    });

    // Notify user via WebSocket
    this.sendToUser(userId, 'export:started', { jobId });

    return jobId;
  }

  private async processExportJob(
    jobId: string,
    projectId: string,
    userId: string,
    options: ExportOptions
  ): Promise<void> {
    const job = this.exportJobs.get(jobId);
    if (!job) {
      return;
    }

    // Helper function to check if export was cancelled
    const checkCancellation = (): void => {
      const currentJob = this.exportJobs.get(jobId);
      if (currentJob?.status === 'cancelled') {
        logger.info('Export cancelled during processing', 'ExportService', {
          jobId,
        });
        throw new Error('Export cancelled by user');
      }
    };

    try {
      job.status = 'processing';
      this.updateJobProgress(jobId, 0);

      // Check cancellation before starting
      checkCancellation();

      // Check if user has access to this project (owner or shared)
      const accessCheck = await SharingService.hasProjectAccess(
        projectId,
        userId
      );
      if (!accessCheck.hasAccess) {
        throw new Error(
          'Access denied: You do not have permission to export this project'
        );
      }

      // Get project data with optimized query - only select needed fields
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          title: true,
          images: {
            where: options.selectedImageIds
              ? { id: { in: options.selectedImageIds } }
              : undefined,
            select: {
              id: true,
              name: true,
              originalPath: true,
              thumbnailPath: true,
              segmentationThumbnailPath: true,
              width: true,
              height: true,
              fileSize: true,
              mimeType: true,
              projectId: true,
              segmentationStatus: true,
              createdAt: true,
              updatedAt: true,
              segmentation: {
                select: {
                  id: true,
                  createdAt: true,
                  updatedAt: true,
                  imageId: true,
                  polygons: true,
                  model: true,
                  threshold: true,
                  confidence: true,
                  processingTime: true,
                  imageHeight: true,
                  imageWidth: true,
                },
              },
            },
          },
        },
      });

      if (!project) {
        throw new Error('Project not found');
      }

      // Create temporary export directory
      const exportDir = path.join(process.env.EXPORT_DIR || './exports', jobId);
      await fs.mkdir(exportDir, { recursive: true });

      // Create folder structure
      await this.createFolderStructure(exportDir);
      this.updateJobProgress(jobId, 5);

      // Parallel export processing - run independent tasks concurrently
      const exportTasks: Promise<void>[] = [];
      let progressStep = 0;
      const totalSteps = [
        options.includeOriginalImages,
        options.includeVisualizations,
        options.annotationFormats?.length,
        options.metricsFormats?.length,
        options.includeDocumentation,
      ].filter(Boolean).length;

      // Use 90% of progress for processing tasks, leaving 5% for ZIP creation
      const progressIncrement = totalSteps > 0 ? 90 / totalSteps : 0;

      // Copy original images (can run in parallel)
      if (options.includeOriginalImages && project.images) {
        const images = project.images as ImageWithSegmentation[];
        exportTasks.push(
          this.copyOriginalImagesWithProgress(
            images,
            exportDir,
            (current, total) => {
              const taskProgress = Math.floor((current / total) * 100);
              const baseProgress = 5 + progressStep * progressIncrement;
              const currentProgress =
                baseProgress + (taskProgress * progressIncrement) / 100;
              this.updateJobProgress(jobId, currentProgress, 'images', {
                current,
                total,
              });
            },
            jobId
          ).then(() => {
            progressStep++;
            this.updateJobProgress(
              jobId,
              5 + progressStep * progressIncrement,
              'images'
            );
          })
        );
      }

      // Generate visualizations (can run in parallel)
      if (options.includeVisualizations && project.images) {
        const visualizationProgressBase = 5 + progressStep * progressIncrement;
        exportTasks.push(
          this.generateVisualizations(
            project.images as ImageWithSegmentation[],
            exportDir,
            options.visualizationOptions,
            jobId,
            (current, total) => {
              const taskProgress = Math.floor((current / total) * 100);
              const currentProgress =
                visualizationProgressBase +
                (taskProgress * progressIncrement) / 100;
              this.updateJobProgress(jobId, currentProgress, 'visualizations', {
                current,
                total,
              });
            }
          ).then(() => {
            progressStep++;
            this.updateJobProgress(
              jobId,
              5 + progressStep * progressIncrement,
              'visualizations'
            );
          })
        );
      }

      // Generate annotations (can run in parallel)
      if (options.annotationFormats?.length && project.images) {
        const annotationProgressBase = 5 + progressStep * progressIncrement;
        exportTasks.push(
          this.generateAnnotations(
            project.images as ImageWithSegmentation[],
            exportDir,
            options.annotationFormats,
            jobId,
            (current, total) => {
              const taskProgress = Math.floor((current / total) * 100);
              const currentProgress =
                annotationProgressBase +
                (taskProgress * progressIncrement) / 100;
              this.updateJobProgress(jobId, currentProgress, 'annotations', {
                current,
                total,
              });
            }
          ).then(() => {
            progressStep++;
            this.updateJobProgress(
              jobId,
              5 + progressStep * progressIncrement,
              'annotations'
            );
          })
        );
      }

      // Generate metrics (can run in parallel)
      if (options.metricsFormats?.length && project.images) {
        exportTasks.push(
          this.generateMetrics(
            project.images as ImageWithSegmentation[],
            exportDir,
            options.metricsFormats,
            project.title,
            options,
            jobId
          ).then(() => {
            progressStep++;
            this.updateJobProgress(jobId, 5 + progressStep * progressIncrement);
          })
        );
      }

      // Generate documentation (can run in parallel)
      if (options.includeDocumentation) {
        exportTasks.push(
          this.generateDocumentation(project, exportDir, options).then(() => {
            progressStep++;
            this.updateJobProgress(jobId, 5 + progressStep * progressIncrement);
          })
        );
      }

      // Wait for all export tasks to complete in parallel
      logger.info(
        `Running ${exportTasks.length} export tasks in parallel`,
        'ExportService'
      );

      // Check for cancellation before running tasks
      checkCancellation();
      await Promise.all(exportTasks);

      // Check for cancellation after tasks complete
      checkCancellation();
      this.updateJobProgress(jobId, 95, 'compression');

      // Check for cancellation before creating ZIP
      checkCancellation();

      // Create ZIP archive (no compression)
      const zipPath = await this.createZipArchive(exportDir, project.title);

      // Check for cancellation after ZIP creation
      checkCancellation();
      this.updateJobProgress(jobId, 100);

      // Update job with file path
      job.filePath = zipPath;
      job.status = 'completed';
      job.completedAt = new Date();

      // Notify completion via WebSocket
      this.sendToUser(userId, 'export:completed', { jobId });

      // Clean up temporary directory
      await fs.rm(exportDir, { recursive: true, force: true });
    } catch (error) {
      logger.error(
        `Export job ${jobId} failed:`,
        error instanceof Error ? error : new Error(String(error))
      );
      job.status = 'failed';
      job.message = error instanceof Error ? error.message : 'Unknown error';

      // Notify failure via WebSocket
      this.sendToUser(userId, 'export:failed', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  private async createFolderStructure(exportDir: string): Promise<void> {
    const folders = [
      'images',
      'visualizations',
      'annotations/coco',
      'annotations/yolo',
      'annotations/json',
      'metrics',
      'documentation',
    ];

    for (const folder of folders) {
      await fs.mkdir(path.join(exportDir, folder), { recursive: true });
    }
  }

  private async copyOriginalImages(
    images: ImageWithSegmentation[],
    exportDir: string,
    jobId?: string
  ): Promise<void> {
    return this.copyOriginalImagesWithProgress(
      images,
      exportDir,
      undefined,
      jobId
    );
  }

  private async copyOriginalImagesWithProgress(
    images: ImageWithSegmentation[],
    exportDir: string,
    onProgress?: (current: number, total: number) => void,
    jobId?: string
  ): Promise<void> {
    const imagesDir = path.join(exportDir, 'images');
    const uploadDir = process.env.UPLOAD_DIR || './uploads';

    // Resolve upload directory to prevent path traversal
    const resolvedUploadDir = path.resolve(uploadDir);

    logger.info(
      `Starting parallel copy of ${images.length} original images`,
      'ExportService'
    );
    let copiedCount = 0;
    let skippedCount = 0;

    // Use higher concurrency for file copying (I/O bound operation)
    const concurrency = Math.min(
      16,
      Math.max(8, Math.floor(images.length / 5))
    );

    const copyImage = async (
      image: ImageWithSegmentation
    ): Promise<'copied' | 'skipped'> => {
      // Check if job was cancelled
      if (jobId && this.isJobCancelled(jobId)) {
        throw new Error('Export cancelled by user');
      }

      if (!image || !image.originalPath) {
        return 'skipped';
      }

      const candidateSourcePath = path.join(uploadDir, image.originalPath);
      const resolvedSourcePath = path.resolve(candidateSourcePath);

      // Security check: ensure resolved path starts with upload directory
      if (!resolvedSourcePath.startsWith(resolvedUploadDir)) {
        logger.warn(
          `Path traversal attempt detected for image ${image.id}`,
          'ExportService',
          {
            imageId: image.id,
            imagePath: image.originalPath,
            resolvedPath: resolvedSourcePath,
            uploadDir: resolvedUploadDir,
          }
        );
        return 'skipped';
      }

      const destPath = path.join(imagesDir, image.name);

      try {
        await fs.copyFile(resolvedSourcePath, destPath);
        return 'copied';
      } catch (error) {
        logger.warn(`Failed to copy image ${image.id}:`, 'ExportService', {
          error: error instanceof Error ? error.message : String(error),
          imageId: image.id,
          sourcePath: resolvedSourcePath,
        });
        return 'skipped';
      }
    };

    // Process images in parallel batches
    await batchProcessor.processBatch(images, copyImage, {
      batchSize: Math.ceil(images.length / 2), // Process in 2 batches for faster copying
      concurrency: concurrency,
      onBatchComplete: (batchIndex, batchResults) => {
        const batchCopied = batchResults.filter(r => r === 'copied').length;
        const batchSkipped = batchResults.filter(r => r === 'skipped').length;
        copiedCount += batchCopied;
        skippedCount += batchSkipped;

        // Report progress
        if (onProgress) {
          onProgress(copiedCount + skippedCount, images.length);
        }

        logger.info(
          `Copy batch ${batchIndex + 1} completed: ${batchCopied} copied, ${batchSkipped} skipped`,
          'ExportService'
        );
      },
      onItemError: (item, error) => {
        logger.error(
          'Image copy failed:',
          error instanceof Error ? error : new Error(String(error)),
          'ExportService'
        );
        skippedCount++;
      },
    });

    logger.info(
      `Parallel image copy completed: ${copiedCount} copied, ${skippedCount} skipped out of ${images.length} total`,
      'ExportService'
    );
  }

  private async generateVisualizations(
    images: ImageWithSegmentation[],
    exportDir: string,
    options?: VisualizationOptions,
    jobId?: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    const vizDir = path.join(exportDir, 'visualizations');

    logger.info(
      `Starting parallel visualization generation for ${images.length} images`,
      'ExportService'
    );
    let processedCount = 0;
    let skippedCount = 0;

    // Use optimal concurrency based on system resources
    // Typically 4-8 concurrent operations work well for I/O bound tasks
    const concurrency = Math.min(
      8,
      Math.max(4, Math.floor(images.length / 10))
    );

    const processImage = async (
      image: ImageWithSegmentation
    ): Promise<'processed' | 'skipped'> => {
      // Check if job was cancelled before processing each image
      if (jobId && this.isJobCancelled(jobId)) {
        throw new Error('Export cancelled by user');
      }

      if (!image) {
        logger.warn(`Image is undefined`, 'ExportService');
        return 'skipped';
      }

      if (!image.segmentation) {
        logger.warn(
          `Image ${image.name} (${image.id}) has no segmentation results`,
          'ExportService'
        );
        return 'skipped';
      }

      const result = image.segmentation;
      if (!result.polygons) {
        logger.warn(
          `Image ${image.name} (${image.id}) has segmentation but no polygons`,
          'ExportService'
        );
        return 'skipped';
      }

      const imageNameWithoutExt = path.parse(image.name).name;
      const vizPath = path.join(vizDir, `${imageNameWithoutExt}_viz.png`);

      let polygons;
      try {
        polygons = JSON.parse(result.polygons);
      } catch (error) {
        logger.error(
          'Failed to parse polygons for visualization:',
          error instanceof Error ? error : new Error(String(error)),
          'ExportService',
          {
            imageId: image.id,
            imageName: image.name,
          }
        );
        return 'skipped';
      }

      try {
        // Validate originalPath before joining
        if (typeof image.originalPath !== 'string' || !image.originalPath) {
          logger.error(
            'Invalid or empty originalPath for image',
            new Error(
              `Invalid originalPath for image ${image.id}: ${image.originalPath}`
            )
          );
          return 'skipped';
        }

        // Construct full path to the image
        const uploadDir = process.env.UPLOAD_DIR || './uploads';
        const fullImagePath = path.resolve(
          path.join(uploadDir, image.originalPath)
        );

        const result = await this.visualizationGenerator.generateVisualization(
          fullImagePath,
          polygons,
          vizPath,
          options
        );

        if (result === 'success') {
          return 'processed';
        } else {
          logger.warn(
            `Visualization generation returned ${result} for image ${image.name}`,
            'ExportService'
          );
          return 'skipped';
        }
      } catch (error) {
        logger.error(
          'Visualization generation failed:',
          error instanceof Error ? error : new Error(String(error)),
          'ExportService',
          {
            imageId: image.id,
            imagePath: image.originalPath,
          }
        );
        return 'skipped';
      }
    };

    // Process images in parallel batches
    const _results = await batchProcessor.processBatch(images, processImage, {
      batchSize: Math.ceil(images.length / 4), // Process in 4 batches
      concurrency: concurrency,
      onBatchComplete: (batchIndex, batchResults) => {
        // Check if job was cancelled after each batch
        if (jobId && this.isJobCancelled(jobId)) {
          throw new Error('Export cancelled by user');
        }

        const batchProcessed = batchResults.filter(
          r => r === 'processed'
        ).length;
        const batchSkipped = batchResults.filter(r => r === 'skipped').length;
        processedCount += batchProcessed;
        skippedCount += batchSkipped;

        // Report progress if callback provided
        if (onProgress) {
          onProgress(processedCount + skippedCount, images.length);
        }

        logger.info(
          `Batch ${batchIndex + 1} completed: ${batchProcessed} processed, ${batchSkipped} skipped`,
          'ExportService'
        );
      },
      onItemError: (item, error) => {
        // Check if this is a cancellation error
        if (
          error instanceof Error &&
          error.message === 'Export cancelled by user'
        ) {
          throw error; // Re-throw to stop the batch processor
        }
        logger.error(
          'Image processing failed:',
          error instanceof Error ? error : new Error(String(error)),
          'ExportService'
        );
        skippedCount++;

        // Report progress even for errors
        if (onProgress) {
          onProgress(processedCount + skippedCount, images.length);
        }
      },
    });

    logger.info(
      `Parallel visualization generation completed: ${processedCount} processed, ${skippedCount} skipped out of ${images.length} total`,
      'ExportService'
    );
  }

  private async generateAnnotations(
    images: ImageWithSegmentation[],
    exportDir: string,
    formats: string[],
    jobId?: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    for (const format of formats) {
      // Check if job was cancelled before processing each format
      if (jobId && this.isJobCancelled(jobId)) {
        throw new Error('Export cancelled by user');
      }

      const formatDir = path.join(exportDir, 'annotations', format);

      if (format === 'coco') {
        // Convert ImageWithSegmentation[] to ImageData[]
        const imageDataArray = images.map(image => ({
          id: image.id,
          filename: image.name,
          width: image.width || 0,
          height: image.height || 0,
          segmentationResults: image.segmentation
            ? [
                {
                  polygons: image.segmentation.polygons,
                  cellCount: 0,
                  timestamp: new Date(),
                },
              ]
            : [],
        }));

        const cocoData =
          await this.formatConverter.convertToCOCO(imageDataArray);
        await fs.writeFile(
          path.join(formatDir, 'annotations.json'),
          JSON.stringify(cocoData, null, 2)
        );
      } else if (format === 'yolo') {
        for (let i = 0; i < images.length; i++) {
          // Check if job was cancelled inside YOLO loop (most time-consuming)
          if (jobId && this.isJobCancelled(jobId)) {
            throw new Error('Export cancelled by user');
          }

          const image = images[i];
          if (image && image.segmentation) {
            const yoloData = await this.formatConverter.convertToYOLO(
              image.segmentation.polygons,
              image.width || 0,
              image.height || 0
            );
            const imageNameWithoutExt = path.parse(image.name).name;
            await fs.writeFile(
              path.join(formatDir, `${imageNameWithoutExt}.txt`),
              yoloData
            );
          }

          // Report progress for YOLO generation
          if (onProgress) {
            onProgress(i + 1, images.length);
          }
        }
      } else if (format === 'json') {
        // Convert ImageWithSegmentation[] to ImageData[]
        const imageDataArray = images.map(image => ({
          id: image.id,
          filename: image.name,
          width: image.width || 0,
          height: image.height || 0,
          segmentationResults: image.segmentation
            ? [
                {
                  polygons: image.segmentation.polygons,
                  cellCount: 0,
                  timestamp: new Date(),
                },
              ]
            : [],
        }));

        const jsonData =
          await this.formatConverter.convertToJSON(imageDataArray);
        await fs.writeFile(
          path.join(formatDir, 'segmentation_data.json'),
          JSON.stringify(jsonData, null, 2)
        );
      }
    }
  }

  private async generateMetrics(
    images: ImageWithSegmentation[],
    exportDir: string,
    formats: string[],
    _projectName: string,
    options?: ExportOptions,
    jobId?: string
  ): Promise<void> {
    // Check if job was cancelled before starting metrics calculation
    if (jobId && this.isJobCancelled(jobId)) {
      throw new Error('Export cancelled by user');
    }

    const metricsDir = path.join(exportDir, 'metrics');
    // Convert images to the format expected by metrics calculator
    const metricsImages = images.map(image => ({
      id: image.id,
      name: image.name,
      width: image.width || undefined,
      height: image.height || undefined,
      segmentation: image.segmentation
        ? {
            polygons: image.segmentation.polygons,
            model: image.segmentation.model,
            threshold: image.segmentation.threshold,
            confidence: image.segmentation.confidence || undefined,
            processingTime: image.segmentation.processingTime || undefined,
          }
        : undefined,
    }));

    const allMetrics = await this.metricsCalculator.calculateAllMetrics(
      metricsImages as Parameters<
        typeof this.metricsCalculator.calculateAllMetrics
      >[0],
      options?.pixelToMicrometerScale
    );

    // Check if job was cancelled after metrics calculation
    if (jobId && this.isJobCancelled(jobId)) {
      throw new Error('Export cancelled by user');
    }

    for (const format of formats) {
      // Check if job was cancelled before each format export
      if (jobId && this.isJobCancelled(jobId)) {
        throw new Error('Export cancelled by user');
      }

      if (format === 'excel') {
        await this.metricsCalculator.exportToExcel(
          allMetrics,
          path.join(metricsDir, 'metrics.xlsx'),
          options?.pixelToMicrometerScale
        );
      } else if (format === 'csv') {
        await this.metricsCalculator.exportToCSV(
          allMetrics,
          path.join(metricsDir, 'metrics.csv'),
          options?.pixelToMicrometerScale
        );
      } else if (format === 'json') {
        await fs.writeFile(
          path.join(metricsDir, 'metrics.json'),
          JSON.stringify(allMetrics, null, 2)
        );
      }
    }
  }

  private async generateDocumentation(
    project: ProjectWithImages,
    exportDir: string,
    options: ExportOptions
  ): Promise<void> {
    const docDir = path.join(exportDir, 'documentation');

    // Generate README
    const readme = this.generateReadme(project, options);
    await fs.writeFile(path.join(docDir, 'README.md'), readme);

    // Generate annotation format guides
    await this.generateAnnotationGuides(exportDir, options);

    // Generate metadata
    const metadata = {
      projectId: project.id,
      projectName: project.title,
      exportDate: new Date().toISOString(),
      imageCount: project.images?.length || 0,
      exportOptions: options,
      version: '1.0.0',
    };
    await fs.writeFile(
      path.join(docDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    // Generate metrics guide
    const metricsGuide = this.generateMetricsGuide(options);
    await fs.writeFile(path.join(docDir, 'metrics_guide.md'), metricsGuide);
  }

  private generateReadme(
    project: ProjectWithImages,
    options: ExportOptions
  ): string {
    return `# Export - ${project.title}

## Export Information
- **Date**: ${new Date().toISOString()}
- **Total Images**: ${project.images?.length || 0}
- **Project ID**: ${project.id}
${
  options.pixelToMicrometerScale && options.pixelToMicrometerScale > 0
    ? `- **Scale Conversion**: ${options.pixelToMicrometerScale} um/pixel (measurements converted to micrometers)`
    : '- **Units**: All measurements in pixels'
}

## Export Contents

### Images
${options.includeOriginalImages ? '✅ Original images included' : '❌ Original images not included'}
${options.includeVisualizations ? '✅ Visualizations with numbered polygons included' : '❌ Visualizations not included'}

### Annotations
${options.annotationFormats?.map(f => `- ${f.toUpperCase()} format`).join('\n') || 'No annotations included'}

### Metrics
${options.metricsFormats?.map(f => `- ${f.toUpperCase()} format`).join('\n') || 'No metrics included'}

## Folder Structure

* images/ - Original images
* visualizations/ - Images with numbered polygons
* annotations/ - Annotation files in various formats
  * coco/ - COCO format annotations
  * yolo/ - YOLO format annotations
  * json/ - Custom JSON format
* metrics/ - Calculated metrics
* documentation/ - This folder

## Usage Instructions
1. Extract the ZIP archive to your desired location
2. Use the appropriate annotation format for your ML framework
3. Metrics are available in Excel, CSV, or JSON format
4. Visualizations show numbered polygons for easy reference

## Notes
- External polygons are numbered sequentially
- Metrics are calculated only for external polygons
- Internal polygon areas (holes) are automatically subtracted from their containing external polygons
- All coordinates are in pixel space relative to original image dimensions
`;
  }

  private generateMetricsGuide(options?: ExportOptions): string {
    // Determine units based on scale
    const isScaled =
      options?.pixelToMicrometerScale && options.pixelToMicrometerScale > 0;
    const areaUnit = isScaled ? 'um^2' : 'px^2';
    const lengthUnit = isScaled ? 'um' : 'px';
    const scaleInfo = isScaled
      ? `\n## Scale Conversion\n\n- **Scale**: ${options.pixelToMicrometerScale} um/pixel\n- **Linear measurements**: Converted from pixels to micrometers (um)\n- **Area measurements**: Converted from pixels^2 to square micrometers (um^2)\n- **Dimensionless ratios**: Remain unchanged (scale-invariant)\n`
      : '\n## Units\n\n- **All measurements are in pixel units**\n- **Linear measurements**: pixels (px)\n- **Area measurements**: square pixels (px^2)\n';

    return `# Polygon Metrics Reference Guide
${scaleInfo}
## Calculated Metrics

### Area
- **Description**: Total enclosed area using the Shoelace formula with hole subtraction
- **Formula**: A = A_external - Sum(A_holes)
- **Implementation**: Shoelace formula: A = (1/2)|Sum(x_i * y_{i+1} - x_{i+1} * y_i)|
- **Units**: ${areaUnit}
- **Range**: [0, ∞)
- **ImageJ compatibility**: ✅ Matches ImageJ area calculation

### Perimeter
- **Description**: Total boundary length following ImageJ convention
- **Formula**: P = Sum(sqrt((x_{i+1} - x_i)^2 + (y_{i+1} - y_i)^2))
- **Implementation**: Euclidean distance between consecutive vertices
- **Units**: ${lengthUnit}
- **Range**: [0, ∞)
- **ImageJ compatibility**: ✅ Includes only external boundary (holes excluded)

### Circularity
- **Description**: Measure of how closely the shape resembles a perfect circle
- **Formula**: C = 4*pi * Area / Perimeter^2
- **LaTeX**: $C = \\\\frac{4\\\\pi A}{P^2}$
- **Range**: [0, 1] where 1 = perfect circle
- **Implementation**: Clamped to prevent division by zero
- **ImageJ compatibility**: ✅ Identical formula

### Solidity
- **Description**: Ratio of polygon area to its convex hull area (measure of convexity)
- **Formula**: S = Area / ConvexHullArea
- **LaTeX**: $S = \\\\frac{A}{A_{hull}}$
- **Range**: [0, 1] where 1 = perfectly convex (no concavities)
- **Implementation**: Uses rotating calipers algorithm for convex hull
- **scikit-image compatibility**: ✅ Matches regionprops.solidity

### Extent
- **Description**: Ratio of polygon area to bounding box area (space-filling efficiency)
- **Formula**: E = Area / (BoundingBoxWidth * BoundingBoxHeight)
- **LaTeX**: $E = \\\\frac{A}{w_{bbox} \\\\times h_{bbox}}$
- **Range**: [0, 1] where 1 = fills entire bounding box
- **Implementation**: Axis-aligned bounding box (AABB)
- **scikit-image compatibility**: ✅ Matches regionprops.extent

### Compactness
- **Description**: Reciprocal of circularity, measures shape complexity
- **Formula**: K = Perimeter^2 / (4*pi * Area)
- **LaTeX**: $K = \\\\frac{P^2}{4\\\\pi A}$
- **Range**: [1, ∞) where 1 = perfect circle, higher = more complex
- **Implementation**: Inverse of circularity formula
- **Note**: Also called "form factor" in some literature

### Convexity
- **Description**: Ratio of convex hull perimeter to actual perimeter
- **Formula**: V = ConvexHullPerimeter / Perimeter
- **LaTeX**: $V = \\\\frac{P_{hull}}{P}$
- **Range**: [0, 1] where 1 = convex shape, lower = more concavities
- **Implementation**: Uses Graham scan for convex hull
- **ImageJ compatibility**: ✅ Similar to ImageJ convexity measure

### Equivalent Diameter
- **Description**: Diameter of a circle with the same area as the polygon
- **Formula**: D_eq = sqrt(4 * Area / pi) = 2*sqrt(Area / pi)
- **LaTeX**: $D_{eq} = 2\\\\sqrt{\\\\frac{A}{\\\\pi}}$
- **Units**: ${lengthUnit}
- **Range**: [0, ∞)
- **ImageJ compatibility**: ✅ Matches ImageJ equivalent diameter

### Feret Diameters
- **Description**: Caliper diameters using rotating calipers algorithm
- **Maximum Feret**: Longest distance between any two boundary points
  - **Formula**: F_max = max(||p_i - p_j||) for all boundary points
  - **LaTeX**: $F_{max} = \\\\max_{i,j} ||p_i - p_j||$
- **Minimum Feret**: Smallest width between parallel supporting lines
  - **Implementation**: Rotating calipers algorithm
  - **LaTeX**: $F_{min} = \\\\min_{\\\\theta} w(\\\\theta)$
- **Aspect Ratio**: AR = F_max / F_min
- **Units**: ${lengthUnit}
- **Range**: F_max ≥ F_min ≥ 0, AR ≥ 1
- **ImageJ compatibility**: ✅ Uses same rotating calipers approach

### Bounding Box Metrics
- **Width/Height**: Axis-aligned bounding box dimensions
- **Formula**: W = max(x) - min(x), H = max(y) - min(y)
- **Units**: ${lengthUnit}
- **Range**: [0, ∞)
- **Implementation**: Simple min/max coordinate calculation

### Sphericity
- **Description**: 2D projection of spherical similarity
- **Formula**: Sph = pi^(1/2) * (4 * Area)^(1/2) / Perimeter
- **LaTeX**: $Sph = \\\\frac{\\\\sqrt{\\\\pi} \\\\cdot 2\\\\sqrt{A}}{P}$
- **Range**: [0, 1] where 1 = perfect circle (sphere projection)
- **Implementation**: Normalized equivalent diameter by perimeter

## Hole Handling

### Area Calculation with Holes
1. **External polygon area** calculated using Shoelace formula
2. **Internal polygon (hole) areas** calculated individually
3. **Final area** = External area - Sum of hole areas
4. **Validation**: Ensures final area ≥ 0

### Perimeter Convention (ImageJ Standard)
- **Included**: Only external boundary perimeter
- **Excluded**: Internal hole boundaries are NOT added to perimeter
- **Rationale**: Follows ImageJ convention for biological analysis
- **Note**: Some tools include hole perimeters - this implementation does not

## Implementation Details

### Algorithms Used
- **Area**: Shoelace formula (Green's theorem)
- **Convex Hull**: Graham scan algorithm
- **Feret Diameters**: Rotating calipers algorithm
- **Point-in-polygon**: Ray casting algorithm
- **Hole detection**: Centroid-based containment test

### Computational Complexity
- **Area calculation**: O(n) where n = vertices
- **Convex hull**: O(n log n)
- **Feret diameters**: O(n^2) for accurate implementation
- **Overall complexity**: O(n^2) per polygon

### Accuracy & Precision
- **Floating-point precision**: Double precision (IEEE 754)
- **Numerical stability**: Guards against division by zero
- **Edge cases**: Handles degenerate polygons gracefully
- **Validation**: All metrics validated for finite values

## Software Compatibility

### ImageJ/FIJI
- ✅ **Area**: Identical Shoelace implementation
- ✅ **Perimeter**: Matches boundary-only convention
- ✅ **Circularity**: Same 4πA/P^2 formula
- ✅ **Equivalent Diameter**: Same √(4A/π) formula
- ✅ **Feret Diameters**: Compatible rotating calipers

### scikit-image (Python)
- ✅ **Solidity**: Matches regionprops.solidity
- ✅ **Extent**: Matches regionprops.extent
- ✅ **Area**: Compatible with region.area
- ✅ **Perimeter**: Compatible with region.perimeter

### Notes for Researchers
1. **Units**: Always verify scale conversion for physical measurements
2. **Holes**: Remember that hole areas are subtracted from total area
3. **Perimeter**: Only external boundary included (ImageJ convention)
4. **Dimensionless ratios**: Circularity, solidity, extent are scale-invariant
5. **Validation**: All metrics checked for mathematical validity (finite, non-negative where applicable)

## Quality Assurance
- **Algorithm validation**: Tested against ImageJ and scikit-image
- **Edge case handling**: Robust for degenerate and complex polygons
- **Performance monitoring**: Automatic warnings for large datasets
- **Error recovery**: Fallback calculations when advanced algorithms fail
`;
  }

  private async generateAnnotationGuides(
    exportDir: string,
    options: ExportOptions
  ): Promise<void> {
    const annotationsDir = path.join(exportDir, 'annotations');

    // Only generate guides for formats that are being exported
    if (options.annotationFormats?.includes('coco')) {
      await this.generateCocoGuide(path.join(annotationsDir, 'coco'));
    }

    if (options.annotationFormats?.includes('yolo')) {
      await this.generateYoloGuide(path.join(annotationsDir, 'yolo'));
    }

    if (options.annotationFormats?.includes('json')) {
      await this.generateJsonGuide(path.join(annotationsDir, 'json'));
    }

    // Generate main annotations README
    await this.generateMainAnnotationGuide(annotationsDir, options);
  }

  private async generateCocoGuide(cocoDir: string): Promise<void> {
    const guide = `# COCO Format - Quick Setup Guide

## CVAT Import Instructions

1. **Create CVAT Project**:
   - Name: "Cell Segmentation"
   - Labels: Add "cell" (polygon) and "cell_hole" (polygon)

2. **Upload Images**:
   - Create new task in your project
   - Upload the same images used in SpheroSeg

3. **Import Annotations**:
   - In task view: Actions → Upload annotations
   - Format: "COCO 1.0"
   - File: Select the annotations.json from this directory

4. **Verify Import**:
   - Check polygon boundaries match your expectations
   - Verify all images have annotations loaded

## Label Configuration for CVAT

\`\`\`yaml
Labels:
  - name: "cell"
    type: "polygon"
    color: "#FF0000"
  - name: "cell_hole"
    type: "polygon"
    color: "#0000FF"
\`\`\`

For detailed instructions, see the full README.md in this directory.
`;

    await fs.writeFile(path.join(cocoDir, 'QUICK_SETUP.md'), guide);
  }

  private async generateYoloGuide(yoloDir: string): Promise<void> {
    const guide = `# YOLO Format - Quick Setup Guide

## Convert to COCO for CVAT

Since CVAT doesn't directly import YOLO segmentation format:

1. **Use conversion script** (see README.md in this directory)
2. **Generate COCO file** from YOLO annotations
3. **Import COCO file** to CVAT following COCO guide

## Training with YOLOv8

\`\`\`bash
# Install YOLOv8
pip install ultralytics

# Train model
yolo train data=data.yaml model=yolov8n-seg.pt epochs=100
\`\`\`

## Classes Configuration

\`\`\`
# classes.txt content:
cell
cell_hole
\`\`\`

For detailed conversion scripts and training setup, see the full README.md.
`;

    await fs.writeFile(path.join(yoloDir, 'QUICK_SETUP.md'), guide);
  }

  private async generateJsonGuide(jsonDir: string): Promise<void> {
    const guide = `# JSON Format - Quick Setup Guide

## Convert to COCO for CVAT

1. **Use conversion script** (see README.md)
2. **Convert JSON to COCO** format
3. **Import to CVAT** as COCO format

## Direct Analysis

The JSON format preserves full SpheroSeg metadata:

- Processing confidence scores
- Model used for segmentation  
- Detailed polygon metrics
- Scale conversion information

## Python Integration

\`\`\`python
import json

# Load annotations
with open('annotations.json') as f:
    data = json.load(f)

# Access polygon data
for image in data['images']:
    for polygon in image['polygons']:
        confidence = polygon['processing']['confidence']
        area = polygon['metrics']['area']
        model = polygon['processing']['model']
\`\`\`

For detailed conversion and analysis scripts, see the full README.md.
`;

    await fs.writeFile(path.join(jsonDir, 'QUICK_SETUP.md'), guide);
  }

  private async generateMainAnnotationGuide(
    annotationsDir: string,
    options: ExportOptions
  ): Promise<void> {
    const exportedFormats = options.annotationFormats || [];
    const scaleInfo = options.pixelToMicrometerScale
      ? `- **Scale**: ${options.pixelToMicrometerScale} um/pixel (measurements in micrometers)`
      : '- **Units**: All measurements in pixels';

    const guide = `# Annotation Export Guide

This export contains cell segmentation annotations in multiple formats for easy integration with annotation tools and ML pipelines.

## Exported Formats

${exportedFormats.map(format => `- **${format.toUpperCase()}**: See ${format}/ directory for format-specific instructions`).join('\n')}

## Scale Information

${scaleInfo}

## Quick Start with CVAT

### 1. Choose Your Format
- **COCO**: Best for most annotation workflows ✅ Recommended
- **YOLO**: For object detection training (requires conversion)
- **JSON**: For custom analysis workflows

### 2. CVAT Setup (COCO Format)

1. **Create Project** in CVAT:
   - Name: "Cell Segmentation - [Your Project Name]"
   - Add labels: "cell" (polygon), "cell_hole" (polygon)

2. **Create Task**:
   - Upload your original images
   - Ensure filenames match the exported annotations

3. **Import Annotations**:
   - Actions → Upload annotations
   - Format: "COCO 1.0" 
   - File: coco/annotations.json

### 3. Verification Checklist

- [ ] All images loaded correctly
- [ ] Polygon boundaries appear accurate
- [ ] Cell count matches expectations
- [ ] Labels assigned correctly (cell vs cell_hole)

## Format-Specific Instructions

Each format directory contains:
- **README.md**: Detailed setup instructions
- **QUICK_SETUP.md**: Fast-track guide
- **Conversion scripts**: For format conversion

## Troubleshooting

### Common Issues
- **"No annotations imported"**: Check image filenames match exactly
- **"Invalid format"**: Verify CVAT supports the annotation format version
- **"Missing labels"**: Ensure labels are created in CVAT before import

### Getting Help
- Check format-specific README files
- Verify image dimensions and file paths
- Test with a single image first

## Integration Examples

### Research Workflow
1. Export → COCO format
2. Import → CVAT for manual review/editing
3. Export → Enhanced COCO for training

### Training Pipeline  
1. Export → YOLO format
2. Train → YOLOv8 segmentation model
3. Deploy → Real-time cell detection

### Analysis Pipeline
1. Export → JSON format  
2. Analyze → Custom Python scripts
3. Visualize → Metrics and quality reports

## Support

For detailed instructions, see the README.md file in each format directory:
${exportedFormats.map(format => `- ${format}/README.md`).join('\n')}
`;

    await fs.writeFile(path.join(annotationsDir, 'README.md'), guide);
  }

  private async createZipArchive(
    exportDir: string,
    projectName: string
  ): Promise<string> {
    // Sanitize project name for filesystem safety
    const sanitizedProjectName = this.sanitizeFilename(projectName);
    // Use simple project name for export file (as requested by user)
    const zipName = `${sanitizedProjectName}.zip`;
    const zipPath = path.join(process.env.EXPORT_DIR || './exports', zipName);

    const output = await fs.open(zipPath, 'w');
    const archive = archiver('zip', {
      zlib: { level: 6 }, // Balanced compression (6 is default, good balance of speed vs size)
      highWaterMark: 16 * 1024 * 1024, // 16MB buffer for better streaming performance
    });

    return new Promise((resolve, reject) => {
      let cleanupCalled = false;

      const cleanup = async (): Promise<void> => {
        if (cleanupCalled) {
          return;
        }
        cleanupCalled = true;

        try {
          // Destroy archive first
          if (archive.readable || archive.writable) {
            archive.destroy();
          }
        } catch (error) {
          logger.warn('Failed to destroy archive:', 'ExportService', {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        try {
          // Close file handle
          await output.close();
        } catch (error) {
          logger.warn('Failed to close file handle:', 'ExportService', {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // Remove event listeners to prevent memory leaks
        writeStream.removeAllListeners();
        archive.removeAllListeners();
      };

      const writeStream = output.createWriteStream();

      // Add error handler for writeStream
      writeStream.on('error', error => {
        cleanup().finally(() => reject(error));
      });

      writeStream.on('close', () => {
        cleanup().finally(() => resolve(zipPath));
      });

      archive.on('error', error => {
        cleanup().finally(() => reject(error));
      });

      archive.pipe(writeStream);
      archive.directory(exportDir, false);

      // Wrap finalize in try/catch and handle its promise rejection
      try {
        archive.finalize().catch(error => {
          cleanup().finally(() => reject(error));
        });
      } catch (error) {
        cleanup().finally(() => reject(error));
      }
    });
  }

  private updateJobProgress(
    jobId: string,
    progress: number,
    stage?:
      | 'images'
      | 'visualizations'
      | 'annotations'
      | 'metrics'
      | 'compression',
    stageProgress?: { current: number; total: number; currentItem?: string }
  ): void {
    const job = this.exportJobs.get(jobId);
    if (job) {
      job.progress = progress;

      // Determine phase based on progress
      const phase = progress < 90 ? 'processing' : 'downloading';

      // Generate contextual message
      const message = this.getProgressMessage(progress, stage, stageProgress);

      // Enhanced progress data for WebSocket
      const progressData = {
        jobId,
        progress,
        phase,
        stage,
        message,
        stageProgress,
        timestamp: new Date(),
      };

      // Send to user via WebSocket
      this.sendToUser(job.userId, 'export:progress', progressData);
    }
  }

  private getProgressMessage(
    progress: number,
    stage?:
      | 'images'
      | 'visualizations'
      | 'annotations'
      | 'metrics'
      | 'compression',
    stageProgress?: { current: number; total: number; currentItem?: string }
  ): string {
    if (stage && stageProgress) {
      const { current, total, currentItem } = stageProgress;
      switch (stage) {
        case 'images':
          return `Copying original images (${current}/${total})${currentItem ? `: ${currentItem}` : ''}... ${progress}%`;
        case 'visualizations':
          return `Generating visualizations (${current}/${total})${currentItem ? `: ${currentItem}` : ''}... ${progress}%`;
        case 'annotations':
          return `Creating annotation files (${current}/${total})${currentItem ? `: ${currentItem}` : ''}... ${progress}%`;
        case 'metrics':
          return `Calculating metrics (${current}/${total})${currentItem ? `: ${currentItem}` : ''}... ${progress}%`;
        case 'compression':
          return `Creating archive... ${progress}%`;
        default:
          return `Processing ${stage} (${current}/${total})... ${progress}%`;
      }
    } else if (stage) {
      switch (stage) {
        case 'images':
          return `Copying original images... ${progress}%`;
        case 'visualizations':
          return `Generating visualizations... ${progress}%`;
        case 'annotations':
          return `Creating annotation files... ${progress}%`;
        case 'metrics':
          return `Calculating metrics... ${progress}%`;
        case 'compression':
          return `Creating archive... ${progress}%`;
        default:
          return `Processing ${stage}... ${progress}%`;
      }
    }
    return `Processing... ${progress}%`;
  }

  private setupJobCleanup(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupOldJobs();
      },
      60 * 60 * 1000
    );

    logger.info('Export job cleanup interval started', 'ExportService', {
      intervalMs: 60 * 60 * 1000,
      jobTtlMs: this.JOB_TTL_MS,
      maxJobs: this.MAX_JOBS,
    });
  }

  private cleanupOldJobs(): void {
    const now = Date.now();
    const jobsToDelete: string[] = [];

    // Find jobs older than TTL or mark excess jobs for deletion
    const sortedJobs = Array.from(this.exportJobs.entries()).sort(
      ([, a], [, b]) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    let deletedCount = 0;

    for (const [jobId, job] of sortedJobs) {
      const jobAge = now - job.createdAt.getTime();

      // Delete if older than TTL or if we have too many jobs
      if (jobAge > this.JOB_TTL_MS || sortedJobs.length > this.MAX_JOBS) {
        jobsToDelete.push(jobId);
        deletedCount++;
      }
    }

    // Remove old jobs
    for (const jobId of jobsToDelete) {
      this.exportJobs.delete(jobId);
    }

    if (deletedCount > 0) {
      logger.info(
        `Cleaned up ${deletedCount} old export jobs`,
        'ExportService',
        {
          deletedCount,
          remainingJobs: this.exportJobs.size,
          totalProcessed: sortedJobs.length,
        }
      );
    }
  }

  async getJobStatus(
    jobId: string,
    projectId: string,
    userId: string
  ): Promise<ExportJob | null> {
    // Check if user has access to this project (owner or shared)
    const accessCheck = await SharingService.hasProjectAccess(
      projectId,
      userId
    );
    if (!accessCheck.hasAccess) {
      return null;
    }

    const job = this.exportJobs.get(jobId);
    if (job && job.projectId === projectId) {
      return job;
    }
    return null;
  }

  async getExportFilePath(
    jobId: string,
    projectId: string,
    userId: string
  ): Promise<string | null> {
    // Check if user has access to this project (owner or shared)
    const accessCheck = await SharingService.hasProjectAccess(
      projectId,
      userId
    );
    if (!accessCheck.hasAccess) {
      return null;
    }

    const job = this.exportJobs.get(jobId);
    if (job && job.projectId === projectId && job.filePath) {
      return job.filePath;
    }
    return null;
  }

  async getExportJob(
    jobId: string,
    projectId: string,
    userId: string
  ): Promise<ExportJob | null> {
    // Check if user has access to this project (owner or shared)
    const accessCheck = await SharingService.hasProjectAccess(
      projectId,
      userId
    );
    if (!accessCheck.hasAccess) {
      return null;
    }

    const job = this.exportJobs.get(jobId);
    if (job && job.projectId === projectId) {
      return job;
    }
    return null;
  }

  async cancelJob(
    jobId: string,
    projectId: string,
    userId: string
  ): Promise<void> {
    // Check if user has access to this project (owner or shared)
    const accessCheck = await SharingService.hasProjectAccess(
      projectId,
      userId
    );
    if (!accessCheck.hasAccess) {
      return; // Silently return if no access
    }

    const job = this.exportJobs.get(jobId);
    if (job && job.projectId === projectId) {
      // Check if job is already completed or cancelled
      if (job.status === 'completed' || job.status === 'cancelled') {
        logger.info(
          'Export job already completed or cancelled',
          'ExportService',
          { jobId, status: job.status }
        );
        return;
      }

      // Mark job as cancelled immediately
      job.status = 'cancelled';
      job.completedAt = new Date();

      // Emit WebSocket cancellation event
      const cancelData = {
        jobId,
        projectId,
        cancelledBy: 'user' as const,
        progress: job.progress,
        cleanupCompleted: true,
        message: 'Export cancelled by user',
        timestamp: new Date(),
      };

      // Send cancellation event to user via WebSocket
      this.sendToUser(userId, 'export:cancelled', cancelData);

      logger.info('Export job cancelled', 'ExportService', {
        jobId,
        projectId,
        userId,
        progress: job.progress,
      });

      // Cancel the Bull queue job if bullJobId exists and queue is available
      if (
        job.bullJobId &&
        this.exportQueue &&
        typeof (
          this.exportQueue as {
            getJob: (id: string) => Promise<{
              getState: () => Promise<string>;
              remove: () => Promise<void>;
            } | null>;
          }
        ).getJob === 'function'
      ) {
        try {
          const queueJob = await (
            this.exportQueue as {
              getJob: (id: string) => Promise<{
                getState: () => Promise<string>;
                remove: () => Promise<void>;
              } | null>;
            }
          ).getJob(job.bullJobId);
          if (queueJob) {
            const state = await queueJob.getState();
            logger.info('Bull queue job state', 'ExportService', {
              jobId,
              bullJobId: job.bullJobId,
              state,
            });

            // Try to remove job regardless of state (except completed)
            if (state !== 'completed') {
              await queueJob.remove();
              logger.info('Bull queue job removed', 'ExportService', {
                jobId,
                bullJobId: job.bullJobId,
              });
            }
          }
        } catch (error) {
          logger.error(
            'Failed to cancel Bull queue job',
            error instanceof Error ? error : undefined,
            'ExportService',
            {
              jobId,
              bullJobId: job.bullJobId,
            }
          );
        }
      }

      // Cleanup is handled automatically when job is removed
    }
  }

  async getExportHistory(
    projectId: string,
    userId: string
  ): Promise<ExportJob[]> {
    // Check if user has access to this project (owner or shared)
    const accessCheck = await SharingService.hasProjectAccess(
      projectId,
      userId
    );
    if (!accessCheck.hasAccess) {
      return [];
    }

    const jobs = Array.from(this.exportJobs.values())
      .filter(job => job.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10); // Return last 10 exports

    return jobs;
  }

  /**
   * Sanitize filename for filesystem safety
   */
  private sanitizeFilename(filename: string): string {
    if (!filename || typeof filename !== 'string') {
      return 'export';
    }

    // Replace invalid characters with underscores
    // Invalid characters: < > : " | ? * \ / and control characters
    let sanitized = filename
      .replace(/[<>:"|?*\\/]/g, '_')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u0080-\u009f]/g, '_')
      .trim();

    // Remove leading/trailing dots and spaces (Windows compatibility)
    sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');

    // Ensure filename is not empty and not too long
    if (!sanitized || sanitized.length === 0) {
      sanitized = 'export';
    } else if (sanitized.length > 100) {
      // Truncate to 100 characters to avoid filesystem limits
      sanitized = sanitized.substring(0, 100).trim();
    }

    // Avoid reserved Windows names
    const reservedNames = [
      'CON',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'COM2',
      'COM3',
      'COM4',
      'COM5',
      'COM6',
      'COM7',
      'COM8',
      'COM9',
      'LPT1',
      'LPT2',
      'LPT3',
      'LPT4',
      'LPT5',
      'LPT6',
      'LPT7',
      'LPT8',
      'LPT9',
    ];
    if (reservedNames.includes(sanitized.toUpperCase())) {
      sanitized = `${sanitized}_export`;
    }

    return sanitized;
  }

  // Cleanup method for graceful shutdown
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Export job cleanup interval stopped', 'ExportService');
    }
  }
}
