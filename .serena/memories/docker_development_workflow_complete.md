# Docker Development Workflow - Cell Segmentation Hub

**Transferred from ByteRover memories - Docker workflow knowledge**

## Essential Make Commands

```bash
# Service Management
make up                 # Start all services (frontend, backend, ML, DB)
make down              # Stop all services
make restart           # Restart all services
make reset             # Clean rebuild of all containers

# Development
make dev-setup         # Complete development environment setup
make logs-f            # Follow logs for all services
make logs-fe           # Frontend logs only
make logs-be           # Backend logs only
make logs-ml           # ML service logs only

# Shell Access
make shell-fe          # Shell into frontend container
make shell-be          # Shell into backend container
make shell-ml          # Shell into ML service container

# Testing & Validation
make health            # Health check all services
make test              # Run all tests in containers
make test-e2e          # End-to-end tests with Playwright
make test-coverage     # Generate test coverage reports

# Quality & Linting
make lint              # Lint all code
make lint-fix          # Auto-fix linting issues
make type-check        # TypeScript type checking
```

## Service Architecture

- **Frontend**: React 18 + TypeScript + Vite (port 3000)
- **Backend**: Node.js + Express + TypeScript (port 3001)
- **ML Service**: Python + FastAPI + PyTorch (port 8000)
- **Database**: SQLite (dev) / PostgreSQL (CI/production)
- **Monitoring**: Prometheus (9090) + Grafana (3030)

## Docker Compose Configuration

- **Networks**: Isolated docker network for service communication
- **Volumes**: Persistent data storage with proper permissions
- **Health Checks**: All services have health check endpoints
- **Hot Reload**: Development environment supports hot reloading
- **Environment Variables**: Separate .env files per environment

## Critical Development Rules

1. **NEVER use npm directly** - always use make commands
2. **All operations through Docker** - no direct node/python execution
3. **Health checks first** - verify services before development
4. **Volume permissions** - ensure proper user permissions (1001:1001)
5. **Port consistency** - align Vite config with Docker ports

## Build Dependencies

### Frontend Dependencies

- Node.js with Canvas support (Cairo, Pango, Pixman)
- TypeScript compilation
- Vite build system
- Husky git hooks

### Backend Dependencies

- Node.js with native modules
- Prisma database client
- JWT authentication
- WebSocket support

### ML Service Dependencies

- Python 3.x with PyTorch
- PIL/Pillow for image processing
- NumPy for numerical operations
- FastAPI web framework

## Environment-Specific Configurations

- **Development**: SQLite, hot reload, debug logging
- **CI/CD**: PostgreSQL, ephemeral storage, comprehensive testing
- **Production**: Blue-green deployment, PostgreSQL, monitoring
