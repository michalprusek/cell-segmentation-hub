# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## 🔍 Session Start Protocol

**ALWAYS at the beginning of each session:**

```bash
# Get repository context
git status          # Check current branch and changes
git log --oneline -10  # Review recent commits
git ls-files | head -20  # See project structure
cat .active-environment  # Check active environment (if exists)
```

This helps understand the current state, branch, uncommitted changes, and recent work history before starting any task.

## ⚠️ PRODUCTION SAFETY WARNING ⚠️

**NEVER modify or deploy to production environments without explicit permission!**

**⚠️ CRITICAL: ALWAYS check @.active-environment file to determine which environment is currently active!**

- **Blue Environment (Ports 4000-4008)**: Production environment
- **Green Environment (Ports 5000-5008)**: Staging/Secondary production - for testing & zero-downtime deployments
- **Local Development (Ports 3000-3001)**: Use for all development work

**Note:** The active environment can change! Never assume which is active - always verify!

## Core Development Guidelines

### Docker-First Development

**CRITICAL: This project runs entirely in Docker containers - NEVER use npm/node commands directly!**

#### Essential Commands

```bash
# Development
make up              # Start all services
make down            # Stop services
make logs-f          # View logs (all services)
make health          # Health check
make reset           # Clean rebuild

# Service Access
make shell-fe        # Frontend shell
make shell-be        # Backend shell
make shell-ml        # ML service shell

# Testing (use Desktop Commander MCP for long-running tests)
make lint            # Linting
make type-check      # TypeScript check
make test            # Unit tests
make test-e2e        # E2E tests
```

#### 🚀 Optimized Docker Build System

**New intelligent build system with automatic cache management:**

```bash
# Optimized builds with automatic cleanup
make build-optimized     # Smart build with pre-cleanup
make build-clean        # Full rebuild without cache
make build-service SERVICE=frontend  # Build specific service

# Docker storage management
make docker-usage       # Show current Docker disk usage
make optimize-storage   # Run optimization (keeps recent images)
make deep-clean        # Aggressive cleanup (removes more)

# Manual scripts for advanced control
./scripts/smart-docker-build.sh --env blue --service backend
./scripts/docker-build-optimizer.sh --aggressive --dry-run
```

**Build Optimization Features:**

- **Automatic cache cleanup** before builds to prevent disk overflow
- **Multi-stage builds** reducing image sizes by 40-60%
- **Cache mounting** for npm/pip packages (faster rebuilds)
- **Parallel builds** when building multiple services
- **Smart image tagging** with environment and timestamp
- **Keeps only 2 latest images** per service (configurable)

**Expected Size Reductions:**

- ML Service: 8GB → 3-5GB (60% reduction)
- Frontend: 2GB → 600MB (70% reduction)
- Backend: 1.5GB → 750MB (50% reduction)

#### Service URLs

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- ML Service: http://localhost:8000
- API Docs: http://localhost:3001/api-docs

### Knowledge Management

**ALWAYS use knowledge systems (MCP servers) for:**

- Planning tasks - retrieve relevant patterns
- Solving problems - check existing solutions
- After completing work - store insights
- Debugging - look for similar issues

### Important Development Practices

1. **File Operations**: Always prefer editing existing files over creating new ones
2. **Documentation**: Only create docs when explicitly requested
3. **Terminal Safety**: Use Desktop Commander MCP for long operations (>30s)
4. **Subagents**: Use frequently to save context - provide comprehensive instructions
5. **Testing**: All tests must run in Docker containers
6. **Git Commits**: Never commit unless explicitly asked

## Configuration Management

### Environment-Based Configuration

The project uses a **template-based configuration system** with environment variables for blue-green deployment:

#### Configuration Structure

```
.env.common          # Shared configuration (email, JWT, SSL, etc.)
.env.blue            # Blue-specific variables (ports, services)
.env.green           # Green-specific variables (ports, services)
nginx.template.conf  # Template for nginx configuration
```

#### Switching Environments

