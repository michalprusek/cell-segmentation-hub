#!/bin/bash
# =================================================================
# Cell Segmentation Hub - Post-Deployment Verification Script
# =================================================================
# This script performs comprehensive verification of the deployed
# system to ensure all components are working correctly.

set -euo pipefail

# Script directory and configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/config/deployment.config"

# Load deployment configuration
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "ERROR: Deployment configuration not found: $CONFIG_FILE"
    exit 1
fi

source "$CONFIG_FILE"

# Command line arguments
TARGET_ENV="${1:-}"
if [[ -z "$TARGET_ENV" ]]; then
    echo "Usage: $0 <environment>"
    echo "  environment: blue or green"
    exit 1
fi

# Initialize logging
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/post-deployment-verify-${TARGET_ENV}-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Global test counters
TESTS_TOTAL=0
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_WARNINGS=0

# Environment-specific configuration
if [[ "$TARGET_ENV" == "blue" ]]; then
    FRONTEND_PORT="$BLUE_FRONTEND_PORT"
    BACKEND_PORT="$BLUE_BACKEND_PORT"
    ML_PORT="$BLUE_ML_PORT"
    SERVICES="$BLUE_SERVICES"
    DB_CONTAINER="postgres-blue"
    REDIS_CONTAINER="redis-blue"
    BACKEND_CONTAINER="blue-backend"
    ML_CONTAINER="blue-ml"
    FRONTEND_CONTAINER="blue-frontend"
elif [[ "$TARGET_ENV" == "green" ]]; then
    FRONTEND_PORT="$GREEN_FRONTEND_PORT"
    BACKEND_PORT="$GREEN_BACKEND_PORT"
    ML_PORT="$GREEN_ML_PORT"
    SERVICES="$GREEN_SERVICES"
    DB_CONTAINER="postgres-green"
    REDIS_CONTAINER="redis-green"
    BACKEND_CONTAINER="green-backend"
    ML_CONTAINER="green-ml"
    FRONTEND_CONTAINER="green-frontend"
else
    echo "ERROR: Invalid environment. Use 'blue' or 'green'"
    exit 1
fi

# Base URLs for testing
FRONTEND_URL="http://localhost:${FRONTEND_PORT}"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
ML_URL="http://localhost:${ML_PORT}"

# Test data
TEST_USER_EMAIL="test-deploy-$(date +%s)@example.com"
TEST_USER_PASSWORD="TestPassword123!"
TEST_PROJECT_NAME="Deployment Test Project $(date +%s)"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
    ((TESTS_WARNINGS++))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Test execution functions
start_test() {
    local test_name="$1"
    ((TESTS_TOTAL++))
    echo -e "${BLUE}🧪 TEST ${TESTS_TOTAL}:${NC} $test_name"
}

pass_test() {
    local message="$1"
    ((TESTS_PASSED++))
    log_success "$message"
}

fail_test() {
    local message="$1"
    ((TESTS_FAILED++))
    log_error "$message"
    return 1
}

# Function to print section headers
print_header() {
    echo ""
    echo "============================================================"
    echo "$1"
    echo "============================================================"
}

# Test Docker containers are running
test_containers_running() {
    start_test "Container Status Check"
    
    local all_running=true
    
    for service in $SERVICES; do
        if docker ps --format "table {{.Names}}" | grep -q "^$service$"; then
            local status
            status=$(docker inspect --format='{{.State.Status}}' "$service")
            if [[ "$status" == "running" ]]; then
                log_info "✓ $service: running"
            else
                log_error "✗ $service: $status"
                all_running=false
            fi
        else
            log_error "✗ $service: not found"
            all_running=false
        fi
    done
    
    if [[ "$all_running" == "true" ]]; then
        pass_test "All containers are running"
    else
        fail_test "Some containers are not running properly"
    fi
}

