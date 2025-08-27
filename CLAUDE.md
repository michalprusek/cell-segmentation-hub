# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**CRITICAL: This project runs entirely in Docker containers - DO NOT use npm commands directly!**

VERY IMPORTANT: Always read relevant docs and fetch relevant documentation using available MCP servers.

VERY IMPORTANT: Use subagents often to save context. They dont have shared context with main agent, so give them comprehensive and clear instructions, also recommend them to use available knowledge systems.

## Knowledge Management System

**Knowledge storage and retrieval** is available through the connected MCP servers for storing and retrieving application knowledge, best practices, and implementation details.

### Usage Guidelines

**ALWAYS use knowledge systems when:**

- **Planning tasks**: Retrieve relevant knowledge before starting implementation
- **Solving problems**: Check for existing solutions and patterns
- **After completing work**: Store insights, solutions, and best practices
- **Debugging issues**: Look for similar problems and their resolutions

### Knowledge Storage Strategy

Store these types of information in the knowledge system:

- **Code patterns**: Successful implementation approaches for common tasks
- **Bug fixes**: Solutions to specific errors and their root causes
- **Architecture decisions**: Why certain technical choices were made
- **Configuration solutions**: Docker, database, and service setup fixes
- **Performance optimizations**: Techniques that improved application performance
- **API integrations**: Working examples of third-party service integrations
- **Testing approaches**: Effective testing strategies and test case patterns

### Retrieval Best Practices

Before starting work, query the knowledge system for:

- Similar features or components already implemented
- Known issues and their solutions related to your task
- Established patterns for the type of work you're doing
- Configuration requirements for related services

### Example Queries

- "React hook patterns for data fetching"
- "Docker container debugging techniques"
- "Prisma database migration best practices"
- "TypeScript error resolution strategies"
- "ML model integration patterns"

**Remember**: The knowledge system serves as the project's institutional memory - use it to avoid repeating work and to build upon proven solutions.

### Docker Environment (Required)

- **Start all services**: `make up` or `make dev-setup`
- **View logs**: `make logs-f` (all services) or `make logs-fe`/`make logs-be`/`make logs-ml`
- **Stop services**: `make down`
- **Health check**: `make health` or `make test`
- **Reset environment**: `make reset` (clean + rebuild)
- **Shell access**: `make shell-fe`/`make shell-be`/`make shell-ml`

### Service URLs (Docker only)

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **ML Service**: http://localhost:8000
- **API Documentation**: http://localhost:3001/api-docs
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3030

**Note**: Some documentation may reference port 8082 for frontend - this is legacy. Always use port 3000 for Docker development.

### Legacy Frontend Commands (Do NOT use in development)

These only work for building static assets, but the app must run in Docker:

- `npm run build` - Production build
- `npm run lint` - Code linting
- `npm run preview` - Preview build (but use Docker for development)

### Docker Build Commands (Use Desktop Commander MCP)

**IMPORTANT: Use Desktop Commander MCP for long-running build operations to prevent macOS terminal crashes**

- For Docker builds longer than 30s, use `mcp__desktop-commander__start_process` instead of Bash tool
- Example: `mcp__desktop-commander__start_process("docker compose build backend", 600000)`
- Monitor with `mcp__desktop-commander__read_process_output` and `mcp__desktop-commander__interact_with_process`

## Project Architecture

This is a React-based cell segmentation application with a full-stack microservices architecture. The system consists of three main services running in Docker containers:

### Core Technologies

- **Frontend**: React 18 + TypeScript + Vite (port 3000)
- **Backend API**: Node.js + Express + TypeScript (port 3001)
- **ML Service**: Python + FastAPI + PyTorch (port 8000)
- **Database**: SQLite (development) / PostgreSQL (CI/production) with Prisma ORM
- **Authentication**: JWT access/refresh tokens
- **UI Framework**: shadcn/ui components with Radix UI primitives
- **Styling**: Tailwind CSS
- **State Management**: React Query for server state, React Context for client state
- **Monitoring**: Prometheus + Grafana stack

