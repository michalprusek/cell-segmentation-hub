#!/bin/bash

# Docker Build Monitoring Script
# Tracks image sizes, build times, and provides optimization suggestions
# Author: Cell Segmentation Hub Team
# Date: 2025-09-10

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/docker/build-config.json"
METRICS_FILE="$PROJECT_ROOT/logs/docker/build-metrics.json"
REPORT_FILE="$PROJECT_ROOT/logs/docker/size-report-$(date '+%Y%m%d-%H%M%S').txt"

# Create directories
mkdir -p "$(dirname "$METRICS_FILE")"

# Parse JSON config (requires jq)
if ! command -v jq &> /dev/null; then
    echo "Warning: jq not installed. Using defaults."
    MAX_FRONTEND_SIZE=1000
    MAX_BACKEND_SIZE=1500
    MAX_ML_SIZE=5000
else
    MAX_FRONTEND_SIZE=$(jq -r '.buildOptimization.services.frontend.maxSizeMB' "$CONFIG_FILE" 2>/dev/null || echo 1000)
    MAX_BACKEND_SIZE=$(jq -r '.buildOptimization.services.backend.maxSizeMB' "$CONFIG_FILE" 2>/dev/null || echo 1500)
    MAX_ML_SIZE=$(jq -r '.buildOptimization.services["ml-service"].maxSizeMB' "$CONFIG_FILE" 2>/dev/null || echo 5000)
fi

# Functions
print_header() {
    echo -e "\n${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║                 Docker Build Monitor                       ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
}