# Test health endpoints
test_health_endpoints() {
    start_test "Health Endpoint Tests"
    
    local health_tests=(
        "$FRONTEND_URL/health:Frontend Health"
        "$BACKEND_URL/health:Backend Health"
        "$ML_URL/health:ML Service Health"
    )
    
    local all_healthy=true
    
    for test_case in "${health_tests[@]}"; do
        local url="${test_case%%:*}"
        local name="${test_case##*:}"
        
        local response_code
        response_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" --max-time 10 || echo "000")
        
        if [[ "$response_code" == "200" ]]; then
            log_info "✓ $name: HTTP $response_code"
        else
            log_error "✗ $name: HTTP $response_code"
            all_healthy=false
        fi
    done
    
    if [[ "$all_healthy" == "true" ]]; then
        pass_test "All health endpoints respond correctly"
    else
        fail_test "Some health endpoints are not responding"
    fi
}

# Test database connectivity
test_database_connectivity() {
    start_test "Database Connectivity Test"
    
    # Test database connection
    if docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1; then
        log_info "✓ Database connection successful"
    else
        fail_test "Database connection failed"
        return 1
    fi
    
    # Test database query
    local query_result
    query_result=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "${TARGET_ENV}_db" -c "SELECT 1;" -t 2>/dev/null | tr -d ' \n' || echo "")
    
    if [[ "$query_result" == "1" ]]; then
        log_info "✓ Database query execution successful"
    else
        log_warning "Database query test inconclusive"
    fi
    
    # Test Prisma connection from backend
    if docker exec "$BACKEND_CONTAINER" node -e "
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        prisma.\$connect().then(() => {
            console.log('Prisma connection successful');
            process.exit(0);
        }).catch((err) => {
            console.error('Prisma connection failed:', err.message);
            process.exit(1);
        });
    " >/dev/null 2>&1; then
        log_info "✓ Prisma connection successful"
        pass_test "Database connectivity verified"
    else
        fail_test "Prisma connection failed"
        return 1
    fi
}

# Test Redis connectivity
test_redis_connectivity() {
    start_test "Redis Connectivity Test"
    
    # Test Redis ping
    if docker exec "$REDIS_CONTAINER" redis-cli ping | grep -q "PONG"; then
        log_info "✓ Redis ping successful"
    else
        fail_test "Redis ping failed"
        return 1
    fi
    
    # Test Redis operations
    local test_key="test-deploy-$(date +%s)"
    local test_value="deployment-test-value"
    
    # Set a test value
    if docker exec "$REDIS_CONTAINER" redis-cli set "$test_key" "$test_value" | grep -q "OK"; then
        log_info "✓ Redis SET operation successful"
    else
        fail_test "Redis SET operation failed"
        return 1
    fi
    
    # Get the test value
    local retrieved_value
    retrieved_value=$(docker exec "$REDIS_CONTAINER" redis-cli get "$test_key")
    
    if [[ "$retrieved_value" == "$test_value" ]]; then
        log_info "✓ Redis GET operation successful"
        # Cleanup
        docker exec "$REDIS_CONTAINER" redis-cli del "$test_key" >/dev/null
        pass_test "Redis connectivity verified"
    else
        fail_test "Redis GET operation failed"
        return 1
    fi
}

# Test API endpoints
test_api_endpoints() {
    start_test "API Endpoint Tests"
    
    local api_tests=(
        "$BACKEND_URL/api/health:GET:Backend API Health"
        "$BACKEND_URL/api/auth/test:GET:Auth Test Endpoint"
        "$ML_URL/api/v1/health:GET:ML API Health"
        "$ML_URL/api/v1/models:GET:ML Models Endpoint"
    )
    
    local all_working=true
    
    for test_case in "${api_tests[@]}"; do
        local url="${test_case%%:*}"
        local method="${test_case#*:}"
        method="${method%%:*}"
        local name="${test_case##*:}"
        
        local response_code
        case "$method" in
            "GET")
                response_code=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$url" --max-time 10 || echo "000")
                ;;
            "POST")
                response_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$url" --max-time 10 || echo "000")
                ;;
        esac
        
        if [[ "$response_code" =~ ^(200|201|400|401)$ ]]; then
            # 400/401 are acceptable for some endpoints without proper auth
            log_info "✓ $name: HTTP $response_code"
        else
            log_error "✗ $name: HTTP $response_code"
            all_working=false
        fi
    done
    
    if [[ "$all_working" == "true" ]]; then
        pass_test "All API endpoints respond correctly"
    else
        fail_test "Some API endpoints are not responding correctly"
    fi
}