### Key Directory Structure

**Frontend (React/TypeScript):**

- `/src/pages/` - Main application pages (Dashboard, ProjectDetail, SegmentationEditor)
- `/src/pages/segmentation/` - Complex segmentation editor with advanced polygon editing
- `/src/components/` - Reusable UI components organized by feature
- `/src/contexts/` - React contexts (Auth, Theme, Language, Model, WebSocket)
- `/src/hooks/` - Custom React hooks for data fetching and state management
- `/src/lib/` - Utility libraries (API client, image processing, segmentation algorithms)

**Backend (Node.js/Express):**

- `/backend/src/api/` - Controllers and routes for REST API
- `/backend/src/services/` - Business logic services
- `/backend/src/middleware/` - Authentication, validation, error handling, monitoring
- `/backend/src/storage/` - File storage abstraction layer
- `/backend/prisma/` - Database schema and migrations

**ML Service (Python/FastAPI):**

- `/backend/segmentation/api/` - FastAPI routes and models
- `/backend/segmentation/services/` - ML inference and postprocessing
- `/backend/segmentation/models/` - PyTorch model definitions (HRNet, ResUNet variants)
- `/backend/segmentation/weights/` - Pre-trained model weights

### Segmentation Editor Architecture

The segmentation editor (`/src/pages/segmentation/`) is the most complex part of the application:

- **Main Editor**: `SegmentationEditor.tsx` orchestrates the entire editing experience
- **Canvas System**: Located in `components/canvas/` - handles image display, polygon rendering, and interactive editing
- **Edit Modes**: Supports multiple editing modes including point addition, polygon modification, and slicing
- **Polygon Interaction**: Complex hooks in `hooks/polygonInteraction/` manage geometry operations, vertex manipulation, and spatial calculations
- **Context System**: Uses React Context to share segmentation state across components
- **Export System**: Supports COCO format export and Excel-based metrics

### Database Schema

The application uses Prisma ORM with different databases per environment:

- **Development**: SQLite (`file:./data/dev.db`)
- **CI/Testing**: PostgreSQL 15 (service container)
- **Production**: PostgreSQL (managed service)

Key tables include:

- `User` - User accounts and authentication
- `Project` - Project metadata and settings
- `ProjectImage` - Image files and processing status
- `SegmentationResult` - ML model results and polygon annotations
- `QueueItem` - Processing queue for ML operations

### Path Aliases

- `@/` maps to `./src/` for clean import paths

### TypeScript Configuration

- Relaxed TypeScript settings (`noImplicitAny: false`, `strictNullChecks: false`)
- Path mapping configured for `@/*` imports
- Separate configs for app and Node.js code

### Authentication Flow

Uses JWT-based authentication with access/refresh tokens. The `AuthContext` manages user state and the `ProtectedRoute` component guards authenticated pages.

### ML Models in Production

- **HRNetV2** - Best accuracy, ~3.1s inference time
- **CBAM-ResUNet** - Fastest inference, ~6.9s inference time
- **MA-ResUNet** - Most precise, ~18.1s inference time with attention mechanisms

### API Documentation

- **Swagger UI**: http://localhost:3001/api-docs (interactive documentation)
- **OpenAPI spec**: http://localhost:3001/api-docs/openapi.json
- **Endpoint registry**: http://localhost:3001/api/endpoints

### WebSocket Real-time Updates

The application uses WebSocket (Socket.io) for real-time segmentation status updates and queue notifications.

**WebSocket Events:**

- `segmentationStatus` - Updates on segmentation processing status (queued, processing, completed, failed)
- `queueStats` - Queue statistics including position and total items
- `segmentationCompleted` - Fired when segmentation finishes successfully with polygon count
- `segmentationFailed` - Fired when segmentation fails with error details
- `connectionStatus` - WebSocket connection state changes