```bash
# Switch to blue environment
./scripts/switch-environment.sh blue

# Switch to green environment
./scripts/switch-environment.sh green

# The script will:
# 1. Load environment variables from .env.common and .env.{color}
# 2. Generate nginx configuration from template
# 3. Create symlinks for active configuration
# 4. Show service status
```

### Nginx Configuration

**Template-based system with proper variable handling**:

- `nginx.template.conf` - Master template using NGINX*VAR* prefix for nginx variables
- `nginx.blue.conf` - Generated for blue environment via switch script
- `nginx.green.conf` - Generated for green environment via switch script
- `nginx.active.conf` - Symlink to currently active configuration
- **Key fix**: Uses `NGINX_VAR_` prefix for nginx runtime variables ($host, $remote_addr) to prevent envsubst conflicts

#### Rate Limiting Zones (Critical for preventing 503 errors)

- `general`: 10 req/s - General requests
- `api`: 30 req/s (burst 80) - API endpoints
- `segmentation`: 100 req/s (burst 100) - **Segmentation bulk results (fixes 503 errors)**
- `upload`: 5 req/s (burst 10) - File uploads

**Important**: Segmentation zone was specifically configured to handle 84+ simultaneous requests

#### Special Endpoints

- `/api/segmentation/images/[id]/results` - Higher limits for bulk result fetching
- `/api/images/upload` - Special handling for file uploads
- `/socket.io/` - WebSocket support with extended timeouts

### Port Mapping

| Service     | Blue | Green | Development |
| ----------- | ---- | ----- | ----------- |
| Frontend    | 4000 | 5000  | 3000        |
| Backend     | 4001 | 5001  | 3001        |
| ML Service  | 4008 | 5008  | 8000        |
| Nginx HTTP  | 4080 | 5080  | 80          |
| Nginx HTTPS | 4443 | 5443  | 443         |
| Redis       | 4379 | 5379  | 6379        |
| PostgreSQL  | 4432 | 5432  | 5432        |

## Project Architecture

### Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + shadcn/ui
- **Backend**: Node.js + Express + TypeScript + Prisma
- **ML Service**: Python + FastAPI + PyTorch
- **Database**: SQLite (dev) / PostgreSQL (prod)
- **Real-time**: WebSocket (Socket.io)
- **Auth**: JWT with refresh tokens

### Key Directories

```
/src/                        # Frontend React app
  /pages/segmentation/       # Complex segmentation editor
  /components/               # Reusable UI components
  /contexts/                 # React contexts
  /hooks/                    # Custom hooks
  /lib/                      # Utilities

/backend/
  /src/api/                  # REST API routes
  /src/services/             # Business logic
  /prisma/                   # Database schema

/backend/segmentation/       # ML service
  /api/                      # FastAPI routes
  /models/                   # PyTorch models

/docker/nginx/              # Nginx configurations
  /snippets/                # Shared SSL parameters
```

### Database Operations

```bash
# Always from backend shell (make shell-be)
npx prisma migrate dev --name migration_name
npx prisma generate
npx prisma studio  # View database
```

## Testing & Quality

### Pre-commit Hooks (Husky)

- ESLint with 0 warnings
- Prettier formatting
- TypeScript checking
- No console.log in production
- Conventional commits: `feat:`, `fix:`, `chore:`, etc.

### Testing Commands

```bash
# Use Desktop Commander MCP for these:
make test           # Unit tests (timeout: 300000)
make test-e2e       # E2E tests (timeout: 600000)
make test-coverage  # Coverage (timeout: 600000)

# Quick checks:
make lint
make type-check
npm run format:check
```

## Internationalization

Supports 6 languages: EN, CS, ES, DE, FR, ZH

- Translation files: `/src/translations/`
- Validation: `npm run i18n:validate`

## WebSocket Real-time Updates

Events:

- `segmentationStatus` - Processing status
- `queueStats` - Queue position
- `segmentationCompleted/Failed` - Results
- Auto-reconnection with exponential backoff

## Production Deployment

### Blue-Green Deployment

