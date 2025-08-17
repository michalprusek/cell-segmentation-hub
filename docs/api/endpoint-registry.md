# API Endpoint Registry System

The Cell Segmentation Hub implements a comprehensive endpoint registry system that automatically tracks, monitors, and manages all API endpoints. This system provides real-time visibility into API usage, health status, and performance metrics.

## Overview

The endpoint registry system consists of several components:

- **Route Registry**: Central repository of all API endpoints
- **Endpoint Tracker**: Middleware for usage statistics and performance monitoring
- **Health Monitor**: Real-time health checks for individual endpoints
- **API Discovery**: Dynamic endpoint listing and documentation

## Registry Architecture

### Core Components

#### 1. Route Registry (`src/api/routes/index.ts`)

The central registry maintains a complete list of all API endpoints:

```typescript
interface RouteInfo {
  path: string;
  method: string;
  description?: string;
  authenticated?: boolean;
}

export const routeRegistry: RouteInfo[] = [];

export function registerRoute(info: RouteInfo) {
  routeRegistry.push(info);
}
```

#### 2. Automatic Route Registration

Routes are automatically registered during application startup:

```typescript
export function setupRoutes(app: Express) {
  // Register API route handlers
  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/projects', imageRoutes);

  // Register known routes in the registry
  registerKnownRoutes();

  // Create discovery endpoints
  setupDiscoveryEndpoints(app);
}
```

#### 3. Discovery Endpoints

The system automatically creates endpoints for API discovery:

```typescript
// List all registered endpoints
app.get('/api/endpoints', (req, res) => {
  res.json({
    success: true,
    data: {
      endpoints: routeRegistry,
      count: routeRegistry.length,
    },
    message: 'Seznam všech API endpoints',
  });
});

// Health status of all endpoints
app.get('/api/health/endpoints', async (req, res) => {
  const endpointHealth = await checkEndpointsHealth();
  res.json({
    success: true,
    data: endpointHealth,
    message: 'Zdravotní stav všech endpoints',
  });
});
```

## Registered Endpoints

### Current Registry (19 Endpoints)

The system currently tracks **19 API endpoints** organized into **6 categories**:

#### Health Endpoints (🌐 Public)

- `GET /health` - Kontrola zdraví serveru
- `GET /api/endpoints` - Seznam všech API endpoints
- `GET /api/health/endpoints` - Zdravotní stav všech endpoints

#### Authentication Endpoints (🌐 Public)

- `POST /api/auth/register` - Registrace nového uživatele
- `POST /api/auth/login` - Přihlášení uživatele
- `POST /api/auth/refresh` - Obnovení access tokenu

#### Protected Authentication (🔒 Protected)

- `POST /api/auth/logout` - Odhlášení uživatele
- `PUT /api/auth/profile` - Aktualizace profilu uživatele
- `DELETE /api/auth/profile` - Smazání uživatelského účtu

#### Project Management (🔒 Protected)

- `GET /api/projects` - Seznam projektů uživatele
- `POST /api/projects` - Vytvoření nového projektu
- `GET /api/projects/:projectId` - Detail konkrétního projektu
- `PUT /api/projects/:projectId` - Aktualizace projektu
- `DELETE /api/projects/:projectId` - Smazání projektu

#### Image Management (🔒 Protected)

- `POST /api/projects/:projectId/images` - Upload obrázku do projektu
- `GET /api/projects/:projectId/images/:imageId` - Detail obrázku
- `DELETE /api/projects/:projectId/images/:imageId` - Smazání obrázku
- `POST /api/projects/:projectId/images/:imageId/segment` - Spuštění segmentace obrázku

#### Documentation Endpoints (🌐 Public)

- `GET /api-docs` - Swagger UI dokumentace
- `GET /api-docs/openapi.json` - OpenAPI JSON specifikace
- `GET /api-docs/postman.json` - Postman kolekce

## Endpoint Tracking System

### Usage Statistics Middleware

The endpoint tracker middleware automatically collects usage statistics:

