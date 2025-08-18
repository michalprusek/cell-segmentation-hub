import client from 'prom-client';
import { prisma } from '../db';
import { logger } from '../utils/logger';

// Business Metrics Registry
const businessRegister = new client.Registry();

// User Activity Metrics
const userRegistrations = new client.Counter({
  name: 'spheroseg_user_registrations_total',
  help: 'Total number of user registrations',
  labelNames: ['method', 'status'],
  registers: [businessRegister]
});

const userLogins = new client.Counter({
  name: 'spheroseg_user_logins_total',
  help: 'Total number of user logins',
  labelNames: ['method', 'status'],
  registers: [businessRegister]
});

const activeUsers = new client.Gauge({
  name: 'spheroseg_active_users',
  help: 'Number of active users in different time periods',
  labelNames: ['period'], // daily, weekly, monthly
  registers: [businessRegister]
});

// Project Metrics
const projectsCreated = new client.Counter({
  name: 'spheroseg_projects_created_total',
  help: 'Total number of projects created',
  labelNames: ['user_type'],
  registers: [businessRegister]
});

const projectsActive = new client.Gauge({
  name: 'spheroseg_projects_active',
  help: 'Number of active projects',
  registers: [businessRegister]
});

const imagesUploaded = new client.Counter({
  name: 'spheroseg_images_uploaded_total',
  help: 'Total number of images uploaded',
  labelNames: ['file_type', 'status'],
  registers: [businessRegister]
});

const averageImagesPerProject = new client.Gauge({
  name: 'spheroseg_average_images_per_project',
  help: 'Average number of images per project',
  registers: [businessRegister]
});

// Segmentation Metrics
const segmentationRequests = new client.Counter({
  name: 'spheroseg_segmentation_requests_total',
  help: 'Total number of segmentation requests',
  labelNames: ['model_name', 'status'],
  registers: [businessRegister]
});

const segmentationDuration = new client.Histogram({
  name: 'spheroseg_segmentation_duration_seconds',
  help: 'Segmentation processing duration in seconds',
  labelNames: ['model_name', 'status'],
  buckets: [1, 5, 10, 20, 30, 60, 120, 300, 600],
  registers: [businessRegister]
});

const segmentationQueueLength = new client.Gauge({
  name: 'spheroseg_segmentation_queue_length',
  help: 'Current number of items in segmentation queue',
  labelNames: ['status'], // pending, processing, completed, failed
  registers: [businessRegister]
});

const polygonsExtracted = new client.Counter({
  name: 'spheroseg_polygons_extracted_total',
  help: 'Total number of polygons extracted from segmentations',
  labelNames: ['model_name'],
  registers: [businessRegister]
});

// Storage Metrics
const storageUsed = new client.Gauge({
  name: 'spheroseg_storage_used_bytes',
  help: 'Total storage used in bytes',
  labelNames: ['type'], // images, thumbnails, exports
  registers: [businessRegister]
});

const storageUsedByUser = new client.Gauge({
  name: 'spheroseg_storage_used_by_user_bytes',
  help: 'Storage used per user in bytes',
  labelNames: ['user_id'],
  registers: [businessRegister]
});

// Export Metrics
const exportsCreated = new client.Counter({
  name: 'spheroseg_exports_created_total',
  help: 'Total number of exports created',
  labelNames: ['format', 'status'],
  registers: [businessRegister]
});

