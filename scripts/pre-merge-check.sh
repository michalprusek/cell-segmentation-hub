#!/bin/bash

# =============================================================================
# LOCAL PRE-MERGE CHECK SCRIPT
# =============================================================================
# Run this script before creating a Pull Request to main branch
# Usage: ./scripts/pre-merge-check.sh [target-branch]
# =============================================================================

set -euo pipefail

# Default target branch
TARGET_BRANCH="${1:-main}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${CYAN}===============================================${NC}"
echo -e "${BOLD}${CYAN}   LOCAL PRE-MERGE VALIDATION${NC}"
echo -e "${BOLD}${CYAN}===============================================${NC}"
echo ""

# Check if .husky/pre-merge exists
if [ -f ".husky/pre-merge" ]; then
    echo -e "${CYAN}Running pre-merge hook...${NC}"
    bash .husky/pre-merge "$TARGET_BRANCH" --test
else
    echo -e "${RED}Pre-merge hook not found!${NC}"
    echo "Please ensure .husky/pre-merge exists"
    exit 1
fi