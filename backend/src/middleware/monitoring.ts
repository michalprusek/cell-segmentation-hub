import { Request, Response, NextFunction } from 'express';
import client from 'prom-client';
import { logger } from '../utils/logger';

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
      const metrics = await register.metrics();
      res.end(metrics);
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
  register
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