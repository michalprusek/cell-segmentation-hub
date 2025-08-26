# CI/CD, Deployment & Production Fixes - Cell Segmentation Hub

**Transferred from ByteRover memories - Production deployment and CI/CD knowledge**

## CI/CD Pipeline Architecture

### GitHub Actions Workflow

- **Triggers**: Push to main, pull requests
- **Environment**: Ubuntu with Docker support
- **Services**: PostgreSQL, Redis for testing
- **Browsers**: Chromium for E2E testing
- **Caching**: Node modules, Docker layers

### Build Process

1. **Dependency Installation**: npm ci with exact versions
2. **Type Checking**: TypeScript compilation validation
3. **Linting**: ESLint with strict rules
4. **Unit Tests**: Vitest with coverage reporting
5. **Integration Tests**: API testing with test database
6. **E2E Tests**: Playwright with service health checks
7. **Build Validation**: Production build testing

## Production Docker Configuration

### Multi-stage Builds

```dockerfile
# Frontend (Alpine-based for size)
FROM node:18-alpine AS frontend-build
RUN apk add --no-cache cairo-dev pango-dev pixman-dev
# ... build process

# Backend (Debian for native modules)
FROM node:18-bullseye AS backend-build
RUN apt-get update && apt-get install -y python3 build-essential
# ... build process

# ML Service (Python with PyTorch)
FROM python:3.9-slim AS ml-service
RUN apt-get update && apt-get install -y gcc
# ... ML dependencies
```

### Build Dependencies Resolution

- **Frontend**: Canvas support (Cairo, Pango, Pixman)
- **Backend**: Native modules (node-gyp, Python build tools)
- **ML Service**: PyTorch, OpenCV, scientific libraries
- **Database**: PostgreSQL client libraries

## Blue-Green Deployment System

### Environment Structure

- **Blue Environment**: Staging (ports 4000-4008)
- **Green Environment**: Production (ports 5000-5008)
- **nginx Router**: Traffic switching between environments
- **Database Separation**: Independent databases per environment

### Deployment Process

```bash
# Automated zero-downtime deployment
./scripts/deploy-blue-green.sh
  ├── Detect current active environment
  ├── Deploy to inactive environment
  ├── Run database migrations
  ├── Health check new deployment
  ├── Switch nginx routing
  └── Keep old environment for rollback

# Emergency rollback (seconds)
./scripts/rollback-deployment.sh
```

### Critical Configuration Files

- `docker-compose.staging.yml` - Blue environment
- `docker-compose.production.yml` - Green environment
- `docker/nginx/nginx.prod.conf` - Routing configuration
- `.env.blue` / `.env.green` - Environment variables

## Production Fixes Applied

### Docker Build Issues Resolved

1. **Node Canvas Dependencies**: Added Cairo, Pango, Pixman
2. **Python Build Tools**: Essential for ML service compilation
3. **JWT Secret Management**: Environment-specific secrets
4. **Network Configuration**: Isolated Docker networks
5. **Volume Permissions**: Proper user permissions (1001:1001)

### CI/CD Fixes Implemented

1. **PostgreSQL Service**: Test database with ephemeral storage
2. **Health Check Timing**: Proper service startup waiting
3. **Environment Variables**: CI-specific configurations
4. **Test Database**: Separate test database URL
5. **Playwright Setup**: Browser installation and configuration

### Production Environment Variables

```bash
# Required for Blue-Green deployment
export STAGING_JWT_ACCESS_SECRET=<blue-secret>
export STAGING_JWT_REFRESH_SECRET=<blue-secret>
export FROM_EMAIL=spheroseg@utia.cas.cz
export WS_ALLOWED_ORIGINS=https://spherosegapp.utia.cas.cz
```

## Service Health Checks

### Health Check Endpoints

- **Frontend**: `GET /health` (200 OK)
- **Backend**: `GET /api/health` (service status)
- **ML Service**: `GET /health` (model readiness)
- **Database**: Connection validation
- **WebSocket**: Connection test

### Health Check Implementation

```typescript
// Backend health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      ml_service: 'available',
      websocket: 'active',
    },
  });
});
```

## Performance Optimizations

### Build Optimizations

- **Multi-stage Builds**: Reduced image sizes
- **Layer Caching**: Docker build cache optimization
- **Dependency Management**: Exact version pinning
- **Bundle Optimization**: Code splitting and tree shaking

### Runtime Optimizations

- **Resource Limits**: Memory and CPU constraints
- **Connection Pooling**: Database connection management
- **Caching Strategies**: Static asset caching
- **Compression**: Gzip compression for API responses

## Monitoring & Observability

### Metrics Collection

- **Prometheus**: Application and system metrics
- **Grafana**: Real-time dashboards
- **Health Checks**: Service availability monitoring
- **Log Aggregation**: Centralized logging

### Production Monitoring

- **Response Times**: API endpoint performance
- **Error Rates**: Application error tracking
- **Resource Usage**: CPU, memory, disk utilization
- **Queue Metrics**: ML processing queue statistics

## Security in Production

### Authentication Security

- **JWT Rotation**: Access and refresh token management
- **CORS Configuration**: Environment-specific origins
- **Rate Limiting**: API abuse prevention
- **Input Validation**: Request sanitization

### Network Security

- **nginx Proxy**: SSL termination and security headers
- **Docker Networks**: Service isolation
- **Firewall Rules**: Port access control
- **SSL/TLS**: HTTPS encryption throughout

## Backup and Recovery

### Database Backups

- **Automated Backups**: Daily database snapshots
- **Blue-Green Safety**: Separate environment databases
- **Migration Safety**: Backup before deployments
- **Recovery Testing**: Regular backup validation

### File Storage Backups

- **Upload Directory**: User image backups
- **Thumbnail Cache**: Regeneratable thumbnails
- **ML Model Weights**: Version-controlled models

## Common Production Issues & Fixes

### Build Failures

- **Canvas Dependencies**: Alpine vs Debian base images
- **Python Build Tools**: gcc, python3-dev requirements
- **Node Native Modules**: node-gyp compilation issues

### Runtime Issues

- **Port Conflicts**: Docker port allocation
- **Permission Errors**: File system permissions (1001:1001)
- **Database Connections**: Connection pool exhaustion
- **WebSocket CORS**: Origin validation failures

### Deployment Issues

- **Environment Variables**: Missing or incorrect values
- **Health Check Timeouts**: Service startup delays
- **nginx Configuration**: Upstream server routing
- **SSL Certificate**: HTTPS configuration problems
