#!/bin/bash

# =============================================================================
# GITHUB BRANCH PROTECTION SETUP SCRIPT
# =============================================================================
# Automatically configures branch protection rules via GitHub API
# Usage: ./scripts/setup-branch-protection.sh [token]
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# CONFIGURATION
# -----------------------------------------------------------------------------

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# GitHub repository details (auto-detect from git remote)
REPO_URL=$(git config --get remote.origin.url)
if [[ $REPO_URL == git@github.com:* ]]; then
    # SSH URL format
    REPO_PATH=${REPO_URL#git@github.com:}
    REPO_PATH=${REPO_PATH%.git}
elif [[ $REPO_URL == https://github.com/* ]]; then
    # HTTPS URL format
    REPO_PATH=${REPO_URL#https://github.com/}
    REPO_PATH=${REPO_PATH%.git}
else
    echo -e "${RED}Error: Could not detect GitHub repository from git remote${NC}"
    exit 1
fi

OWNER=$(echo $REPO_PATH | cut -d'/' -f1)
REPO=$(echo $REPO_PATH | cut -d'/' -f2)

# Branches to protect
BRANCHES=("main" "master" "production")

# Required status checks from our workflow
REQUIRED_CHECKS=(
    "code-quality"
    "unit-tests (frontend)"
    "unit-tests (backend)"
    "build"
    "docker-build (frontend)"
    "docker-build (backend)"
    "docker-build (ml)"
    "integration-tests"
    "e2e-tests"
    "security"
    "database-check"
    "merge-ready"
)

# -----------------------------------------------------------------------------
# FUNCTIONS
# -----------------------------------------------------------------------------

print_header() {
    echo ""
    echo -e "${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${MAGENTA}🔒 GITHUB BRANCH PROTECTION SETUP${NC}"
    echo -e "${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}Repository: ${BOLD}$OWNER/$REPO${NC}"
    echo ""
}

get_github_token() {
    # Check if token is provided as argument
    if [ -n "${1:-}" ]; then
        GITHUB_TOKEN="$1"
        return 0
    fi
    
    # Check environment variable
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        return 0
    fi
    
    # Check gh CLI authentication
    if command -v gh >/dev/null 2>&1; then
        if gh auth status >/dev/null 2>&1; then
            GITHUB_TOKEN=$(gh auth token)
            return 0
        fi
    fi
    
    # Prompt for token
    echo -e "${YELLOW}GitHub Personal Access Token required${NC}"
    echo -e "${CYAN}Create one at: https://github.com/settings/tokens${NC}"
    echo -e "${CYAN}Required scopes: repo (all)${NC}"
    echo ""
    read -sp "Enter GitHub Token: " GITHUB_TOKEN
    echo ""
    echo ""
}

check_branch_exists() {
    local branch="$1"
    
    echo -e "${CYAN}Checking if branch '$branch' exists...${NC}"
    
    local response=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$OWNER/$REPO/branches/$branch")
    
    if [ "$response" = "200" ]; then
        echo -e "${GREEN}✓ Branch '$branch' exists${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠ Branch '$branch' not found${NC}"
        return 1
    fi
}

setup_branch_protection() {
    local branch="$1"
    
    echo ""
    echo -e "${BOLD}${CYAN}Configuring protection for branch: $branch${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Build JSON payload
    local checks_json=$(printf '"%s",' "${REQUIRED_CHECKS[@]}")
    checks_json="[${checks_json%,}]"
    
    local payload=$(cat <<EOF
{
    "required_status_checks": {
        "strict": true,
        "contexts": $checks_json
    },
    "enforce_admins": true,
    "required_pull_request_reviews": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews": true,
        "require_code_owner_reviews": false,
        "require_last_push_approval": false
    },
    "restrictions": null,
    "allow_force_pushes": false,
    "allow_deletions": false,
    "block_creations": false,
    "required_conversation_resolution": true,
    "lock_branch": false,
    "allow_fork_syncing": false
}
EOF
)
    
    # Send API request
    echo -e "${CYAN}Applying protection rules...${NC}"
    
    local response=$(curl -s -X PUT \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$OWNER/$REPO/branches/$branch/protection" \
        -d "$payload")
    
    # Check response
    if echo "$response" | grep -q '"url"'; then
        echo -e "${GREEN}✓ Branch protection successfully configured for '$branch'${NC}"
        
        # Show summary of settings
        echo ""
        echo -e "${GREEN}Applied settings:${NC}"
        echo -e "  ✓ Require PR before merging"
        echo -e "  ✓ Require 1 approval"
        echo -e "  ✓ Dismiss stale reviews on new commits"
        echo -e "  ✓ Require status checks (${#REQUIRED_CHECKS[@]} checks)"
        echo -e "  ✓ Require branches to be up to date"
        echo -e "  ✓ Include administrators"
        echo -e "  ✓ Require conversation resolution"
        echo -e "  ✓ Block force pushes"
        
        return 0
    else
        echo -e "${RED}✗ Failed to configure branch protection${NC}"
        echo -e "${RED}Error: $(echo $response | jq -r '.message // "Unknown error"')${NC}"
        
        # Common error fixes
        if echo "$response" | grep -q "Not Found"; then
            echo -e "${YELLOW}Tip: Make sure the branch exists and you have admin rights${NC}"
        elif echo "$response" | grep -q "Bad credentials"; then
            echo -e "${YELLOW}Tip: Your token may be invalid or expired${NC}"
        elif echo "$response" | grep -q "Forbidden"; then
            echo -e "${YELLOW}Tip: Your token needs 'repo' scope${NC}"
        fi
        
        return 1
    fi
}

get_current_protection() {
    local branch="$1"
    
    echo -e "${CYAN}Fetching current protection status...${NC}"
    
    local response=$(curl -s \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$OWNER/$REPO/branches/$branch/protection")
    
    if echo "$response" | grep -q '"url"'; then
        echo -e "${YELLOW}Current protection settings:${NC}"
        echo "$response" | jq -r '{
            enforce_admins: .enforce_admins.enabled,
            required_reviews: .required_pull_request_reviews.required_approving_review_count,
            dismiss_stale_reviews: .required_pull_request_reviews.dismiss_stale_reviews,
            required_status_checks: .required_status_checks.contexts,
            strict_checks: .required_status_checks.strict
        }' 2>/dev/null || echo "$response"
    else
        echo -e "${YELLOW}No protection currently configured${NC}"
    fi
}

disable_branch_protection() {
    local branch="$1"
    
    echo -e "${YELLOW}Removing protection from branch '$branch'...${NC}"
    
    local response=$(curl -s -X DELETE \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$OWNER/$REPO/branches/$branch/protection")
    
    echo -e "${GREEN}✓ Protection removed from '$branch'${NC}"
}

create_github_workflow_file() {
    echo ""
    echo -e "${CYAN}Checking GitHub Actions workflow...${NC}"
    
    if [ ! -f ".github/workflows/pre-merge-checks.yml" ]; then
        echo -e "${YELLOW}⚠ Workflow file not found${NC}"
        echo -e "${CYAN}The branch protection rules reference these workflow jobs.${NC}"
        echo -e "${CYAN}Make sure .github/workflows/pre-merge-checks.yml exists and is pushed.${NC}"
    else
        echo -e "${GREEN}✓ Workflow file exists${NC}"
    fi
}

# -----------------------------------------------------------------------------
# MAIN EXECUTION
# -----------------------------------------------------------------------------

main() {
    print_header
    
    # Get GitHub token
    get_github_token "$@"
    
    # Verify token works
    echo -e "${CYAN}Verifying GitHub access...${NC}"
    local verify=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
        "https://api.github.com/repos/$OWNER/$REPO")
    
    if echo "$verify" | grep -q '"full_name"'; then
        echo -e "${GREEN}✓ Successfully authenticated${NC}"
    else
        echo -e "${RED}✗ Authentication failed${NC}"
        echo -e "${RED}Error: $(echo $verify | jq -r '.message // "Invalid token"')${NC}"
        exit 1
    fi
    
    # Check if user has admin rights
    local permissions=$(echo "$verify" | jq -r '.permissions.admin // false')
    if [ "$permissions" != "true" ]; then
        echo -e "${RED}✗ You need admin rights to configure branch protection${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Admin rights confirmed${NC}"
    
    # Check workflow file
    create_github_workflow_file
    
    # Process each branch
    local configured=0
    local skipped=0
    
    for branch in "${BRANCHES[@]}"; do
        if check_branch_exists "$branch"; then
            # Show current protection
            get_current_protection "$branch"
            
            # Ask user
            echo ""
            read -p "$(echo -e "${YELLOW}Configure protection for '$branch'? (y/n/skip): ${NC}")" answer
            
            case $answer in
                [Yy]*)
                    if setup_branch_protection "$branch"; then
                        ((configured++))
                    fi
                    ;;
                [Nn]*)
                    echo -e "${YELLOW}Skipping '$branch'${NC}"
                    ((skipped++))
                    ;;
                *)
                    echo -e "${YELLOW}Skipping '$branch'${NC}"
                    ((skipped++))
                    ;;
            esac
        else
            ((skipped++))
        fi
    done
    
    # Summary
    echo ""
    echo -e "${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}CONFIGURATION COMPLETE${NC}"
    echo -e "${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  Configured: ${GREEN}$configured branches${NC}"
    echo -e "  Skipped:    ${YELLOW}$skipped branches${NC}"
    echo ""
    
    if [ $configured -gt 0 ]; then
        echo -e "${GREEN}✓ Branch protection is now active!${NC}"
        echo ""
        echo -e "${CYAN}Next steps:${NC}"
        echo -e "  1. Create a Pull Request to test the protection"
        echo -e "  2. Verify all status checks appear"
        echo -e "  3. Confirm merge is blocked until checks pass"
        echo ""
        echo -e "${CYAN}View settings at:${NC}"
        echo -e "  https://github.com/$OWNER/$REPO/settings/branches"
    fi
}

# Show help
show_help() {
    echo "Usage: $0 [OPTIONS] [GITHUB_TOKEN]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  -r, --remove   Remove protection from branches"
    echo "  -s, --status   Show current protection status only"
    echo ""
    echo "Examples:"
    echo "  $0                    # Interactive setup"
    echo "  $0 ghp_xxxxx         # Use provided token"
    echo "  $0 --status          # Check current status"
    echo "  $0 --remove          # Remove protection"
    echo ""
    echo "Environment variables:"
    echo "  GITHUB_TOKEN         GitHub personal access token"
}

# Parse arguments
case "${1:-}" in
    -h|--help)
        show_help
        exit 0
        ;;
    -r|--remove)
        print_header
        get_github_token "${2:-}"
        for branch in "${BRANCHES[@]}"; do
            if check_branch_exists "$branch"; then
                disable_branch_protection "$branch"
            fi
        done
        exit 0
        ;;
    -s|--status)
        print_header
        get_github_token "${2:-}"
        for branch in "${BRANCHES[@]}"; do
            if check_branch_exists "$branch"; then
                echo ""
                echo -e "${BOLD}${CYAN}Branch: $branch${NC}"
                get_current_protection "$branch"
            fi
        done
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac