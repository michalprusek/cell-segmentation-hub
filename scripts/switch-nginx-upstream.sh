#!/bin/bash

# Blue-Green Nginx Upstream Switching Script
# This script switches the nginx upstream configuration between blue and green environments

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
BACKUP_DIR="$PROJECT_ROOT/backups/nginx/$(date +%Y%m%d_%H%M%S)"

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

# Function to detect current active environment from nginx config
get_current_env() {
    if grep -q "blue-backend:3001" "$NGINX_CONFIG"; then
        echo "blue"
    elif grep -q "green-backend:3001" "$NGINX_CONFIG"; then
        echo "green"
    else
        echo "unknown"
    fi
}

# Function to get running nginx container
get_nginx_container() {
    local blue_nginx=$(docker ps --filter "name=nginx-blue" --filter "status=running" --format "{{.Names}}" 2>/dev/null)
    local green_nginx=$(docker ps --filter "name=nginx-green" --filter "status=running" --format "{{.Names}}" 2>/dev/null)
    
    if [ ! -z "$blue_nginx" ]; then
        echo "nginx-blue"
    elif [ ! -z "$green_nginx" ]; then
        echo "nginx-green"
    else
        echo ""
    fi
}

# Function to backup current nginx config
backup_config() {
    mkdir -p "$BACKUP_DIR"
    cp "$NGINX_CONFIG" "$BACKUP_DIR/nginx.prod.conf.backup"
    print_success "Configuration backed up to $BACKUP_DIR/nginx.prod.conf.backup"
}

# Function to switch upstream configuration
switch_upstream() {
    local target_env=$1
    
    print_info "Switching nginx upstream to $target_env environment..."
    
    # Backup current config
    backup_config
    
    if [ "$target_env" == "blue" ]; then
        # Switch to blue
        sed -i 's/green-backend:3001/blue-backend:3001/g' "$NGINX_CONFIG"
        sed -i 's/green-frontend:80/blue-frontend:80/g' "$NGINX_CONFIG"
        sed -i 's/green-ml:8000/blue-ml:8000/g' "$NGINX_CONFIG"
        sed -i 's/green-grafana:3000/blue-grafana:3000/g' "$NGINX_CONFIG"
    elif [ "$target_env" == "green" ]; then
        # Switch to green
        sed -i 's/blue-backend:3001/green-backend:3001/g' "$NGINX_CONFIG"
        sed -i 's/blue-frontend:80/green-frontend:80/g' "$NGINX_CONFIG"
        sed -i 's/blue-ml:8000/green-ml:8000/g' "$NGINX_CONFIG"
        sed -i 's/blue-grafana:3000/green-grafana:3000/g' "$NGINX_CONFIG"
    else
        print_error "Invalid target environment. Use 'blue' or 'green'."
        return 1
    fi
    
    print_success "Upstream configuration switched to $target_env"
}

# Function to reload nginx configuration
reload_nginx() {
    local nginx_container=$(get_nginx_container)
    
    if [ -z "$nginx_container" ]; then
        print_error "No running nginx container found"
        return 1
    fi
    
    print_info "Reloading nginx configuration in container: $nginx_container"
    
    # Test nginx configuration first
    if docker exec "$nginx_container" nginx -t > /dev/null 2>&1; then
        print_success "Nginx configuration test passed"
    else
        print_error "Nginx configuration test failed"
        return 1
    fi
    
    # Reload nginx
    if docker exec "$nginx_container" nginx -s reload > /dev/null 2>&1; then
        print_success "Nginx configuration reloaded successfully"
        return 0
    else
        print_error "Failed to reload nginx configuration"
        return 1
    fi
}

# Function to verify the switch worked
verify_switch() {
    local expected_env=$1
    local current_env=$(get_current_env)
    
    if [ "$current_env" == "$expected_env" ]; then
        print_success "Switch verified: nginx is now pointing to $expected_env environment"
        return 0
    else
        print_error "Switch verification failed: expected $expected_env, but found $current_env"
        return 1
    fi
}

# Function to show current status
show_status() {
    print_info "Current nginx upstream configuration:"
    local current_env=$(get_current_env)
    local nginx_container=$(get_nginx_container)
    
    echo -e "  Environment: ${GREEN}$current_env${NC}"
    echo -e "  Nginx Container: ${GREEN}${nginx_container:-"None running"}${NC}"
    
    print_info "Backend upstream:"
    grep -A 1 "upstream backend" "$NGINX_CONFIG" | grep "server" || echo "  Not found"
    
    print_info "ML service upstream:"
    grep -A 1 "upstream ml_service" "$NGINX_CONFIG" | grep "server" || echo "  Not found"
    
    print_info "Frontend upstream:"
    grep -A 1 "upstream frontend" "$NGINX_CONFIG" | grep "server" || echo "  Not found"
}

# Function to test API connectivity
test_api() {
    local test_url="https://spherosegapp.utia.cas.cz/health"
    
    print_info "Testing API connectivity..."
    
    local response=$(curl -s -k "$test_url" 2>/dev/null || echo "")
    
    if [ ! -z "$response" ]; then
        print_success "API is responding: $response"
        
        # Test a specific API endpoint that was causing issues
        local queue_test=$(curl -s -k "https://spherosegapp.utia.cas.cz/api/queue/batch" 2>/dev/null || echo "")
        if [[ "$queue_test" == *"UNAUTHORIZED"* ]]; then
            print_success "Queue API endpoint is properly routing (returns auth error as expected)"
        elif [[ "$queue_test" == *"Bad Request"* ]]; then
            print_error "Queue API endpoint still returning 400 Bad Request"
        else
            print_warning "Queue API endpoint response: $queue_test"
        fi
    else
        print_error "No response from API"
    fi
}

# Main function
main() {
    local command=${1:-"status"}
    
    case $command in
        "status")
            print_info "Blue-Green Nginx Upstream Status"
            print_info "================================"
            show_status
            ;;
        "switch")
            local target_env=$2
            if [ -z "$target_env" ]; then
                print_error "Usage: $0 switch [blue|green]"
                exit 1
            fi
            
            local current_env=$(get_current_env)
            
            if [ "$current_env" == "$target_env" ]; then
                print_warning "Nginx is already pointing to $target_env environment"
                exit 0
            fi
            
            print_info "Switching from $current_env to $target_env..."
            
            if switch_upstream "$target_env"; then
                if reload_nginx; then
                    if verify_switch "$target_env"; then
                        print_success "Switch completed successfully!"
                        test_api
                    else
                        print_error "Switch verification failed"
                        exit 1
                    fi
                else
                    print_error "Failed to reload nginx"
                    exit 1
                fi
            else
                print_error "Failed to switch upstream configuration"
                exit 1
            fi
            ;;
        "test")
            test_api
            ;;
        "reload")
            reload_nginx
            ;;
        *)
            echo "Usage: $0 [status|switch|test|reload] [blue|green]"
            echo ""
            echo "Commands:"
            echo "  status        - Show current upstream configuration"
            echo "  switch [env]  - Switch to blue or green environment"
            echo "  test          - Test API connectivity"
            echo "  reload        - Reload nginx configuration"
            echo ""
            echo "Examples:"
            echo "  $0 status"
            echo "  $0 switch blue"
            echo "  $0 switch green"
            echo "  $0 test"
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"