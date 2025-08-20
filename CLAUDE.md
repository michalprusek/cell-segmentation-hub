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

1. Always use Docker environment (`make up` to start)
2. Query knowledge system for existing patterns and solutions
3. Check if translations need updates for UI changes

**During development:** 4. Run `npm run dev` for frontend development with hot reload 5. Use `make logs-f` to monitor all services 6. Test changes with `npm run test` and `npm run test:e2e` 7. Validate translations with `npm run i18n:validate` if applicable

**Before committing:** 8. The pre-commit hook automatically runs comprehensive checks 9. All checks must pass (ESLint, Prettier, TypeScript, security) 10. Use conventional commit format (feat:, fix:, chore:, etc.)

**Quality assurance:** 11. Always run `npm run type-check` and `npm run lint` before major changes 12. Use `make health` to verify all services are running correctly 13. Store learnings and solutions in the knowledge system for future reference

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
