import { Request, Response, NextFunction } from 'express';
import client from 'prom-client';
import { logger } from '../utils/logger';
import {
  businessMetricsRegistry,
  trackApiError,
  trackFeatureUsage,
  initializeBusinessMetricsCollection
} from '../monitoring/businessMetrics';

// Vytvoření registru pro metriky
const register = new client.Registry();

// Přidání default metrik (CPU, memory, atd.)
client.collectDefaultMetrics({ register });

// Custom metriky pro API
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register]
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in milliseconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 5, 15, 50, 100, 200, 300, 400, 500, 1000, 2000, 5000],
  registers: [register]
});

const activeConnections = new client.Gauge({
  name: 'active_connections',
  help: 'Number of active connections',
  registers: [register]
});

const endpointHealth = new client.Gauge({
  name: 'endpoint_health',
  help: 'Health status of endpoints (1 = healthy, 0 = unhealthy)',
  labelNames: ['endpoint', 'method'],
  registers: [register]
});

const mlModelInferenceTime = new client.Histogram({
  name: 'ml_model_inference_duration_ms',
  help: 'ML model inference duration in milliseconds',
  labelNames: ['model_name', 'status'],
  buckets: [100, 500, 1000, 2000, 5000, 10000, 20000, 30000],
  registers: [register]
});

const mlModelRequests = new client.Counter({
  name: 'ml_model_requests_total',
  help: 'Total number of ML model requests',
  labelNames: ['model_name', 'status'],
  registers: [register]
});

const databaseConnections = new client.Gauge({
  name: 'database_connections_active',
  help: 'Number of active database connections',
  registers: [register]
});

const uploadedFiles = new client.Counter({
  name: 'uploaded_files_total',
  help: 'Total number of uploaded files',
  labelNames: ['file_type', 'status'],
  registers: [register]
});

// Middleware pro monitoring HTTP požadavků
export function createMonitoringMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    // Zvýšení počtu aktivních spojení
    activeConnections.inc();

    // Při dokončení požadavku
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const route = req.route?.path || req.path;
      const method = req.method;
      const status = res.statusCode.toString();

      // Aktualizace metrik
      httpRequestsTotal.inc({ method, route, status });
      httpRequestDuration.observe({ method, route, status }, duration);
      
      // Snížení počtu aktivních spojení
      activeConnections.dec();

      // Update endpoint health
      const isHealthy = res.statusCode < 500 ? 1 : 0;
      endpointHealth.set({ endpoint: route, method }, isHealthy);

      // Track business metrics for errors
      if (res.statusCode >= 400) {
        const userType = (req as Request & { user?: unknown }).user ? 'authenticated' : 'anonymous';
        const errorType = res.statusCode >= 500 ? 'server_error' : 'client_error';
        trackApiError(route, errorType, status, userType);
      }

      // Track feature usage for authenticated users
      if ((req as Request & { user?: unknown }).user && res.statusCode < 400) {
        const featureName = getFeatureNameFromRoute(route, method);
        if (featureName) {
          trackFeatureUsage(featureName, 'authenticated');
        }
      }

      // Logování pomalých požadavků
      if (duration > 1000) {
        logger.warn(`Slow request: ${method} ${route} took ${duration}ms`);
      }
    });

    next();
  };
}

// Endpoint pro Prometheus scraping
export function getMetricsEndpoint(): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response) => {
    try {
      res.set('Content-Type', register.contentType);
      
      // Combine both standard and business metrics
      const standardMetrics = await register.metrics();
      const businessMetrics = await businessMetricsRegistry.metrics();
      
      // Combine the metrics
      const allMetrics = standardMetrics + businessMetrics;
      
      res.end(allMetrics);
    } catch (error) {
      logger.error('Error generating metrics:', error as Error);
      res.status(500).end('Error generating metrics');
    }
  };
}

// Funkce pro trackování ML modelů
export function trackMLModelInference(modelName: string, duration: number, success: boolean): void {
  const status = success ? 'success' : 'error';
  mlModelInferenceTime.observe({ model_name: modelName, status }, duration);
  mlModelRequests.inc({ model_name: modelName, status });
}

// Funkce pro trackování uploadů
export function trackFileUpload(fileType: string, success: boolean): void {
  const status = success ? 'success' : 'error';
  uploadedFiles.inc({ file_type: fileType, status });
}

// Funkce pro aktualizaci databázových spojení
export function updateDatabaseConnections(count: number): void {
  databaseConnections.set(count);
}

// Health check pro monitoring systém
export function getMonitoringHealth(): {healthy: boolean; message: string; metricsCount?: number; lastScrape?: string; error?: string} {
  try {
    // Check if register is working by attempting to get metrics
    register.getSingleMetricAsString('process_cpu_user_seconds_total');
    return {
      healthy: true,
      message: 'Monitoring system is operational',
      metricsCount: register.getMetricsAsArray().length,
      lastScrape: new Date().toISOString()
    };
  } catch (error) {
    return {
      healthy: false,
      message: 'Monitoring system error',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Helper function to map routes to feature names for business metrics
function getFeatureNameFromRoute(route: string, method: string): string | null {
  const routeFeatureMap: Record<string, string> = {
    // Authentication features
    '/api/auth/login': 'user_login',
    '/api/auth/register': 'user_registration',
    '/api/auth/logout': 'user_logout',
    
    // Project features
    '/api/projects': method === 'POST' ? 'project_creation' : 'project_list',
    '/api/projects/:id': method === 'GET' ? 'project_view' : method === 'PUT' ? 'project_edit' : 'project_delete',
    
    // Image features
    '/api/projects/:id/images': 'image_upload',
    '/api/projects/:projectId/images/:imageId': 'image_view',
    
    // Segmentation features
    '/api/segmentation/process': 'segmentation_request',
    '/api/segmentation/:id/results': 'segmentation_results',
    '/api/segmentation/queue': 'queue_status',
    
    // Export features
    '/api/projects/:id/export': 'data_export',
    
    // Profile features
    '/api/profile': 'profile_access',
    '/api/profile/avatar': 'avatar_upload',
    
    // Sharing features
    '/api/projects/:id/share': 'project_sharing'
  };

  // Check for exact match first
  if (routeFeatureMap[route]) {
    return routeFeatureMap[route];
  }

  // Check for pattern matches
  for (const [pattern, feature] of Object.entries(routeFeatureMap)) {
    if (route.match(pattern.replace(/:\w+/g, '[^/]+'))) {
      return feature;
    }
  }

  return null;
}

// Initialize business metrics collection when the module loads
let metricsCollectionInterval: NodeJS.Timeout | null = null;

export function initializeMetricsCollection(): void {
  if (metricsCollectionInterval) {
    clearInterval(metricsCollectionInterval);
  }
  
  metricsCollectionInterval = initializeBusinessMetricsCollection(5); // 5-minute intervals
  logger.info('Business metrics collection initialized');
}

// Export všech metrik pro externí použití
export const metrics = {
  httpRequestsTotal,
  httpRequestDuration,
  activeConnections,
  endpointHealth,
  mlModelInferenceTime,
  mlModelRequests,
  databaseConnections,
  uploadedFiles,
  register,
  businessMetricsRegistry
};

// Export funkcí
export {
  httpRequestsTotal,
  httpRequestDuration,
  activeConnections,
  endpointHealth,
  mlModelInferenceTime,
  mlModelRequests,
  databaseConnections,
  uploadedFiles,
  register
};