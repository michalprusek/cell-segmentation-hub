#!/bin/bash

# Test runner script for SpheroSeg
# Runs all tests in isolated Docker containers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log() {
    echo -e "${GREEN}[TEST]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Cleanup function
cleanup() {
    log "Cleaning up test environment..."
    docker-compose -f docker-compose.test.yml down -v --remove-orphans 2>/dev/null || true
    docker network rm spheroseg-test 2>/dev/null || true
}

# Trap cleanup on exit
trap cleanup EXIT

# Parse arguments
SERVICES="all"
VERBOSE=false
REBUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --service)
            SERVICES="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --rebuild)
            REBUILD=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --service <service>  Run tests for specific service (frontend, backend, ml, all)"
            echo "  --verbose, -v        Verbose output"
            echo "  --rebuild           Rebuild containers before testing"
            echo "  --help, -h          Show this help"
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            exit 1
            ;;
    esac
done

log "Starting SpheroSeg test suite..."
log "Service(s): $SERVICES"

# Clean up any existing test containers
cleanup

# Build test containers if needed
if [ "$REBUILD" = true ]; then
    log "Rebuilding test containers..."
    docker-compose -f docker-compose.test.yml build --no-cache
else
    log "Building test containers..."
    docker-compose -f docker-compose.test.yml build
fi

# Start test services
log "Starting test environment..."
docker-compose -f docker-compose.test.yml up -d test-database test-redis

# Wait for database to be ready
log "Waiting for test database..."
timeout=30
counter=0
while ! docker exec $(docker-compose -f docker-compose.test.yml ps -q test-database) pg_isready -U testuser -d spheroseg_test > /dev/null 2>&1; do
    if [ $counter -ge $timeout ]; then
        error "Database failed to start within ${timeout}s"
        exit 1
    fi
    sleep 1
    ((counter++))
done
log "Database is ready"

# Wait for Redis to be ready
log "Waiting for test Redis..."
timeout=10
counter=0
while ! docker exec $(docker-compose -f docker-compose.test.yml ps -q test-redis) redis-cli ping > /dev/null 2>&1; do
    if [ $counter -ge $timeout ]; then
        error "Redis failed to start within ${timeout}s"
        exit 1
    fi
    sleep 1
    ((counter++))
done
log "Redis is ready"

# Initialize test database
log "Initializing test database..."
docker-compose -f docker-compose.test.yml run --rm test-backend npm run prisma:migrate:dev

# Function to run tests for a specific service
run_service_tests() {
    local service=$1
    log "Running $service tests..."
    
    if [ "$VERBOSE" = true ]; then
        docker-compose -f docker-compose.test.yml run --rm test-$service
    else
        docker-compose -f docker-compose.test.yml run --rm test-$service > /tmp/test-$service.log 2>&1
    fi
    
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        log "$service tests: ${GREEN}PASSED${NC}"
        return 0
    else
        error "$service tests: ${RED}FAILED${NC}"
        if [ "$VERBOSE" = false ]; then
            echo "Test output saved to /tmp/test-$service.log"
            echo "Last 20 lines of output:"
            tail -n 20 /tmp/test-$service.log
        fi
        return $exit_code
    fi
}

# Track test results
failed_services=()
total_services=0

# Run tests based on service selection
case $SERVICES in
    all)
        services=("frontend" "backend" "ml")
        ;;
    *)
        services=("$SERVICES")
        ;;
esac

# Run tests for each service
for service in "${services[@]}"; do
    total_services=$((total_services + 1))
    if ! run_service_tests "$service"; then
        failed_services+=("$service")
    fi
done

# Summary
echo
log "Test Summary:"
log "============="
log "Total services tested: $total_services"
log "Passed: $((total_services - ${#failed_services[@]}))"
log "Failed: ${#failed_services[@]}"

if [ ${#failed_services[@]} -eq 0 ]; then
    log "${GREEN}All tests passed!${NC}"
    exit 0
else
    error "Failed services: ${failed_services[*]}"
    exit 1
fi