```bash
# ALWAYS check active environment first!
cat .active-environment

# Switch environments (generates nginx config from template)
./scripts/switch-environment.sh blue   # Production
./scripts/switch-environment.sh green  # Staging

# Start nginx-main container after switching
docker run -d --name nginx-main \
  --network spheroseg-blue \
  -v $(pwd)/docker/nginx/nginx.active.conf:/etc/nginx/conf.d/default.conf:ro \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  -v $(pwd)/backend/uploads:/app/uploads:ro \
  -v $(pwd)/docker/nginx/snippets:/etc/nginx/snippets:ro \
  -p 80:4080 -p 443:4443 \
  nginx:alpine

# Deploy specific environment
docker compose -f docker-compose.blue.yml up -d
docker compose -f docker-compose.green.yml up -d

# Reload nginx configuration after changes
docker exec nginx-main nginx -s reload

# Health check
curl http://localhost/health
# Returns: "blue-production-healthy" or "green-production-healthy"
```

### Build & Deployment System

#### 🚀 NEW: Optimized Build System with Auto-Cleanup

**Use the new smart build system for all builds:**

```bash
# Build with automatic optimization and cleanup
make build-optimized              # All services for current environment
make build-service SERVICE=frontend  # Specific service

# Or use the smart build script directly
./scripts/smart-docker-build.sh --env blue    # Build for blue environment
./scripts/smart-docker-build.sh --env green   # Build for green environment
./scripts/smart-docker-build.sh --service backend --env blue  # Specific service

# Clean builds (no cache)
make build-clean                  # Full rebuild without cache
./scripts/smart-docker-build.sh --no-cache --env blue
```

**Benefits of new system:**

- ✅ Automatic cleanup before build (prevents disk overflow)
- ✅ 40-70% smaller images (ML: 10GB→4GB, Backend: 2GB→750MB)
- ✅ Faster builds with intelligent caching
- ✅ Keeps only 2 latest images per service
- ✅ No manual cache management needed

#### Docker Storage Management

```bash
# Monitor Docker usage
make docker-usage          # Show current disk usage
./scripts/docker-monitor.sh  # Detailed analysis with recommendations

# Cleanup commands
make optimize-storage      # Regular cleanup (safe)
make deep-clean           # Aggressive cleanup (removes more)
./scripts/docker-build-optimizer.sh --aggressive  # Emergency cleanup
```

#### Frontend Rebuild (Production)

**Recommended method using optimized build:**

```bash
# For blue environment
./scripts/smart-docker-build.sh --env blue --service blue-frontend

# For green environment
./scripts/smart-docker-build.sh --env green --service green-frontend

# The script automatically:
# - Cleans old images
# - Builds with optimization
# - Tags properly
# - Removes intermediate layers
```

**Note**: Manual cache clearing is handled automatically by the new build system!

### Zero-Downtime Deployment Process

1. **Deploy to inactive environment** (e.g., green if blue is active)
2. **Test inactive environment** on staging ports
3. **Switch router** to new environment
4. **Monitor** for issues
5. **Rollback** if needed by switching back

### Critical Configuration

**Database Safety:**

- Databases are SEPARATE (spheroseg_blue vs spheroseg_green)
- Always backup before deployment
- Rollback only reverts code, NOT data

**Required Permissions:**

```bash
sudo chown -R 1001:1001 /home/cvat/cell-segmentation-hub/backend/uploads/blue/
sudo chown -R 1001:1001 /home/cvat/cell-segmentation-hub/backend/uploads/green/
```

## Email Configuration

### SMTP Server Settings

**UTIA Mail Server Configuration:**

```bash
# SMTP Connection Settings
SMTP_HOST=mail.utia.cas.cz
SMTP_PORT=25  # Port 25 with STARTTLS (Ports 465 and 587 are blocked)
SMTP_SECURE=false  # false for STARTTLS
SMTP_REQUIRE_TLS=true

# No authentication required
SMTP_AUTH=false
EMAIL_FROM=spheroseg@utia.cas.cz  # Sender address

# Extended timeouts for UTIA server delays (up to 10 minutes)
EMAIL_TIMEOUT=300000
SMTP_SOCKET_TIMEOUT_MS=600000
EMAIL_GLOBAL_TIMEOUT=600000
```

**Important Notes:**

