#!/bin/bash
set -euo pipefail

# Production Deployment Script
# This script builds and deploys the production environment with zero-downtime strategy

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.prod.yml"
ENV_FILE="$PROJECT_ROOT/.env.production"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up..."
    # Remove any temporary files if needed
}

# Set trap for cleanup
trap cleanup EXIT

# Check if running as root
if [[ $EUID -eq 0 ]]; then
    log_error "This script should not be run as root for security reasons."
    exit 1
fi

# Parse command line arguments
SKIP_BACKUP=false
SKIP_TESTS=false
FORCE_REBUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-backup)
            SKIP_BACKUP=true
            shift
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --force-rebuild)
            FORCE_REBUILD=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --skip-backup    Skip database backup"
            echo "  --skip-tests     Skip health checks"
            echo "  --force-rebuild  Force rebuild without cache"
            echo "  -h, --help       Show this help"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Change to project root
cd "$PROJECT_ROOT"

log_info "Starting production deployment..."
log_info "Project root: $PROJECT_ROOT"
log_info "Compose file: $COMPOSE_FILE"
log_info "Environment file: $ENV_FILE"

# Check if required files exist
if [[ ! -f "$COMPOSE_FILE" ]]; then
    log_error "Compose file not found: $COMPOSE_FILE"
    exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
    log_error "Environment file not found: $ENV_FILE"
    exit 1
fi

# Check if Docker and Docker Compose are available
if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed or not in PATH"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    log_error "Docker Compose is not available"
    exit 1
fi

# Pre-deployment checks
log_info "Running pre-deployment checks..."

# Check disk space
available_space=$(df / | awk 'NR==2 {print $4}')
if [[ $available_space -lt 2097152 ]]; then  # 2GB in KB
    log_error "Insufficient disk space. At least 2GB required."
    exit 1
fi

# Check if SSL certificates exist
if [[ ! -f "/etc/letsencrypt/live/spherosegapp.utia.cas.cz/fullchain.pem" ]]; then
    log_error "SSL certificate not found. Run init-letsencrypt.sh first."
    exit 1
fi

# Create backup directory
mkdir -p scripts/db-backup

# Backup production database (if not skipped)
if [[ "$SKIP_BACKUP" == false ]]; then
    if docker ps -q -f name=spheroseg-db | grep -q .; then
        log_info "Creating database backup..."
        backup_file="scripts/db-backup/prod-backup-$(date +%Y%m%d_%H%M%S).sql"
        if docker exec spheroseg-db pg_dump -U spheroseg -d spheroseg_prod > "$backup_file"; then
            log_success "Database backup created: $backup_file"
        else
            log_error "Database backup failed"
            exit 1
        fi
    else
        log_warning "Production database not running, skipping backup"
    fi
else
    log_warning "Skipping database backup as requested"
fi

# Build new images
log_info "Building production images..."
build_args=""
if [[ "$FORCE_REBUILD" == true ]]; then
    build_args="--no-cache"
    log_info "Force rebuilding without cache..."
fi

if ! docker compose -f "$COMPOSE_FILE" build $build_args; then
    log_error "Build failed"
    exit 1
fi

log_success "Build completed successfully"

# Test new images before deployment
if [[ "$SKIP_TESTS" == false ]]; then
    log_info "Running image health tests..."
    
    # Test backend image
    if ! docker run --rm --name test-backend -e NODE_ENV=production spheroseg-backend node --version >/dev/null 2>&1; then
        log_error "Backend image test failed"
        exit 1
    fi
    
    # Test ML service image
    if ! docker run --rm --name test-ml spheroseg-ml python --version >/dev/null 2>&1; then
        log_error "ML service image test failed"
        exit 1
    fi
    
    log_success "Image tests passed"
else
    log_warning "Skipping health tests as requested"
fi

# Rolling deployment strategy
log_info "Starting rolling deployment..."