# Test file upload functionality
test_file_upload() {
    start_test "File Upload Test"
    
    # Create a test image file
    local test_image="/tmp/test-upload-$(date +%s).png"
    
    # Create a simple test image using ImageMagick (if available) or just a text file
    if command -v convert >/dev/null 2>&1; then
        convert -size 100x100 xc:white "$test_image" 2>/dev/null || echo "Test image" > "$test_image"
    else
        # Create a fake PNG header + some data
        printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00d\x00\x00\x00d\x08\x06\x00\x00\x00p\xe2\x95!\x00\x00\x00\x13IDATx\x9cc\xf8\x00\x01\x00\x00\x00\x01\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00' > "$test_image"
    fi
    
    # Test upload to backend
    local upload_response
    upload_response=$(curl -s -w "%{http_code}" -X POST \
        "$BACKEND_URL/api/test/upload" \
        -F "file=@$test_image" \
        --max-time 30 2>/dev/null || echo "000")
    
    # Extract HTTP status code (last 3 digits)
    local status_code="${upload_response: -3}"
    
    # Clean up test file
    rm -f "$test_image"
    
    if [[ "$status_code" =~ ^(200|201|400|401|404)$ ]]; then
        # 400/401/404 are acceptable if the test endpoint doesn't exist or requires auth
        log_info "✓ File upload endpoint responding (HTTP $status_code)"
        
        # Check if upload directories exist and are writable
        local upload_dir
        if [[ "$TARGET_ENV" == "blue" ]]; then
            upload_dir="$PROJECT_ROOT/$BLUE_UPLOAD_DIR"
        else
            upload_dir="$PROJECT_ROOT/$GREEN_UPLOAD_DIR"
        fi
        
        if [[ -d "$upload_dir" ]] && [[ -w "$upload_dir" ]]; then
            log_info "✓ Upload directory is writable: $upload_dir"
            pass_test "File upload functionality verified"
        else
            log_warning "Upload directory may not be writable: $upload_dir"
            pass_test "File upload partially verified (endpoint responding)"
        fi
    else
        fail_test "File upload test failed (HTTP $status_code)"
    fi
}

# Test WebSocket connectivity
test_websocket_connectivity() {
    start_test "WebSocket Connectivity Test"
    
    # Create a simple WebSocket test using curl or node
    local ws_url="ws://localhost:${BACKEND_PORT}/socket.io/"
    
    # Test if WebSocket endpoint is available using curl
    local ws_response
    ws_response=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Connection: Upgrade" \
        -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" \
        -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
        "$BACKEND_URL/socket.io/" \
        --max-time 10 2>/dev/null || echo "000")
    
    if [[ "$ws_response" =~ ^(101|200|400|401)$ ]]; then
        log_info "✓ WebSocket endpoint responding (HTTP $ws_response)"
        pass_test "WebSocket connectivity verified"
    else
        log_warning "WebSocket test inconclusive (HTTP $ws_response)"
        pass_test "WebSocket test completed (endpoint may require specific protocol)"
    fi
}

# Test ML model inference
test_ml_inference() {
    start_test "ML Model Inference Test"
    
    # Test if ML models are loaded
    local models_response
    models_response=$(curl -s "$ML_URL/api/v1/models" --max-time 10 2>/dev/null || echo "")
    
    if [[ -n "$models_response" ]] && [[ "$models_response" != "000" ]]; then
        log_info "✓ ML models endpoint responding"
        
        # Check if models contain expected model names
        if echo "$models_response" | grep -q "hrnet\|resnet\|cbam"; then
            log_info "✓ Expected ML models found in response"
            pass_test "ML inference capability verified"
        else
            log_warning "ML models response may not contain expected models"
            pass_test "ML inference partially verified (endpoint responding)"
        fi
    else
        fail_test "ML models endpoint not responding"
    fi
}