- Server: mail.utia.cas.cz (Axigen ESMTP)
- Sends emails from: spheroseg@utia.cas.cz
- **No authentication required** for internal UTIA network
- UTIA server has significant delays (2-10 minutes) for email processing
- Emails are queued automatically for background processing
- Password reset emails are always queued to prevent user timeout

## Key Features & Capabilities

### Batch Processing

- **Supports batch processing up to 10,000 images** per request
- Located in `/backend/src/api/controllers/queueController.ts`
- Supports massive bulk segmentation operations

### Blue-Green Deployment

- **Zero-downtime deployments** with blue-green architecture
- Template-based nginx configuration with NGINX*VAR* prefix for variables
- Environment switching via `./scripts/switch-environment.sh`
- Rate limiting: 100 req/s (burst 100) for segmentation endpoints
- nginx variables properly preserved through sed post-processing
- Full documentation: `/docs/BLUE-GREEN-DEPLOYMENT.md`

### Email Service

- Robust email service with queue support
- Extended timeouts for slow SMTP servers
- Automatic queue for password reset emails
- Background processing for all email operations

### Model Performance Benchmarks

- HRNet: ~196ms inference, 301ms total
- CBAM-ResUNet: ~396ms inference, 501ms total
- U-Net: ~197ms inference, 302ms total

### Polygon Metrics

- Implemented rotating calipers for Feret diameter
- Perimeter includes holes (ImageJ convention)
- Location: `/src/pages/segmentation/utils/metricCalculations.ts`

## Quick Reference

### Common Tasks

- **New API endpoint**: Add to `/backend/src/api/routes/`
- **New component**: Use shadcn/ui patterns in `/src/components/`
- **Translations**: Update all files in `/src/translations/`
- **Database changes**: Update schema, migrate, generate
- **Switch environment**: `./scripts/switch-environment.sh [blue|green]`

### Security

- No console.log in production
- JWT authentication required
- Rate limiting enabled (see nginx zones above)
- Security scanning with CodeQL

### Performance

- Redis caching enabled
- Connection pooling (5-25 connections)
- Circuit breakers for external services
- Prometheus + Grafana monitoring
- Segmentation endpoints have 100 req/s rate limit
- **Batch processing limit: 10,000 images** per request (increased from 500)

## Important Reminders

1. **NEVER** touch production without permission
2. **ALWAYS CHECK** `.active-environment` file BEFORE any operations - active env can change!
3. **ALWAYS** use optimized build commands: `make build-optimized` or `./scripts/smart-docker-build.sh`
4. **USE** Desktop Commander MCP for long operations
5. **PREFER** editing existing files
6. **STORE** knowledge after completing tasks
7. **TEST** in Docker containers only
8. **SWITCH** environments using the provided script: `./scripts/switch-environment.sh`
9. **VERIFY** active environment after switching: `cat .active-environment`
10. **REMEMBER** batch processing supports up to 10,000 images per request
11. **USE** new build system - it handles cleanup and caching automatically
12. **MONITOR** Docker usage regularly: `make docker-usage`

## Docker Optimization System

### Quick Reference - New Build Commands

```bash
# ALWAYS use these optimized commands:
make build-optimized         # Replaces 'make build'
make build-service SERVICE=frontend  # Build specific service
make docker-usage           # Check disk usage
make optimize-storage       # Clean up space

# Emergency cleanup:
./scripts/docker-build-optimizer.sh --aggressive
```

### Deprecated Files (DO NOT USE)

The following files are replaced by optimized versions:

- ❌ `docker/frontend.Dockerfile` → ✅ `docker/frontend.optimized.Dockerfile`
- ❌ `docker/backend.Dockerfile` → ✅ `docker/backend.optimized.Dockerfile`
- ❌ `docker/ml.Dockerfile` → ✅ `docker/ml.optimized.Dockerfile`
- ❌ `docker/frontend.prod.Dockerfile` → ✅ `docker/frontend.optimized.Dockerfile`
- ❌ `docker/backend.prod.Dockerfile` → ✅ `docker/backend.optimized.Dockerfile`

All docker-compose files have been updated to use optimized versions automatically.