```typescript
export function createEndpointTracker() {
  const endpointStats = new Map<
    string,
    {
      calls: number;
      lastCalled: Date;
      avgResponseTime: number;
      errors: number;
    }
  >();

  return (req: any, res: any, next: any) => {
    const startTime = Date.now();
    const endpoint = `${req.method} ${req.route?.path || req.path}`;

    // Track endpoint usage
    const stats = endpointStats.get(endpoint) || {
      calls: 0,
      lastCalled: new Date(),
      avgResponseTime: 0,
      errors: 0,
    };

    stats.calls++;
    stats.lastCalled = new Date();

    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      stats.avgResponseTime = (stats.avgResponseTime + responseTime) / 2;

      if (res.statusCode >= 400) {
        stats.errors++;
      }

      endpointStats.set(endpoint, stats);
    });

    next();
  };
}
```

### Collected Metrics

For each endpoint, the system tracks:

- **Call Count**: Total number of requests
- **Average Response Time**: Mean response time in milliseconds
- **Error Count**: Number of failed requests (4xx, 5xx status codes)
- **Last Called**: Timestamp of most recent request
- **Success Rate**: Calculated from calls vs errors

## Health Monitoring

### Individual Endpoint Health

The system performs health checks on all registered endpoints:

```typescript
async function checkEndpointsHealth() {
  const healthChecks = routeRegistry.map(async route => {
    try {
      // Health check logic for each endpoint type
      const isHealthy = await performHealthCheck(route);

      return {
        endpoint: route.path,
        method: route.method,
        status: isHealthy ? 'healthy' : 'unhealthy',
        authenticated: route.authenticated,
        description: route.description,
        lastChecked: new Date().toISOString(),
        responseTime: await measureResponseTime(route),
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

  return {
    summary: {
      total: results.length,
      healthy: results.filter(r => r.status === 'healthy').length,
      unhealthy: results.filter(r => r.status === 'unhealthy').length,
      errors: results.filter(r => r.status === 'error').length,
    },
    endpoints: results,
    lastUpdated: new Date().toISOString(),
  };
}
```

### Health Status Response

Example response from `/api/health/endpoints`:

```json
{
  "success": true,
  "data": {
    "summary": {
      "total": 19,
      "healthy": 17,
      "unhealthy": 1,
      "errors": 1
    },
    "endpoints": [
      {
        "endpoint": "/health",
        "method": "GET",
        "status": "healthy",
        "authenticated": false,
        "description": "Kontrola zdraví serveru",
        "lastChecked": "2024-01-15T10:30:00.000Z",
        "responseTime": 15
      },
      {
        "endpoint": "/api/auth/login",
        "method": "POST",
        "status": "healthy",
        "authenticated": false,
        "description": "Přihlášení uživatele",
        "lastChecked": "2024-01-15T10:30:00.000Z",
        "responseTime": 45
      }
    ],
    "lastUpdated": "2024-01-15T10:30:00.000Z"
  }
}
```

## Development Console Output

### Startup Logging

During development, the system logs all registered endpoints:

```
📍 Registered API Endpoints:
=====================================

🔹 HEALTH:
   🌐 GET    /health - Kontrola zdraví serveru
   🌐 GET    /api/endpoints - Seznam všech API endpoints
   🌐 GET    /api/health/endpoints - Zdravotní stav všech endpoints

🔹 API:
   🌐 POST   /api/auth/register - Registrace nového uživatele
   🌐 POST   /api/auth/login - Přihlášení uživatele
   🌐 POST   /api/auth/refresh - Obnovení access tokenu
   🔒 POST   /api/auth/logout - Odhlášení uživatele
   🔒 GET    /api/projects - Seznam projektů uživatele
   🔒 POST   /api/projects - Vytvoření nového projektu
   🔒 GET    /api/projects/:projectId - Detail konkrétního projektu
   🔒 PUT    /api/projects/:projectId - Aktualizace projektu
   🔒 DELETE /api/projects/:projectId - Smazání projektu
   🔒 POST   /api/projects/:projectId/images - Upload obrázku do projektu
   🔒 GET    /api/projects/:projectId/images/:imageId - Detail obrázku
   🔒 DELETE /api/projects/:projectId/images/:imageId - Smazání obrázku
   🔒 POST   /api/projects/:projectId/images/:imageId/segment - Spuštění segmentace obrázku

🔹 API-DOCS:
   🌐 GET    /api-docs - Swagger UI dokumentace
   🌐 GET    /api-docs/openapi.json - OpenAPI JSON specifikace
   🌐 GET    /api-docs/postman.json - Postman kolekce

=====================================
```

**Legend**:

