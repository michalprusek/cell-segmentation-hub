#!/bin/bash

# Cell Segmentation Hub - Comprehensive System Cleanup Script
# Usage: ./system-cleanup.sh [--dry-run] [--aggressive] [--backup]

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse command line arguments
DRY_RUN=false
AGGRESSIVE=false
BACKUP=false

for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            echo -e "${YELLOW}🔍 Running in DRY-RUN mode - no changes will be made${NC}"
            ;;
        --aggressive)
            AGGRESSIVE=true
            echo -e "${RED}⚠️  Running in AGGRESSIVE mode - will remove more resources${NC}"
            ;;
        --backup)
            BACKUP=true
            echo -e "${GREEN}✅ Backup will be created before cleanup${NC}"
            ;;
    esac
done

# Function to execute commands based on dry-run mode
execute_cmd() {
    if [ "$DRY_RUN" = true ]; then
        echo -e "${BLUE}[DRY-RUN]${NC} Would execute: $*"
    else
        echo -e "${GREEN}[EXECUTING]${NC} $*"
        eval "$@"
    fi
}

# Function to print section headers
print_header() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
}

# Function to calculate and display size
show_size() {
    if [ -e "$1" ]; then
        SIZE=$(du -sh "$1" 2>/dev/null | cut -f1)
        echo -e "  📊 Size of $1: ${YELLOW}${SIZE}${NC}"
    fi
}

# Start cleanup
echo -e "${GREEN}🧹 Starting Cell Segmentation Hub System Cleanup${NC}"
echo -e "Date: $(date)"

# Phase 0: Pre-cleanup analysis
print_header "📊 Pre-Cleanup Analysis"
echo "Current disk usage:"
df -h /
echo ""
echo "Docker space usage:"
docker system df || true
echo ""

# Calculate initial sizes
INITIAL_DISK=$(df / | tail -1 | awk '{print $3}')

# Phase 1: Backup (if requested)
if [ "$BACKUP" = true ]; then
    print_header "💾 Creating Backup"
    BACKUP_DIR="/tmp/spheroseg-backup-$(date +%Y%m%d-%H%M%S)"
    execute_cmd "mkdir -p ${BACKUP_DIR}"
    execute_cmd "cp -r /home/cvat/cell-segmentation-hub/.env* ${BACKUP_DIR}/ 2>/dev/null || true"
    execute_cmd "cp -r /home/cvat/cell-segmentation-hub/docker-compose*.yml ${BACKUP_DIR}/ 2>/dev/null || true"
    echo -e "${GREEN}✅ Backup created at: ${BACKUP_DIR}${NC}"
fi

# Phase 2: Docker Cleanup
print_header "🐋 Docker Cleanup"

# Stop running containers gracefully
echo "Stopping Docker containers..."
execute_cmd "cd /home/cvat/cell-segmentation-hub && docker compose down 2>/dev/null || true"

# Remove stopped containers
echo "Removing stopped containers..."
execute_cmd "docker container prune -f"

# Remove unused networks
echo "Removing unused networks..."
execute_cmd "docker network prune -f"

# Remove dangling images
echo "Removing dangling images..."
execute_cmd "docker image prune -f"

# Remove unused volumes (careful!)
if [ "$AGGRESSIVE" = true ]; then
    echo "Removing unused volumes..."
    execute_cmd "docker volume prune -f"
fi

# Clean build cache
echo "Cleaning Docker build cache..."
execute_cmd "docker builder prune -f"

# Aggressive Docker cleanup
if [ "$AGGRESSIVE" = true ]; then
    echo -e "${RED}Performing aggressive Docker cleanup...${NC}"
    execute_cmd "docker system prune -a --volumes -f"
    execute_cmd "docker image prune -a --filter 'until=24h' -f"
fi

# Phase 3: Process Cleanup
print_header "🔧 Process Cleanup"

# Find and kill orphaned processes
echo "Cleaning orphaned Node.js processes..."
execute_cmd "pkill -f 'node.*spheroseg' 2>/dev/null || true"
execute_cmd "pkill -f 'npm.*spheroseg' 2>/dev/null || true"

echo "Cleaning orphaned Python processes..."
execute_cmd "pkill -f 'python.*segmentation' 2>/dev/null || true"
execute_cmd "pkill -f 'uvicorn.*8000' 2>/dev/null || true"

# Phase 4: Application Files Cleanup
print_header "📁 Application Files Cleanup"

cd /home/cvat/cell-segmentation-hub

# Frontend cleanup
echo "Cleaning frontend artifacts..."
show_size "node_modules"
show_size "dist"
show_size ".next"

if [ "$AGGRESSIVE" = true ]; then
    execute_cmd "rm -rf node_modules 2>/dev/null || true"
    execute_cmd "rm -rf backend/node_modules 2>/dev/null || true"
fi

