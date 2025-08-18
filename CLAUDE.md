# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**CRITICAL: This project runs entirely in Docker containers - DO NOT use npm commands directly!**

VERY IMPORTANT: Always read relevant docs and fetch relevant documentation using available MCP servers.

VERY IMPORTANT: Use subagents often to save context. They dont have shared context with main agent, so give them comprehensive and clear instructions, also recommend them to use available knowledge systems.

## Test-Driven Development (TDD) - MANDATORY

**CRITICAL: Always follow Test-Driven Development principles!**

### TDD Workflow Requirements

**BEFORE implementing any feature or fixing any bug:**

1. **Check for existing tests**: Look for test files related to the component/feature you're modifying
2. **Write/update tests FIRST**: If no tests exist, create them. If tests exist, update them for new requirements
3. **Verify test failure**: Run the test to ensure it fails (red phase)
4. **Implement the feature**: Write minimal code to make the test pass (green phase)
5. **Refactor if needed**: Improve the code while keeping tests passing (refactor phase)
6. **Add to test suites**: Ensure new tests are included in the appropriate test suite

### Test Locations

- **Frontend unit tests**: `/src/**/*.test.ts(x)` - Run with `docker exec -it spheroseg-frontend npm run test`
- **Frontend E2E tests**: `/e2e/*.spec.ts` - Run with `docker exec -it spheroseg-frontend npm run test:e2e`
- **Backend unit tests**: `/backend/src/**/*.test.ts` - Run with `docker exec -it spheroseg-backend npm run test`
- **API integration tests**: `/backend/src/api/**/*.test.ts`

### Test Implementation Guidelines

- **Component tests**: Test user interactions, state changes, and rendered output
- **Hook tests**: Test custom hooks in isolation using `@testing-library/react-hooks`
- **API tests**: Test endpoints with different scenarios (success, validation errors, auth failures)
- **Integration tests**: Test complete user flows with Playwright
- **ML service tests**: Verify model loading, inference, and postprocessing

### Running Tests

```bash
# Frontend unit tests
docker exec -it spheroseg-frontend npm run test

# Frontend E2E tests
docker exec -it spheroseg-frontend npm run test:e2e

# Backend tests
docker exec -it spheroseg-backend npm run test

# Test with coverage
docker exec -it spheroseg-frontend npm run test:coverage
```

**REMEMBER**: No feature is complete without tests. This is not optional - it's mandatory for maintaining code quality and preventing regressions.

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

**CRITICAL: This project uses Docker exclusively. NEVER use npm/node/make commands directly - always use Docker!**

## 🚨 DEPLOYMENT STRATEGY - MANDATORY TO FOLLOW

**CRITICAL RULE: Work ONLY in staging environment. Production deployments are AUTOMATED via GitHub Actions.**

### Development & Staging Workflow

1. **ALL development work happens in STAGING**:

   ```bash
   # Work in staging environment ONLY
   docker compose -f docker-compose.staging.yml up -d
   docker compose -f docker-compose.staging.yml build
   docker compose -f docker-compose.staging.yml logs -f
   ```

2. **AUTOMATED STAGING DEPLOYMENT**:
   - **Auto-deploy script is running**: `/home/cvat/cell-segmentation-hub/scripts/auto-deploy-staging.sh`
   - Automatically pulls and deploys changes every 30 seconds
   - Just push to `staging` branch - deployment is automatic!
   - No manual intervention needed

3. **NEVER directly modify production**:
   - ❌ DO NOT use `docker-compose.prod.yml` for development
   - ❌ DO NOT manually deploy to production
   - ❌ DO NOT make changes directly on production server

4. **Production deployment via GitHub Actions ONLY**:
   - Push changes to `staging` branch → Auto-deploy to local staging
   - After testing on staging → Merge to `main` branch
   - GitHub Actions automatically deploys to production
   - This ensures all production deployments have:
     - ✅ Passed all tests
     - ✅ Built successfully in Docker
     - ✅ Been tested on staging first
     - ✅ Proper rollback capability

### Staging Environment Commands:

