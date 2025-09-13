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
      include: {
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
}

export class ExportService {
  private static instance: ExportService;
  private exportQueue: unknown; // Queue - Bull queue type disabled
  private wsService: WebSocketService | null = null;
  private visualizationGenerator: VisualizationGenerator;
  private metricsCalculator: MetricsCalculator;
  private formatConverter: FormatConverter;
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

  private sendToUser(userId: string, event: string, data: Record<string, unknown>): void {
    if (this.wsService) {
      try {
        // Use the WebSocketService emitToUser method for all export events
        this.wsService.emitToUser(userId, event, data);
        
        if (event === 'export:started') {
          logger.debug('Export started notification sent', 'ExportService', { userId, jobId: data.jobId });
        } else if (event === 'export:progress') {
          logger.debug('Export progress update sent', 'ExportService', { userId, progress: data.progress });
        } else if (event === 'export:completed') {
          logger.info('Export completed notification sent', 'ExportService', { userId, jobId: data.jobId });
        } else if (event === 'export:failed') {
          logger.error('Export failed notification sent', new Error(String(data.error)), 'ExportService', { userId, jobId: data.jobId });
        }
      } catch (error) {
        logger.error('Failed to send WebSocket message', error instanceof Error ? error : new Error(String(error)), 'ExportService', { userId, event, data });
      }
    } else {
      logger.warn('WebSocketService not available for export notification', 'ExportService', { userId, event });
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
    options: ExportOptions
  ): Promise<string> {
    // Check if user has access to this project (owner or shared)
    const accessCheck = await SharingService.hasProjectAccess(projectId, userId);
    if (!accessCheck.hasAccess) {
      throw new Error('Access denied: You do not have permission to export this project');
    }

    const jobId = uuidv4();

    // Create job record
    const job: ExportJob = {
      id: jobId,
      projectId,
      userId,
      status: 'pending',
      progress: 0,
      createdAt: new Date(),
      options,
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
      logger.error('Export job failed with unhandled error', err instanceof Error ? err : new Error(String(err)), 'ExportService', {
        jobId,
        projectId,
        userId,
        options
      });
      
      // Mark job as failed if it exists
      const job = this.exportJobs.get(jobId);
      if (job) {
        job.status = 'failed';
        job.message = err instanceof Error ? err.message : 'Unknown error occurred';
        job.completedAt = new Date();
        
        // Notify user of failure
        this.sendToUser(userId, 'export:failed', {
          jobId,
          error: job.message
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
    if (!job) {return;}

    try {
      job.status = 'processing';
      this.updateJobProgress(jobId, 0);

      // Check if user has access to this project (owner or shared)
      const accessCheck = await SharingService.hasProjectAccess(projectId, userId);
      if (!accessCheck.hasAccess) {
        throw new Error('Access denied: You do not have permission to export this project');
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
              width: true,
              height: true,
              segmentation: {
                select: {
                  id: true,
                  polygons: true,
                  model: true,
                  threshold: true,
                  confidence: true,
                  processingTime: true
                }
              }
            },
          },
        },
      });

      if (!project) {
        throw new Error('Project not found');
      }

      // Create temporary export directory
      const exportDir = path.join(
        process.env.EXPORT_DIR || './exports',
        jobId
      );
      await fs.mkdir(exportDir, { recursive: true });

      // Create folder structure
      await this.createFolderStructure(exportDir);
      this.updateJobProgress(jobId, 10);

      // Parallel export processing - run independent tasks concurrently
      const exportTasks: Promise<void>[] = [];
      let progressStep = 0;
      const totalSteps = [
        options.includeOriginalImages,
        options.includeVisualizations,
        options.annotationFormats?.length,
        options.metricsFormats?.length,
        options.includeDocumentation
      ].filter(Boolean).length;
      
      const progressIncrement = totalSteps > 0 ? 80 / totalSteps : 0;
      
      // Copy original images (can run in parallel)
      if (options.includeOriginalImages && project.images) {
        exportTasks.push(
          this.copyOriginalImages(project.images, exportDir).then(() => {
            progressStep++;
            this.updateJobProgress(jobId, 10 + progressStep * progressIncrement);
          })
        );
      }

      // Generate visualizations (can run in parallel)
      if (options.includeVisualizations && project.images) {
        exportTasks.push(
          this.generateVisualizations(
            project.images,
            exportDir,
            options.visualizationOptions
          ).then(() => {
            progressStep++;
            this.updateJobProgress(jobId, 10 + progressStep * progressIncrement);
          })
        );
      }

      // Generate annotations (can run in parallel)
      if (options.annotationFormats?.length && project.images) {
        exportTasks.push(
          this.generateAnnotations(
            project.images,
            exportDir,
            options.annotationFormats
          ).then(() => {
            progressStep++;
            this.updateJobProgress(jobId, 10 + progressStep * progressIncrement);
          })
        );
      }

      // Generate metrics (can run in parallel)
      if (options.metricsFormats?.length && project.images) {
        exportTasks.push(
          this.generateMetrics(
            project.images,
            exportDir,
            options.metricsFormats,
            project.title,
            options
          ).then(() => {
            progressStep++;
            this.updateJobProgress(jobId, 10 + progressStep * progressIncrement);
          })
        );
      }

      // Generate documentation (can run in parallel)
      if (options.includeDocumentation) {
        exportTasks.push(
          this.generateDocumentation(project, exportDir, options).then(() => {
            progressStep++;
            this.updateJobProgress(jobId, 10 + progressStep * progressIncrement);
          })
        );
      }
      
      // Wait for all export tasks to complete in parallel
      logger.info(`Running ${exportTasks.length} export tasks in parallel`, undefined, 'ExportService');
      await Promise.all(exportTasks);
      this.updateJobProgress(jobId, 90);

      // Create ZIP archive (no compression)
      const zipPath = await this.createZipArchive(
        exportDir,
        project.title
      );
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
      logger.error(`Export job ${jobId} failed:`, error instanceof Error ? error : new Error(String(error)));
      job.status = 'failed';
      job.message = error instanceof Error ? error.message : 'Unknown error';
      
      // Notify failure via WebSocket
      this.sendToUser(userId, 'export:failed', { 
        jobId, 
        error: error instanceof Error ? error.message : 'Unknown error'
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

  private async copyOriginalImages(images: ImageWithSegmentation[], exportDir: string): Promise<void> {
    const imagesDir = path.join(exportDir, 'images');
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    
    // Resolve upload directory to prevent path traversal
    const resolvedUploadDir = path.resolve(uploadDir);
    
    logger.info(`Starting parallel copy of ${images.length} original images`, undefined, 'ExportService');
    let copiedCount = 0;
    let skippedCount = 0;
    
    // Use higher concurrency for file copying (I/O bound operation)
    const concurrency = Math.min(16, Math.max(8, Math.floor(images.length / 5)));
    
    const copyImage = async (image: ImageWithSegmentation): Promise<'copied' | 'skipped'> => {
      if (!image || !image.originalPath) {
        return 'skipped';
      }
      
      const candidateSourcePath = path.join(uploadDir, image.originalPath);
      const resolvedSourcePath = path.resolve(candidateSourcePath);
      
      // Security check: ensure resolved path starts with upload directory
      if (!resolvedSourcePath.startsWith(resolvedUploadDir)) {
        logger.warn(`Path traversal attempt detected for image ${image.id}`, 'ExportService', {
          imageId: image.id,
          imagePath: image.originalPath,
          resolvedPath: resolvedSourcePath,
          uploadDir: resolvedUploadDir
        });
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
          sourcePath: resolvedSourcePath
        });
        return 'skipped';
      }
    };
    
    // Process images in parallel batches
    await batchProcessor.processBatch(
      images,
      copyImage,
      {
        batchSize: Math.ceil(images.length / 2), // Process in 2 batches for faster copying
        concurrency: concurrency,
        onBatchComplete: (batchIndex, batchResults) => {
          const batchCopied = batchResults.filter(r => r === 'copied').length;
          const batchSkipped = batchResults.filter(r => r === 'skipped').length;
          copiedCount += batchCopied;
          skippedCount += batchSkipped;
          logger.info(`Copy batch ${batchIndex + 1} completed: ${batchCopied} copied, ${batchSkipped} skipped`, undefined, 'ExportService');
        },
        onItemError: (item, error) => {
          logger.error('Image copy failed:', error instanceof Error ? error : new Error(String(error)), 'ExportService');
          skippedCount++;
        }
      }
    );
    
    logger.info(`Parallel image copy completed: ${copiedCount} copied, ${skippedCount} skipped out of ${images.length} total`, undefined, 'ExportService');
  }

  private async generateVisualizations(
    images: ImageWithSegmentation[],
    exportDir: string,
    options?: VisualizationOptions
  ): Promise<void> {
    const vizDir = path.join(exportDir, 'visualizations');
    
    logger.info(`Starting parallel visualization generation for ${images.length} images`, undefined, 'ExportService');
    let processedCount = 0;
    let skippedCount = 0;
    
    // Use optimal concurrency based on system resources
    // Typically 4-8 concurrent operations work well for I/O bound tasks
    const concurrency = Math.min(8, Math.max(4, Math.floor(images.length / 10)));
    
    const processImage = async (image: ImageWithSegmentation): Promise<'processed' | 'skipped'> => {
      if (!image) {
        logger.warn(`Image is undefined`, 'ExportService');
        return 'skipped';
      }
      
      if (!image.segmentation) {
        logger.warn(`Image ${image.name} (${image.id}) has no segmentation results`, 'ExportService');
        return 'skipped';
      }
      
      const result = image.segmentation;
      if (!result.polygons) {
        logger.warn(`Image ${image.name} (${image.id}) has segmentation but no polygons`, 'ExportService');
        return 'skipped';
      }
      
      const imageNameWithoutExt = path.parse(image.name).name;
      const vizPath = path.join(vizDir, `${imageNameWithoutExt}_viz.png`);
      
      let polygons;
      try {
        polygons = JSON.parse(result.polygons);
      } catch (error) {
        logger.error('Failed to parse polygons for visualization:', error instanceof Error ? error : new Error(String(error)), 'ExportService', { 
          imageId: image.id,
          imageName: image.name
        });
        return 'skipped';
      }
      
      try {
        // Validate originalPath before joining
        if (typeof image.originalPath !== 'string' || !image.originalPath) {
          logger.error('Invalid or empty originalPath for image', new Error(`Invalid originalPath for image ${image.id}: ${image.originalPath}`));
          return 'skipped';
        }
        
        // Construct full path to the image
        const uploadDir = process.env.UPLOAD_DIR || './uploads';
        const fullImagePath = path.resolve(path.join(uploadDir, image.originalPath));
        
        const result = await this.visualizationGenerator.generateVisualization(
          fullImagePath,
          polygons,
          vizPath,
          options
        );
        
        if (result === 'success') {
          return 'processed';
        } else {
          logger.warn(`Visualization generation returned ${result} for image ${image.name}`, 'ExportService');
          return 'skipped';
        }
      } catch (error) {
        logger.error('Visualization generation failed:', error instanceof Error ? error : new Error(String(error)), 'ExportService', {
          imageId: image.id,
          imagePath: image.originalPath
        });
        return 'skipped';
      }
    };
    
    // Process images in parallel batches
    const _results = await batchProcessor.processBatch(
      images,
      processImage,
      {
        batchSize: Math.ceil(images.length / 4), // Process in 4 batches
        concurrency: concurrency,
        onBatchComplete: (batchIndex, batchResults) => {
          const batchProcessed = batchResults.filter(r => r === 'processed').length;
          const batchSkipped = batchResults.filter(r => r === 'skipped').length;
          processedCount += batchProcessed;
          skippedCount += batchSkipped;
          logger.info(`Batch ${batchIndex + 1} completed: ${batchProcessed} processed, ${batchSkipped} skipped`, undefined, 'ExportService');
        },
        onItemError: (item, error) => {
          logger.error('Image processing failed:', error instanceof Error ? error : new Error(String(error)), 'ExportService');
          skippedCount++;
        }
      }
    );
    
    logger.info(`Parallel visualization generation completed: ${processedCount} processed, ${skippedCount} skipped out of ${images.length} total`, undefined, 'ExportService');
  }

  private async generateAnnotations(
    images: ImageWithSegmentation[],
    exportDir: string,
    formats: string[]
  ): Promise<void> {
    for (const format of formats) {
      const formatDir = path.join(exportDir, 'annotations', format);
      
      if (format === 'coco') {
        // Convert ImageWithSegmentation[] to ImageData[]
        const imageDataArray = images.map((image) => ({
          id: image.id,
          filename: image.name,
          width: image.width || 0,
          height: image.height || 0,
          segmentationResults: image.segmentation ? [{
            polygons: image.segmentation.polygons,
            cellCount: 0,
            timestamp: new Date()
          }] : []
        }));
        
        const cocoData = await this.formatConverter.convertToCOCO(imageDataArray);
        await fs.writeFile(
          path.join(formatDir, 'annotations.json'),
          JSON.stringify(cocoData, null, 2)
        );
      } else if (format === 'yolo') {
        for (let i = 0; i < images.length; i++) {
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
        }
      } else if (format === 'json') {
        // Convert ImageWithSegmentation[] to ImageData[]
        const imageDataArray = images.map((image) => ({
          id: image.id,
          filename: image.name,
          width: image.width || 0,
          height: image.height || 0,
          segmentationResults: image.segmentation ? [{
            polygons: image.segmentation.polygons,
            cellCount: 0,
            timestamp: new Date()
          }] : []
        }));
        
        const jsonData = await this.formatConverter.convertToJSON(imageDataArray);
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
    options?: ExportOptions
  ): Promise<void> {
    const metricsDir = path.join(exportDir, 'metrics');
    // Convert images to the format expected by metrics calculator
    const metricsImages = images.map(image => ({
      id: image.id,
      name: image.name,
      width: image.width || undefined,
      height: image.height || undefined,
      segmentation: image.segmentation ? {
        polygons: image.segmentation.polygons,
        model: image.segmentation.model,
        threshold: image.segmentation.threshold,
        confidence: image.segmentation.confidence || undefined,
        processingTime: image.segmentation.processingTime || undefined
      } : undefined
    }));
    
    const allMetrics = await this.metricsCalculator.calculateAllMetrics(
      metricsImages as Parameters<typeof this.metricsCalculator.calculateAllMetrics>[0],
      options?.pixelToMicrometerScale
    );

    for (const format of formats) {
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

  private generateReadme(project: ProjectWithImages, options: ExportOptions): string {
    return `# Export - ${project.title}

## Export Information
- **Date**: ${new Date().toISOString()}
- **Total Images**: ${project.images?.length || 0}
- **Project ID**: ${project.id}
${options.pixelToMicrometerScale && options.pixelToMicrometerScale > 0 
  ? `- **Scale Conversion**: ${options.pixelToMicrometerScale} µm/pixel (measurements converted to micrometers)` 
  : '- **Units**: All measurements in pixels'}

## Export Contents

### Images
${options.includeOriginalImages ? '✅ Original images included' : '❌ Original images not included'}
${options.includeVisualizations ? '✅ Visualizations with numbered polygons included' : '❌ Visualizations not included'}

### Annotations
${options.annotationFormats?.map(f => `- ${f.toUpperCase()} format`).join('\n') || 'No annotations included'}

### Metrics
${options.metricsFormats?.map(f => `- ${f.toUpperCase()} format`).join('\n') || 'No metrics included'}

## Folder Structure
\`\`\`
.
├── images/               # Original images
├── visualizations/       # Images with numbered polygons
├── annotations/          # Annotation files in various formats
│   ├── coco/            # COCO format annotations
│   ├── yolo/            # YOLO format annotations
│   └── json/            # Custom JSON format
├── metrics/             # Calculated metrics
└── documentation/       # This folder
\`\`\`

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
    const isScaled = options?.pixelToMicrometerScale && options.pixelToMicrometerScale > 0;
    const areaUnit = isScaled ? 'µm²' : 'pixels²';
    const lengthUnit = isScaled ? 'µm' : 'pixels';
    const scaleInfo = isScaled 
      ? `\n## Scale Conversion\n\n- **Scale**: ${options.pixelToMicrometerScale} µm/pixel\n- **All linear measurements converted to micrometers**\n- **All area measurements converted to square micrometers**\n` 
      : '\n## Units\n\n- **All measurements are in pixel units**\n';

    return `# Metrics Guide
${scaleInfo}
## Calculated Metrics

### Area
- **Description**: Total area of the polygon in ${areaUnit}
- **Calculation**: Area of external polygon minus areas of all internal polygons (holes)
- **Units**: ${areaUnit}

### Perimeter
- **Description**: Total length of the polygon boundary
- **Units**: ${lengthUnit}

### Circularity
- **Description**: Measure of how circular the shape is
- **Formula**: 4π × Area / Perimeter²
- **Range**: 0 to 1 (1 = perfect circle)

### Equivalent Diameter
- **Description**: Diameter of a circle with the same area
- **Formula**: √(4 × Area / π)
- **Units**: ${lengthUnit}

### Feret Diameters
- **Maximum**: Longest distance between any two points on the boundary
- **Minimum**: Shortest distance between parallel tangents
- **Aspect Ratio**: Maximum / Minimum

### Compactness
- **Description**: Ratio of area to the area of minimum bounding circle
- **Range**: 0 to 1 (1 = perfect circle)

### Convexity
- **Description**: Ratio of convex hull perimeter to actual perimeter
- **Range**: 0 to 1 (1 = convex shape)

### Solidity
- **Description**: Ratio of area to convex hull area
- **Range**: 0 to 1 (1 = no concavities)

### Sphericity
- **Description**: Measure of how spherical the shape is
- **Formula**: π × √(4 × Area / π) / Perimeter
- **Range**: 0 to 1 (1 = perfect sphere projection)

## Important Notes
1. Metrics are evaluated only for external polygons
2. Internal polygon areas (holes) are automatically subtracted from their containing external polygons
3. Measurements are in pixel coordinates
4. For physical measurements, apply appropriate scale factor
5. Metrics are calculated using OpenCV algorithms for accuracy
`;
  }

  private async generateAnnotationGuides(exportDir: string, options: ExportOptions): Promise<void> {
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

  private async generateMainAnnotationGuide(annotationsDir: string, options: ExportOptions): Promise<void> {
    const exportedFormats = options.annotationFormats || [];
    const scaleInfo = options.pixelToMicrometerScale 
      ? `- **Scale**: ${options.pixelToMicrometerScale} µm/pixel (measurements in micrometers)`
      : '- **Units**: All measurements in pixels';

    const guide = `# Annotation Export Guide

This export contains cell segmentation annotations in multiple formats for easy integration with annotation tools and ML pipelines.

## Exported Formats

${exportedFormats.map(format => `- **${format.toUpperCase()}**: See \`${format}/\` directory for format-specific instructions`).join('\n')}

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
   - File: \`coco/annotations.json\`

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
${exportedFormats.map(format => `- \`${format}/README.md\``).join('\n')}
`;

    await fs.writeFile(path.join(annotationsDir, 'README.md'), guide);
  }

  private async createZipArchive(
    exportDir: string,
    projectName: string
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const zipName = `${projectName}_export_${timestamp}.zip`;
    const zipPath = path.join(process.env.EXPORT_DIR || './exports', zipName);

    const output = await fs.open(zipPath, 'w');
    const archive = archiver('zip', {
      zlib: { level: 6 }, // Balanced compression (6 is default, good balance of speed vs size)
      highWaterMark: 16 * 1024 * 1024, // 16MB buffer for better streaming performance
    });

    return new Promise((resolve, reject) => {
      let cleanupCalled = false;
      
      const cleanup = async (): Promise<void> => {
        if (cleanupCalled) {return;}
        cleanupCalled = true;
        
        try {
          // Destroy archive first
          if (archive.readable || archive.writable) {
            archive.destroy();
          }
        } catch (error) {
          logger.warn('Failed to destroy archive:', 'ExportService', { error: error instanceof Error ? error.message : String(error) });
        }
        
        try {
          // Close file handle
          await output.close();
        } catch (error) {
          logger.warn('Failed to close file handle:', 'ExportService', { error: error instanceof Error ? error.message : String(error) });
        }
        
        // Remove event listeners to prevent memory leaks
        writeStream.removeAllListeners();
        archive.removeAllListeners();
      };

      const writeStream = output.createWriteStream();
      
      // Add error handler for writeStream
      writeStream.on('error', (error) => {
        cleanup().finally(() => reject(error));
      });
      
      writeStream.on('close', () => {
        cleanup().finally(() => resolve(zipPath));
      });
      
      archive.on('error', (error) => {
        cleanup().finally(() => reject(error));
      });

      archive.pipe(writeStream);
      archive.directory(exportDir, false);
      
      // Wrap finalize in try/catch and handle its promise rejection
      try {
        archive.finalize().catch((error) => {
          cleanup().finally(() => reject(error));
        });
      } catch (error) {
        cleanup().finally(() => reject(error));
      }
    });
  }


  private updateJobProgress(jobId: string, progress: number): void {
    const job = this.exportJobs.get(jobId);
    if (job) {
      job.progress = progress;
      // Send progress update via WebSocket
      this.sendToUser(job.userId, 'export:progress', { jobId, progress });
    }
  }

  private setupJobCleanup(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldJobs();
    }, 60 * 60 * 1000);
    
    logger.info('Export job cleanup interval started', 'ExportService', {
      intervalMs: 60 * 60 * 1000,
      jobTtlMs: this.JOB_TTL_MS,
      maxJobs: this.MAX_JOBS
    });
  }

  private cleanupOldJobs(): void {
    const now = Date.now();
    const jobsToDelete: string[] = [];
    
    // Find jobs older than TTL or mark excess jobs for deletion
    const sortedJobs = Array.from(this.exportJobs.entries())
      .sort(([, a], [, b]) => b.createdAt.getTime() - a.createdAt.getTime());
    
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
      logger.info(`Cleaned up ${deletedCount} old export jobs`, 'ExportService', {
        deletedCount,
        remainingJobs: this.exportJobs.size,
        totalProcessed: sortedJobs.length
      });
    }
  }

  async getJobStatus(jobId: string, projectId: string, userId: string): Promise<ExportJob | null> {
    // Check if user has access to this project (owner or shared)
    const accessCheck = await SharingService.hasProjectAccess(projectId, userId);
    if (!accessCheck.hasAccess) {
      return null;
    }

    const job = this.exportJobs.get(jobId);
    if (job && job.projectId === projectId) {
      return job;
    }
    return null;
  }

  async getExportFilePath(jobId: string, projectId: string, userId: string): Promise<string | null> {
    // Check if user has access to this project (owner or shared)
    const accessCheck = await SharingService.hasProjectAccess(projectId, userId);
    if (!accessCheck.hasAccess) {
      return null;
    }

    const job = this.exportJobs.get(jobId);
    if (job && job.projectId === projectId && job.filePath) {
      return job.filePath;
    }
    return null;
  }

  async cancelJob(jobId: string, projectId: string, userId: string): Promise<void> {
    // Check if user has access to this project (owner or shared)
    const accessCheck = await SharingService.hasProjectAccess(projectId, userId);
    if (!accessCheck.hasAccess) {
      return; // Silently return if no access
    }

    const job = this.exportJobs.get(jobId);
    if (job && job.projectId === projectId) {
      job.status = 'cancelled';
      // Cancel the Bull queue job if bullJobId exists and queue is available
      if (job.bullJobId && this.exportQueue && typeof (this.exportQueue as { getJob: (id: string) => Promise<{ getState: () => Promise<string>; remove: () => Promise<void> } | null> }).getJob === 'function') {
        const queueJob = await (this.exportQueue as { getJob: (id: string) => Promise<{ getState: () => Promise<string>; remove: () => Promise<void> } | null> }).getJob(job.bullJobId);
        if (queueJob && ['waiting', 'delayed'].includes(await queueJob.getState())) {
          await queueJob.remove();
        }
      }
    }
  }

  async getExportHistory(projectId: string, userId: string): Promise<ExportJob[]> {
    // Check if user has access to this project (owner or shared)
    const accessCheck = await SharingService.hasProjectAccess(projectId, userId);
    if (!accessCheck.hasAccess) {
      return [];
    }

    const jobs = Array.from(this.exportJobs.values())
      .filter(job => job.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10); // Return last 10 exports
    
    return jobs;
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