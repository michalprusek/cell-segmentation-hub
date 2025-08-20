#!/bin/bash

# =============================================================================
# QUICK BRANCH PROTECTION SETUP
# =============================================================================
# Simplified one-command setup for branch protection
# =============================================================================

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${CYAN}🔒 Quick Branch Protection Setup${NC}"
echo ""

# Use gh CLI if available
if command -v gh >/dev/null 2>&1; then
    echo -e "${CYAN}Using GitHub CLI...${NC}"
    
    # Get repo info
    REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
    
    echo -e "${CYAN}Repository: ${BOLD}$REPO${NC}"
    echo ""
    
    # Configure main branch protection
    echo -e "${CYAN}Configuring protection for 'main' branch...${NC}"
    
    gh api \
        --method PUT \
        -H "Accept: application/vnd.github+json" \
        "/repos/$REPO/branches/main/protection" \
        -f required_status_checks[strict]=true \
        -f required_status_checks[contexts][]='merge-ready' \
        -f required_status_checks[contexts][]='code-quality' \
        -f required_status_checks[contexts][]='unit-tests (frontend)' \
        -f required_status_checks[contexts][]='unit-tests (backend)' \
        -f required_status_checks[contexts][]='build' \
        -f required_status_checks[contexts][]='security' \
        -f required_status_checks[contexts][]='e2e-tests' \
        -f enforce_admins=true \
        -f required_pull_request_reviews[required_approving_review_count]=1 \
        -f required_pull_request_reviews[dismiss_stale_reviews]=true \
        -f required_conversation_resolution=true \
        -f restrictions=null \
        -f allow_force_pushes=false \
        -f allow_deletions=false
    
    echo -e "${GREEN}✅ Branch protection configured successfully!${NC}"
    echo ""
    echo -e "${CYAN}View settings at:${NC}"
    echo -e "https://github.com/$REPO/settings/branches"
    
else
    echo -e "${YELLOW}GitHub CLI not found. Installing...${NC}"
    echo ""
    echo "Please install GitHub CLI first:"
    echo ""
    echo "  # macOS"
    echo "  brew install gh"
    echo ""
    echo "  # Linux"
    echo "  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg"
    echo "  echo 'deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main' | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null"
    echo "  sudo apt update && sudo apt install gh"
    echo ""
    echo "Then authenticate:"
    echo "  gh auth login"
    echo ""
    echo "And run this script again."
    exit 1
fi