**Key Features:**

- **Auto-reconnection**: Automatically reconnects with exponential backoff
- **Auto-refresh**: Polygons automatically reload when segmentation completes
- **Visual indicators**: Real-time connection status shown in UI
- **State persistence**: Loading states persist across page refreshes (5-minute TTL)
- **Queue position**: Shows user's position in the processing queue

**Usage in Components:**

```typescript
// Hook for WebSocket segmentation updates
const { lastUpdate, queueStats, isConnected } = useSegmentationQueue(projectId);

// Hook for reloading segmentation with retry logic
const { isReloading, reloadSegmentation } = useSegmentationReload({
  projectId,
  imageId,
  onPolygonsLoaded: setPolygons,
  maxRetries: 2,
});
```

### Internationalization

Multi-language support via `LanguageContext` with translations in `/src/translations/`. The system includes comprehensive validation to ensure translation completeness across all supported languages (EN, CS, ES, DE, FR, ZH).

## Development Best Practices

### Important Reminders

- **Docker-first development**: Always use `make` commands, never direct npm/node commands
- **File editing**: Always prefer editing existing files over creating new ones
- **Documentation**: Only create docs when explicitly requested by the user
- **Terminal safety**: Never use KillBash tool as it terminates the user's session
- **VERY IMPORTANT - MacOS Terminal Issue**: When running long commands (>30s), ALWAYS use the appropriate MCP tools for process management instead of Bash tool, as long-running Bash commands cause Claude Code terminal crashes on macOS

### Testing and Quality

**IMPORTANT: Always use Desktop Commander MCP for running tests inside Docker containers to prevent terminal timeouts**

- For Docker test commands, use `mcp__desktop-commander__start_process` instead of Bash tool
- Example: `mcp__desktop-commander__start_process("make test", 300000)`
- Note: All test commands must run inside Docker containers per Docker-first development policy

- **Linting**: Run `make lint` for code quality checks in Docker
- **Lint fix**: Run `make lint-fix` to auto-fix ESLint issues in Docker
- **Type checking**: Run `make type-check` to verify TypeScript types in Docker
- **Unit tests**: Run `make test` for Vitest unit tests in Docker (USE DESKTOP COMMANDER, timeout: 300000)
- **Test UI**: Run `make test-ui` for interactive Vitest interface in Docker
- **E2E tests**: Run `make test-e2e` for Playwright end-to-end tests in Docker (USE DESKTOP COMMANDER, timeout: 600000)
- **E2E UI**: Run `make test-e2e-ui` for interactive Playwright interface in Docker
- **Test coverage**: Run `make test-coverage` to generate coverage report in Docker (USE DESKTOP COMMANDER, timeout: 600000)
- **Formatting**: Run `npm run format` to format code with Prettier
- **Format check**: Run `npm run format:check` to check formatting without changes
- **API testing**: Use Swagger UI at http://localhost:3001/api-docs
- **Health checks**: Use `make health` to verify all services are running
- **Service logs**: Use `make logs-f` to monitor all services in real-time

### Internationalization (i18n)

- **Translation validation**: Run `npm run i18n:validate` to check translation completeness and consistency
- **Translation check**: Run `npm run i18n:check` to verify all translation keys exist
- **Translation lint**: Run `npm run i18n:lint` to lint i18n-specific rules
- **Supported languages**: English (en), Czech (cs), Spanish (es), German (de), French (fr), Chinese (zh)
- **Translation files**: Located in `/src/translations/`

### Git Hooks and Pre-commit Checks

The project uses Husky for comprehensive pre-commit validation:

**Automated Checks (Cannot be bypassed):**

- **ESLint**: Code quality with 0 warnings allowed
- **Prettier**: Code formatting verification
- **TypeScript**: Type checking for both frontend and backend
- **Security**: Prevents console.log in production code
- **Code quality**: Blocks debugger statements and merge conflict markers
- **File size**: Warns about files >1MB
- **Package consistency**: Validates package-lock.json updates

