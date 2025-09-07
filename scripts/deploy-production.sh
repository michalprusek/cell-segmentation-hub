#!/bin/bash
# =================================================================
# Cell Segmentation Hub - Production Deployment Script
# =================================================================
# This script handles zero-downtime blue-green deployments with
# automatic health checks, database migrations, and rollback capabilities.

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
DEPLOYMENT_ID="deployment-$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/${DEPLOYMENT_ID}.log"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Global deployment state
CURRENT_ACTIVE_ENV=""
TARGET_ENV=""
DEPLOYMENT_STARTED=false
BACKUP_CREATED=false
NEW_ENV_DEPLOYED=false
TRAFFIC_SWITCHED=false
OLD_ENV_STOPPED=false

# Command line argument parsing
FORCE_DEPLOYMENT=false
SKIP_BACKUP=false
QUICK_ROLLBACK=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            FORCE_DEPLOYMENT=true
            shift
            ;;
        --skip-backup)
            SKIP_BACKUP=true
            shift
            ;;
        --quick-rollback)
            QUICK_ROLLBACK=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --force          Force deployment even if validation fails"
            echo "  --skip-backup    Skip database backup (NOT RECOMMENDED)"
            echo "  --quick-rollback Perform quick rollback to previous environment"
            echo "  --help, -h       Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                    # Normal deployment with all safety checks"
            echo "  $0 --force           # Force deployment bypassing validation"
            echo "  $0 --quick-rollback  # Rollback to previous environment"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_deploy() {
    echo -e "${PURPLE}[DEPLOY]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_rollback() {
    echo -e "${CYAN}[ROLLBACK]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Function to print section headers
print_header() {
    echo ""
    echo "============================================================"
    echo "$1"
    echo "============================================================"
}

print_banner() {
    echo ""
    echo "██████╗ ███████╗██████╗ ██╗      ██████╗ ██╗   ██╗"
    echo "██╔══██╗██╔════╝██╔══██╗██║     ██╔═══██╗╚██╗ ██╔╝"
    echo "██║  ██║█████╗  ██████╔╝██║     ██║   ██║ ╚████╔╝ "
    echo "██║  ██║██╔══╝  ██╔═══╝ ██║     ██║   ██║  ╚██╔╝  "
    echo "██████╔╝███████╗██║     ███████╗╚██████╔╝   ██║   "
    echo "╚═════╝ ╚══════╝╚═╝     ╚══════╝ ╚═════╝    ╚═╝   "
    echo ""
    echo "Cell Segmentation Hub - Blue-Green Deployment System"
    echo "Deployment ID: $DEPLOYMENT_ID"
    echo "$(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
}

# Cleanup function for emergency situations
emergency_cleanup() {
    log_error "Emergency cleanup triggered"
    
    if [[ "$TRAFFIC_SWITCHED" == "true" ]] && [[ -n "$CURRENT_ACTIVE_ENV" ]]; then
        log_rollback "Attempting to switch traffic back to $CURRENT_ACTIVE_ENV"
        switch_nginx_traffic "$CURRENT_ACTIVE_ENV" || true
    fi
    
    if [[ "$NEW_ENV_DEPLOYED" == "true" ]] && [[ -n "$TARGET_ENV" ]]; then
        log_rollback "Stopping newly deployed $TARGET_ENV environment"
        stop_environment "$TARGET_ENV" || true
    fi
    
    log_error "Emergency cleanup completed"
}

# Trap for cleanup on script termination
cleanup() {
    if [[ "$DEPLOYMENT_STARTED" == "true" ]] && [[ $? -ne 0 ]]; then
        log_error "Deployment failed, running emergency cleanup"
        emergency_cleanup
    fi
    log_info "Deployment script terminated"
}
trap cleanup EXIT

# Detect currently active environment
detect_active_environment() {
    print_header "Detecting Active Environment"
    
    # Method 1: Check nginx configuration
    if [[ -f "$PROJECT_ROOT/$NGINX_PROD_CONFIG" ]]; then
        if grep -q "server blue-backend:3001" "$PROJECT_ROOT/$NGINX_PROD_CONFIG"; then
            CURRENT_ACTIVE_ENV="blue"
            TARGET_ENV="green"
        elif grep -q "server green-backend:3001" "$PROJECT_ROOT/$NGINX_PROD_CONFIG"; then
            CURRENT_ACTIVE_ENV="green"
            TARGET_ENV="blue"
        fi
    fi
    
    # Method 2: Check running containers as confirmation
    local blue_containers=0
    local green_containers=0
    
    for service in $BLUE_SERVICES; do
        if docker ps --format "table {{.Names}}" | grep -q "^$service$"; then
            ((blue_containers++))
        fi
    done
    
    for service in $GREEN_SERVICES; do
        if docker ps --format "table {{.Names}}" | grep -q "^$service$"; then
            ((green_containers++))
        fi
    done
    
    log_info "Blue environment containers running: $blue_containers"
    log_info "Green environment containers running: $green_containers"
    
    # If detection from nginx config failed, use container count as fallback
    if [[ -z "$CURRENT_ACTIVE_ENV" ]]; then
        if [[ $blue_containers -gt $green_containers ]]; then
            CURRENT_ACTIVE_ENV="blue"
            TARGET_ENV="green"
        else
            CURRENT_ACTIVE_ENV="green"
            TARGET_ENV="blue"
        fi
        log_warning "Active environment detected from running containers"
    fi
    
    log_success "Current active environment: $CURRENT_ACTIVE_ENV"
    log_success "Target deployment environment: $TARGET_ENV"
    
    return 0
}

# Run pre-deployment validation
run_pre_deployment_validation() {
    print_header "Pre-Deployment Validation"
    
    if [[ "$FORCE_DEPLOYMENT" == "true" ]]; then
        log_warning "Skipping pre-deployment validation (--force flag)"
        return 0
    fi
    
    log_info "Running comprehensive pre-deployment checks..."
    
    if ! "$SCRIPT_DIR/pre-deployment-check.sh"; then
        log_error "Pre-deployment validation failed"
        log_error "Use --force to bypass validation (NOT RECOMMENDED)"
        return 1
    fi
    
    log_success "Pre-deployment validation passed"
    return 0
}

# Fix permissions before deployment
fix_permissions() {
    print_header "Fixing File Permissions"
    
    log_info "Running permission fix script..."
    
    if ! "$SCRIPT_DIR/fix-permissions.sh"; then
        log_error "Permission fix failed"
        return 1
    fi
    
    log_success "File permissions fixed"
    return 0
}

# Create backup of current environment
create_backup() {
    if [[ "$SKIP_BACKUP" == "true" ]]; then
        log_warning "Skipping backup creation (--skip-backup flag)"
        BACKUP_CREATED=true  # Mark as created to prevent rollback issues
        return 0
    fi
    
    print_header "Creating Backup of Current Environment"
    
    local backup_timestamp
    backup_timestamp=$(date +%Y%m%d-%H%M%S)
    local backup_name="backup-${CURRENT_ACTIVE_ENV}-${backup_timestamp}"
    local backup_path="$PROJECT_ROOT/$BACKUP_DIR/$backup_name"
    
    # Create backup directory
    mkdir -p "$backup_path"
    
    # Backup database
    log_info "Backing up $CURRENT_ACTIVE_ENV database..."
    local db_container
    local db_name
    
    if [[ "$CURRENT_ACTIVE_ENV" == "blue" ]]; then
        db_container="postgres-blue"
        db_name="$BLUE_DB_NAME"
    else
        db_container="postgres-green"  
        db_name="$GREEN_DB_NAME"
    fi
    
    # Check if database container is running
    if ! docker ps --format "table {{.Names}}" | grep -q "^$db_container$"; then
        log_error "Database container $db_container is not running"
        return 1
    fi
    
    # Create database dump with timeout
    if timeout $BACKUP_TIMEOUT docker exec "$db_container" pg_dump -U "$DB_USER" -d "$db_name" > "$backup_path/database.sql"; then
        log_success "Database backup created: $backup_path/database.sql"
    else
        log_error "Database backup failed"
        return 1
    fi
    
    # Backup upload files
    log_info "Backing up upload files..."
    local upload_source
    if [[ "$CURRENT_ACTIVE_ENV" == "blue" ]]; then
        upload_source="$PROJECT_ROOT/$BLUE_UPLOAD_DIR"
    else
        upload_source="$PROJECT_ROOT/$GREEN_UPLOAD_DIR"
    fi
    
    if [[ -d "$upload_source" ]]; then
        if cp -r "$upload_source" "$backup_path/uploads"; then
            log_success "Upload files backup created: $backup_path/uploads"
        else
            log_error "Upload files backup failed"
            return 1
        fi
    else
        log_warning "Upload directory not found: $upload_source"
    fi
    
    # Backup nginx configuration
    log_info "Backing up nginx configuration..."
    if cp "$PROJECT_ROOT/$NGINX_PROD_CONFIG" "$backup_path/nginx.conf"; then
        log_success "Nginx configuration backup created"
    else
        log_error "Nginx configuration backup failed"
        return 1
    fi
    
    # Create backup metadata
    cat > "$backup_path/metadata.txt" << EOF
Backup created: $(date)
Environment: $CURRENT_ACTIVE_ENV
Deployment ID: $DEPLOYMENT_ID
Database: $db_name
Upload directory: $upload_source
EOF
    
    # Store backup path for potential rollback
    echo "$backup_path" > "$PROJECT_ROOT/.last_backup"
    
    BACKUP_CREATED=true
    log_success "Backup created successfully: $backup_path"
    
    # Cleanup old backups
    cleanup_old_backups
    
    return 0
}

# Cleanup old backups
cleanup_old_backups() {
    log_info "Cleaning up old backups..."
    
    local backup_base="$PROJECT_ROOT/$BACKUP_DIR"
    if [[ ! -d "$backup_base" ]]; then
        return 0
    fi
    
    # Remove backups older than retention period
    find "$backup_base" -maxdepth 1 -type d -name "backup-*" -mtime +$BACKUP_RETENTION_DAYS -exec rm -rf {} \; 2>/dev/null || true
    
    # Keep only the most recent backups (based on MAX_BACKUPS_KEEP)
    local backup_count
    backup_count=$(find "$backup_base" -maxdepth 1 -type d -name "backup-*" | wc -l)
    
    if [[ $backup_count -gt $MAX_BACKUPS_KEEP ]]; then
        local backups_to_remove=$((backup_count - MAX_BACKUPS_KEEP))
        find "$backup_base" -maxdepth 1 -type d -name "backup-*" -printf "%T@ %p\n" | \
            sort -n | head -n "$backups_to_remove" | cut -d' ' -f2- | \
            xargs rm -rf 2>/dev/null || true
        log_info "Removed $backups_to_remove old backups"
    fi
}

# Build and deploy to target environment
deploy_to_target_environment() {
    print_header "Deploying to $TARGET_ENV Environment"
    
    local compose_file
    local env_file
    
    if [[ "$TARGET_ENV" == "blue" ]]; then
        compose_file="$BLUE_COMPOSE_FILE"
        env_file="$BLUE_ENV_FILE"
    else
        compose_file="$GREEN_COMPOSE_FILE"
        env_file="$GREEN_ENV_FILE"
    fi
    
    # Ensure environment file exists
    if [[ ! -f "$PROJECT_ROOT/$env_file" ]]; then
        log_error "Environment file not found: $env_file"
        return 1
    fi
    
    # Stop target environment if it's running (cleanup from previous deployment)
    log_info "Stopping any existing $TARGET_ENV services..."
    stop_environment "$TARGET_ENV" || true
    
    # Build and start new environment
    log_deploy "Building $TARGET_ENV environment..."
    cd "$PROJECT_ROOT"
    
    # Load environment variables for password
    export $(grep -v '^#' "$env_file" | xargs -d '\n')
    
    # Build with no cache to ensure latest code
    if ! timeout $SERVICE_START_TIMEOUT docker-compose -f "$compose_file" build --no-cache; then
        log_error "Failed to build $TARGET_ENV environment"
        return 1
    fi
    
    log_deploy "Starting $TARGET_ENV services..."
    if ! timeout $SERVICE_START_TIMEOUT docker-compose -f "$compose_file" up -d; then
        log_error "Failed to start $TARGET_ENV services"
        return 1
    fi
    
    NEW_ENV_DEPLOYED=true
    log_success "$TARGET_ENV environment deployed"
    
    return 0
}

# Wait for services to be healthy
wait_for_health_checks() {
    print_header "Waiting for Health Checks"
    
    local services
    if [[ "$TARGET_ENV" == "blue" ]]; then
        services=$BLUE_SERVICES
    else
        services=$GREEN_SERVICES
    fi
    
    log_info "Checking health of $TARGET_ENV services..."
    
    local max_attempts=$HEALTH_CHECK_RETRIES
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        log_info "Health check attempt $attempt/$max_attempts"
        
        local healthy_services=0
        local total_services=0
        
        for service in $services; do
            ((total_services++))
            
            # Check if container is running
            if docker ps --format "table {{.Names}}" | grep -q "^$service$"; then
                # Check health status
                local health_status
                health_status=$(docker inspect --format='{{.State.Health.Status}}' "$service" 2>/dev/null || echo "none")
                
                if [[ "$health_status" == "healthy" ]] || [[ "$health_status" == "none" ]]; then
                    # If no health check is defined, consider it healthy if running
                    if [[ "$health_status" == "none" ]]; then
                        # Do a simple connectivity test instead
                        case $service in
                            *frontend*)
                                if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${TARGET_ENV == 'blue' && echo $BLUE_FRONTEND_PORT || echo $GREEN_FRONTEND_PORT}/health" | grep -q "200"; then
                                    ((healthy_services++))
                                fi
                                ;;
                            *backend*)
                                if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${TARGET_ENV == 'blue' && echo $BLUE_BACKEND_PORT || echo $GREEN_BACKEND_PORT}/health" | grep -q "200"; then
                                    ((healthy_services++))
                                fi
                                ;;
                            *ml*)
                                if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${TARGET_ENV == 'blue' && echo $BLUE_ML_PORT || echo $GREEN_ML_PORT}/health" | grep -q "200"; then
                                    ((healthy_services++))
                                fi
                                ;;
                            *)
                                ((healthy_services++))  # Database and Redis services
                                ;;
                        esac
                    else
                        ((healthy_services++))
                    fi
                fi
                
                log_info "Service $service: $(docker inspect --format='{{.State.Status}}' "$service" 2>/dev/null || echo 'unknown') (health: $health_status)"
            else
                log_warning "Service $service is not running"
            fi
        done
        
        log_info "Healthy services: $healthy_services/$total_services"
        
        if [[ $healthy_services -eq $total_services ]]; then
            log_success "All $TARGET_ENV services are healthy"
            return 0
        fi
        
        if [[ $attempt -lt $max_attempts ]]; then
            log_info "Waiting $HEALTH_CHECK_INTERVAL seconds before next check..."
            sleep $HEALTH_CHECK_INTERVAL
        fi
        
        ((attempt++))
    done
    
    log_error "Health check failed after $max_attempts attempts"
    return 1
}

