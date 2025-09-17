#!/bin/bash

# Health Check Script for SpheroSeg Deployment
# Comprehensive health check for both staging and production environments

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Function to check service health
check_service() {
    local service=$1
    local url=$2
    local expected=$3
    
    if curl -sf "$url" | grep -q "$expected" 2>/dev/null; then
        print_success "$service is healthy"
        return 0
    else
        print_error "$service is not responding correctly"
        return 1
    fi
}

# Function to check container status
check_container() {
    local container=$1
    
    if docker ps | grep -q "$container"; then
        local status=$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo "no-health-check")
        
        if [ "$status" == "healthy" ]; then
            print_success "$container is running and healthy"
        elif [ "$status" == "no-health-check" ]; then
            print_warning "$container is running (no health check configured)"
        else
            print_warning "$container is running but status is: $status"
        fi
        return 0
    else
        print_error "$container is not running"
        return 1
    fi
}

# Function to check database connectivity
check_database() {
    local env=$1
    
    if docker exec ${env}-db pg_isready -U spheroseg -d spheroseg_${env} > /dev/null 2>&1; then
        local count=$(docker exec ${env}-db psql -U spheroseg -d spheroseg_${env} -t -c "SELECT COUNT(*) FROM \"User\";" 2>/dev/null || echo "0")
        print_success "Database is ready (Users: $count)"
        return 0
    else
        print_error "Database is not ready"
        return 1
    fi
}

# Function to check Redis
check_redis() {
    local env=$1
    
    if docker exec ${env}-redis redis-cli ping > /dev/null 2>&1; then
        print_success "Redis is responding"
        return 0
    else
        print_error "Redis is not responding"
        return 1
    fi
}

# Function to check disk space
check_disk_space() {
    local usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
    
    if [ "$usage" -lt 80 ]; then
        print_success "Disk usage is ${usage}% (OK)"
    elif [ "$usage" -lt 90 ]; then
        print_warning "Disk usage is ${usage}% (Warning)"
    else
        print_error "Disk usage is ${usage}% (Critical)"
    fi
}

# Function to check memory usage
check_memory() {
    local mem_used=$(free -m | awk 'NR==2{printf "%.1f", $3*100/$2}')
    
    if (( $(echo "$mem_used < 80" | bc -l) )); then
        print_success "Memory usage is ${mem_used}% (OK)"
    elif (( $(echo "$mem_used < 90" | bc -l) )); then
        print_warning "Memory usage is ${mem_used}% (Warning)"
    else
        print_error "Memory usage is ${mem_used}% (Critical)"
    fi
}

# Function to check environment
check_environment() {
    local env=$1
    local is_active=$2
    
    echo
    if [ "$is_active" == "true" ]; then
        print_info "========== ACTIVE: $env Environment =========="
    else
        print_info "========== STANDBY: $env Environment =========="
    fi
    
    # Check containers
    print_info "Checking containers..."
    check_container "${env}-frontend"
    check_container "${env}-backend"
    check_container "${env}-ml"
    check_container "${env}-db"
    check_container "${env}-redis"
    
    # Check services if containers are running
    if docker ps | grep -q "${env}-backend"; then
        print_info "Checking services..."
        check_service "Backend API" "http://localhost:$([[ $env == 'staging' ]] && echo '4001' || echo '5001')/health" "healthy"
        check_service "ML Service" "http://localhost:$([[ $env == 'staging' ]] && echo '4008' || echo '5008')/health" "ok"
    fi
    
    # Check database and Redis
    print_info "Checking data stores..."
    check_database "$env"
    check_redis "$env"
}

# Main function
main() {
    print_info "SpheroSeg Deployment Health Check"
    print_info "================================="
    
    # Check system resources
    print_info "System Resources:"
    check_disk_space
    check_memory
    
    # Detect active environment from nginx
    if grep -q "staging-backend" "/home/cvat/spheroseg-app/docker/nginx/nginx.prod.conf"; then
        ACTIVE_ENV="staging"
    else
        ACTIVE_ENV="production"
    fi
    
    print_info "Active environment (nginx): $ACTIVE_ENV"
    
    # Check public endpoint
    print_info "Checking public endpoint..."
    if curl -sf https://spherosegapp.utia.cas.cz/health > /dev/null 2>&1; then
        print_success "Public endpoint is accessible"
    else
        print_error "Public endpoint is not accessible"
    fi
    
    # Check both environments
    if [ "$ACTIVE_ENV" == "staging" ]; then
        check_environment "staging" "true"
        check_environment "production" "false"
    else
        check_environment "production" "true"
        check_environment "staging" "false"
    fi
    
    # Check nginx
    echo
    print_info "Checking Nginx..."
    check_container "spheroseg-nginx"
    
    # Summary
    echo
    print_info "================================="
    print_success "Health check completed"
    print_info "Active environment: $ACTIVE_ENV"
}

# Run main function
main "$@"