- **Start services**: `docker compose -f docker-compose.staging.yml up -d`
- **Stop services**: `docker compose -f docker-compose.staging.yml down`
- **Build services**: `docker compose -f docker-compose.staging.yml build [--no-cache]`
- **View logs**: `docker compose -f docker-compose.staging.yml logs -f [service]`
- **Shell access**: `docker exec -it [container-name] /bin/bash`

### Production Deployment (AUTOMATED ONLY):

**Production is deployed ONLY through GitHub Actions workflow:**

1. Push to `staging` branch and test thoroughly
2. Create PR from `staging` to `main`
3. Merge PR triggers automatic production deployment
4. GitHub Actions handles:
   - Database backup
   - Blue-green deployment
   - Health checks
   - Automatic rollback on failure

**Container Names:**

- `spheroseg-nginx` - Web server (nginx)
- `spheroseg-backend` - API server (Node.js)
- `spheroseg-ml` - ML service (Python)
- `spheroseg-db` - Database (PostgreSQL)
- `spheroseg-redis` - Cache (Redis)
- `spheroseg-prometheus` - Metrics
- `spheroseg-grafana` - Dashboard

### Service URLs (Docker only)

**Staging Environment (PRIMARY WORKING ENVIRONMENT):**

- **Frontend**: http://localhost:4000 ✅ **USE THIS FOR ALL DEVELOPMENT**
- **Backend API**: http://localhost:4001/api
- **ML Service**: http://localhost:4008
- **API Documentation**: http://localhost:4001/api-docs
- **Grafana**: http://localhost:3031

**Production Environment (READ-ONLY - DEPLOYED VIA GITHUB ONLY):**

- **Frontend**: https://spherosegapp.utia.cas.cz (DO NOT MODIFY DIRECTLY)
- **Backend API**: https://spherosegapp.utia.cas.cz/api
- **ML Service**: Internal only
- **Monitoring**: Internal Grafana

**IMPORTANT**:

- 🟢 Always work in STAGING (port 4000)
- 🔴 NEVER modify production directly
- 🔵 Production updates happen ONLY through GitHub Actions

### DISABLED Commands (Do NOT use)

**These commands are DISABLED and should NEVER be used:**

- ~~`make up/down/logs`~~ - Use Docker commands directly
- ~~`npm run build/lint/test`~~ - All tasks must run inside Docker containers
- ~~Direct Node.js/npm commands~~ - Everything runs in containerized environment

**Compose-only — do not run make or npm on the host; run npm inside containers via docker exec/docker-compose run.**

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

### Internationalization

Multi-language support via `LanguageContext` with translations in `/src/translations/`. The system includes comprehensive validation to ensure translation completeness across all supported languages (EN, CS, ES, DE, FR, ZH).

## Development Best Practices

### Important Reminders

- **Docker-first development**: Always use Docker Compose commands, never direct npm/node/make commands on host
- **STAGING ONLY**: All development and testing happens in staging environment (`docker-compose.staging.yml`)
- **PRODUCTION VIA GITHUB**: Production deployments happen ONLY through GitHub Actions - NEVER manually
- **File editing**: Always prefer editing existing files over creating new ones
- **Documentation**: Only create docs when explicitly requested by the user
- **Terminal safety**: Never use KillBash tool as it terminates the user's session
- **VERY IMPORTANT - MacOS Terminal Issue**: When running long commands (>30s), ALWAYS use the appropriate MCP tools for process management instead of Bash tool, as long-running Bash commands cause Claude Code terminal crashes on macOS

### Testing and Quality

- **Linting**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run lint`
- **Lint fix**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run lint:fix`
- **Type checking**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run type-check`
- **Unit tests**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run test`
- **Test UI**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run test:ui`
- **E2E tests**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run test:e2e`
- **E2E UI**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run test:e2e:ui`
- **Test coverage**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run test:coverage`
- **Formatting**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run format`
- **Format check**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run format:check`
- **API testing**: Use Swagger UI at http://localhost:3001/api-docs
- **Health checks**: Use `docker compose ps` to verify all services are running
- **Service logs**: Use `docker compose logs -f` to monitor all services in real-time

