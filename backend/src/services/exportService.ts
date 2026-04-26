import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import archiver from 'archiver';
import sharp from 'sharp';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../utils/logger';
import { VisualizationGenerator } from './visualization/visualizationGenerator';
import {
  MetricsCalculator,
  type ImageWithSegmentation as MetricsImageInput,
  type ImageMetrics,
} from './metrics/metricsCalculator';
import {
  FormatConverter,
  resolveImageDimensions,
  type Polygon as ExportPolygon,
} from './export/formatConverter';
import { WebSocketService } from './websocketService';
import * as SharingService from './sharingService';
import { batchProcessor } from '../utils/batchProcessor';
import { mapWithConcurrency } from '../utils/concurrency';
import type { CancellableJobStatus } from '../types';
import {
  generateReadme,
  generateMetricsGuide,
  generateAnnotationGuides,
} from './export/exportDocs';
import {
  sanitizeFilename,
  getProgressMessage,
  createZipArchive,
} from './export/exportFileOperations';

const YOLO_WRITE_CONCURRENCY = 16;

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
export type ProjectWithImages = Prisma.ProjectGetPayload<{
  select: {
    id: true;
    title: true;
    type: true;
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
  status: CancellableJobStatus;
  progress: number;
  message?: string;
  filePath?: string;
  createdAt: Date;
  completedAt?: Date;
  options: ExportOptions;
  projectName?: string;
  /**
   * Non-fatal problems surfaced to the user after a completed export (e.g.
   * wound TimeSeries sheet could not be written because the chart library
   * failed). The job still ends with ``status: 'completed'`` — these are
   * warnings, not errors.
   */
  warnings?: string[];
}

export class ExportService {
  private static instance: ExportService;
  private wsService: WebSocketService | null = null;
  private visualizationGenerator: VisualizationGenerator;
  private metricsCalculator: MetricsCalculator;
  private formatConverter: FormatConverter;

  private isJobCancelled(jobId: string): boolean {
    return this.exportJobs.get(jobId)?.status === 'cancelled';
  }
  private exportJobs: Map<string, ExportJob>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_JOBS = 1000; // Maximum number of jobs to keep in memory

  constructor() {
    this.visualizationGenerator = new VisualizationGenerator();
    this.metricsCalculator = new MetricsCalculator();
    this.formatConverter = new FormatConverter();
    this.exportJobs = new Map();
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

  /** How many concurrent export jobs a single user can have running. */
  private static readonly MAX_ACTIVE_JOBS_PER_USER = 1;

  /** True if the given user already has an active (non-terminal) export. */
  private hasActiveJobForUser(userId: string): boolean {
    let active = 0;
    for (const job of this.exportJobs.values()) {
      if (
        job.userId === userId &&
        (job.status === 'pending' || job.status === 'processing')
      ) {
        active++;
        if (active >= ExportService.MAX_ACTIVE_JOBS_PER_USER) {
          return true;
        }
      }
    }
    return false;
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

    // Per-user concurrency cap: each export burns I/O + CPU + RAM. Without
    // this gate a user could spam POST /api/export/... and exhaust shared
    // resources for everyone else. Caller (controller) translates this
    // error to HTTP 429 in PR follow-up.
    if (this.hasActiveJobForUser(userId)) {
      throw new Error(
        'Rate limit exceeded: you already have an export in progress. ' +
          'Wait for it to finish or cancel it before starting another.'
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

    // Process export directly
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
          type: true, // drives metric export dispatcher
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

      // Generate metrics (can run in parallel). Project.type drives the
      // metric format dispatch (spheroid vs spheroid_invasive vs sperm vs wound).
      if (options.metricsFormats?.length && project.images) {
        exportTasks.push(
          this.generateMetrics(
            project.images as ImageWithSegmentation[],
            exportDir,
            options.metricsFormats,
            project.title,
            project.type || 'spheroid',
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
      const zipPath = await createZipArchive(exportDir, project.title);

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
        // Polygon coordinates come from the ML service in PIL's original-image
        // space, recorded on Segmentation.imageWidth/Height. Prefer those over
        // Image.width/height (Sharp upload metadata, nullable for BMP).
        const imageDataArray = images.map(image => ({
          id: image.id,
          filename: image.name,
          width: image.segmentation?.imageWidth || image.width || 0,
          height: image.segmentation?.imageHeight || image.height || 0,
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
        await mapWithConcurrency(
          images,
          YOLO_WRITE_CONCURRENCY,
          async image => {
            if (!image || !image.segmentation) {return;}

            // YOLO normalizes every coordinate by width/height → 0 would
            // produce NaN/Infinity in the output file. Resolve dimensions
            // with the same fallback chain used by COCO/JSON: ML-PIL dims
            // first, then Sharp upload metadata, then polygon extents.
            let parsedPolygons: ExportPolygon[] = [];
            try {
              const parsed = JSON.parse(image.segmentation.polygons);
              if (Array.isArray(parsed)) {parsedPolygons = parsed;}
            } catch {
              // convertToYOLO will re-parse and report the error with context
            }
            const { width: yoloWidth, height: yoloHeight } =
              resolveImageDimensions(
                {
                  id: image.id,
                  filename: image.name,
                  width: image.segmentation.imageWidth || image.width || 0,
                  height: image.segmentation.imageHeight || image.height || 0,
                },
                parsedPolygons,
                'YOLO'
              );

            if (yoloWidth <= 0 || yoloHeight <= 0) {
              logger.error(
                `YOLO export skipped for image ${image.name} (${image.id}): no usable dimensions`,
                new Error('No usable image dimensions'),
                'ExportService',
                { jobId, imageId: image.id }
              );
              return;
            }

            const yoloResult = await this.formatConverter.convertToYOLO(
              image.segmentation.polygons,
              yoloWidth,
              yoloHeight
            );
            const imageNameWithoutExt = path.parse(image.name).name;
            await fs.writeFile(
              path.join(formatDir, `${imageNameWithoutExt}.txt`),
              yoloResult.content
            );
            if (yoloResult.warnings.length > 0) {
              logger.warn(
                `YOLO export for ${image.name} produced ${yoloResult.warnings.length} warning(s)`,
                'ExportService',
                { jobId, imageId: image.id, warnings: yoloResult.warnings }
              );
            }
          },
          {
            shouldAbort: () => !!jobId && this.isJobCancelled(jobId),
            onProgress,
            abortMessage: 'Export cancelled by user',
          }
        );
      } else if (format === 'json') {
        const imageDataArray = images.map(image => ({
          id: image.id,
          filename: image.name,
          width: image.segmentation?.imageWidth || image.width || 0,
          height: image.segmentation?.imageHeight || image.height || 0,
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
    projectType: string,
    options?: ExportOptions,
    jobId?: string
  ): Promise<void> {
    // Check if job was cancelled before starting metrics calculation
    if (jobId && this.isJobCancelled(jobId)) {
      throw new Error('Export cancelled by user');
    }

    const metricsDir = path.join(exportDir, 'metrics');

    // Backfill missing image dimensions from disk before metrics calculation.
    // Older uploads were written without populating width/height in DB; the
    // DI metric needs real dimensions to rasterise the polygon. We read
    // metadata via sharp and persist back to the DB so subsequent exports
    // and any UI surface get the correct values.
    const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
    const dimsCache = new Map<string, { width: number; height: number }>();

    /** Read width/height from a BMP file via header parsing.
     * Sharp/libvips lacks BMP support in the production image, so for the
     * microscopy upload format (mostly .bmp) we parse the DIB header
     * directly: width @ offset 18, height @ offset 22 (4-byte LE int32;
     * negative height = top-down storage, take abs).
     */
    const readBmpDims = async (
      filePath: string
    ): Promise<{ width: number; height: number } | null> => {
      const fh = await fs.open(filePath, 'r');
      try {
        const buf = Buffer.alloc(26);
        await fh.read(buf, 0, 26, 0);
        if (buf[0] !== 0x42 || buf[1] !== 0x4d) return null;
        const width = buf.readInt32LE(18);
        const height = Math.abs(buf.readInt32LE(22));
        if (width <= 0 || height <= 0) return null;
        return { width, height };
      } finally {
        await fh.close();
      }
    };

    for (const image of images) {
      if ((image.width && image.height) || !image.originalPath) continue;

      // Step 1: read dimensions from disk. Try BMP header first (microscopy
      // format, sharp doesn't support it in this build); fall back to sharp
      // for PNG/JPEG/TIFF.
      const filePath = path.join(uploadDir, image.originalPath);
      const ext = path.extname(filePath).toLowerCase();
      let meta: { width?: number; height?: number };
      try {
        if (ext === '.bmp') {
          const bmp = await readBmpDims(filePath);
          if (!bmp) continue;
          meta = bmp;
        } else {
          meta = await sharp(filePath).metadata();
        }
      } catch (err) {
        logger.warn(
          `Failed to READ dimensions for ${image.id} from disk: ${err instanceof Error ? err.message : String(err)}`,
          'ExportService',
          { jobId, imageId: image.id, path: image.originalPath }
        );
        continue;
      }
      if (!meta.width || !meta.height) continue;

      // Cache wins over DB so metrics calc can proceed even if persistence fails.
      dimsCache.set(image.id, { width: meta.width, height: meta.height });

      // Step 2: persist back to the DB. Failure here is a real DB problem
      // (connection lost, constraint violation) — log ERROR, not WARN.
      try {
        await prisma.image.update({
          where: { id: image.id },
          data: { width: meta.width, height: meta.height },
        });
        logger.info(
          `Backfilled dims for image ${image.id}: ${meta.width}x${meta.height}`,
          'ExportService',
          { jobId, imageId: image.id }
        );
      } catch (err) {
        logger.error(
          `Failed to PERSIST backfilled dimensions for ${image.id}; metrics will use cached values`,
          err instanceof Error ? err : new Error(String(err)),
          'ExportService',
          { jobId, imageId: image.id }
        );
      }
    }

    // Convert images to the format expected by metrics calculator
    const metricsImages: MetricsImageInput[] = images.map(image => {
      const cached = dimsCache.get(image.id);
      return {
        id: image.id,
        name: image.name,
        width: image.width || cached?.width || undefined,
        height: image.height || cached?.height || undefined,
        segmentation: image.segmentation
          ? {
              polygons: image.segmentation.polygons,
              model: image.segmentation.model,
              threshold: image.segmentation.threshold,
              confidence: image.segmentation.confidence || undefined,
              processingTime: image.segmentation.processingTime || undefined,
            }
          : undefined,
      };
    });

    const allMetrics = await this.metricsCalculator.calculateAllMetrics(
      metricsImages,
      options?.pixelToMicrometerScale
    );

    // Per-image metrics (Disintegration Index). Failures here must not break
    // the rest of the export — DI is purely additive.
    let imageMetrics: ImageMetrics[] = [];
    try {
      imageMetrics = await this.metricsCalculator.calculateAllImageMetrics(
        metricsImages,
        options?.pixelToMicrometerScale
      );
    } catch (err) {
      logger.error(
        'Per-image DI metrics aggregation crashed; Excel will omit the DI columns',
        err instanceof Error ? err : new Error(String(err)),
        'ExportService',
        { jobId, imageCount: metricsImages.length }
      );
    }

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
        const excelPath = path.join(metricsDir, 'metrics.xlsx');
        // Project type drives which Excel layout we emit. Auto-detection
        // (sperm polylines / wound model) is kept as a fallback for legacy
        // projects that pre-date the explicit type field.
        if (projectType === 'sperm') {
          const exportedSperm = await this.metricsCalculator.exportSpermToExcel(
            metricsImages,
            excelPath,
            options?.pixelToMicrometerScale
          );
          if (!exportedSperm) {
            logger.warn(
              `Project flagged as sperm but no polyline data — falling back to standard polygon metrics`,
              'ExportService',
              { jobId }
            );
            // Fall back to per-polygon metrics (NOT the DI-shaped report).
            await this.metricsCalculator.exportPolygonMetricsToExcel(
              allMetrics,
              excelPath,
              options?.pixelToMicrometerScale
            );
          }
        } else if (projectType === 'spheroid_invasive') {
          // Disintegrated-spheroid analysis: simplified 4-metric report
          // (Total Spheroid Area, Core Area, Invasion Area, DI).
          await this.metricsCalculator.exportToExcel(
            allMetrics,
            excelPath,
            options?.pixelToMicrometerScale,
            imageMetrics
          );
        } else {
          // 'spheroid' (standard) and 'wound': emit the comprehensive
          // per-polygon metrics report (Polygon Metrics + Summary sheets).
          await this.metricsCalculator.exportPolygonMetricsToExcel(
            allMetrics,
            excelPath,
            options?.pixelToMicrometerScale
          );
        }

        // Wound time-series: no-op for non-wound projects. Failures are
        // reported per phase so the UI can distinguish chart-render issues
        // from filesystem issues from xlsx corruption.
        const tsWarnings = await this.maybeAppendWoundTimeSeries(
          images,
          excelPath,
          exportDir,
          jobId
        );
        if (tsWarnings.length > 0 && jobId) {
          const job = this.exportJobs.get(jobId);
          if (job) {
            job.warnings = [...(job.warnings ?? []), ...tsWarnings];
          }
        }
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
    const readme = generateReadme(project, options);
    await fs.writeFile(path.join(docDir, 'README.md'), readme);

    // Generate annotation format guides
    await generateAnnotationGuides(exportDir, options);

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
    const metricsGuide = generateMetricsGuide(options);
    await fs.writeFile(path.join(docDir, 'metrics_guide.md'), metricsGuide);
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
      const message = getProgressMessage(progress, stage, stageProgress);

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
  // Cleanup method for graceful shutdown
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Export job cleanup interval stopped', 'ExportService');
    }
  }

  /**
   * If the project contains wound-model segmentations, open the metrics
   * workbook and append a ``WoundTimeSeries`` sheet with wound-area % per
   * frame and an embedded line chart. Additionally writes the chart PNG
   * as a standalone file at ``<exportDir>/wound_healing/wound_area_chart.png``
   * so users don't have to extract it out of Excel. No-op for spheroid/
   * sperm projects.
   *
   * Returns an array of warnings so the caller can attach all of them to
   * the export job; empty array on full success or non-wound project.
   * Each phase (xlsx-append, xlsx-write, chart-render, png-write) surfaces
   * its own distinct warning so the user can tell which part failed —
   * previously one failure was reported as "the whole time-series broke",
   * which was misleading when e.g. only the standalone PNG file failed.
   */
  private async maybeAppendWoundTimeSeries(
    images: ImageWithSegmentation[],
    excelPath: string,
    exportDir: string,
    jobId?: string
  ): Promise<string[]> {
    const hasWound = images.some(img => img.segmentation?.model === 'wound');
    if (!hasWound) {
      return [];
    }

    const warnings: string[] = [];

    // Phase 1: load export deps + open the just-written metrics workbook.
    // exceljs is a CJS module with TypeScript interop — ``.default`` works at
    // runtime via esModuleInterop but the namespace type doesn't advertise
    // it, hence the cast.
    type ExcelJsDefault = typeof import('exceljs');
    let ExcelJS: ExcelJsDefault;
    let appendWoundTimeSeriesSheet: typeof import('./export/woundTimeSeries').appendWoundTimeSeriesSheet;
    let writeStandaloneWoundChart: typeof import('./export/woundTimeSeries').writeStandaloneWoundChart;
    try {
      const excelMod = (await import('exceljs')) as unknown as {
        default: ExcelJsDefault;
      };
      ExcelJS = excelMod.default;
      ({ appendWoundTimeSeriesSheet, writeStandaloneWoundChart } = await import(
        './export/woundTimeSeries'
      ));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        'Failed to load wound TimeSeries dependencies',
        err instanceof Error ? err : undefined,
        'ExportService',
        { error: message, jobId }
      );
      return [
        `Wound time-series skipped — export dependency load failed: ${message}`,
      ];
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.readFile(excelPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        'Failed to open metrics.xlsx for wound TimeSeries append',
        err instanceof Error ? err : undefined,
        'ExportService',
        { error: message, jobId, excelPath }
      );
      return [
        `Wound time-series sheet could not be added — metrics.xlsx unreadable: ${message}`,
      ];
    }

    // Phase 2: compute + write the TimeSeries sheet. Also captures chart
    // render failures as a non-fatal ``chartError`` on the returned shape.
    const { count, chartPng, chartError } = await appendWoundTimeSeriesSheet(
      workbook,
      images
    );

    if (count === 0) {
      return [];
    }

    if (chartError) {
      warnings.push(
        `Wound area chart could not be rendered (TimeSeries sheet still written): ${chartError}`
      );
    }

    try {
      await workbook.xlsx.writeFile(excelPath);
      logger.info(
        `Wound TimeSeries appended: ${count} frames`,
        'ExportService',
        { jobId, hasChart: chartPng !== null }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        'Failed to save metrics.xlsx after wound TimeSeries append',
        err instanceof Error ? err : undefined,
        'ExportService',
        { error: message, jobId, excelPath }
      );
      return [
        ...warnings,
        `Wound time-series sheet could not be saved: ${message}`,
      ];
    }

    // Phase 3: standalone PNG copy for users who don't want to extract
    // the chart out of Excel. Independent of the sheet above — this can
    // fail without invalidating the xlsx.
    if (chartPng) {
      try {
        const chartPath = await writeStandaloneWoundChart(exportDir, chartPng);
        logger.info(`Wound area chart saved to ${chartPath}`, 'ExportService', {
          jobId,
          frames: count,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          'Failed to save standalone wound chart PNG',
          err instanceof Error ? err : undefined,
          'ExportService',
          { error: message, jobId }
        );
        warnings.push(
          `Wound area chart PNG could not be saved (Excel copy is still available): ${message}`
        );
      }
    }

    return warnings;
  }
}