# Run database migrations
run_database_migrations() {
    print_header "Running Database Migrations"
    
    if [[ "$AUTO_MIGRATE" != "true" ]]; then
        log_info "Auto-migration is disabled, skipping"
        return 0
    fi
    
    local backend_container
    if [[ "$TARGET_ENV" == "blue" ]]; then
        backend_container="blue-backend"
    else
        backend_container="green-backend"
    fi
    
    # Wait for backend to be fully ready
    sleep 10
    
    log_info "Running database migrations in $backend_container..."
    
    # Run Prisma migration
    if timeout $DB_MIGRATION_TIMEOUT docker exec "$backend_container" npx prisma migrate deploy; then
        log_success "Database migrations completed"
    else
        log_error "Database migration failed"
        if [[ "$ROLLBACK_ON_MIGRATION_FAILURE" == "true" ]]; then
            log_rollback "Rolling back due to migration failure"
            return 1
        fi
    fi
    
    # Generate Prisma client
    log_info "Generating Prisma client..."
    if docker exec "$backend_container" npx prisma generate; then
        log_success "Prisma client generated"
    else
        log_warning "Prisma client generation failed (non-critical)"
    fi
    
    return 0
}

# Run comprehensive tests on new environment
run_deployment_tests() {
    print_header "Running Deployment Tests"
    
    log_info "Running post-deployment verification tests..."
    
    if ! "$SCRIPT_DIR/post-deployment-verify.sh" "$TARGET_ENV"; then
        log_error "Post-deployment tests failed"
        return 1
    fi
    
    log_success "All deployment tests passed"
    return 0
}