**Manual bypass** (emergency only): Use `git commit --no-verify`

**Conventional Commits**: Use format `feat:`, `fix:`, `chore:`, `docs:`, `style:`, `refactor:`, `test:`

### Common Development Tasks

- **Adding new API endpoints**: Add routes in `/backend/src/api/routes/`, controllers in `/backend/src/api/controllers/`, and update OpenAPI spec
- **Frontend components**: Create in `/src/components/` following existing patterns, use shadcn/ui primitives
- **ML model changes**: Modify `/backend/segmentation/models/` and update model loading in `/backend/segmentation/services/`
- **Adding translations**: Add new keys to all language files in `/src/translations/`, run `npm run i18n:validate` to verify
- **Database changes**:
  - Update `/backend/prisma/schema.prisma`
  - Shell into backend container: `make shell-be`
  - Run migration: `npx prisma migrate dev --name your_migration_name`
  - Generate client: `npx prisma generate`
- **Viewing database**: Run `cd backend && npm run db:studio` (opens Prisma Studio)
- **Docker operations**: All docker commands available via `make` targets (see `make help`)
- **Running single tests**: Use Vitest filtering: `npm run test -- --run specific-test-name`
- **Frontend debugging**: Use browser dev tools with source maps enabled in development

## Current System Status (Updated 2025-08-26)

**Enterprise-Grade Production Platform:**

- ✅ **Full-stack architecture**: React frontend + Node.js API + Python ML service
- ✅ **Authentication system**: JWT with email verification and refresh tokens
- ✅ **Database layer**: Prisma ORM with connection pooling (5-25 connections)
- ✅ **ML pipeline**: 3 production models with circuit breaker protection
- ✅ **File storage**: Local storage with Redis caching layer
- ✅ **API documentation**: Swagger UI with OpenAPI 3.0 specification
- ✅ **Monitoring stack**: Prometheus + Grafana + Jaeger distributed tracing
- ✅ **Docker environment**: Full containerization with health checks
- ✅ **Security hardening**: Zero console.logs, rate limiting, automated scanning
- ✅ **Performance optimization**: 62% faster tests, 60-80% reduced DB load
- ✅ **Operational excellence**: Slack/PagerDuty alerts, baseline monitoring
- ✅ **Self-maintaining**: Dependabot updates, quarterly security audits

**Key Features Working:**

- User registration with email verification
- Project creation and management with image uploads
- Real-time ML segmentation with polygon extraction
- Advanced polygon editing with multiple interaction modes
- Export functionality (COCO format, Excel metrics)
- Multi-language support (EN, CS, ES, DE, FR, ZH)
- Real-time WebSocket notifications with queue processing
- Redis session management and API caching
- Circuit breaker protection for all external services
- Multi-tier rate limiting (Anonymous/Auth/Premium/Admin)
- Distributed tracing across microservices
- Self-adjusting monitoring baselines
- Automated security vulnerability scanning

**Enterprise Infrastructure:**

- **Security**: JWT tokens, email verification, rate limiting, security scanning
- **Performance**: Redis caching, connection pooling, parallel testing
- **Scalability**: Microservices, queue-based processing, circuit breakers
- **Observability**: Prometheus metrics, Grafana dashboards, Jaeger tracing
- **Reliability**: Health checks, circuit breakers, fallback strategies
- **Maintenance**: Automated updates, security audits, TypeScript migration

## Monitoring & Observability

### Access Points

- **Prometheus**: http://localhost:9090 (metrics collection)
- **Grafana**: http://localhost:3030 (dashboards)
- **Jaeger**: http://localhost:16686 (distributed tracing)
- **Redis Commander**: http://localhost:8081 (cache inspection)

### Key Dashboards