### Internationalization (i18n)

- **Translation validation**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run i18n:validate`
- **Translation check**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run i18n:check`
- **Translation lint**: Run inside frontend container: `docker exec -it spheroseg-frontend npm run i18n:lint`
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
- **Adding translations**: Add new keys to all language files in `/src/translations/`, run inside frontend container: `docker exec -it spheroseg-frontend npm run i18n:validate`
- **Database changes**:
  - Update `/backend/prisma/schema.prisma`
  - Shell into backend container: `docker exec -it spheroseg-backend /bin/bash`
  - Run migration: `npx prisma migrate dev --name your_migration_name`
  - Generate client: `npx prisma generate`
- **Viewing database**: Run inside backend container: `docker exec -it spheroseg-backend npm run db:studio`
- **Docker operations**: Use docker compose commands directly (see `docker compose --help`)
- **Running single tests**: Use Vitest filtering inside frontend container: `docker exec -it spheroseg-frontend npm run test -- --run specific-test-name`
- **Frontend debugging**: Use browser dev tools with source maps enabled in development

## Current System Status

**Production-Ready Components:**

- ✅ **Full-stack architecture**: React frontend + Node.js API + Python ML service
- ✅ **Authentication system**: JWT-based with access/refresh tokens
- ✅ **Database layer**: Prisma ORM (SQLite dev, PostgreSQL CI/prod), full CRUD operations
- ✅ **ML pipeline**: 3 production models (HRNet, ResUNet Small, ResUNet Advanced)
- ✅ **File storage**: Local storage with automatic thumbnail generation
- ✅ **API documentation**: Swagger UI with OpenAPI 3.0 specification
- ✅ **Monitoring stack**: Prometheus metrics + Grafana dashboards
- ✅ **Docker environment**: Full containerization with health checks

**Key Features Working:**

- User registration, authentication, and profile management
- Project creation and management with image uploads
- Real-time ML segmentation with polygon extraction
- Advanced polygon editing with multiple interaction modes
- Export functionality (COCO format, Excel metrics)
- Multi-language support (EN, CS, ES, DE, FR, ZH) with i18n validation
- Real-time WebSocket notifications for queue processing

**Architecture Highlights:**

- **Security**: JWT tokens stored securely, CORS configured, rate limiting
- **Performance**: Optimized Docker containers, efficient image processing
- **Scalability**: Microservices architecture, queue-based ML processing
- **Developer Experience**: Hot reload in development, comprehensive API docs
- nikdy nepřeskakuj pre-commit hook!

### Development Workflow Best Practices

**Before making changes:**

1. Always use STAGING Docker environment (`docker compose -f docker-compose.staging.yml up -d`)
2. Query knowledge system for existing patterns and solutions
3. Check if translations need updates for UI changes

**During development:** 4. Work ONLY in staging environment (port 4000) 5. Use `docker compose -f docker-compose.staging.yml logs -f` to monitor services 6. Test changes inside containers: `docker exec -it spheroseg-frontend npm run test` 7. Validate translations: `docker exec -it spheroseg-frontend npm run i18n:validate`

**Before committing:** 8. The pre-commit hook automatically runs comprehensive checks 9. All checks must pass (ESLint, Prettier, TypeScript, security) 10. Use conventional commit format (feat:, fix:, chore:, etc.) 11. Push to `staging` branch - **AUTO-DEPLOY HANDLES THE REST!**

**Automated deployment process:** 12. **Push to staging** → GitHub Actions runs tests 13. **Auto-deploy script** (running locally) detects changes within 30s 14. **Automatic rebuild** and restart of Docker containers 15. **No manual steps needed** - just commit and push!

**Production deployment:** 16. Create PR from `staging` to `main` branch 17. Merge PR triggers automatic production deployment via GitHub Actions 18. Store learnings and solutions in the knowledge system for future reference

## Recent Implementations & Important Notes

### Automated Staging Deployment

**IMPLEMENTED: Auto-deploy script for seamless staging updates**

