#!/bin/bash

# Rollback Script for SpheroSeg
# Quick rollback to previous environment in case of issues

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

# Function to detect which environment nginx is pointing to
get_nginx_target() {
    if grep -q "staging-backend" "$NGINX_CONFIG"; then
        echo "staging"
    elif grep -q "production-backend" "$NGINX_CONFIG"; then
        echo "production"
    else
        echo "unknown"
    fi
}

# Function to check if environment is running
is_env_running() {
    local env=$1
    if docker ps | grep -q "${env}-backend"; then
        return 0
    else
        return 1
    fi
}

# Function to switch nginx routing
switch_nginx() {
    local to_env=$1
    
    print_info "Switching nginx to $to_env..."
    
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

# Main rollback function
main() {
    print_warning "Starting Emergency Rollback"
    print_warning "============================"
    
    # Detect current nginx target
    CURRENT_TARGET=$(get_nginx_target)
    print_info "Current nginx target: $CURRENT_TARGET"
    
    # Determine rollback target
    if [ "$CURRENT_TARGET" == "staging" ]; then
        ROLLBACK_TARGET="production"
    elif [ "$CURRENT_TARGET" == "production" ]; then
        ROLLBACK_TARGET="staging"
    else
        print_error "Cannot determine current environment"
        exit 1
    fi
    
    print_info "Will rollback to: $ROLLBACK_TARGET"
    
    # Check if rollback target is running
    if ! is_env_running "$ROLLBACK_TARGET"; then
        print_error "$ROLLBACK_TARGET environment is not running!"
        print_info "Starting $ROLLBACK_TARGET environment..."
        
        cd "$PROJECT_ROOT"
        if [ "$ROLLBACK_TARGET" == "staging" ]; then
            docker compose -f docker-compose.staging.yml up -d
        else
            docker compose -f docker-compose.production.yml up -d
        fi
        
        # Wait for health
        sleep 30
    fi
    
    # Confirm rollback
    echo -e "${YELLOW}This will immediately switch traffic from $CURRENT_TARGET to $ROLLBACK_TARGET.${NC}"
    read -p "Continue with rollback? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Rollback cancelled"
        exit 0
    fi
    
    # Perform rollback
    if switch_nginx "$ROLLBACK_TARGET"; then
        print_success "Rollback completed successfully!"
        print_success "Traffic now served by: $ROLLBACK_TARGET"
    else
        print_error "Rollback failed!"
        exit 1
    fi
    
    # Verify
    sleep 2
    RESPONSE=$(curl -s https://spherosegapp.utia.cas.cz/health)
    if [[ "$RESPONSE" == *"$ROLLBACK_TARGET"* ]]; then
        print_success "Verified: $ROLLBACK_TARGET is serving traffic"
    else
        print_warning "Could not verify rollback. Please check manually."
    fi
}

# Run main function
main "$@"