- **Business Overview**: Active users, queue status, feature usage
- **Performance Dashboard**: Resource utilization, API performance
- **Security Metrics**: Vulnerability trends, rate limit violations
- **Baseline Analysis**: Statistical thresholds, anomaly detection

### Alert Channels

- **Slack**: `/alerts` command for interactive management
- **PagerDuty**: Incident creation with escalation policies
- **Email**: HTML notifications with system metrics

## Security & Compliance

### Security Features

- **Rate Limiting**: 4-tier system with cost-based limiting
- **Circuit Breakers**: Service-specific protection with fallbacks
- **Security Scanning**: CodeQL, Trivy, TruffleHog, GitLeaks
- **Dependency Updates**: Daily Dependabot checks
- **Quarterly Audits**: Automated security assessment framework

### Security Commands

```bash
npm run security:check        # Check for console.log and secrets
npm run security:audit:full   # Complete security audit
node scripts/security-audit/generate-audit-report.js
```

## Performance Optimizations

### Caching Strategy

- **Redis**: Session management, API responses, ML results
- **Cache Keys**: User-scoped with intelligent TTL management
- **Invalidation**: Pattern-based with automatic triggers

### Database Optimization

- **Connection Pooling**: 5-25 connections for production
- **Query Monitoring**: Slow query detection and alerting
- **Performance Baselines**: P50, P95, P99 tracking

### Test Performance

```bash
npm run test:parallel    # 4-thread execution (45s)
npm run test:critical   # Essential tests only (8s)
npm run test:performance # Performance suite
```

## Operational Procedures

### Daily Operations

```bash
# Morning checks
node scripts/monitoring/collect-baselines.js --range=24h
make health
make logs-f

# Review alerts
curl http://localhost:3001/api/webhooks/alerts/summary
```

### Weekly Tasks

```bash
# TypeScript migration checkpoint
bash scripts/weekly-checkpoints/week${WEEK}-checkpoint.sh

# Performance review
node scripts/monitoring/generate-performance-report.js

# Security check
npm run security:check
```

### Monthly Tasks

```bash
# Dependency review
npm outdated
npm audit

# TypeScript migration progress
npm run migration-report

# Capacity planning
node scripts/monitoring/capacity-planning.js
```

### Quarterly Tasks

```bash
# Security audit
npm run security:audit:full

# Dependency license review
node scripts/dependency-review/license-audit.js

# Generate security scorecard
node scripts/security-audit/generate-scorecard.js
```

## Recent Implementations & Important Notes

### Storage Space Indicator (Dashboard)

- **Backend Endpoint**: `GET /api/auth/storage-stats` - Returns user's total storage usage
- **Frontend**: Replaced average segmentation time with storage usage indicator in dashboard
- **Location**: `StatsOverview` component shows storage in MB/GB with HardDrive icon from lucide-react
- **Translation keys**: Already exist - `dashboard.storageUsed` in all language files

### Critical Import Paths

- **Backend Prisma imports**: Use stable import aliases like `@db/prisma` or `@/db` instead of fragile relative paths. Configure TypeScript path aliases in `tsconfig.json` paths and update bundler/module resolution configs (webpack/ts-node/next) so imports work from any directory depth. Example alias: `"@db/*": ["./src/db/*"]` then use `import { prisma } from '@db/prisma'`. Relative fallback `import { prisma } from '../../db'` may be used but is discouraged.
- **This is essential** - wrong import path causes MODULE_NOT_FOUND errors and backend crash

### WebSocket Segmentation Queue Fix

- **Problem**: WebSocket disconnecting with "transport close" and not reconnecting
- **Solution**: Enable Socket.io auto-reconnection, add keep-alive pings, fix disconnect handling
- **Key settings**: `reconnection: true`, ping interval every 25s, proper reconnect event handlers
- **Location**: `/src/services/webSocketManager.ts`

## Blue-Green Deployment System

### ⚠️ CRITICAL DATABASE SAFETY WARNING