const exportDuration = new client.Histogram({
  name: 'spheroseg_export_duration_seconds',
  help: 'Export processing duration in seconds',
  labelNames: ['format', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [businessRegister]
});

// Model Usage Metrics
const modelUsageStats = new client.Gauge({
  name: 'spheroseg_model_usage_percentage',
  help: 'Percentage of usage for each model',
  labelNames: ['model_name'],
  registers: [businessRegister]
});

// Error Metrics
const businessErrors = new client.Counter({
  name: 'spheroseg_business_errors_total',
  help: 'Total number of business-level errors',
  labelNames: ['error_type', 'operation'],
  registers: [businessRegister]
});

// Business Metric Collection Functions

export class BusinessMetricsService {
  // User Activity Tracking
  static trackUserRegistration(method: 'email' | 'oauth', success: boolean): void {
    const status = success ? 'success' : 'failure';
    userRegistrations.inc({ method, status });
    logger.info(`User registration tracked: ${method} - ${status}`);
  }

  static trackUserLogin(method: 'email' | 'oauth', success: boolean): void {
    const status = success ? 'success' : 'failure';
    userLogins.inc({ method, status });
    logger.info(`User login tracked: ${method} - ${status}`);
  }

  // Project Activity Tracking
  static trackProjectCreated(userType: 'registered' | 'premium' = 'registered'): void {
    projectsCreated.inc({ user_type: userType });
    logger.info(`Project creation tracked: ${userType} user`);
  }

  static trackImageUpload(fileType: string, success: boolean): void {
    const status = success ? 'success' : 'failure';
    imagesUploaded.inc({ file_type: fileType, status });
    logger.info(`Image upload tracked: ${fileType} - ${status}`);
  }

  // Segmentation Tracking
  static trackSegmentationRequest(modelName: string, success: boolean, durationSeconds?: number): void {
    const status = success ? 'success' : 'failure';
    segmentationRequests.inc({ model_name: modelName, status });
    
    if (durationSeconds !== undefined) {
      segmentationDuration.observe({ model_name: modelName, status }, durationSeconds);
    }
    
    logger.info(`Segmentation request tracked: ${modelName} - ${status}`);
  }

  static trackPolygonsExtracted(modelName: string, count: number): void {
    polygonsExtracted.inc({ model_name: modelName }, count);
    logger.info(`Polygons extracted tracked: ${count} polygons from ${modelName}`);
  }

  // Export Tracking
  static trackExportCreated(format: string, success: boolean, durationSeconds?: number): void {
    const status = success ? 'success' : 'failure';
    exportsCreated.inc({ format, status });
    
    if (durationSeconds !== undefined) {
      exportDuration.observe({ format, status }, durationSeconds);
    }
    
    logger.info(`Export creation tracked: ${format} - ${status}`);
  }

  // Error Tracking
  static trackBusinessError(errorType: string, operation: string): void {
    businessErrors.inc({ error_type: errorType, operation });
    logger.warn(`Business error tracked: ${errorType} in ${operation}`);
  }

  // Storage Tracking
  static updateStorageUsed(type: 'images' | 'thumbnails' | 'exports', bytes: number): void {
    storageUsed.set({ type }, bytes);
  }

  static updateUserStorageUsed(userId: string, bytes: number): void {
    storageUsedByUser.set({ user_id: userId }, bytes);
  }

  // Queue Tracking
  static updateQueueLength(status: 'pending' | 'processing' | 'completed' | 'failed', count: number): void {
    segmentationQueueLength.set({ status }, count);
  }

  // Periodic Data Collection from Database
  static async collectDatabaseMetrics(): Promise<void> {
    try {
      // Active users metrics
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const dailyActiveUsers = await prisma.user.count({
        where: { updatedAt: { gte: oneDayAgo } }
      });
      const weeklyActiveUsers = await prisma.user.count({
        where: { updatedAt: { gte: oneWeekAgo } }
      });
      const monthlyActiveUsers = await prisma.user.count({
        where: { updatedAt: { gte: oneMonthAgo } }
      });

      activeUsers.set({ period: 'daily' }, dailyActiveUsers);
      activeUsers.set({ period: 'weekly' }, weeklyActiveUsers);
      activeUsers.set({ period: 'monthly' }, monthlyActiveUsers);

      // Project metrics
      const totalActiveProjects = await prisma.project.count();
      projectsActive.set(totalActiveProjects);

      // Average images per project
      const projectsWithImageCounts = await prisma.project.findMany({
        select: {
          _count: {
            select: { images: true }
          }
        }
      });
      
      if (projectsWithImageCounts.length > 0) {
        const totalImages = projectsWithImageCounts.reduce((sum, project) => sum + project._count.images, 0);
        const avgImages = totalImages / projectsWithImageCounts.length;
        averageImagesPerProject.set(avgImages);
      }

      // Queue length metrics
      const queueStats = await prisma.segmentationQueue.groupBy({
        by: ['status'],
        _count: { status: true }
      });

      // Reset all queue metrics
      segmentationQueueLength.set({ status: 'pending' }, 0);
      segmentationQueueLength.set({ status: 'processing' }, 0);
      segmentationQueueLength.set({ status: 'completed' }, 0);
      segmentationQueueLength.set({ status: 'failed' }, 0);

      // Update with actual counts
      queueStats.forEach((stat: { status: string; _count: { status: number } }) => {
        segmentationQueueLength.set({ status: stat.status }, stat._count.status);
      });

      // Model usage statistics
      const modelStats = await prisma.segmentation.groupBy({
        by: ['model'],
        _count: { model: true }
      });

      const totalSegmentations = modelStats.reduce((sum: number, stat: { _count: { model: number } }) => sum + stat._count.model, 0);
      
      modelStats.forEach((stat: { model: string; _count: { model: number } }) => {
        const percentage = totalSegmentations > 0 ? (stat._count.model / totalSegmentations) * 100 : 0;
        modelUsageStats.set({ model_name: stat.model || 'unknown' }, percentage);
      });

      logger.info('Business metrics collected from database');
    } catch (error) {
      logger.error('Failed to collect database metrics:', error as Error);
      this.trackBusinessError('database_collection_failed', 'collect_metrics');
    }
  }

  // Get business metrics for Prometheus scraping
  static async getBusinessMetrics(): Promise<string> {
    try {
      // Collect fresh database metrics before returning
      await this.collectDatabaseMetrics();
      return businessRegister.metrics();
    } catch (error) {
      logger.error('Failed to get business metrics:', error as Error);
      throw error;
    }
  }

  // Get metrics registry
  static getRegistry(): client.Registry {
    return businessRegister;
  }

  // Health check for business metrics
  static getHealthStatus(): { healthy: boolean; message: string; metricsCount?: number; error?: string } {
    try {
      const metricsCount = businessRegister.getMetricsAsArray().length;
      return {
        healthy: true,
        message: 'Business metrics system operational',
        metricsCount
      };
    } catch (error) {
      return {
        healthy: false,
        message: 'Business metrics system error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Export all metrics for external use
export const businessMetrics = {
  userRegistrations,
  userLogins,
  activeUsers,
  projectsCreated,
  projectsActive,
  imagesUploaded,
  averageImagesPerProject,
  segmentationRequests,
  segmentationDuration,
  segmentationQueueLength,
  polygonsExtracted,
  storageUsed,
  storageUsedByUser,
  exportsCreated,
  exportDuration,
  modelUsageStats,
  businessErrors,
  register: businessRegister
};

// Start periodic collection (every 5 minutes)
const COLLECTION_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  BusinessMetricsService.collectDatabaseMetrics().catch(error => {
    logger.error('Periodic business metrics collection failed:', error as Error);
  });
}, COLLECTION_INTERVAL);

// Initial collection
BusinessMetricsService.collectDatabaseMetrics().catch(error => {
  logger.error('Initial business metrics collection failed:', error as Error);
});