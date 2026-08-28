import client from 'prom-client';
import { logger } from '../utils/logger';

// Separate registry for business metrics
export const businessMetricsRegistry = new client.Registry();

// Business metrics
const apiErrorsTotal = new client.Counter({
  name: 'api_errors_total',
  help: 'Total number of API errors',
  labelNames: ['endpoint', 'error_type', 'status_code'],
  registers: [businessMetricsRegistry],
});

const featureUsageCounter = new client.Counter({
  name: 'feature_usage_total',
  help: 'Usage count for application features',
  labelNames: ['feature', 'user_type'],
  registers: [businessMetricsRegistry],
});

const imageProcessingCounter = new client.Counter({
  name: 'images_processed_total',
  help: 'Total number of images processed',
  labelNames: ['type', 'status'],
  registers: [businessMetricsRegistry],
});

const userActivityGauge = new client.Gauge({
  name: 'active_users',
  help: 'Number of active users',
  labelNames: ['tier'],
  registers: [businessMetricsRegistry],
});

const projectsCreatedTotal = new client.Counter({
  name: 'projects_created_total',
  help: 'Total number of projects created',
  registers: [businessMetricsRegistry],
});

const segmentationJobsTotal = new client.Counter({
  name: 'segmentation_jobs_total',
  help: 'Total number of segmentation jobs',
  labelNames: ['model', 'status'],
  registers: [businessMetricsRegistry],
});

const storageUsageGauge = new client.Gauge({
  name: 'storage_usage_bytes',
  help: 'Storage usage in bytes',
  labelNames: ['type'],
  registers: [businessMetricsRegistry],
});

const authenticationAttempts = new client.Counter({
  name: 'authentication_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['type', 'status'],
  registers: [businessMetricsRegistry],
});

const apiResponseTime = new client.Histogram({
  name: 'api_response_time_seconds',
  help: 'API response time distribution',
  labelNames: ['endpoint', 'method'],
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
  registers: [businessMetricsRegistry],
});

const queueSize = new client.Gauge({
  name: 'queue_size',
  help: 'Size of processing queues',
  labelNames: ['queue_name'],
  registers: [businessMetricsRegistry],
});

/**
 * Track API errors
 */
export function trackApiError(
  endpoint: string,
  errorType: string,
  statusCode: number
): void {
  try {
    apiErrorsTotal.inc({
      endpoint,
      error_type: errorType,
      status_code: statusCode.toString(),
    });
  } catch (error) {
    logger.error('Failed to track API error metric:', error);
  }
}

/**
 * Track feature usage
 */
export function trackFeatureUsage(
  feature: string,
  userType = 'anonymous'
): void {
  try {
    featureUsageCounter.inc({
      feature,
      user_type: userType,
    });
  } catch (error) {
    logger.error('Failed to track feature usage metric:', error);
  }
}

/**
 * Update active users count
 */
export function updateActiveUsers(tier: string, count: number): void {
  try {
    userActivityGauge.set({ tier }, count);
  } catch (error) {
    logger.error('Failed to update active users metric:', error);
  }
}

/**
 * Update storage usage
 */
export function updateStorageUsage(type: string, bytes: number): void {
  try {
    storageUsageGauge.set({ type }, bytes);
  } catch (error) {
    logger.error('Failed to update storage usage metric:', error);
  }
}

/**
 * Update queue size
 */
export function updateQueueSize(queueName: string, size: number): void {
  try {
    queueSize.set({ queue_name: queueName }, size);
  } catch (error) {
    logger.error('Failed to update queue size metric:', error);
  }
}

/**
 * Initialize business metrics collection
 */
export function initializeBusinessMetricsCollection(): void {
  try {
    logger.info('Initializing business metrics collection...');

    // Set initial values for gauges
    updateActiveUsers('free', 0);
    updateActiveUsers('premium', 0);
    updateActiveUsers('admin', 0);

    updateStorageUsage('images', 0);
    updateStorageUsage('thumbnails', 0);
    updateStorageUsage('temp', 0);

    updateQueueSize('segmentation', 0);
    updateQueueSize('export', 0);

    logger.info('✅ Business metrics collection initialized');
  } catch (error) {
    logger.error('Failed to initialize business metrics collection:', error);
  }
}

// Export all metrics for testing
export {
  apiErrorsTotal,
  featureUsageCounter,
  imageProcessingCounter,
  userActivityGauge,
  projectsCreatedTotal,
  segmentationJobsTotal,
  storageUsageGauge,
  authenticationAttempts,
  apiResponseTime,
  queueSize,
};