- 🌐 = Public endpoint (no authentication required)
- 🔒 = Protected endpoint (JWT authentication required)

## Usage Examples

### 1. Listing All Endpoints

```bash
# Get complete endpoint registry
curl http://localhost:3001/api/endpoints

# Response
{
  "success": true,
  "data": {
    "endpoints": [
      {
        "path": "/health",
        "method": "GET",
        "description": "Kontrola zdraví serveru",
        "authenticated": false
      }
      // ... more endpoints
    ],
    "count": 19
  }
}
```

### 2. Checking Endpoint Health

```bash
# Get health status of all endpoints
curl http://localhost:3001/api/health/endpoints

# Response includes summary and individual endpoint health
```

### 3. Integration with Monitoring

```javascript
// Example monitoring script
const checkApiHealth = async () => {
  const response = await fetch('http://localhost:3001/api/health/endpoints');
  const health = await response.json();

  const unhealthyEndpoints = health.data.endpoints.filter(
    endpoint => endpoint.status !== 'healthy'
  );

  if (unhealthyEndpoints.length > 0) {
    console.warn('Unhealthy endpoints detected:', unhealthyEndpoints);
    // Send alert to monitoring system
  }
};

// Run health check every 5 minutes
setInterval(checkApiHealth, 5 * 60 * 1000);
```

## Integration with External Systems

### Prometheus Metrics

The endpoint registry integrates with the Prometheus monitoring system:

```typescript
// Metrics exported for each endpoint
const endpointCalls = new promClient.Counter({
  name: 'api_endpoint_calls_total',
  help: 'Total number of API endpoint calls',
  labelNames: ['endpoint', 'method', 'status'],
});

const endpointDuration = new promClient.Histogram({
  name: 'api_endpoint_duration_seconds',
  help: 'API endpoint response time',
  labelNames: ['endpoint', 'method'],
});
```

Access metrics at: http://localhost:3001/metrics

### Health Check Integration

The registry integrates with the main health check system:

```typescript
// Main health check includes endpoint registry status
app.get('/health', async (req, res) => {
  const endpointHealth = await getEndpointRegistryHealth();

  return ResponseHelper.success(res, {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    components: {
      database: dbHealth,
      endpoints: endpointHealth,
      monitoring: monitoringHealth,
    },
  });
});
```

## Future Enhancements

### Planned Features

1. **Dynamic Route Discovery**: Automatic detection of new routes without manual registration
2. **Advanced Analytics**: Request patterns, peak usage times, geographical distribution
3. **Performance Alerts**: Automatic alerts for endpoints with degraded performance
4. **Rate Limiting Integration**: Per-endpoint rate limiting based on usage patterns
5. **Endpoint Versioning**: Track and manage multiple versions of endpoints
6. **Security Monitoring**: Detection of unusual access patterns or potential attacks

### API Gateway Integration

The endpoint registry is designed to support future API gateway integration:

- **Service Discovery**: Automatic registration with service discovery systems
- **Load Balancing**: Health-based routing decisions
- **Circuit Breaker**: Automatic failure detection and recovery
- **Traffic Shaping**: Request routing based on endpoint health and performance

## Troubleshooting

### Common Issues

#### 1. Missing Endpoints in Registry

If endpoints don't appear in the registry:

```typescript
// Ensure endpoints are registered in setupRoutes()
registerRoute({
  path: '/api/your-endpoint',
  method: 'POST',
  description: 'Your endpoint description',
  authenticated: true,
});
```

#### 2. Incorrect Health Status

If health checks report incorrect status:

```bash
# Check individual endpoint manually
curl -I http://localhost:3001/api/your-endpoint

# Verify endpoint is accessible and returns expected status
```

#### 3. Missing Usage Statistics

If usage statistics aren't being collected:

```typescript
// Ensure endpoint tracker middleware is applied
app.use(createEndpointTracker());

// Middleware must be applied before route handlers
```

### Debug Mode

Enable detailed logging for the endpoint registry:

```bash
# Set environment variable
export ENDPOINT_REGISTRY_DEBUG=true

# Start server with debug logging
npm run dev
```

Debug mode provides detailed information about:

- Route registration process
- Health check execution
- Statistics collection
- Middleware application

The endpoint registry system provides comprehensive visibility and control over the Cell Segmentation Hub API, enabling effective monitoring, debugging, and optimization of API performance and reliability.