**VŽDY PŘED DEPLOYMENTEM:**

1. **ZÁLOHA DATABÁZE JE POVINNÁ** - deployment skripty to dělají automaticky, ale vždy zkontroluj!
2. **Nikdy neměň docker-compose volumes sekci** - může způsobit ztrátu dat
3. **Databáze jsou ODDĚLENÉ** - blue má `spheroseg_blue`, green má `spheroseg_green`
4. **Při rollbacku se data NEVRACÍ** - rollback vrátí jen kód, ne databázi

### Current Production Setup (AKTUALIZOVÁNO 20.8.2025)

**DŮLEŽITÉ**: Produkce nyní běží na **BLUE** prostředí (porty 4000-4008), nikoliv staging!

- Blue prostředí je aktivní a nginx směřuje na `blue-backend`, `blue-frontend`, `blue-ml`
- Green prostředí (porty 5000-5008) je připraveno pro další deployment

### Deployment Strategy

The system uses **Blue-Green deployment** for zero-downtime releases:

1. **Two identical environments**:
   - **Staging** (Blue): Ports 4000-4008, database: spheroseg_staging
   - **Production** (Green): Ports 5000-5008, database: spheroseg_production
   - **Nginx**: Routes traffic to active environment via `docker/nginx/nginx.prod.conf`

2. **Deployment Process**:

   ```bash
   # VŽDY NEJDŘÍV - zkontroluj aktivní prostředí!
   docker ps | grep -E "blue|green"

   # Deploy new version (automatic zero-downtime)
   ./scripts/deploy-blue-green.sh

   # Emergency rollback (takes seconds) - POZOR: nevrací data!
   ./scripts/rollback-deployment.sh

   # Health check both environments
   ./scripts/deployment-health-check.sh
   ```

   **⚠️ POZOR NA NGINX KONFIGURACI:**
   - Vždy zkontroluj, že nginx upstream směřuje na správné kontejnery
   - Aktuálně musí být: `server blue-backend:3001`, NE `staging-backend`!

3. **How it works**:
   - Detects current active environment from nginx config
   - Backs up database before deployment
   - Deploys new version to inactive environment
   - Runs database migrations automatically
   - Switches nginx routing (milliseconds downtime)
   - Keeps old environment running for instant rollback

4. **Key files**:
   - `docker-compose.staging.yml` - Staging environment config
   - `docker-compose.production.yml` - Production environment config (new)
   - `docker/nginx/nginx.prod.conf` - Nginx routing configuration
   - `scripts/deploy-blue-green.sh` - Main deployment script
   - `scripts/rollback-deployment.sh` - Emergency rollback script
   - `scripts/deployment-health-check.sh` - Health monitoring
   - `docs/DEPLOYMENT.md` - Full deployment documentation

5. **Port mapping**:
   - **Staging**: Frontend 4000, Backend 4001, ML 4008, Grafana 3031
   - **Production**: Frontend 5000, Backend 5001, ML 5008, Grafana 3032
   - **Public**: https://spherosegapp.utia.cas.cz (nginx on 80/443)

6. **Current status**:
   - **Active environment**: staging (serving production traffic)
   - **Next deployment**: Will automatically go to production environment
   - **Databases**: Separate (spheroseg_staging, spheroseg_production)
   - **File storage**: Separate directories per environment

### Nginx Routing - KRITICKÉ BODY

**WebSocket podpora (MUSÍ BÝT!):**

```nginx
location /socket.io/ {
    proxy_pass http://backend/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    # WebSocket timeouts - důležité pro real-time notifikace
    proxy_connect_timeout 7d;
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;
}
```

**API routing fix:**

- **Issue**: API routes returning 404 due to incorrect rewrite rule
- **Solution**: Changed from `rewrite ^/api/(.*)$ /api/$1 break;` to `proxy_pass http://backend/api/;`
- **Location**: `/docker/nginx/nginx.prod.conf` line 132
- **Test**: `curl -X POST https://spherosegapp.utia.cas.cz/api/auth/login`

