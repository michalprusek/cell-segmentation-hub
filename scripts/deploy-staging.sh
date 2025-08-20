#!/bin/bash
set -euo pipefail

# Staging Deployment Script
# This script builds and deploys the staging environment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.staging.yml"
ENV_FILE="$PROJECT_ROOT/.env.staging"

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

# Change to project root
cd "$PROJECT_ROOT"

log_info "Starting staging deployment..."
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

# Check if production environment is running (to avoid conflicts)
if docker ps --format "table {{.Names}}" | grep -q "spheroseg-nginx"; then
    log_info "Production environment detected running - staging will run alongside"
else
    log_warning "Production environment not detected - make sure nginx configuration supports staging"
fi

# Create necessary directories
log_info "Creating necessary directories..."
# Use docker to create directories with correct permissions
docker run --rm -v "$PROJECT_ROOT/backend/uploads:/uploads" alpine:latest sh -c "mkdir -p /uploads/staging && chmod 755 /uploads/staging" || true
docker run --rm -v "$PROJECT_ROOT/scripts/db-backup:/backup" alpine:latest sh -c "mkdir -p /backup/staging && chmod 755 /backup/staging" || true
mkdir -p monitoring/staging-dashboards || true

# Backup current staging data (if exists)
if docker ps -q -f name=staging-db | grep -q .; then
    log_info "Backing up staging database..."
    docker exec staging-db pg_dump -U spheroseg -d spheroseg_staging > "scripts/db-backup/staging/backup-$(date +%Y%m%d_%H%M%S).sql" || true
fi

# Stop staging services if running
log_info "Stopping staging services..."
docker compose -f "$COMPOSE_FILE" -p staging down --remove-orphans || true

# Build staging images
log_info "Building staging images..."
docker compose -f "$COMPOSE_FILE" -p staging build --no-cache

# Start staging services
log_info "Starting staging services..."
docker compose -f "$COMPOSE_FILE" -p staging up -d

# Wait for services to be healthy
log_info "Waiting for services to be healthy..."
max_attempts=60
attempt=0

while [[ $attempt -lt $max_attempts ]]; do
    if docker compose -f "$COMPOSE_FILE" -p staging ps | grep -q "unhealthy"; then
        log_info "Some services are still starting... (attempt $((attempt + 1))/$max_attempts)"
        sleep 10
        attempt=$((attempt + 1))
    else
        break
    fi
done

if [[ $attempt -eq $max_attempts ]]; then
    log_error "Services failed to become healthy within expected time"
    log_info "Service status:"
    docker compose -f "$COMPOSE_FILE" -p staging ps
    exit 1
fi

# Check service health
log_info "Checking service health..."
services_healthy=true

# Check database connectivity
if ! docker exec staging-backend curl -f http://localhost:3001/health >/dev/null 2>&1; then
    log_error "Backend health check failed"
    services_healthy=false
fi

# Check ML service
if ! docker exec staging-ml curl -f http://localhost:8000/health >/dev/null 2>&1; then
    log_error "ML service health check failed"
    services_healthy=false
fi

# Check database
if ! docker exec staging-db pg_isready -U spheroseg -d spheroseg_staging >/dev/null 2>&1; then
    log_error "Database health check failed"
    services_healthy=false
fi

if [[ "$services_healthy" == false ]]; then
    log_error "Some services are not healthy. Check logs:"
    log_info "Backend logs:"
    docker compose -f "$COMPOSE_FILE" -p staging logs --tail=20 backend
    log_info "ML service logs:"
    docker compose -f "$COMPOSE_FILE" -p staging logs --tail=20 ml-service
    exit 1
fi

# Run database migrations
log_info "Running database migrations..."
docker exec staging-backend npm run db:migrate || {
    log_error "Database migration failed"
    exit 1
}

# Display service information
log_success "Staging deployment completed successfully!"
echo ""
log_info "Service URLs (internal):"
echo "  - Backend API: http://staging-backend:3001"
echo "  - ML Service: http://staging-ml:8000"
echo "  - Grafana: http://localhost:3031"
echo ""
log_info "Public URLs (after nginx configuration):"
echo "  - Frontend: https://staging.spherosegapp.utia.cas.cz"
echo "  - API: https://staging.spherosegapp.utia.cas.cz/api"
echo "  - ML API: https://staging.spherosegapp.utia.cas.cz/api/ml"
echo "  - Grafana: https://staging.spherosegapp.utia.cas.cz/grafana"
echo ""

# Show running containers
log_info "Staging containers status:"
docker compose -f "$COMPOSE_FILE" -p staging ps

# Show resource usage
log_info "Resource usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep staging

echo ""
log_success "Staging environment is ready!"
log_warning "Note: Make sure nginx includes staging configuration and SSL certificate covers staging.spherosegapp.utia.cas.cz"

# Show next steps
echo ""
log_info "Next steps:"
echo "  1. Update DNS to point staging.spherosegapp.utia.cas.cz to this server"
echo "  2. Update SSL certificate to include staging subdomain"
echo "  3. Test staging environment functionality"
echo "  4. Use 'docker compose -f $COMPOSE_FILE -p staging logs -f' to monitor logs"

exit 0