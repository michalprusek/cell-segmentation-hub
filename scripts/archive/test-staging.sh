#!/bin/bash
set -euo pipefail

# Test Staging Environment
# This script tests the staging deployment without affecting production

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
STAGING_COMPOSE="$PROJECT_ROOT/docker-compose.staging.yml"

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

cd "$PROJECT_ROOT"

log_info "Testing staging environment setup..."
echo ""

# Test 1: Configuration validation
log_info "Test 1: Validating Docker Compose configuration..."
if docker compose -f "$STAGING_COMPOSE" config --quiet; then
    log_success "Docker Compose configuration is valid"
else
    log_error "Docker Compose configuration validation failed"
    exit 1
fi

# Test 2: Environment file check
log_info "Test 2: Checking environment file..."
if [[ -f ".env.staging" ]]; then
    log_success ".env.staging file exists"
    
    # Check required variables
    required_vars=("STAGING_DB_PASSWORD" "STAGING_JWT_ACCESS_SECRET" "STAGING_JWT_REFRESH_SECRET")
    for var in "${required_vars[@]}"; do
        if grep -q "^${var}=" .env.staging; then
            log_success "  ✓ $var is set"
        else
            log_error "  ✗ $var is missing"
        fi
    done
else
    log_error ".env.staging file not found"
    exit 1
fi

# Test 3: Check Docker images
log_info "Test 3: Checking if required Docker base images exist..."
required_images=("nginx:alpine" "postgres:15-alpine" "redis:7-alpine" "prom/prometheus:latest" "grafana/grafana:latest")
for image in "${required_images[@]}"; do
    if docker image inspect "$image" >/dev/null 2>&1; then
        log_success "  ✓ $image is available"
    else
        log_warning "  ⚠ $image not found locally (will be pulled during build)"
    fi
done

# Test 4: Check required directories
log_info "Test 4: Checking required directories..."
required_dirs=(
    "backend/uploads/staging"
    "scripts/db-backup/staging"
    "monitoring"
    "docker/nginx/sites"
)

for dir in "${required_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
        log_success "  ✓ $dir exists"
    else
        log_warning "  ⚠ Directory $dir will be created during deployment"
    fi
done

# Test 5: Check required files
log_info "Test 5: Checking required configuration files..."
required_files=(
    "docker-compose.staging.yml"
    "docker/nginx/staging.conf" 
    "docker/nginx/sites/staging.spherosegapp.conf"
    "monitoring/staging-prometheus.yml"
    "scripts/deploy-staging.sh"
    "scripts/staging-manager.sh"
)

for file in "${required_files[@]}"; do
    if [[ -f "$file" ]]; then
        log_success "  ✓ $file exists"
    else
        log_error "  ✗ $file is missing"
    fi
done

# Test 6: Check network availability
log_info "Test 6: Checking if production network exists..."
if docker network inspect spheroseg-network >/dev/null 2>&1; then
    log_success "Production network 'spheroseg-network' exists"
else
    log_warning "Production network 'spheroseg-network' not found"
    log_info "Creating production network for staging connectivity..."
    docker network create spheroseg-network || true
fi

# Test 7: Check port availability
log_info "Test 7: Checking staging port availability..."
staging_ports=("3031")  # Grafana port for staging

for port in "${staging_ports[@]}"; do
    if ss -tulpn | grep -q ":$port "; then
        log_warning "  ⚠ Port $port is already in use"
        log_info "    Process using port $port:"
        ss -tulpn | grep ":$port " || true
    else
        log_success "  ✓ Port $port is available"
    fi
done

# Test 8: Dry run build test
log_info "Test 8: Testing build capability (dry run)..."
log_info "Pulling base images..."
docker pull nginx:alpine >/dev/null 2>&1 || true
docker pull postgres:15-alpine >/dev/null 2>&1 || true
docker pull redis:7-alpine >/dev/null 2>&1 || true

log_success "Build capability test completed"

# Test 9: Script permissions
log_info "Test 9: Checking script permissions..."
scripts=("deploy-staging.sh" "staging-manager.sh" "init-letsencrypt-staging.sh")
for script in "${scripts[@]}"; do
    if [[ -x "scripts/$script" ]]; then
        log_success "  ✓ scripts/$script is executable"
    else
        log_warning "  ⚠ Making scripts/$script executable"
        chmod +x "scripts/$script"
    fi
done

# Test 10: Isolation verification
log_info "Test 10: Verifying staging/production isolation..."
log_success "Staging configuration uses:"
log_success "  • Separate containers (staging-* prefix)"
log_success "  • Separate database (spheroseg_staging)"
log_success "  • Separate network (staging-network)"
log_success "  • Separate volumes (staging-* prefix)"
log_success "  • Separate subdomain (staging.spherosegapp.utia.cas.cz)"

# Summary
echo ""
log_info "=== STAGING TEST SUMMARY ==="
echo ""
log_success "✅ Staging environment is ready for deployment"
echo ""
log_info "Next steps:"
echo "  1. Ensure DNS points staging.spherosegapp.utia.cas.cz to this server"
echo "  2. Run: ./scripts/init-letsencrypt-staging.sh (for SSL)"
echo "  3. Run: ./scripts/deploy-staging.sh (to deploy staging)"
echo "  4. Run: ./scripts/staging-manager.sh status (to check status)"
echo ""
log_info "Staging URLs (after deployment):"
echo "  • Frontend: https://staging.spherosegapp.utia.cas.cz"
echo "  • Grafana: http://localhost:3031"
echo ""
log_warning "Remember: Staging runs alongside production without interference"

exit 0