execute_cmd "rm -rf dist build .next out 2>/dev/null || true"
execute_cmd "rm -rf coverage .nyc_output 2>/dev/null || true"
execute_cmd "rm -rf playwright-report test-results 2>/dev/null || true"

# Clear npm cache
echo "Clearing npm cache..."
execute_cmd "npm cache clean --force 2>/dev/null || true"

# Backend cleanup
echo "Cleaning backend artifacts..."
execute_cmd "find . -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true"
execute_cmd "find . -type f -name '*.pyc' -delete 2>/dev/null || true"
execute_cmd "find . -type f -name '*.pyo' -delete 2>/dev/null || true"
execute_cmd "find . -type d -name '.pytest_cache' -exec rm -rf {} + 2>/dev/null || true"

# ML cache cleanup
echo "Cleaning ML model cache..."
execute_cmd "rm -rf /tmp/transformers 2>/dev/null || true"
execute_cmd "rm -rf ~/.cache/torch 2>/dev/null || true"

# Phase 5: Legacy Files Cleanup
print_header "🗑️  Legacy Files Cleanup"

echo "Removing backup and temporary files..."
execute_cmd "find . -name '*.bak' -o -name '*.backup' -o -name '*~' -delete 2>/dev/null || true"
execute_cmd "find . -name '.DS_Store' -delete 2>/dev/null || true"
execute_cmd "find . -name 'Thumbs.db' -delete 2>/dev/null || true"
execute_cmd "find . -name '*.swp' -o -name '*.swo' -delete 2>/dev/null || true"

# Remove old log files (older than 30 days)
echo "Cleaning old log files..."
execute_cmd "find . -name '*.log' -mtime +30 -delete 2>/dev/null || true"

# Clean temporary files
echo "Cleaning temporary files..."
execute_cmd "rm -rf /tmp/spheroseg-* 2>/dev/null || true"
execute_cmd "rm -rf /tmp/upload-* 2>/dev/null || true"
execute_cmd "rm -rf /tmp/playwright-* 2>/dev/null || true"

# Remove empty directories
echo "Removing empty directories..."
execute_cmd "find . -type d -empty -delete 2>/dev/null || true"

# Phase 6: System Logs Cleanup
print_header "📝 System Logs Cleanup"

echo "Cleaning journal logs..."
if [ "$DRY_RUN" = false ]; then
    sudo journalctl --vacuum-time=7d 2>/dev/null || true
    sudo journalctl --vacuum-size=500M 2>/dev/null || true
else
    echo -e "${BLUE}[DRY-RUN]${NC} Would clean journal logs older than 7 days and limit to 500M"
fi

# Clear application logs
echo "Clearing application logs..."
execute_cmd "> /home/cvat/cell-segmentation-hub/backend/logs/error.log 2>/dev/null || true"
execute_cmd "> /home/cvat/cell-segmentation-hub/backend/logs/access.log 2>/dev/null || true"
execute_cmd "> /home/cvat/cell-segmentation-hub/backend/logs/combined.log 2>/dev/null || true"

# Phase 7: Git Cleanup
print_header "📦 Git Repository Optimization"

cd /home/cvat/cell-segmentation-hub

echo "Optimizing git repository..."
execute_cmd "git gc --prune=now 2>/dev/null || true"
execute_cmd "git repack -Ad 2>/dev/null || true"
execute_cmd "git prune-packed 2>/dev/null || true"

# Phase 8: Final Report
print_header "📊 Cleanup Report"

echo -e "${GREEN}✅ Cleanup completed successfully!${NC}"
echo ""
echo "Disk usage after cleanup:"
df -h /
echo ""
echo "Docker space after cleanup:"
docker system df || true
echo ""

# Calculate space saved
FINAL_DISK=$(df / | tail -1 | awk '{print $3}')
if [ "$DRY_RUN" = false ]; then
    SAVED=$((INITIAL_DISK - FINAL_DISK))
    echo -e "${GREEN}💾 Approximate space saved: ${SAVED}K${NC}"
fi

# List remaining large directories
echo ""
echo "Largest directories remaining:"
du -sh /home/cvat/cell-segmentation-hub/* 2>/dev/null | sort -rh | head -10

echo ""
echo -e "${GREEN}🎉 Cleanup process finished at $(date)${NC}"

# Provide recovery information
if [ "$BACKUP" = true ]; then
    echo ""
    echo -e "${YELLOW}📌 Backup location: ${BACKUP_DIR}${NC}"
    echo -e "${YELLOW}   To restore: cp -r ${BACKUP_DIR}/* /home/cvat/cell-segmentation-hub/${NC}"
fi

# Restart services if not in dry-run mode
if [ "$DRY_RUN" = false ]; then
    echo ""
    echo -e "${BLUE}🔄 Restarting services...${NC}"
    cd /home/cvat/cell-segmentation-hub
    make up 2>/dev/null || docker compose up -d 2>/dev/null || true
    echo -e "${GREEN}✅ Services restarted${NC}"
fi

exit 0