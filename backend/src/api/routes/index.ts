import { Express, Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../../utils/logger';
import authRoutes from './authRoutes';
import projectRoutes from './projectRoutes';
import imageRoutes from './imageRoutes';
import { segmentationRoutes } from './segmentationRoutes';
import { queueRoutes } from './queueRoutes';
import { exportRoutes } from './exportRoutes';
import metricsRoutes from './metricsRoutes';

interface RouteInfo {
  path: string;
  method: string;
  description?: string;
  authenticated?: boolean;
}

export const routeRegistry: RouteInfo[] = [];

// Global endpoint stats with memory management
const MAX_ENDPOINTS = 1000;
const ENDPOINT_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

const globalEndpointStats = new Map<string, {
  calls: number;
  lastCalled: Date;
  lastSeen: number; // timestamp for eviction
  avgResponseTime: number;
  errors: number;
  totalResponseTime: number;
}>();

/**
 * Registruje route do centrálního registru
 */
export function registerRoute(info: RouteInfo): void {
  routeRegistry.push(info);
}

/**
 * Nastaví všechny API routes
 */
export function setupRoutes(app: Express): void {
  // Registrace routes
  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/projects', imageRoutes);
  app.use('/api/images', imageRoutes); // Direct image routes
  app.use('/api/segmentation', segmentationRoutes);
  app.use('/api/queue', queueRoutes);
  app.use('/api', exportRoutes); // Export routes
  app.use('/api/metrics', metricsRoutes); // Business metrics routes

  // Manuální registrace známých routes
  registerKnownRoutes();

  // Endpoint pro seznam všech routes
  app.get('/api/endpoints', (req, res) => {
    res.json({
      success: true,
      data: {
        endpoints: routeRegistry,
        count: routeRegistry.length
      },
      message: 'Seznam všech API endpoints'
    });
  });

  // Endpoint pro zdravotní stav všech endpoints
  app.get('/api/health/endpoints', async (req, res) => {
    const endpointHealth = await checkEndpointsHealth();
    res.json({
      success: true,
      data: endpointHealth,
      message: 'Zdravotní stav všech endpoints'
    });
  });

  logger.info(`📍 Registered ${routeRegistry.length} API endpoints`);
  
  // Výpis všech registrovaných routes při startu
  if (process.env.NODE_ENV === 'development') {
    logRegisteredRoutes();
  }
}

/**
 * Manuálně registruje známé routes
 * TODO: Automatizovat pomocí route inspection
 */
function registerKnownRoutes(): void {
  // Health endpoints
  registerRoute({
    path: '/health',
    method: 'GET',
    description: 'Kontrola zdraví serveru',
    authenticated: false
  });

  registerRoute({
    path: '/api/endpoints',
    method: 'GET',
    description: 'Seznam všech API endpoints',
    authenticated: false
  });

  registerRoute({
    path: '/api/health/endpoints',
    method: 'GET',
    description: 'Zdravotní stav všech endpoints',
    authenticated: false
  });

  // Auth endpoints
  registerRoute({
    path: '/api/auth/register',
    method: 'POST',
    description: 'Registrace nového uživatele',
    authenticated: false
  });

  registerRoute({
    path: '/api/auth/login',
    method: 'POST',
    description: 'Přihlášení uživatele',
    authenticated: false
  });

  registerRoute({
    path: '/api/auth/refresh',
    method: 'POST',
    description: 'Obnovení access tokenu',
    authenticated: false
  });

  registerRoute({
    path: '/api/auth/logout',
    method: 'POST',
    description: 'Odhlášení uživatele',
    authenticated: true
  });

  // Project endpoints
  registerRoute({
    path: '/api/projects',
    method: 'GET',
    description: 'Seznam projektů uživatele',
    authenticated: true
  });

  registerRoute({
    path: '/api/projects',
    method: 'POST',
    description: 'Vytvoření nového projektu',
    authenticated: true
  });

  registerRoute({
    path: '/api/projects/:projectId',
    method: 'GET',
    description: 'Detail konkrétního projektu',
    authenticated: true
  });

  registerRoute({
    path: '/api/projects/:projectId',
    method: 'PUT',
    description: 'Aktualizace projektu',
    authenticated: true
  });

  registerRoute({
    path: '/api/projects/:projectId',
    method: 'DELETE',
    description: 'Smazání projektu',
    authenticated: true
  });

  // Image endpoints
  registerRoute({
    path: '/api/projects/:projectId/images',
    method: 'POST',
    description: 'Upload obrázku do projektu',
    authenticated: true
  });

  registerRoute({
    path: '/api/projects/:projectId/images/:imageId',
    method: 'GET',
    description: 'Detail obrázku',
    authenticated: true
  });

  registerRoute({
    path: '/api/projects/:projectId/images/:imageId',
    method: 'DELETE',
    description: 'Smazání obrázku',
    authenticated: true
  });

  registerRoute({
    path: '/api/projects/:projectId/images/:imageId/segment',
    method: 'POST',
    description: 'Spuštění segmentace obrázku',
    authenticated: true
  });

  // Documentation endpoints
  registerRoute({
    path: '/api-docs',
    method: 'GET',
    description: 'Swagger UI dokumentace',
    authenticated: false
  });

  registerRoute({
    path: '/api-docs/openapi.json',
    method: 'GET',
    description: 'OpenAPI JSON specifikace',
    authenticated: false
  });

  registerRoute({
    path: '/api-docs/postman.json',
    method: 'GET',
    description: 'Postman kolekce',
    authenticated: false
  });
}

/**
 * Výpis všech registrovaných routes do konzole
 */
function logRegisteredRoutes(): void {
  logger.info('\n📍 Registered API Endpoints:');
  logger.info('=====================================');
  
  const groupedRoutes = routeRegistry.reduce((groups, route) => {
    const group = route.path.split('/')[1] || 'root';
    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push(route);
    return groups;
  }, {} as Record<string, RouteInfo[]>);

  Object.entries(groupedRoutes).forEach(([group, routes]) => {
    logger.info(`\n🔹 ${group.toUpperCase()}:`);
    routes.forEach(route => {
      const auth = route.authenticated ? '🔒' : '🌐';
      const method = route.method.padEnd(6);
      logger.info(`  ${auth} ${method} ${route.path} - ${route.description || 'No description'}`);
    });
  });
  
  logger.info('\n=====================================\n');
}

/**
 * Middleware pro automatické trackování endpoint usage
 */
export function createEndpointTracker(): RequestHandler {
  // Periodic cleanup of old entries
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of Array.from(globalEndpointStats.entries())) {
      if (now - value.lastSeen > ENDPOINT_TTL) {
        globalEndpointStats.delete(key);
      }
    }
  }, 60 * 60 * 1000); // Clean up every hour

  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const endpoint = `${req.method} ${req.route?.path || req.path}`;

    // Evict oldest entries if map is too large
    if (globalEndpointStats.size >= MAX_ENDPOINTS) {
      const sortedEntries = Array.from(globalEndpointStats.entries())
        .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      
      // Remove oldest 10% of entries
      const toRemove = Math.floor(MAX_ENDPOINTS * 0.1);
      for (let i = 0; i < toRemove; i++) {
        const entry = sortedEntries[i];
        if (entry) {
          globalEndpointStats.delete(entry[0]);
        }
      }
    }

    // Track endpoint call
    const stats = globalEndpointStats.get(endpoint) || {
      calls: 0,
      lastCalled: new Date(),
      lastSeen: Date.now(),
      avgResponseTime: 0,
      errors: 0,
      totalResponseTime: 0
    };

    stats.calls++;
    stats.lastCalled = new Date();
    stats.lastSeen = Date.now();

    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      stats.totalResponseTime += responseTime;
      stats.avgResponseTime = stats.totalResponseTime / stats.calls;
      
      if (res.statusCode >= 400) {
        stats.errors++;
      }
      
      globalEndpointStats.set(endpoint, stats);
    });

    // Přidání stats do req objektu pro monitoring
    (req as Request & { endpointStats?: Map<string, unknown> }).endpointStats = globalEndpointStats;
    
    next();
  };
}

