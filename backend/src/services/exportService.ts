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
  ) {
    const job = this.exportJobs.get(jobId);
    if (!job) {return;}

    try {
      job.status = 'processing';
      this.updateJobProgress(jobId, 0);

      // Get project data
      const project = await prisma.project.findUnique({
        where: { id: projectId, userId },
        select: {
          id: true,
          title: true,
          images: {
            where: options.selectedImageIds
              ? { id: { in: options.selectedImageIds } }
              : undefined,
            include: {
              segmentation: true,
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

      // Process images
      if (options.includeOriginalImages && project.images) {
        await this.copyOriginalImages(project.images, exportDir);
        this.updateJobProgress(jobId, 20);
      }

      // Generate visualizations
      if (options.includeVisualizations && project.images) {
        await this.generateVisualizations(
          project.images,
          exportDir,
          options.visualizationOptions
        );
        this.updateJobProgress(jobId, 40);
      }

      // Generate annotations
      if (options.annotationFormats?.length && project.images) {
        await this.generateAnnotations(
          project.images,
          exportDir,
          options.annotationFormats
        );
        this.updateJobProgress(jobId, 60);
      }

      // Generate metrics
      if (options.metricsFormats?.length && project.images) {
        await this.generateMetrics(
          project.images,
          exportDir,
          options.metricsFormats,
          project.title
        );
        this.updateJobProgress(jobId, 80);
      }

      // Generate documentation
      if (options.includeDocumentation) {
        await this.generateDocumentation(project, exportDir, options);
        this.updateJobProgress(jobId, 90);
      }

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

  private async createFolderStructure(exportDir: string) {
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
    
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      if (image && image.originalPath) {
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
          continue;
        }
        
        const destPath = path.join(imagesDir, image.name);
        
        try {
          await fs.copyFile(resolvedSourcePath, destPath);
        } catch (error) {
          logger.warn(`Failed to copy image ${image.id}:`, 'ExportService', { 
            error: error instanceof Error ? error.message : String(error),
            imageId: image.id,
            sourcePath: resolvedSourcePath
          });
        }
      }
    }
  }

  private async generateVisualizations(
    images: ImageWithSegmentation[],
    exportDir: string,
    options?: VisualizationOptions
  ): Promise<void> {
    const vizDir = path.join(exportDir, 'visualizations');
    
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      if (image && image.segmentation) {
        const result = image.segmentation;
        if (result.polygons) {
          const imageNameWithoutExt = path.parse(image.name).name;
          const vizPath = path.join(
            vizDir,
            `${imageNameWithoutExt}_viz.png`
          );
          
          let polygons;
          try {
            polygons = JSON.parse(result.polygons);
          } catch (error) {
            logger.error('Failed to parse polygons for visualization:', error instanceof Error ? error : new Error(String(error)), 'ExportService', { 
              imageId: image.id
            });
            continue;
          }
          
          try {
            // Construct full path to the image
            const uploadDir = process.env.UPLOAD_DIR || './uploads';
            const fullImagePath = path.join(uploadDir, image.originalPath);
            
            await this.visualizationGenerator.generateVisualization(
              fullImagePath,
              polygons,
              vizPath,
              options
            );
          } catch (error) {
            logger.error('Visualization generation failed:', error instanceof Error ? error : new Error(String(error)), 'ExportService', {
              imageId: image.id,
              imagePath: image.originalPath
            });
            // Continue with other images even if visualization fails
          }
        }
      }
    }
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
    projectName: string
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
    
    const allMetrics = await this.metricsCalculator.calculateAllMetrics(metricsImages as Parameters<typeof this.metricsCalculator.calculateAllMetrics>[0]);

    for (const format of formats) {
      if (format === 'excel') {
        await this.metricsCalculator.exportToExcel(
          allMetrics,
          path.join(metricsDir, 'metrics.xlsx')
        );
      } else if (format === 'csv') {
        await this.metricsCalculator.exportToCSV(
          allMetrics,
          path.join(metricsDir, 'metrics.csv')
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
    const metricsGuide = this.generateMetricsGuide();
    await fs.writeFile(path.join(docDir, 'metrics_guide.md'), metricsGuide);
  }

  private generateReadme(project: ProjectWithImages, options: ExportOptions): string {
    return `# Export - ${project.title}

## Export Information
- **Date**: ${new Date().toISOString()}
- **Total Images**: ${project.images?.length || 0}
- **Project ID**: ${project.id}

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
- Metrics are calculated for external polygons with internal areas subtracted
- All coordinates are in pixel space relative to original image dimensions
`;
  }

  private generateMetricsGuide(): string {
    return `# Metrics Guide

## Calculated Metrics

### Area
- **Description**: Total area of the polygon in pixels²
- **Calculation**: Area of external polygon minus areas of all internal polygons (holes)
- **Units**: pixels²

### Perimeter
- **Description**: Total length of the polygon boundary
- **Units**: pixels

### Circularity
- **Description**: Measure of how circular the shape is
- **Formula**: 4π × Area / Perimeter²
- **Range**: 0 to 1 (1 = perfect circle)

### Equivalent Diameter
- **Description**: Diameter of a circle with the same area
- **Formula**: √(4 × Area / π)
- **Units**: pixels

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
1. All metrics account for internal polygons (holes)
2. Measurements are in pixel coordinates
3. For physical measurements, apply appropriate scale factor
4. Metrics are calculated using OpenCV algorithms for accuracy
`;
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
      zlib: { level: 0 }, // No compression
    });

    return new Promise((resolve, reject) => {
      let cleanupCalled = false;
      
      const cleanup = async () => {
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
    const job = this.exportJobs.get(jobId);
    if (job && job.projectId === projectId && job.userId === userId) {
      return job;
    }
    return null;
  }

  async getExportFilePath(jobId: string, projectId: string, userId: string): Promise<string | null> {
    const job = this.exportJobs.get(jobId);
    if (job && job.projectId === projectId && job.userId === userId && job.filePath) {
      return job.filePath;
    }
    return null;
  }

  async cancelJob(jobId: string, projectId: string, userId: string): Promise<void> {
    const job = this.exportJobs.get(jobId);
    if (job && job.projectId === projectId && job.userId === userId) {
      job.status = 'cancelled';
      // Cancel the Bull queue job if bullJobId exists and queue is available
      if (job.bullJobId && this.exportQueue && typeof (this.exportQueue as any).getJob === 'function') {
        const queueJob = await (this.exportQueue as any).getJob(job.bullJobId);
        if (queueJob && ['waiting', 'delayed'].includes(await queueJob.getState())) {
          await queueJob.remove();
        }
      }
    }
  }

  async getExportHistory(projectId: string, userId: string): Promise<ExportJob[]> {
    const jobs = Array.from(this.exportJobs.values())
      .filter(job => job.projectId === projectId && job.userId === userId)
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