# Get current container IDs for rollback
old_backend=$(docker ps -q -f name=spheroseg-backend || true)
old_ml=$(docker ps -q -f name=spheroseg-ml || true)
old_frontend=$(docker ps -q -f name=spheroseg-frontend || true)

# Start new containers
log_info "Starting new containers..."
if ! docker compose -f "$COMPOSE_FILE" up -d; then
    log_error "Failed to start new containers"
    exit 1
fi

# Wait for services to be healthy
log_info "Waiting for services to be healthy..."
max_attempts=60
attempt=0

while [[ $attempt -lt $max_attempts ]]; do
    unhealthy_services=$(docker compose -f "$COMPOSE_FILE" ps --filter "health=unhealthy" -q | wc -l)
    if [[ $unhealthy_services -gt 0 ]]; then
        log_info "Some services are still starting... (attempt $((attempt + 1))/$max_attempts)"
        sleep 10
        attempt=$((attempt + 1))
    else
        break
    fi
done

if [[ $attempt -eq $max_attempts ]]; then
    log_error "Services failed to become healthy within expected time"
    log_info "Rolling back..."
    
    # Rollback if old containers exist
    if [[ -n "$old_backend" || -n "$old_ml" || -n "$old_frontend" ]]; then
        docker start $old_backend $old_ml $old_frontend 2>/dev/null || true
    fi
    
    log_info "Service status:"
    docker compose -f "$COMPOSE_FILE" ps
    exit 1
fi

# Run database migrations
log_info "Running database migrations..."
if ! docker exec spheroseg-backend npm run db:migrate; then
    log_error "Database migration failed"
    exit 1
fi

# Verify deployment
log_info "Verifying deployment..."
deployment_success=true

# Check backend health
if ! docker exec spheroseg-backend curl -f http://localhost:3001/health >/dev/null 2>&1; then
    log_error "Backend health check failed"
    deployment_success=false
fi

# Check ML service health
if ! docker exec spheroseg-ml curl -f http://localhost:8000/health >/dev/null 2>&1; then
    log_error "ML service health check failed"
    deployment_success=false
fi

# Check database connectivity
if ! docker exec spheroseg-db pg_isready -U spheroseg -d spheroseg_prod >/dev/null 2>&1; then
    log_error "Database health check failed"
    deployment_success=false
fi

# Check external connectivity
if ! curl -f -k https://spherosegapp.utia.cas.cz/health >/dev/null 2>&1; then
    log_warning "External health check failed - nginx might need restart"
fi

if [[ "$deployment_success" == false ]]; then
    log_error "Deployment verification failed"
    exit 1
fi

# Clean up old containers
log_info "Cleaning up old containers..."
docker system prune -f --filter "until=1h" || true

# Update SSL certificates if needed
log_info "Checking SSL certificate renewal..."
if [[ -f "/scripts/certbot-renew.sh" ]]; then
    ./scripts/certbot-renew.sh || log_warning "SSL renewal check failed"
fi

# Display deployment information
log_success "Production deployment completed successfully!"
echo ""
log_info "Service URLs:"
echo "  - Frontend: https://spherosegapp.utia.cas.cz"
echo "  - API: https://spherosegapp.utia.cas.cz/api"
echo "  - ML API: https://spherosegapp.utia.cas.cz/api/ml"
echo "  - Grafana: https://spherosegapp.utia.cas.cz/grafana"
echo ""

# Show running containers
log_info "Production containers status:"
docker compose -f "$COMPOSE_FILE" ps

# Show resource usage
log_info "Resource usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep spheroseg

echo ""
log_success "Production environment is running!"

# Show monitoring commands
echo ""
log_info "Monitoring commands:"
echo "  - Logs: docker compose -f $COMPOSE_FILE logs -f"
echo "  - Status: docker compose -f $COMPOSE_FILE ps"
echo "  - Stop: docker compose -f $COMPOSE_FILE down"

exit 0