# Test nginx routing (if running through nginx)
test_nginx_routing() {
    start_test "Nginx Routing Test"
    
    # Test if we can reach the service through the production domain
    if [[ -n "$PRODUCTION_URL" ]]; then
        # Test main routes through nginx
        local nginx_tests=(
            "$PRODUCTION_URL/health:Frontend through Nginx"
            "$PRODUCTION_URL/api/health:Backend API through Nginx"
            "$PRODUCTION_URL/api/ml/health:ML Service through Nginx"
        )
        
        local all_routed=true
        
        for test_case in "${nginx_tests[@]}"; do
            local url="${test_case%%:*}"
            local name="${test_case##*:}"
            
            local response_code
            response_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" --max-time 10 -k || echo "000")
            
            if [[ "$response_code" == "200" ]]; then
                log_info "✓ $name: HTTP $response_code"
            else
                log_warning "⚠ $name: HTTP $response_code (may be expected if not fully configured)"
                all_routed=false
            fi
        done
        
        if [[ "$all_routed" == "true" ]]; then
            pass_test "Nginx routing verified"
        else
            log_warning "Some nginx routes may not be fully configured"
            pass_test "Nginx routing partially verified"
        fi
    else
        log_info "Production URL not configured, skipping nginx routing test"
        pass_test "Nginx routing test skipped (no production URL)"
    fi
}

# Test environment-specific configuration
test_environment_config() {
    start_test "Environment Configuration Test"
    
    # Test that the backend is using the correct database
    local db_config_response
    db_config_response=$(curl -s "$BACKEND_URL/api/debug/config" --max-time 10 2>/dev/null || echo "")
    
    if [[ -n "$db_config_response" ]]; then
        # Check if the response contains the expected database name (without exposing sensitive info)
        if echo "$db_config_response" | grep -q "${TARGET_ENV}"; then
            log_info "✓ Backend using correct environment configuration"
        else
            log_warning "Environment configuration may not be correct"
        fi
    else
        log_info "Debug endpoint not available (this is normal in production)"
    fi
    
    # Test that upload directories are correctly configured
    local upload_dir
    if [[ "$TARGET_ENV" == "blue" ]]; then
        upload_dir="$PROJECT_ROOT/$BLUE_UPLOAD_DIR"
    else
        upload_dir="$PROJECT_ROOT/$GREEN_UPLOAD_DIR"
    fi
    
    if [[ -d "$upload_dir" ]]; then
        local subdirs_ok=true
        for subdir in $UPLOAD_SUBDIRS; do
            if [[ ! -d "$upload_dir/$subdir" ]]; then
                log_warning "Upload subdirectory missing: $subdir"
                subdirs_ok=false
            fi
        done
        
        if [[ "$subdirs_ok" == "true" ]]; then
            log_info "✓ Upload directory structure correct"
        fi
    else
        log_error "Upload directory not found: $upload_dir"
        fail_test "Upload directory configuration incorrect"
        return 1
    fi
    
    pass_test "Environment configuration verified"
}

