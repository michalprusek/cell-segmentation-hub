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
type ProjectWithImages = Prisma.ProjectGetPayload<{
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
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
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

---

# Per-Image Metrics: Disintegration Analysis

**Applies to projects with \`type='spheroid_invasive'\` only.** Standard
\`spheroid\` and \`wound\` projects get the per-polygon metrics report
described above; \`sperm\` projects get the head/midpiece/tail morphology
sheet. This section documents the disintegrated-spheroid Excel layout,
which is one row per image with the four numeric metrics
**Total Spheroid Area**, **Core Area**, **Invasion Area** (all in ${areaUnit})
and **Disintegration Index** (dimensionless). The metrics target spheroid
disintegration analysis (Lim, Kang, Lee 2020 — Sci. Rep. PMC6971071) but
apply equally to compact (t=0) and rozprsknuté (t>0) spheroids.

## Pipeline Overview

\`\`\`
ASPP segmentation  →  polygons[]  →  core detection (Otsu + 2-of-3 voting)
                                       ↓
                              partClass="core" polygon attached
                                       ↓
       ┌──────────────┬─────────────────┬──────────────────┐
       ↓              ↓                 ↓                  ↓
 Total Spheroid    Core Area     Invasion Area    Disintegration
   Area (Σ ext.    (largest       (Total − Core,    Index = tanh(W₁)
   non-core)        core CC)       clamped ≥ 0)     where W₁ compares
                                                    the empirical CDF of
                                                    distances of every
                                                    mask pixel against
                                                    every core pixel,
                                                    normalised by R_core
\`\`\`

## Core Detection (ASPP-only)

Performed in the Python ML service inside \`PostprocessingService.detect_core_polygons\`
(file \`backend/segmentation/services/postprocessing.py\`). Pipeline:

1. **Pick parent**: the **largest** external polygon detected by ASPP (\`A_all\`)
   that exceeds \`CORE_MIN_PARENT_AREA = 1000 px²\`. Smaller externals are
   noise/debris and don't get a core.

2. **Rasterise** the parent polygon into a binary mask matching the original
   image dimensions (\`cv2.fillPoly\` on a uint8 zero canvas).

3. **Local Otsu** on the grayscale intensities **inside the mask only**:
   \`thr = threshold_otsu(gray[mask>0])\`. The histogram restriction is essential
   — global Otsu sits between background and cells, which is the duality of
   the segmentation itself and yields no information about core vs. corona.

4. **2-of-3 compactness gate**. The spheroid is "compact" (= core covers the
   whole parent) when **at least two** of these indicators agree:
   - **mean_diff** < 45 grayscale levels: difference of \`mean(below_thr)\` and
     \`mean(above_thr)\` inside the mask. Small ⇒ unimodal interior.
   - **core_frac** > 0.75: fraction of mask pixels below Otsu. High ⇒ most of
     the spheroid is dense.
   - **solidity** > 0.85: \`area / convex_hull_area\` of the parent polygon.
     High ⇒ round, no invasion projections.

   Calibrated on user 12bprusek's *time_0h* (compact) vs *time_48h* (invasive)
   projects, April 2026. Cohen's *d* = 3.18 on \`mean_diff\`. Class constants
   are tunable in \`PostprocessingService\`.

5. **Compact path** (votes ≥ 2): return the **whole parent polygon** as the
   core. \`Core Area ≈ Total Spheroid Area\`.

6. **Bimodal path** (votes < 2): build \`core_raw = (gray ≤ thr) & mask\`, label
   connected components, return the **single largest CC** as the core polygon.
   The contour is extracted via \`cv2.findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)\`.

7. The returned core polygon carries \`partClass="core"\` and \`parent_id\` linking
   it to the parent spheroid.

## Total Spheroid Area (${areaUnit})

\`\`\`
TotalSpheroidArea = Σ area(external polygon)   for partClass ≠ "core"
\`\`\`

- **Sum of geometric areas** of every external polygon **excluding** the core.
  The core sits *inside* the parent spheroid; including it would double-count
  the same physical pixels.
- **Algorithm**: Shoelace (Gauss's area) formula on polygon vertices —
  \`A = ½ |Σᵢ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)|\`. Vertices wrap (i+1 mod n).
- **Unit conversion**: when a μm/px scale is configured at the project level,
  \`A_μm² = A_px² × scale²\`. Otherwise pixel units are reported.
- **Multi-spheroid images**: smaller spheroids (those without a detected core)
  are still summed in. So \`TotalSpheroidArea\` represents *all cell-covered
  area* in the image, not just the largest.

## Core Area (${areaUnit})

\`\`\`
CoreArea = area(polygon with partClass="core")
\`\`\`

- Geometric area of the **single core polygon** (largest connected component
  below Otsu threshold; or the whole parent in the compact case).
- Same Shoelace formula and same scale conversion as Total Spheroid Area.
- For a compact spheroid: \`CoreArea ≈ TotalSpheroidArea\` (whole parent = core).
- For a fully invasive spheroid: \`CoreArea\` is the dense central agglomerate
  while the rest of \`TotalSpheroidArea\` is the diffuse invasion zone.
- **Reference**: Lim 2020 \`A_core\` (paper notation) corresponds directly.

## Invasion Area (${areaUnit})

\`\`\`
InvasionArea = max(0, TotalSpheroidArea − CoreArea)
\`\`\`

- Cell-covered area **outside** the dense core. Direct numeric proxy for the
  invasion zone size: how much of the cell mass has migrated beyond the dense
  central agglomerate.
- For a **compact** (t=0) spheroid: InvasionArea ≈ 0.
- For a **strongly invasive** spheroid: InvasionArea ≈ 0.5–0.8 × TotalSpheroidArea.
- Same Shoelace areas + same scale conversion. Clamped at zero to handle
  edge cases where Core slightly exceeds Total due to numerical artefacts.
- Corresponds to Lim 2020 \`(A_all − A_core)\` numerator of the invasion index B.

## Disintegration Index (DI)

The DI is a scalar in \`[0, 1)\` that quantifies *how much spheroid mass has
escaped beyond a uniform-disk reference of equivalent core area*. Reported in
the Excel column **Disintegration Index** (4 decimal places, dimensionless).

Algorithm (implemented in
\`backend/segmentation/api/metrics_endpoint.py\` — POST \`/api/disintegration-index\`):

1. **Rasterise the union of every external polygon** (the whole ASPP segmentation
   mask, excluding cores) into a single binary canvas via repeated
   \`cv2.fillPoly\`. Collect the \`(x, y)\` of all \`N\` white pixels.

2. **Centroid anchor**:
   - If a core polygon is present, \`(cx, cy) = (mean(xᵢ_core), mean(yᵢ_core))\` —
     the centroid of the **core pixels**. The metric thus measures how far
     mass spread from the dense core, not from the smeared mass centroid
     that drifts toward the invasion zone (improvement A — biologically the
     core is the natural reference point for "how far did things go").
   - Otherwise (no core) fallback to mask centroid
     \`(cx, cy) = (mean(xᵢ), mean(yᵢ))\`.

   Distances \`dᵢ = √((xᵢ − cx)² + (yᵢ − cy)²)\` are computed for both
   sets (\`d_mask\` over all mask pixels and \`d_core\` over core pixels)
   relative to this single anchor.

3. **Reference radius**:
   - If a core polygon is present, \`R_ref = √(N_core / π)\` where \`N_core\` is
     the rasterised pixel count of the core.
   - Otherwise fallback to \`R_eff = √(N / π)\`.

4. **Reference distribution — empirical core CDF**. When a core polygon is
   present, the reference is the **empirical** distribution of distances
   \`d_core\` for every pixel inside the core, anchored on the **same
   centroid as d_mask** (the core centroid from step 2). This means the
   reference reflects the **actual radial profile of the dense core**,
   not an idealised disk. The fallback (no core) uses the analytical
   equivalent-disk CDF \`F_ref(d̃) = d̃²\` for \`d̃ ∈ [0, 1]\`.

5. **1-Wasserstein distance**:
   - **Core path**: \`W₁_px = wasserstein_distance(d_mask, d_core)\` via
     \`scipy.stats\`, computed exactly between the two empirical 1D
     distributions. Scale-normalised: \`W₁ = W₁_px / R_core\`, where
     \`R_core = √(N_core / π)\`.
   - **r_eff fallback**: bin-free quantile formula
     \`W₁ ≈ (1/N) · Σᵢ |d̃₍ᵢ₎ − √((i − 0.5) / N)|\` where d̃₍ᵢ₎ are sorted
     normalised distances \`d_mask / R_eff\`.

6. **Saturation**: \`DI = tanh(W₁)\`. Maps \`W₁ ∈ [0, ∞) → [0, 1)\`.

**Properties**: dimensionless, scale-invariant (all distances normalised by
\`R_ref\`), rotation-invariant, translation-invariant (centroid-relative).

**Calibrated thresholds** (user 12bprusek, April 2026):
- *time_0h* (compact): DI median ≈ 0.001
- *time_48h* (rozprsknuté): DI median ≈ 0.48
- 320× separation between groups

## Edge Cases & Caveats

- **No ASPP segmentation** (HRNet, CBAM-ResUNet, plain U-Net, sperm, wound):
  no core polygon is generated. \`Core Area = 0\`, \`Total Spheroid Area\` still
  reports the sum of all external polygons. Compatibility-safe for any model.
- **Image with no polygons or no externals**: both metrics report \`0\`.
- **Cropped spheroid touching image edge**: the centroid is biased, the
  rasterised area is truncated. Detected via bbox of mask = canvas edge —
  not auto-flagged in the export but visible by inspection.
- **Multiple spheroids, only the largest gets a core**: smaller spheroids
  contribute to \`Total Spheroid Area\` only. By design — paper Lim 2020
  treats each spheroid as its own experimental unit.
- **Hollow / necrotic core**: the central pixels may be lighter than the
  surrounding ring, which inflates \`mean_diff\` and the algorithm may pick a
  ring-shaped CC as the "core". Mathematically correct given the intensity
  histogram, biologically ambiguous; manual inspection recommended for
  spheroids known to have necrotic centres.

## Source Files

- **Core detection**: \`backend/segmentation/services/postprocessing.py\`
- **DI computation**: \`backend/segmentation/api/metrics_endpoint.py\`
- **Per-image area orchestration**: \`backend/src/services/metrics/metricsCalculator.ts\`
  (\`calculateAllImageMetrics\`)
- **Excel writer**: same file (\`exportToExcel\` — emits Image Name, Image ID,
  Total Spheroid Area, Core Area, Invasion Area, Disintegration Index)
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