# Switch nginx traffic to new environment  
switch_nginx_traffic() {
    local target_env="$1"
    print_header "Switching Traffic to $target_env Environment"
    
    local nginx_config="$PROJECT_ROOT/$NGINX_PROD_CONFIG"
    local nginx_backup="$nginx_config.backup-$(date +%Y%m%d-%H%M%S)"
    
    # Create backup of current nginx config
    cp "$nginx_config" "$nginx_backup"
    log_info "Nginx config backed up to: $(basename "$nginx_backup")"
    
    # Update upstream servers based on target environment
    local backend_upstream
    local ml_upstream
    local frontend_upstream
    
    if [[ "$target_env" == "blue" ]]; then
        backend_upstream="$NGINX_BACKEND_UPSTREAM_BLUE"
        ml_upstream="$NGINX_ML_UPSTREAM_BLUE"
        frontend_upstream="$NGINX_FRONTEND_UPSTREAM_BLUE"
    else
        backend_upstream="$NGINX_BACKEND_UPSTREAM_GREEN"
        ml_upstream="$NGINX_ML_UPSTREAM_GREEN"
        frontend_upstream="$NGINX_FRONTEND_UPSTREAM_GREEN"
    fi
    
    # Create temporary config with new upstreams
    local temp_config="$nginx_config.tmp"
    sed -e "s|upstream backend {.*}|upstream backend { $backend_upstream }|g" \
        -e "s|upstream ml_service {.*}|upstream ml_service { $ml_upstream }|g" \
        -e "s|upstream frontend {.*}|upstream frontend { $frontend_upstream }|g" \
        "$nginx_config" > "$temp_config"
    
    # Validate new configuration
    if docker run --rm -v "$temp_config:/etc/nginx/nginx.conf:ro" nginx:alpine nginx -t >/dev/null 2>&1; then
        log_success "New nginx configuration is valid"
    else
        log_error "New nginx configuration is invalid"
        rm -f "$temp_config"
        return 1
    fi
    
    # Apply new configuration
    mv "$temp_config" "$nginx_config"
    
    # Reload nginx (assuming nginx is running in a container or as a service)
    if docker ps --format "table {{.Names}}" | grep -q "nginx"; then
        local nginx_container
        nginx_container=$(docker ps --format "table {{.Names}}" | grep "nginx" | head -1)
        
        if docker exec "$nginx_container" nginx -s reload; then
            log_success "Nginx configuration reloaded successfully"
        else
            log_error "Failed to reload nginx configuration"
            # Restore backup
            mv "$nginx_backup" "$nginx_config"
            return 1
        fi
    else
        log_info "No nginx container found, configuration updated for next restart"
    fi
    
    TRAFFIC_SWITCHED=true
    log_success "Traffic switched to $target_env environment"
    
    return 0
}

