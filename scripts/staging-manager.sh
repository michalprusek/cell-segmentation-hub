#!/bin/bash
set -euo pipefail

# Staging Environment Manager
# This script provides easy management of staging environment

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

# Show usage
show_usage() {
    echo "Staging Environment Manager"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  start         Start staging environment"
    echo "  stop          Stop staging environment" 
    echo "  restart       Restart staging environment"
    echo "  logs          Show staging logs"
    echo "  status        Show staging status"
    echo "  shell SERVICE Enter shell in staging service (backend, ml-service, postgres)"
    echo "  deploy        Deploy staging environment"
    echo "  clean         Clean staging environment (removes containers and volumes)"
    echo "  backup        Backup staging database"
    echo "  restore FILE  Restore staging database from backup file"
    echo ""
    echo "Options:"
    echo "  -h, --help    Show this help"
    echo "  -f            Follow logs (for logs command)"
    echo ""
    echo "Examples:"
    echo "  $0 start                    # Start staging"
    echo "  $0 logs -f                  # Follow all staging logs"
    echo "  $0 logs backend             # Show backend logs"
    echo "  $0 shell backend            # Enter backend container shell"
    echo "  $0 backup                   # Backup staging database"
}

# Check if staging is running
is_staging_running() {
    docker compose -f "$STAGING_COMPOSE" -p staging ps -q | grep -q . 2>/dev/null
}

# Get service status
get_service_status() {
    docker compose -f "$STAGING_COMPOSE" -p staging ps --format json 2>/dev/null | jq -r '.[] | "\(.Name): \(.State) (\(.Status))"' 2>/dev/null || echo "No services running"
}

# Main command handling
case "${1:-help}" in
    start)
        log_info "Starting staging environment..."
        if is_staging_running; then
            log_warning "Staging environment is already running"
            get_service_status
        else
            docker compose -f "$STAGING_COMPOSE" -p staging up -d
            log_success "Staging environment started"
            sleep 5
            get_service_status
        fi
        ;;
    
    stop)
        log_info "Stopping staging environment..."
        if is_staging_running; then
            docker compose -f "$STAGING_COMPOSE" -p staging stop
            log_success "Staging environment stopped"
        else
            log_warning "Staging environment is not running"
        fi
        ;;
    
    restart)
        log_info "Restarting staging environment..."
        docker compose -f "$STAGING_COMPOSE" -p staging restart
        log_success "Staging environment restarted"
        sleep 5
        get_service_status
        ;;
    
    logs)
        if [[ "${2:-}" == "-f" ]]; then
            service="${3:-}"
            if [[ -n "$service" ]]; then
                docker compose -f "$STAGING_COMPOSE" -p staging logs -f "$service"
            else
                docker compose -f "$STAGING_COMPOSE" -p staging logs -f
            fi
        elif [[ -n "${2:-}" ]]; then
            docker compose -f "$STAGING_COMPOSE" -p staging logs "${2}"
        else
            docker compose -f "$STAGING_COMPOSE" -p staging logs --tail=50
        fi
        ;;
    
    status)
        log_info "Staging environment status:"
        echo ""
        if is_staging_running; then
            get_service_status
            echo ""
            log_info "Resource usage:"
            docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | head -1
            docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep staging
        else
            log_warning "Staging environment is not running"
        fi
        ;;
    
    shell)
        service="${2:-backend}"
        valid_services=("backend" "ml-service" "postgres" "redis")
        
        if [[ ! " ${valid_services[*]} " =~ " ${service} " ]]; then
            log_error "Invalid service: $service"
            log_info "Valid services: ${valid_services[*]}"
            exit 1
        fi
        
        container_name="staging-${service}"
        if [[ "$service" == "ml-service" ]]; then
            container_name="staging-ml"
        elif [[ "$service" == "postgres" ]]; then
            container_name="staging-db"
        elif [[ "$service" == "redis" ]]; then
            container_name="staging-redis"
        fi
        
        if docker ps -q -f name="$container_name" | grep -q .; then
            log_info "Entering $container_name shell..."
            if [[ "$service" == "postgres" ]]; then
                docker exec -it "$container_name" psql -U spheroseg -d spheroseg_staging
            else
                docker exec -it "$container_name" /bin/bash
            fi
        else
            log_error "Container $container_name is not running"
        fi
        ;;
    
    deploy)
        log_info "Deploying staging environment..."
        "$SCRIPT_DIR/deploy-staging.sh"
        ;;
    
    clean)
        log_warning "This will remove all staging containers and volumes!"
        read -p "Are you sure? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Cleaning staging environment..."
            docker compose -f "$STAGING_COMPOSE" -p staging down -v --remove-orphans
            
            # Remove staging images
            docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.ID}}" | grep staging | awk '{print $3}' | xargs -r docker rmi -f
            
            log_success "Staging environment cleaned"
        else
            log_info "Clean operation cancelled"
        fi
        ;;
    
    backup)
        if docker ps -q -f name=staging-db | grep -q .; then
            backup_file="$PROJECT_ROOT/scripts/db-backup/staging/staging-backup-$(date +%Y%m%d_%H%M%S).sql"
            mkdir -p "$(dirname "$backup_file")"
            
            log_info "Creating staging database backup..."
            if docker exec staging-db pg_dump -U spheroseg -d spheroseg_staging > "$backup_file"; then
                log_success "Backup created: $backup_file"
            else
                log_error "Backup failed"
                exit 1
            fi
        else
            log_error "Staging database is not running"
            exit 1
        fi
        ;;
    
    restore)
        backup_file="${2:-}"
        if [[ -z "$backup_file" ]]; then
            log_error "Backup file path required"
            log_info "Usage: $0 restore /path/to/backup.sql"
            exit 1
        fi
        
        if [[ ! -f "$backup_file" ]]; then
            log_error "Backup file not found: $backup_file"
            exit 1
        fi
        
        if ! docker ps -q -f name=staging-db | grep -q .; then
            log_error "Staging database is not running"
            exit 1
        fi
        
        log_warning "This will overwrite the staging database!"
        read -p "Are you sure? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Restoring staging database from $backup_file..."
            if docker exec -i staging-db psql -U spheroseg -d spheroseg_staging < "$backup_file"; then
                log_success "Database restored successfully"
            else
                log_error "Database restore failed"
                exit 1
            fi
        else
            log_info "Restore operation cancelled"
        fi
        ;;
    
    help|--help|-h)
        show_usage
        ;;
    
    *)
        log_error "Unknown command: ${1:-}"
        echo ""
        show_usage
        exit 1
        ;;
esac