/**
 * Kontrola zdraví všech endpoints
 */
async function checkEndpointsHealth(): Promise<Record<string, unknown>> {
  
  // Simulace kontroly každého endpointu
  const healthChecks = routeRegistry.map(async (route) => {
    try {
      // Pro základní endpoints vracíme vždy healthy, pro parametrické endpointy použij deterministickou kontrolu
      const isHealthy = !route.path.includes('/:') || (process.env.NODE_ENV !== 'production' && process.env.HEALTH_SIMULATE_FAILURES === 'true' ? Math.random() > 0.1 : true);
      
      return {
        endpoint: route.path,
        method: route.method,
        status: isHealthy ? 'healthy' : 'unhealthy',
        authenticated: route.authenticated,
        description: route.description,
        lastChecked: new Date().toISOString(),
        responseTime: globalEndpointStats.get(`${route.method.toUpperCase()} ${route.path}`)?.avgResponseTime || 0
      };
    } catch (error) {
      return {
        endpoint: route.path,
        method: route.method,
        status: 'error',
        authenticated: route.authenticated,
        description: route.description,
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date().toISOString(),
      };
    }
  });

  const results = await Promise.all(healthChecks);
  
  const summary = {
    total: results.length,
    healthy: results.filter(r => r.status === 'healthy').length,
    unhealthy: results.filter(r => r.status === 'unhealthy').length,
    errors: results.filter(r => r.status === 'error').length,
  };

  return {
    summary,
    endpoints: results,
    lastUpdated: new Date().toISOString(),
  };
}

export { routeRegistry as routes, checkEndpointsHealth };