# Stop old environment
stop_environment() {
    local env="$1"
    print_header "Stopping $env Environment"
    
    local compose_file
    if [[ "$env" == "blue" ]]; then
        compose_file="$BLUE_COMPOSE_FILE"
    else
        compose_file="$GREEN_COMPOSE_FILE"
    fi
    
    cd "$PROJECT_ROOT"
    
    # Stop services gracefully
    log_info "Stopping $env services..."
    if docker-compose -f "$compose_file" stop; then
        log_success "$env services stopped"
    else
        log_warning "Some $env services may still be running"
    fi
    
    # Remove containers but keep volumes
    log_info "Removing $env containers..."
    if docker-compose -f "$compose_file" rm -f; then
        log_success "$env containers removed"
    else
        log_warning "Some $env containers may still exist"
    fi
    
    if [[ "$env" == "$CURRENT_ACTIVE_ENV" ]]; then
        OLD_ENV_STOPPED=true
    fi
    
    return 0
}

# Quick rollback function
perform_quick_rollback() {
    print_header "Performing Quick Rollback"
    
    if [[ -z "$CURRENT_ACTIVE_ENV" ]]; then
        log_error "Cannot determine environment to rollback to"
        return 1
    fi
    
    log_rollback "Rolling back to $CURRENT_ACTIVE_ENV environment"
    
    # Switch nginx traffic back
    if ! switch_nginx_traffic "$CURRENT_ACTIVE_ENV"; then
        log_error "Failed to switch traffic back to $CURRENT_ACTIVE_ENV"
        return 1
    fi
    
    # Stop the failed new environment
    if [[ -n "$TARGET_ENV" ]]; then
        stop_environment "$TARGET_ENV"
    fi
    
    # Restart old environment if it was stopped
    if [[ "$OLD_ENV_STOPPED" == "true" ]]; then
        log_rollback "Restarting $CURRENT_ACTIVE_ENV environment"
        
        local compose_file
        if [[ "$CURRENT_ACTIVE_ENV" == "blue" ]]; then
            compose_file="$BLUE_COMPOSE_FILE"
        else
            compose_file="$GREEN_COMPOSE_FILE"
        fi
        
        cd "$PROJECT_ROOT"
        if docker-compose -f "$compose_file" up -d; then
            log_success "$CURRENT_ACTIVE_ENV environment restarted"
        else
            log_error "Failed to restart $CURRENT_ACTIVE_ENV environment"
            return 1
        fi
    fi
    
    log_success "Quick rollback completed successfully"
    return 0
}