- **Script location**: `/home/cvat/cell-segmentation-hub/scripts/auto-deploy-staging.sh`
- **Status**: Must be started manually or via systemd/Docker
- **Check interval**: Every 30 seconds
- **Process**: Automatically pulls, builds, and restarts staging when changes detected

**Three ways to run auto-deploy:**

1. **Manual (temporary)**:

   ```bash
   ./scripts/auto-deploy-staging.sh &
   ```

2. **Systemd service (permanent, recommended for Linux)**:

   ```bash
   sudo ./scripts/install-auto-deploy.sh
   ```

3. **Docker container (portable, auto-restart)**:
   ```bash
   docker compose -f docker-compose.auto-deploy.yml up -d
   ```

**How it works:**

1. Script monitors `staging` branch for new commits
2. When changes detected, automatically:
   - Pulls latest code
   - Rebuilds Docker images
   - Restarts services with zero downtime
   - Runs health checks

**GitHub Actions Integration:**

- **Repository**: PUBLIC (unlimited free Actions minutes)
- **Workflow**: `.github/workflows/staging.yml`
- **Triggers on**: Push to `staging` branch
- **Tests**: TypeScript, ESLint, unit tests (with continue-on-error for known mock issues)

### SSL Automation with Let's Encrypt

**CRITICAL: Automated SSL certificate management is now implemented for production deployments.**

#### SSL Setup Scripts:

- **Initial Setup**: `./scripts/init-letsencrypt.sh` - Run ONCE after production deployment
- **Automatic Renewal**: `./scripts/certbot-renew.sh` - Automated renewal script
- **Certificate Status**: `./scripts/check-ssl-expiry.sh` - Check certificate health

#### Production SSL Configuration:

- **Certbot Service**: Integrated into `docker-compose.prod.yml`
- **Automatic Renewal**: Runs every 12 hours via Docker container
- **Nginx Integration**: ACME challenge support at `/.well-known/acme-challenge/`
- **Certificate Location**: `/etc/letsencrypt/live/spherosegapp.utia.cas.cz/`

#### SSL Management Commands:

```bash
# Initial SSL setup (run once)
./scripts/init-letsencrypt.sh

# Check certificate status
./scripts/check-ssl-expiry.sh

# Manual renewal (if needed)
./scripts/certbot-renew.sh

# Start automatic renewal service
docker compose -f docker-compose.prod.yml up -d certbot
```

### Business Metrics & Advanced Monitoring

**MAJOR: Comprehensive business metrics system implemented alongside infrastructure monitoring.**

#### Custom Business Metrics Available:

- **User Activity**: Registrations, logins, active users (daily/weekly/monthly)
- **Project Metrics**: Projects created, active projects, images uploaded, average images per project
- **Segmentation Analytics**: Request counts, processing times, queue lengths, model usage distribution
- **Storage Tracking**: Storage used by type, per-user storage usage
- **Export Statistics**: Export counts by format, processing times
- **Error Tracking**: Business-level errors by type and operation

#### Metrics Endpoints:

- **Combined Metrics**: `GET /metrics` - Infrastructure + business metrics (Prometheus format)
- **Business Only**: `GET /api/metrics/business` - Business metrics only
- **Infrastructure Only**: `GET /api/metrics` - Infrastructure metrics only
- **Health Check**: `GET /api/metrics/health` - Metrics system health status
- **Admin Stats**: `GET /api/metrics/stats` - JSON summary for admin dashboard (requires auth)
- **Refresh**: `POST /api/metrics/refresh` - Manual metrics refresh (admin only)

#### Grafana Dashboard:

- **Configuration**: See `/monitoring/business-dashboard-config.md`
- **Access**: http://localhost:3030 (use GRAFANA_ADMIN_PASSWORD)
- **Dashboards**: Infrastructure + Business metrics with alerts
- **Data Collection**: Automatic every 5 minutes + real-time tracking

#### Prometheus Scraping:

- **Combined Metrics**: `backend:3001/metrics` (30s interval)
- **Business Metrics**: `backend:3001/api/metrics/business` (60s interval)
- **Data Retention**: 30 days (configurable in prometheus.yml)

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

- nikdy neobcházej husky commit!
