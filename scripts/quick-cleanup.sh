#!/bin/bash

# Quick cleanup for Cell Segmentation Hub - Safe and fast cleanup

set -euo pipefail

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🧹 Quick Cleanup for Cell Segmentation Hub${NC}"
echo "Starting at $(date)"

# Initial disk usage
echo -e "\n${YELLOW}Current disk usage:${NC}"
df -h / | grep -E "Filesystem|/"

# Docker cleanup (safe operations only)
echo -e "\n${BLUE}Cleaning Docker resources...${NC}"
docker container prune -f
docker image prune -f
docker network prune -f
docker builder prune -f --filter "until=24h"

# Clear temporary files
echo -e "\n${BLUE}Clearing temporary files...${NC}"
rm -rf /tmp/spheroseg-* 2>/dev/null || true
rm -rf /tmp/upload-* 2>/dev/null || true
rm -rf /tmp/playwright-* 2>/dev/null || true

# Clear old logs (older than 7 days)
echo -e "\n${BLUE}Clearing old logs...${NC}"
find /home/cvat/cell-segmentation-hub -name "*.log" -mtime +7 -delete 2>/dev/null || true

# Clear Python cache
echo -e "\n${BLUE}Clearing Python cache...${NC}"
find /home/cvat/cell-segmentation-hub -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find /home/cvat/cell-segmentation-hub -type f -name "*.pyc" -delete 2>/dev/null || true

# Clear test artifacts
echo -e "\n${BLUE}Clearing test artifacts...${NC}"
rm -rf /home/cvat/cell-segmentation-hub/coverage 2>/dev/null || true
rm -rf /home/cvat/cell-segmentation-hub/playwright-report 2>/dev/null || true
rm -rf /home/cvat/cell-segmentation-hub/test-results 2>/dev/null || true

# Git cleanup (safe)
echo -e "\n${BLUE}Optimizing git repository...${NC}"
cd /home/cvat/cell-segmentation-hub
git gc --auto 2>/dev/null || true

# Final disk usage
echo -e "\n${GREEN}✅ Quick cleanup complete!${NC}"
echo -e "${YELLOW}Final disk usage:${NC}"
df -h / | grep -E "Filesystem|/"

# Show Docker space
echo -e "\n${YELLOW}Docker space usage:${NC}"
docker system df

echo -e "\n${GREEN}Completed at $(date)${NC}"