### Environment Variables - POVINNÉ PRO BLUE/GREEN

**Při spuštění docker-compose VŽDY exportuj:**

```bash
export STAGING_JWT_ACCESS_SECRET=<hodnota z .env.blue>
export STAGING_JWT_REFRESH_SECRET=<hodnota z .env.blue>
export FROM_EMAIL=spheroseg@utia.cas.cz
```

**WebSocket CORS - MUSÍ být nastaveno:**

- V `.env.blue` nebo `.env.green`: `WS_ALLOWED_ORIGINS=https://spherosegapp.utia.cas.cz`
- V docker-compose.yml environment sekci obou!

### Upload Permissions - KRITICKÉ

**Složky musí mít správná oprávnění (UID 1001):**

```bash
sudo chown -R 1001:1001 /home/cvat/cell-segmentation-hub/backend/uploads/blue/
sudo chown -R 1001:1001 /home/cvat/cell-segmentation-hub/backend/uploads/green/
```

**Podsložky MUSÍ existovat:**

- `/images`
- `/thumbnails`
- `/temp`

## Email Service Configuration

### Local Development - MailHog

The project includes MailHog for local email testing. All emails are captured locally and viewable through web UI.

**Configuration (automatic with `make up`):**

- SMTP Server: mailhog:1025
- Web UI: http://localhost:8025
- Sender: spheroseg@utia.cas.cz
- All emails are captured locally, not sent externally

**View sent emails:**

```bash
open http://localhost:8025
```

### Production - UTIA SMTP Server

For production or real email testing, use UTIA SMTP configuration:

**Configuration file:** `.env.utia`

- Host: mail.utia.cas.cz
- Port: 465 (SSL/TLS)
- Sender: spheroseg@utia.cas.cz
- Authentication: Required (add password to SMTP_PASS)

**Activate UTIA config:**

```bash
# 1. Add password to .env.utia
# 2. Restart backend with UTIA config
make restart-backend-utia
```

### Testing Email Service

**Test endpoints (development only):**

- `GET /api/test-email/test-connection` - Test SMTP connection
- `POST /api/test-email/send-test` - Send test email

**Features using email service:**

- Password reset - sends reset link via email
- Project sharing - sends invitation emails
- Both properly configured and tested ✅

### Makefile Commands

```bash
make test-email-mailhog    # Info about MailHog testing
make test-email-utia       # Info about UTIA SMTP testing
make restart-backend-utia  # Restart backend with UTIA config
```

- vždy používej desktop commander k získání logs!

## Enterprise Features Summary (Added 2025-08-26)

### 🛡️ Security Layer

- **Authentication**: JWT + Email verification with multilingual support
- **Authorization**: Role-based access control with user tiers
- **Rate Limiting**: 4-tier system (Anonymous: 20/min, Auth: 60/min, Premium: 120/min, Admin: 500/min)
- **DDoS Protection**: Automatic IP blocking after 10 violations
- **Security Scanning**: CodeQL, Trivy, TruffleHog, GitLeaks
- **Audit Logging**: Comprehensive activity tracking with retention policies

### ⚡ Performance Layer

- **Caching**: Redis with 60-80% database load reduction
- **Connection Pooling**: 5-25 connections optimized for production
- **Circuit Breakers**: Service-specific protection with fallback strategies
- **Parallel Testing**: 62% faster execution with 4-thread support
- **Lazy Loading**: Code splitting and async component loading
- **Image Optimization**: Automatic thumbnail generation and caching

### 📊 Monitoring Layer

- **Business Metrics**: 50+ custom metrics for user activity and feature usage
- **Technical Metrics**: CPU, memory, network, and disk utilization
- **Distributed Tracing**: OpenTelemetry with Jaeger visualization
- **Error Tracking**: Centralized aggregation with severity classification
- **Performance Baselines**: P50/P95/P99 statistical monitoring
- **Alert Correlation**: Multi-metric validation to reduce false positives

