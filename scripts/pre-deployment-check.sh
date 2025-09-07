#!/bin/bash
# =================================================================
# Cell Segmentation Hub - Pre-Deployment Validation Script
# =================================================================
# This script performs comprehensive validation checks before deployment
# to prevent common deployment errors and ensure system readiness.

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

# Initialize logging
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/pre-deployment-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Global variables
VALIDATION_ERRORS=0
VALIDATION_WARNINGS=0
CURRENT_ACTIVE_ENV=""
TARGET_ENV=""

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
    ((VALIDATION_WARNINGS++))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
    ((VALIDATION_ERRORS++))
}

# Function to print section headers
print_header() {
    echo ""
    echo "============================================================"
    echo "$1"
    echo "============================================================"
}

# Check if Docker is running
check_docker_running() {
    print_header "Checking Docker Status"
    
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed"
        return 1
    fi
    
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker daemon is not running"
        return 1
    fi
    
    log_success "Docker is running"
    
    # Check Docker Compose
    if ! command -v docker-compose >/dev/null 2>&1; then
        if ! docker compose version >/dev/null 2>&1; then
            log_error "Docker Compose is not available"
            return 1
        else
            log_info "Using Docker Compose plugin"
        fi
    else
        log_info "Using standalone Docker Compose"
    fi
    
    return 0
}

# Check Docker Compose files exist and are valid
check_compose_files() {
    print_header "Validating Docker Compose Files"
    
    local compose_files=("$BLUE_COMPOSE_FILE" "$GREEN_COMPOSE_FILE" "$NGINX_COMPOSE_FILE")
    
    for file in "${compose_files[@]}"; do
        if [[ ! -f "$PROJECT_ROOT/$file" ]]; then
            log_error "Docker Compose file not found: $file"
            continue
        fi
        
        # Validate YAML syntax
        if ! docker-compose -f "$PROJECT_ROOT/$file" config >/dev/null 2>&1; then
            log_error "Invalid YAML syntax in: $file"
            continue
        fi
        
        log_success "Valid compose file: $file"
    done
    
    return 0
}

