#!/bin/bash

# Blue-Green Deployment Script for SpheroSeg
# This script provides zero-downtime deployment using blue-green strategy

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
NGINX_CONFIG="$PROJECT_ROOT/docker/nginx/nginx.prod.conf"
BACKUP_DIR="$PROJECT_ROOT/backups/$(date +%Y%m%d_%H%M%S)"

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check current active environment
get_active_env() {
    if docker ps | grep -q "production-backend"; then
        echo "production"
    elif docker ps | grep -q "staging-backend"; then
        echo "staging"
    else
        echo "none"
    fi
}

# Function to check environment health
check_health() {
    local env=$1
    local max_attempts=30
    local attempt=1
    
    print_info "Checking health of $env environment..."
    
    while [ $attempt -le $max_attempts ]; do
        if docker exec ${env}-backend curl -f http://localhost:3001/health > /dev/null 2>&1; then
            print_success "$env backend is healthy"
            return 0
        fi
        
        print_info "Waiting for $env to be healthy... (attempt $attempt/$max_attempts)"
        sleep 5
        ((attempt++))
    done
    
    print_error "$env environment failed health check"
    return 1
}

# Function to backup database
backup_database() {
    local env=$1
    print_info "Backing up $env database..."
    
    mkdir -p "$BACKUP_DIR"
    
    docker exec ${env}-db pg_dump -U spheroseg spheroseg_${env} | gzip > "$BACKUP_DIR/${env}_db_backup.sql.gz"
    
    if [ $? -eq 0 ]; then
        print_success "Database backed up to $BACKUP_DIR/${env}_db_backup.sql.gz"
    else
        print_error "Database backup failed"
        return 1
    fi
}

# Function to switch nginx routing
switch_nginx() {
    local from_env=$1
    local to_env=$2
    
    print_info "Switching nginx from $from_env to $to_env..."
    
    # Backup current nginx config
    cp "$NGINX_CONFIG" "$BACKUP_DIR/nginx.prod.conf.backup"
    
    # Update nginx config to point to new environment
    if [ "$to_env" == "production" ]; then
        # Switch to production
        sed -i 's/staging-backend/production-backend/g' "$NGINX_CONFIG"
        sed -i 's/staging-frontend/production-frontend/g' "$NGINX_CONFIG"
        sed -i 's/staging-ml/production-ml/g' "$NGINX_CONFIG"
        sed -i 's/staging-grafana/production-grafana/g' "$NGINX_CONFIG"
        sed -i 's/"staging"/"production"/g' "$NGINX_CONFIG"
    else
        # Switch to staging
        sed -i 's/production-backend/staging-backend/g' "$NGINX_CONFIG"
        sed -i 's/production-frontend/staging-frontend/g' "$NGINX_CONFIG"
        sed -i 's/production-ml/staging-ml/g' "$NGINX_CONFIG"
        sed -i 's/production-grafana/staging-grafana/g' "$NGINX_CONFIG"
        sed -i 's/"production"/"staging"/g' "$NGINX_CONFIG"
    fi
    
    # Reload nginx
    docker exec spheroseg-nginx nginx -s reload
    
    if [ $? -eq 0 ]; then
        print_success "Nginx switched to $to_env"
    else
        print_error "Failed to reload nginx"
        return 1
    fi
}

# Function to deploy new version
deploy_version() {
    local target_env=$1
    local compose_file=$2
    
    print_info "Deploying to $target_env environment..."
    
    cd "$PROJECT_ROOT"
    
    # Build and start the target environment
    docker compose -f "$compose_file" build
    docker compose -f "$compose_file" up -d
    
    # Wait for health check
    if check_health "$target_env"; then
        print_success "$target_env deployment successful"
        return 0
    else
        print_error "$target_env deployment failed"
        return 1
    fi
}

# Function to cleanup old environment
cleanup_old_env() {
    local env=$1
    
    print_info "Stopping $env environment..."
    
    cd "$PROJECT_ROOT"
    
    if [ "$env" == "staging" ]; then
        docker compose -f docker-compose.staging.yml down
    else
        docker compose -f docker-compose.production.yml down
    fi
    
    print_success "$env environment stopped"
}

# Main deployment function
main() {
    print_info "Starting Blue-Green Deployment"
    print_info "================================"
    
    # Check current active environment
    ACTIVE_ENV=$(get_active_env)
    print_info "Current active environment: $ACTIVE_ENV"
    
    if [ "$ACTIVE_ENV" == "none" ]; then
        print_error "No active environment found. Please start staging or production first."
        exit 1
    fi
    
    # Determine target environment
    if [ "$ACTIVE_ENV" == "staging" ]; then
        TARGET_ENV="production"
        TARGET_COMPOSE="docker-compose.production.yml"
    else
        TARGET_ENV="staging"
        TARGET_COMPOSE="docker-compose.staging.yml"
    fi
    
    print_info "Target environment: $TARGET_ENV"
    
    # Ask for confirmation
    echo -e "${YELLOW}This will deploy to $TARGET_ENV and switch traffic from $ACTIVE_ENV.${NC}"
    read -p "Continue? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Deployment cancelled"
        exit 0
    fi
    
    # Step 1: Backup current database
    if ! backup_database "$ACTIVE_ENV"; then
        print_error "Backup failed. Aborting deployment."
        exit 1
    fi
    
    # Step 2: Deploy to target environment
    if ! deploy_version "$TARGET_ENV" "$TARGET_COMPOSE"; then
        print_error "Deployment failed. Aborting."
        exit 1
    fi
    
    # Step 3: Run database migrations if needed
    if [ -f "$PROJECT_ROOT/backend/prisma/schema.prisma" ]; then
        print_info "Running database migrations..."
        docker exec ${TARGET_ENV}-backend npx prisma migrate deploy
    fi
    
    # Step 4: Warm up the new environment
    print_info "Warming up $TARGET_ENV environment..."
    for i in {1..5}; do
        curl -s https://spherosegapp.utia.cas.cz/health > /dev/null 2>&1 || true
        sleep 1
    done
    
    # Step 5: Switch nginx to new environment
    if ! switch_nginx "$ACTIVE_ENV" "$TARGET_ENV"; then
        print_error "Failed to switch traffic. Rolling back..."
        switch_nginx "$TARGET_ENV" "$ACTIVE_ENV"
        exit 1
    fi
    
    # Step 6: Verify new environment is serving traffic
    sleep 5
    RESPONSE=$(curl -s https://spherosegapp.utia.cas.cz/health)
    if [[ "$RESPONSE" == *"$TARGET_ENV"* ]]; then
        print_success "Traffic successfully switched to $TARGET_ENV"
    else
        print_warning "Could not verify traffic switch. Please check manually."
    fi
    
    # Step 7: Keep old environment running for rollback (optional)
    print_info "Old environment ($ACTIVE_ENV) is still running for quick rollback."
    print_info "To stop it, run: docker compose -f docker-compose.$ACTIVE_ENV.yml down"
    
    print_success "================================"
    print_success "Deployment completed successfully!"
    print_success "Active environment: $TARGET_ENV"
    print_info "Backup saved to: $BACKUP_DIR"
}

# Run main function
main "$@"