# Full rollback from backup
perform_full_rollback() {
    print_header "Performing Full Rollback from Backup"
    
    if [[ "$BACKUP_CREATED" != "true" ]]; then
        log_error "No backup was created, cannot perform full rollback"
        log_info "Use quick rollback instead: $0 --quick-rollback"
        return 1
    fi
    
    local backup_path
    if [[ -f "$PROJECT_ROOT/.last_backup" ]]; then
        backup_path=$(cat "$PROJECT_ROOT/.last_backup")
    else
        log_error "Backup path not found"
        return 1
    fi
    
    if [[ ! -d "$backup_path" ]]; then
        log_error "Backup directory not found: $backup_path"
        return 1
    fi
    
    log_rollback "Restoring from backup: $backup_path"
    
    # Restore database
    if [[ -f "$backup_path/database.sql" ]]; then
        log_rollback "Restoring database..."
        
        local db_container
        local db_name
        
        if [[ "$CURRENT_ACTIVE_ENV" == "blue" ]]; then
            db_container="postgres-blue"
            db_name="$BLUE_DB_NAME"
        else
            db_container="postgres-green"
            db_name="$GREEN_DB_NAME"
        fi
        
        # Restore database from backup
        if docker exec -i "$db_container" psql -U "$DB_USER" -d "$db_name" < "$backup_path/database.sql"; then
            log_success "Database restored from backup"
        else
            log_error "Database restoration failed"
        fi
    fi
    
    # Restore upload files
    if [[ -d "$backup_path/uploads" ]]; then
        log_rollback "Restoring upload files..."
        
        local upload_target
        if [[ "$CURRENT_ACTIVE_ENV" == "blue" ]]; then
            upload_target="$PROJECT_ROOT/$BLUE_UPLOAD_DIR"
        else
            upload_target="$PROJECT_ROOT/$GREEN_UPLOAD_DIR"
        fi
        
        if rm -rf "$upload_target" && cp -r "$backup_path/uploads" "$upload_target"; then
            log_success "Upload files restored from backup"
        else
            log_error "Upload files restoration failed"
        fi
    fi
    
    # Restore nginx configuration
    if [[ -f "$backup_path/nginx.conf" ]]; then
        log_rollback "Restoring nginx configuration..."
        
        if cp "$backup_path/nginx.conf" "$PROJECT_ROOT/$NGINX_PROD_CONFIG"; then
            log_success "Nginx configuration restored from backup"
            
            # Reload nginx
            if docker ps --format "table {{.Names}}" | grep -q "nginx"; then
                local nginx_container
                nginx_container=$(docker ps --format "table {{.Names}}" | grep "nginx" | head -1)
                docker exec "$nginx_container" nginx -s reload || true
            fi
        else
            log_error "Nginx configuration restoration failed"
        fi
    fi
    
    log_success "Full rollback completed"
    return 0
}