### 🔄 Automation Layer

- **Dependency Updates**: Daily Dependabot scans with grouped PRs
- **Security Audits**: Quarterly automated reviews with scoring
- **TypeScript Migration**: 4-week phased migration tools
- **Alert Management**: Self-adjusting thresholds based on baselines
- **Backup & Recovery**: Automated database backups before deployments
- **CI/CD Pipeline**: Pre-commit hooks, security scanning, E2E tests

## Quick Command Reference

### Security & Quality

```bash
npm run security:check         # Check for security issues
npm run security:audit:full    # Complete security audit
npm run type-check:all         # Full TypeScript validation
npm run lint:fix              # Fix linting issues
npm run test:critical         # 8-second smoke test
npm run test:parallel         # Fast parallel tests (45s)
```

### Monitoring & Operations

```bash
# Baseline collection
node scripts/monitoring/collect-baselines.js --range=7d

# Rate limit tuning
node scripts/monitoring/tune-rate-limits.js --analyze

# Alert management (in Slack)
/alerts status
/alerts silence <alert-name> <duration>
/alerts test

# Performance reports
node scripts/monitoring/generate-performance-report.js
```

### Migration & Maintenance

```bash
# TypeScript migration
npm run migration:validate
bash scripts/weekly-checkpoints/week1-checkpoint.sh

# Dependency review
npm outdated
npm audit fix

# Database management
npx prisma migrate dev
npx prisma studio
```

## Operational Runbooks

### Incident Response

1. Check Grafana dashboards for anomalies
2. Review Jaeger traces for failed requests
3. Check circuit breaker status: `curl http://localhost:3001/api/resilience/health`
4. Review rate limit violations: `curl http://localhost:3001/api/admin/rate-limits/violations`
5. Check Redis cache status: `redis-cli ping`

### Performance Degradation

1. Review slow query logs in Grafana
2. Check database pool utilization: `curl http://localhost:3001/api/database/metrics`
3. Analyze cache hit rates: `curl http://localhost:3001/api/cache/stats`
4. Review circuit breaker metrics for service failures
5. Check ML processing queue length

### Security Incident

1. Review security dashboard for vulnerability trends
2. Check rate limit violations for attack patterns
3. Review audit logs for suspicious activity
4. Run security scan: `npm run security:audit:full`
5. Generate incident report: `node scripts/security-audit/generate-incident-report.js`

## Important Production Configurations

### Environment Variables (Production)

```bash
# Security
REQUIRE_EMAIL_VERIFICATION=true
JWT_ACCESS_SECRET=<strong-secret>
JWT_REFRESH_SECRET=<strong-secret>

# Performance
REDIS_URL=redis://redis:6379
DATABASE_CONNECTION_LIMIT=25
RATE_LIMIT_WINDOW_MS=60000

# Monitoring
ENABLE_TRACING=true
JAEGER_ENDPOINT=http://jaeger:14268/api/traces
PROMETHEUS_PORT=9090

# Alerts
SLACK_WEBHOOK_URL=<webhook-url>
PAGERDUTY_API_KEY=<api-key>
ALERT_EMAIL_RECIPIENTS=ops@example.com
```

### Health Check Endpoints

- **Overall Health**: GET /health
- **Database Health**: GET /api/database/health
- **Redis Health**: GET /api/cache/health
- **ML Service Health**: GET /api/ml/health
- **Monitoring Health**: GET /metrics

## Session Context

This codebase has been enhanced with 25 comprehensive improvements (2025-08-26):

- 21 technical improvements (security, performance, monitoring)
- 4 operational excellence tasks (baselines, alerts, migration, audits)

All systems are production-ready with enterprise-grade security, monitoring, and self-maintaining automation.
