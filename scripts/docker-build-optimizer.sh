#!/bin/bash

# Docker Build Optimizer - Comprehensive Build and Cache Management
# This script optimizes Docker builds by cleaning old artifacts and managing cache
# Author: Cell Segmentation Hub Team
# Date: 2025-09-10

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_ROOT/logs/docker"
LOG_FILE="$LOG_DIR/build-optimizer-$(date '+%Y%m%d-%H%M%S').log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Build configuration
MAX_BUILD_CACHE_GB=10          # Maximum build cache to keep
MAX_IMAGE_AGE_DAYS=7           # Keep images newer than this
KEEP_LATEST_IMAGES=2           # Number of latest images to keep per service
AGGRESSIVE_CLEANUP=false       # Set to true for aggressive cleanup
DRY_RUN=false                 # Set to true to see what would be cleaned

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

log_header() {
    echo -e "\n${BLUE}========================================${NC}" | tee -a "$LOG_FILE"
    echo -e "${BLUE}$1${NC}" | tee -a "$LOG_FILE"
    echo -e "${BLUE}========================================${NC}" | tee -a "$LOG_FILE"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --aggressive)
            AGGRESSIVE_CLEANUP=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --max-cache)
            MAX_BUILD_CACHE_GB="$2"
            shift 2
            ;;
        --keep-images)
            KEEP_LATEST_IMAGES="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --aggressive     Enable aggressive cleanup (removes more)"
            echo "  --dry-run       Show what would be cleaned without doing it"
            echo "  --max-cache GB  Maximum build cache to keep (default: 10GB)"
            echo "  --keep-images N  Number of latest images to keep (default: 2)"
            echo "  --help          Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Get disk space in GB
get_free_space_gb() {
    df / | awk 'NR==2 {print int($4/1048576)}'
}

get_docker_usage_gb() {
    docker system df --format "{{.Size}}" | head -1 | sed 's/GB//' | sed 's/MB//' | awk '{print int($1)}'
}

# Calculate saved space
calculate_saved_space() {
    local before=$1
    local after=$2
    echo $((after - before))
}

# Docker command wrapper for dry run
docker_exec() {
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] Would execute: docker $*" | tee -a "$LOG_FILE"
    else
        docker "$@" 2>&1 | tee -a "$LOG_FILE" || true
    fi
}

log_header "Docker Build Optimizer Started"
log_info "Timestamp: $TIMESTAMP"
log_info "Configuration:"
log_info "  - Aggressive cleanup: $AGGRESSIVE_CLEANUP"
log_info "  - Dry run: $DRY_RUN"
log_info "  - Max build cache: ${MAX_BUILD_CACHE_GB}GB"
log_info "  - Keep latest images: $KEEP_LATEST_IMAGES"

# Initial space check
INITIAL_FREE_GB=$(get_free_space_gb)
log_info "Initial free space: ${INITIAL_FREE_GB}GB"

# Get initial Docker usage
log_header "Docker Space Analysis"
docker system df | tee -a "$LOG_FILE"

# Phase 1: Clean build cache
log_header "Phase 1: Cleaning Docker Build Cache"

log_info "Removing build cache older than 24 hours..."
BEFORE=$(get_free_space_gb)
if [ "$AGGRESSIVE_CLEANUP" = true ]; then
    docker_exec builder prune -af --filter "until=1h"
else
    docker_exec builder prune -f --filter "until=24h" --keep-storage="${MAX_BUILD_CACHE_GB}GB"
fi
AFTER=$(get_free_space_gb)
SAVED=$(calculate_saved_space $BEFORE $AFTER)
log_info "Build cache cleaned. Space saved: ${SAVED}GB"

# Phase 2: Remove stopped containers
log_header "Phase 2: Removing Stopped Containers"

log_info "Listing stopped containers..."
docker ps -a --filter "status=exited" --format "table {{.Names}}\t{{.Status}}\t{{.Size}}" | tee -a "$LOG_FILE"

BEFORE=$(get_free_space_gb)
if [ "$AGGRESSIVE_CLEANUP" = true ]; then
    docker_exec container prune -f
else
    docker_exec container prune -f --filter "until=${MAX_IMAGE_AGE_DAYS}d"
fi
AFTER=$(get_free_space_gb)
SAVED=$(calculate_saved_space $BEFORE $AFTER)
log_info "Stopped containers removed. Space saved: ${SAVED}GB"

# Phase 3: Clean environment-specific images
log_header "Phase 3: Cleaning Environment-Specific Images"