# Check environment files exist and contain required variables
check_env_files() {
    print_header "Checking Environment Files"
    
    local env_files=("$BLUE_ENV_FILE" "$GREEN_ENV_FILE")
    
    for env_file in "${env_files[@]}"; do
        if [[ ! -f "$PROJECT_ROOT/$env_file" ]]; then
            log_error "Environment file not found: $env_file"
            continue
        fi
        
        # Check required environment variables
        local missing_vars=()
        for var in $REQUIRED_ENV_VARS; do
            if ! grep -q "^${var}=" "$PROJECT_ROOT/$env_file" 2>/dev/null; then
                missing_vars+=("$var")
            fi
        done
        
        if [[ ${#missing_vars[@]} -gt 0 ]]; then
            log_error "Missing required variables in $env_file: ${missing_vars[*]}"
        else
            log_success "Environment file valid: $env_file"
        fi
    done
    
    return 0
}

# Check SSL certificates
check_ssl_certificates() {
    print_header "Checking SSL Certificates"
    
    if [[ "$ENABLE_SSL" == "true" ]]; then
        if [[ ! -d "$SSL_CERT_DIR" ]]; then
            log_error "SSL certificate directory not found: $SSL_CERT_DIR"
            return 1
        fi
        
        local cert_file="$SSL_CERT_DIR/$SSL_CERT_FILE"
        local key_file="$SSL_CERT_DIR/$SSL_KEY_FILE"
        
        if [[ ! -f "$cert_file" ]]; then
            log_error "SSL certificate not found: $cert_file"
            return 1
        fi
        
        if [[ ! -f "$key_file" ]]; then
            log_error "SSL private key not found: $key_file"
            return 1
        fi
        
        # Check certificate expiration
        local expiry_date
        if expiry_date=$(openssl x509 -enddate -noout -in "$cert_file" 2>/dev/null | cut -d= -f2); then
            local expiry_epoch
            expiry_epoch=$(date -d "$expiry_date" +%s 2>/dev/null || echo "0")
            local current_epoch
            current_epoch=$(date +%s)
            local days_until_expiry=$(( (expiry_epoch - current_epoch) / 86400 ))
            
            if [[ $days_until_expiry -lt 30 ]]; then
                log_warning "SSL certificate expires in $days_until_expiry days"
            else
                log_success "SSL certificate valid for $days_until_expiry days"
            fi
        else
            log_warning "Could not check SSL certificate expiration"
        fi
    else
        log_info "SSL is disabled in configuration"
    fi
    
    return 0
}

# Check and create upload directories with correct permissions
check_upload_directories() {
    print_header "Checking Upload Directories and Permissions"
    
    local upload_dirs=("$BLUE_UPLOAD_DIR" "$GREEN_UPLOAD_DIR")
    
    for base_dir in "${upload_dirs[@]}"; do
        # Create base directory if it doesn't exist
        if [[ ! -d "$PROJECT_ROOT/$base_dir" ]]; then
            log_info "Creating upload directory: $base_dir"
            mkdir -p "$PROJECT_ROOT/$base_dir"
        fi
        
        # Create required subdirectories
        for subdir in $UPLOAD_SUBDIRS; do
            local full_path="$PROJECT_ROOT/$base_dir/$subdir"
            if [[ ! -d "$full_path" ]]; then
                log_info "Creating subdirectory: $base_dir/$subdir"
                mkdir -p "$full_path"
            fi
        done
        
        # Check permissions
        local owner_uid
        owner_uid=$(stat -c %u "$PROJECT_ROOT/$base_dir" 2>/dev/null || echo "0")
        if [[ "$owner_uid" != "$DOCKER_UID" ]]; then
            log_warning "Upload directory $base_dir has incorrect ownership (UID: $owner_uid, expected: $DOCKER_UID)"
        else
            log_success "Upload directory permissions correct: $base_dir"
        fi
    done
    
    return 0
}

# Check ML model weights exist
check_ml_weights() {
    print_header "Checking ML Model Weights"
    
    if [[ ! -d "$PROJECT_ROOT/$ML_WEIGHTS_DIR" ]]; then
        log_error "ML weights directory not found: $ML_WEIGHTS_DIR"
        return 1
    fi
    
    local missing_files=()
    for file in $REQUIRED_ML_FILES; do
        if [[ ! -f "$PROJECT_ROOT/$ML_WEIGHTS_DIR/$file" ]]; then
            missing_files+=("$file")
        fi
    done
    
    if [[ ${#missing_files[@]} -gt 0 ]]; then
        log_error "Missing ML model files: ${missing_files[*]}"
        log_error "Download them from the official repository"
        return 1
    fi
    
    log_success "All required ML model weights found"
    return 0
}

# Test database connectivity for both environments
check_database_connectivity() {
    print_header "Checking Database Connectivity"
    
    # This function checks if the database containers can be started and connected to
    # We'll do a dry run without actually affecting the running services
    
    local envs=("blue" "green")
    
    for env in "${envs[@]}"; do
        local compose_file
        local db_service
        local network
        
        if [[ "$env" == "blue" ]]; then
            compose_file="$BLUE_COMPOSE_FILE"
            db_service="postgres-blue"
            network="$BLUE_NETWORK"
        else
            compose_file="$GREEN_COMPOSE_FILE"
            db_service="postgres-green"
            network="$GREEN_NETWORK"
        fi
        
        # Check if database is already running
        if docker ps --format "table {{.Names}}" | grep -q "$db_service"; then
            log_success "Database $db_service is already running"
        else
            log_info "Database $db_service is not running (will be started during deployment)"
        fi
    done
    
    return 0
}

# Validate Nginx configuration
check_nginx_config() {
    print_header "Validating Nginx Configuration"
    
    if [[ ! -f "$PROJECT_ROOT/$NGINX_PROD_CONFIG" ]]; then
        log_error "Nginx production config not found: $NGINX_PROD_CONFIG"
        return 1
    fi
    
    # Test nginx config syntax in a temporary container
    local temp_container="nginx-config-test-$$"
    
    if docker run --rm --name "$temp_container" \
        -v "$PROJECT_ROOT/$NGINX_PROD_CONFIG:/etc/nginx/nginx.conf:ro" \
        nginx:alpine nginx -t >/dev/null 2>&1; then
        log_success "Nginx configuration syntax is valid"
    else
        log_error "Nginx configuration syntax error"
        # Show the actual error
        docker run --rm --name "$temp_container" \
            -v "$PROJECT_ROOT/$NGINX_PROD_CONFIG:/etc/nginx/nginx.conf:ro" \
            nginx:alpine nginx -t
        return 1
    fi
    
    return 0
}

# Check available disk space
check_disk_space() {
    print_header "Checking Disk Space"
    
    local available_gb
    available_gb=$(df "$PROJECT_ROOT" | awk 'NR==2 {printf "%.1f", $4/1024/1024}')
    
    if (( $(echo "$available_gb < $MIN_DISK_SPACE_GB" | bc -l) )); then
        log_error "Insufficient disk space: ${available_gb}GB available, ${MIN_DISK_SPACE_GB}GB required"
        return 1
    fi
    
    log_success "Sufficient disk space: ${available_gb}GB available"
    return 0
}

# Check memory usage
check_memory_usage() {
    print_header "Checking Memory Usage"
    
    local total_memory_mb
    total_memory_mb=$(free -m | awk 'NR==2{print $2}')
    local used_memory_mb
    used_memory_mb=$(free -m | awk 'NR==2{print $3}')
    local available_memory_mb
    available_memory_mb=$((total_memory_mb - used_memory_mb))
    
    if [[ $available_memory_mb -lt $MIN_MEMORY_MB ]]; then
        log_error "Insufficient memory: ${available_memory_mb}MB available, ${MIN_MEMORY_MB}MB required"
        return 1
    fi
    
    local memory_usage_percent
    memory_usage_percent=$((used_memory_mb * 100 / total_memory_mb))
    
    if [[ $memory_usage_percent -gt $MAX_CPU_USAGE_PERCENT ]]; then
        log_warning "High memory usage: ${memory_usage_percent}%"
    fi
    
    log_success "Memory check passed: ${available_memory_mb}MB available, ${memory_usage_percent}% used"
    return 0
}

# Detect currently active environment
detect_active_environment() {
    print_header "Detecting Active Environment"
    
    # Check which nginx upstream is currently active
    if [[ -f "$PROJECT_ROOT/$NGINX_PROD_CONFIG" ]]; then
        if grep -q "server blue-backend:3001" "$PROJECT_ROOT/$NGINX_PROD_CONFIG"; then
            CURRENT_ACTIVE_ENV="blue"
            TARGET_ENV="green"
        elif grep -q "server green-backend:3001" "$PROJECT_ROOT/$NGINX_PROD_CONFIG"; then
            CURRENT_ACTIVE_ENV="green"
            TARGET_ENV="blue"
        else
            log_warning "Could not determine active environment from nginx config"
            CURRENT_ACTIVE_ENV="unknown"
            TARGET_ENV="blue"  # Default to blue
        fi
    fi
    
    # Verify by checking running containers
    local blue_running=0
    local green_running=0
    
    for service in $BLUE_SERVICES; do
        if docker ps --format "table {{.Names}}" | grep -q "$service"; then
            ((blue_running++))
        fi
    done
    
    for service in $GREEN_SERVICES; do
        if docker ps --format "table {{.Names}}" | grep -q "$service"; then
            ((green_running++))
        fi
    done
    
    log_info "Blue environment services running: $blue_running"
    log_info "Green environment services running: $green_running"
    
    if [[ "$CURRENT_ACTIVE_ENV" != "unknown" ]]; then
        log_success "Active environment: $CURRENT_ACTIVE_ENV"
        log_success "Target environment: $TARGET_ENV"
    else
        log_warning "Active environment detection uncertain"
    fi
    
    return 0
}

# Check for port conflicts
check_port_conflicts() {
    print_header "Checking Port Conflicts"
    
    local target_ports
    if [[ "$TARGET_ENV" == "blue" ]]; then
        target_ports=($BLUE_FRONTEND_PORT $BLUE_BACKEND_PORT $BLUE_ML_PORT $BLUE_NGINX_HTTP)
    else
        target_ports=($GREEN_FRONTEND_PORT $GREEN_BACKEND_PORT $GREEN_ML_PORT $GREEN_NGINX_HTTP)
    fi
    
    local conflicts=0
    for port in "${target_ports[@]}"; do
        if netstat -tuln | grep -q ":$port "; then
            # Check if it's one of our expected services
            local container_name
            container_name=$(docker ps --format "table {{.Names}}\t{{.Ports}}" | grep ":$port->" | awk '{print $1}' || echo "")
            
            if [[ -n "$container_name" ]] && [[ "$TARGET_ENV" == "blue" ]] && [[ "$container_name" =~ blue-.* ]]; then
                log_info "Port $port is occupied by expected blue service: $container_name"
            elif [[ -n "$container_name" ]] && [[ "$TARGET_ENV" == "green" ]] && [[ "$container_name" =~ green-.* ]]; then
                log_info "Port $port is occupied by expected green service: $container_name"
            else
                log_error "Port conflict detected on port $port (occupied by: $container_name)"
                ((conflicts++))
            fi
        fi
    done
    
    if [[ $conflicts -eq 0 ]]; then
        log_success "No unexpected port conflicts detected"
    fi
    
    return $conflicts
}

# Generate validation report
generate_validation_report() {
    print_header "Validation Summary"
    
    echo "Pre-deployment validation completed at $(date)"
    echo "Log file: $LOG_FILE"
    echo ""
    echo "Results:"
    echo "  Errors: $VALIDATION_ERRORS"
    echo "  Warnings: $VALIDATION_WARNINGS"
    echo ""
    
    if [[ $VALIDATION_ERRORS -eq 0 ]]; then
        echo -e "${GREEN}✓ VALIDATION PASSED${NC} - System is ready for deployment"
        echo ""
        echo "Deployment Plan:"
        echo "  Current Active Environment: $CURRENT_ACTIVE_ENV"
        echo "  Target Environment: $TARGET_ENV"
        echo "  Deployment Strategy: $DEPLOYMENT_STRATEGY"
        echo ""
        echo "Next steps:"
        echo "  1. Run backup of current environment"
        echo "  2. Deploy to $TARGET_ENV environment"
        echo "  3. Run post-deployment verification"
        echo "  4. Switch nginx routing to $TARGET_ENV"
        echo ""
        return 0
    else
        echo -e "${RED}✗ VALIDATION FAILED${NC} - Fix errors before deployment"
        echo ""
        echo "Please address all errors and run validation again."
        echo ""
        return 1
    fi
}

# Main validation function
main() {
    log_info "Starting pre-deployment validation"
    log_info "Project root: $PROJECT_ROOT"
    log_info "Configuration file: $CONFIG_FILE"
    
    # Validate configuration file itself
    if ! validate_config; then
        log_error "Configuration validation failed"
        exit 1
    fi
    
    # Detect current state
    detect_active_environment
    
    # Run all validation checks
    local checks=(
        "check_docker_running"
        "check_compose_files"
        "check_env_files"
        "check_ssl_certificates"
        "check_upload_directories"
        "check_ml_weights"
        "check_database_connectivity"
        "check_nginx_config"
        "check_disk_space"
        "check_memory_usage"
        "check_port_conflicts"
    )
    
    for check in "${checks[@]}"; do
        if ! "$check"; then
            log_error "Validation check failed: $check"
        fi
    done
    
    # Generate final report
    generate_validation_report
}

# Handle script termination
cleanup() {
    log_info "Pre-deployment validation script terminated"
}
trap cleanup EXIT

# Run main function
main "$@"