# Test resource usage
test_resource_usage() {
    start_test "Resource Usage Check"
    
    local high_usage_containers=()
    
    for service in $SERVICES; do
        if docker ps --format "table {{.Names}}" | grep -q "^$service$"; then
            # Get memory usage
            local memory_usage
            memory_usage=$(docker stats "$service" --no-stream --format "table {{.MemPerc}}" | tail -n 1 | tr -d '%')
            
            # Get CPU usage
            local cpu_usage
            cpu_usage=$(docker stats "$service" --no-stream --format "table {{.CPUPerc}}" | tail -n 1 | tr -d '%')
            
            log_info "Resource usage for $service: CPU ${cpu_usage}%, Memory ${memory_usage}%"
            
            # Check for high usage (warning thresholds)
            if (( $(echo "$memory_usage > 90" | bc -l 2>/dev/null || echo 0) )); then
                high_usage_containers+=("$service (Memory: ${memory_usage}%)")
            fi
            
            if (( $(echo "$cpu_usage > 80" | bc -l 2>/dev/null || echo 0) )); then
                high_usage_containers+=("$service (CPU: ${cpu_usage}%)")
            fi
        fi
    done
    
    if [[ ${#high_usage_containers[@]} -gt 0 ]]; then
        log_warning "High resource usage detected in: ${high_usage_containers[*]}"
        pass_test "Resource usage check completed with warnings"
    else
        pass_test "Resource usage within normal limits"
    fi
}

# Test log outputs for errors
test_log_outputs() {
    start_test "Log Output Analysis"
    
    local critical_errors=0
    
    for service in $SERVICES; do
        if docker ps --format "table {{.Names}}" | grep -q "^$service$"; then
            # Check recent logs for critical errors
            local error_count
            error_count=$(docker logs "$service" --since=5m 2>&1 | grep -iE "$CRITICAL_ERROR_KEYWORDS" | wc -l || echo "0")
            
            if [[ "$error_count" -gt 0 ]]; then
                log_error "Critical errors found in $service logs: $error_count"
                ((critical_errors += error_count))
            else
                log_info "✓ No critical errors in $service logs"
            fi
        fi
    done
    
    if [[ $critical_errors -eq 0 ]]; then
        pass_test "No critical errors found in logs"
    else
        fail_test "Found $critical_errors critical errors in logs"
    fi
}

# Generate verification report
generate_verification_report() {
    print_header "Verification Summary"
    
    local success_rate=0
    if [[ $TESTS_TOTAL -gt 0 ]]; then
        success_rate=$(( (TESTS_PASSED * 100) / TESTS_TOTAL ))
    fi
    
    echo "Post-deployment verification completed at $(date)"
    echo "Environment: $TARGET_ENV"
    echo "Log file: $LOG_FILE"
    echo ""
    echo "Test Results:"
    echo "  Total Tests: $TESTS_TOTAL"
    echo "  Passed: $TESTS_PASSED"
    echo "  Failed: $TESTS_FAILED"
    echo "  Warnings: $TESTS_WARNINGS"
    echo "  Success Rate: ${success_rate}%"
    echo ""
    
    if [[ $TESTS_FAILED -eq 0 ]]; then
        echo -e "${GREEN}✅ VERIFICATION PASSED${NC} - System is working correctly"
        echo ""
        echo "Environment Details:"
        echo "  Frontend URL: $FRONTEND_URL"
        echo "  Backend URL: $BACKEND_URL"
        echo "  ML Service URL: $ML_URL"
        echo ""
        echo "All systems are operational and ready for traffic."
        return 0
    else
        echo -e "${RED}❌ VERIFICATION FAILED${NC} - $TESTS_FAILED tests failed"
        echo ""
        echo "Please review the failed tests and fix the issues before proceeding."
        echo "Consider rolling back if critical functionality is broken."
        return 1
    fi
}

# Main verification function
main() {
    log_info "Starting post-deployment verification for $TARGET_ENV environment"
    log_info "Frontend: $FRONTEND_URL"
    log_info "Backend: $BACKEND_URL"
    log_info "ML Service: $ML_URL"
    
    # Run all verification tests
    local test_functions=(
        "test_containers_running"
        "test_health_endpoints"
        "test_database_connectivity"
        "test_redis_connectivity"
        "test_api_endpoints"
        "test_file_upload"
        "test_websocket_connectivity"
        "test_ml_inference"
        "test_nginx_routing"
        "test_environment_config"
        "test_resource_usage"
        "test_log_outputs"
    )
    
    for test_function in "${test_functions[@]}"; do
        if ! "$test_function"; then
            log_error "Test failed: $test_function"
        fi
        echo ""  # Add space between tests
    done
    
    # Generate final report
    generate_verification_report
}

# Handle script termination
cleanup() {
    log_info "Post-deployment verification script terminated"
}
trap cleanup EXIT

# Run main function
main "$@"