# Main deployment function
main() {
    print_banner
    
    DEPLOYMENT_STARTED=true
    
    # Handle quick rollback
    if [[ "$QUICK_ROLLBACK" == "true" ]]; then
        detect_active_environment
        perform_quick_rollback
        exit $?
    fi
    
    log_deploy "Starting blue-green deployment"
    log_deploy "Deployment ID: $DEPLOYMENT_ID"
    log_deploy "Log file: $LOG_FILE"
    
    # Step 1: Detect current state
    detect_active_environment
    
    # Step 2: Run pre-deployment validation
    if ! run_pre_deployment_validation; then
        log_error "Deployment aborted due to validation failure"
        exit 1
    fi
    
    # Step 3: Fix permissions
    if ! fix_permissions; then
        log_error "Deployment aborted due to permission fix failure"
        exit 1
    fi
    
    # Step 4: Create backup
    if ! create_backup; then
        log_error "Deployment aborted due to backup failure"
        if [[ "$SKIP_BACKUP" != "true" ]]; then
            exit 1
        fi
    fi
    
    # Step 5: Deploy to target environment
    if ! deploy_to_target_environment; then
        log_error "Deployment failed during environment setup"
        perform_quick_rollback
        exit 1
    fi
    
    # Step 6: Wait for health checks
    if ! wait_for_health_checks; then
        log_error "Deployment failed during health checks"
        perform_quick_rollback
        exit 1
    fi
    
    # Step 7: Run database migrations
    if ! run_database_migrations; then
        log_error "Deployment failed during database migrations"
        perform_quick_rollback
        exit 1
    fi
    
    # Step 8: Run deployment tests
    if ! run_deployment_tests; then
        log_error "Deployment failed during testing"
        perform_quick_rollback
        exit 1
    fi
    
    # Step 9: Switch traffic to new environment
    if ! switch_nginx_traffic "$TARGET_ENV"; then
        log_error "Deployment failed during traffic switch"
        perform_quick_rollback
        exit 1
    fi
    
    # Step 10: Stop old environment (after traffic switch)
    log_info "Waiting 30 seconds to ensure traffic switch is stable..."
    sleep 30
    
    if ! stop_environment "$CURRENT_ACTIVE_ENV"; then
        log_warning "Failed to stop old environment, but deployment is successful"
    fi
    
    # Deployment completed successfully
    print_header "Deployment Completed Successfully"
    
    log_success "🎉 Blue-Green Deployment Completed Successfully!"
    log_success "Active environment switched from $CURRENT_ACTIVE_ENV to $TARGET_ENV"
    log_success "Production URL: $PRODUCTION_URL"
    log_success "Deployment ID: $DEPLOYMENT_ID"
    log_success "Log file: $LOG_FILE"
    
    if [[ "$BACKUP_CREATED" == "true" ]]; then
        log_info "💾 Backup created and available for rollback if needed"
        log_info "To rollback: $0 --quick-rollback"
    fi
    
    echo ""
    echo "🔍 Quick verification:"
    echo "  Frontend: curl -s $PRODUCTION_URL/health"
    echo "  Backend API: curl -s $PRODUCTION_URL/api/health"
    echo "  ML Service: curl -s $PRODUCTION_URL/api/ml/health"
    echo ""
    echo "📊 Monitor deployment:"
    echo "  Grafana: http://localhost:3030"
    echo "  Prometheus: http://localhost:9090"
    echo ""
    
    return 0
}

# Run main function
main "$@"