print_section() {
    echo -e "\n${BLUE}▶ $1${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

get_image_size_mb() {
    local image=$1
    docker images --format "{{.Size}}" "$image" | head -1 | sed 's/MB//' | sed 's/GB/*1024/' | bc 2>/dev/null || echo 0
}

check_image_size() {
    local service=$1
    local max_size=$2
    local pattern=$3
    
    echo -e "\n${YELLOW}Checking $service images...${NC}"
    
    # Find all matching images
    local images=$(docker images --format "{{.Repository}}:{{.Tag}}\t{{.Size}}" | grep -E "$pattern" || true)
    
    if [ -z "$images" ]; then
        echo "  No $service images found"
        return
    fi
    
    echo "$images" | while IFS=$'\t' read -r image size; do
        # Convert size to MB
        size_mb=$(echo "$size" | sed 's/MB//' | sed 's/GB/*1024/' | bc 2>/dev/null || echo 0)
        
        if [ "${size_mb%.*}" -gt "$max_size" ]; then
            echo -e "  ${RED}⚠ $image: $size (exceeds ${max_size}MB limit)${NC}"
            echo "    Suggestions:"
            echo "    - Review multi-stage build optimization"
            echo "    - Check for unnecessary dependencies"
            echo "    - Consider using Alpine base images"
        elif [ "${size_mb%.*}" -gt $((max_size * 80 / 100)) ]; then
            echo -e "  ${YELLOW}⚡ $image: $size (approaching limit)${NC}"
        else
            echo -e "  ${GREEN}✓ $image: $size${NC}"
        fi
    done
}

analyze_docker_usage() {
    print_section "Docker System Overview"
    
    # Overall Docker usage
    docker system df
    
    # Count images by type
    echo -e "\n${YELLOW}Image Statistics:${NC}"
    echo "  Total images: $(docker images -q | wc -l)"
    echo "  Dangling images: $(docker images -f "dangling=true" -q | wc -l || echo 0)"
    echo "  Running containers: $(docker ps -q | wc -l)"
    echo "  Stopped containers: $(docker ps -aq --filter "status=exited" | wc -l || echo 0)"
}

analyze_build_cache() {
    print_section "Build Cache Analysis"
    
    # Get build cache usage
    local cache_info=$(docker system df --format "{{json .}}" | jq -r 'select(.Type == "Build Cache") | .Size' 2>/dev/null || echo "N/A")
    echo "Build cache size: $cache_info"
    
    # Analyze cache entries
    docker builder du 2>/dev/null | head -20 || echo "Build cache details not available"
}

generate_optimization_report() {
    print_section "Optimization Recommendations"
    
    local total_size=$(docker system df --format "{{json .}}" | jq -r 'select(.Type == "Images") | .Size' 2>/dev/null || echo "0")
    
    echo "Current total image size: $total_size"
    echo ""
    echo "Recommendations:"
    
    # Check for multiple versions of same image
    echo -e "\n${YELLOW}1. Duplicate Image Versions:${NC}"
    for service in frontend backend ml-service; do
        local count=$(docker images | grep -c "$service" || echo 0)
        if [ "$count" -gt 2 ]; then
            echo "   ⚠ $service has $count versions. Consider removing old ones."
        fi
    done
    
    # Check for large base images
    echo -e "\n${YELLOW}2. Base Image Optimization:${NC}"
    if docker images | grep -q "python:3.10$"; then
        echo "   ⚠ Using full Python image. Consider python:3.10-slim"
    fi
    if docker images | grep -q "node:.*[^alpine]$"; then
        echo "   ⚠ Using full Node image. Consider node:20-alpine"
    fi
    
    # Suggest cleanup based on age
    echo -e "\n${YELLOW}3. Age-based Cleanup:${NC}"
    local old_images=$(docker images --format "{{.Repository}}:{{.Tag}}\t{{.CreatedSince}}" | grep -E "weeks|months" | wc -l || echo 0)
    if [ "$old_images" -gt 0 ]; then
        echo "   ⚠ Found $old_images images older than 1 week"
        echo "   Run: make deep-clean"
    fi
    
    # Layer optimization
    echo -e "\n${YELLOW}4. Layer Optimization Tips:${NC}"
    echo "   • Combine RUN commands with && to reduce layers"
    echo "   • Order Dockerfile commands from least to most frequently changing"
    echo "   • Use .dockerignore to exclude unnecessary files"
    echo "   • Clean package manager cache in same layer as install"
}

monitor_real_time() {
    print_section "Real-time Monitoring"
    
    echo "Monitoring Docker events (press Ctrl+C to stop)..."
    docker events --filter type=image --format "{{.Time}} {{.Action}} {{.Actor.Attributes.name}}" &
    
    local PID=$!
    trap "kill $PID 2>/dev/null" EXIT
    
    while true; do
        sleep 10
        echo -n "."
    done
}

# Main execution
main() {
    print_header
    
    # Generate report
    {
        echo "Docker Build Monitoring Report"
        echo "Generated: $(date)"
        echo "================================"
        
        analyze_docker_usage
        echo ""
        
        print_section "Image Size Analysis"
        check_image_size "Frontend" "$MAX_FRONTEND_SIZE" "frontend"
        check_image_size "Backend" "$MAX_BACKEND_SIZE" "backend"
        check_image_size "ML Service" "$MAX_ML_SIZE" "ml-service|segmentation"
        echo ""
        
        analyze_build_cache
        echo ""
        
        generate_optimization_report
        
    } | tee "$REPORT_FILE"
    
    echo -e "\n${GREEN}Report saved to: $REPORT_FILE${NC}"
    
    # Ask if user wants real-time monitoring
    read -p "Start real-time monitoring? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        monitor_real_time
    fi
}

# Check for specific command
case "${1:-}" in
    --watch)
        monitor_real_time
        ;;
    --report)
        generate_optimization_report
        ;;
    --sizes)
        check_image_size "Frontend" "$MAX_FRONTEND_SIZE" "frontend"
        check_image_size "Backend" "$MAX_BACKEND_SIZE" "backend"
        check_image_size "ML Service" "$MAX_ML_SIZE" "ml-service|segmentation"
        ;;
    *)
        main
        ;;
esac