cleanup_environment_images() {
    local env_label=$1
    log_info "Cleaning $env_label environment images (keeping latest $KEEP_LATEST_IMAGES)..."
    
    # Get all images for this environment sorted by creation date
    local images=$(docker images --filter "label=environment=$env_label" --format "{{.ID}}\t{{.CreatedAt}}" 2>/dev/null | sort -k2 -r || true)
    
    if [ -n "$images" ]; then
        local count=0
        echo "$images" | while IFS=$'\t' read -r id created; do
            count=$((count + 1))
            if [ $count -gt $KEEP_LATEST_IMAGES ]; then
                log_info "Removing old $env_label image: $id (created: $created)"
                docker_exec rmi -f "$id"
            else
                log_info "Keeping recent $env_label image: $id (created: $created)"
            fi
        done
    fi
}

# Clean blue and green environment images
for env in blue green; do
    cleanup_environment_images "$env"
done

# Phase 4: Remove dangling images
log_header "Phase 4: Removing Dangling Images"

log_info "Finding dangling images..."
docker images -f "dangling=true" --format "table {{.ID}}\t{{.Size}}\t{{.CreatedAt}}" | tee -a "$LOG_FILE"

BEFORE=$(get_free_space_gb)
docker_exec image prune -f
AFTER=$(get_free_space_gb)
SAVED=$(calculate_saved_space $BEFORE $AFTER)
log_info "Dangling images removed. Space saved: ${SAVED}GB"

# Phase 5: Clean old images by service
log_header "Phase 5: Cleaning Old Service Images"

cleanup_service_images() {
    local service_name=$1
    log_info "Cleaning $service_name images (keeping latest $KEEP_LATEST_IMAGES)..."
    
    # Find all images for this service
    local images=$(docker images | grep "$service_name" | awk '{print $3"\t"$4" "$5}' | sort -k2 -r || true)
    
    if [ -n "$images" ]; then
        local count=0
        echo "$images" | while IFS=$'\t' read -r id created; do
            count=$((count + 1))
            if [ $count -gt $KEEP_LATEST_IMAGES ]; then
                log_info "Removing old $service_name image: $id"
                docker_exec rmi -f "$id"
            fi
        done
    fi
}

# Clean images for each service
for service in spheroseg-frontend spheroseg-backend spheroseg-ml blue-frontend blue-backend green-frontend green-backend; do
    cleanup_service_images "$service"
done

# Phase 6: Remove unused volumes (optional)
if [ "$AGGRESSIVE_CLEANUP" = true ]; then
    log_header "Phase 6: Removing Unused Volumes"
    
    log_info "Listing unused volumes..."
    docker volume ls -f dangling=true | tee -a "$LOG_FILE"
    
    BEFORE=$(get_free_space_gb)
    docker_exec volume prune -f
    AFTER=$(get_free_space_gb)
    SAVED=$(calculate_saved_space $BEFORE $AFTER)
    log_info "Unused volumes removed. Space saved: ${SAVED}GB"
fi

# Phase 7: Clean unused networks
log_header "Phase 7: Cleaning Unused Networks"
docker_exec network prune -f

# Phase 8: Comprehensive system prune (if aggressive)
if [ "$AGGRESSIVE_CLEANUP" = true ]; then
    log_header "Phase 8: Aggressive System Cleanup"
    
    BEFORE=$(get_free_space_gb)
    docker_exec system prune -af --volumes --filter "until=${MAX_IMAGE_AGE_DAYS}d"
    AFTER=$(get_free_space_gb)
    SAVED=$(calculate_saved_space $BEFORE $AFTER)
    log_info "Aggressive cleanup completed. Space saved: ${SAVED}GB"
fi

# Phase 9: Clean Docker logs
log_header "Phase 9: Cleaning Docker Logs"

if [ "$DRY_RUN" = false ]; then
    # Truncate large container logs
    find /var/lib/docker/containers -name "*.log" -size +100M -exec truncate -s 0 {} \; 2>/dev/null || true
    log_info "Large Docker logs truncated"
fi

# Final report
log_header "Cleanup Complete - Final Report"

FINAL_FREE_GB=$(get_free_space_gb)
TOTAL_SAVED=$((FINAL_FREE_GB - INITIAL_FREE_GB))

log_info "Initial free space: ${INITIAL_FREE_GB}GB"
log_info "Final free space: ${FINAL_FREE_GB}GB"
log_info "Total space saved: ${TOTAL_SAVED}GB"

# Final Docker usage
log_header "Final Docker Space Usage"
docker system df | tee -a "$LOG_FILE"

# Recommendations
if [ "$FINAL_FREE_GB" -lt 20 ]; then
    log_warning "Disk space is still low! Consider:"
    log_warning "  - Running with --aggressive flag"
    log_warning "  - Reducing --keep-images parameter"
    log_warning "  - Removing unused Docker images manually"
    log_warning "  - Checking for large files outside Docker"
fi

log_info "Full log saved to: $LOG_FILE"
exit 0