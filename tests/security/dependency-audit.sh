#!/bin/bash
# Security Dependency Audit Script
# Checks for known vulnerabilities in project dependencies

set -euo pipefail

echo "🛡️ SphereSeg Security Dependency Audit"
echo "========================================"

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Counters
TOTAL_ISSUES=0
HIGH_ISSUES=0
MEDIUM_ISSUES=0
LOW_ISSUES=0

# Create reports directory with error handling
if ! mkdir -p security-reports; then
    echo "❌ Failed to create security-reports directory"
    exit 1
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
REPORT_FILE="security-reports/dependency_audit_${TIMESTAMP}.json"
SUMMARY_FILE="security-reports/dependency_audit_summary_${TIMESTAMP}.txt"

# Start summary report with error handling
if ! echo "SphereSeg Dependency Security Audit" > "$SUMMARY_FILE"; then
    echo "❌ Failed to create summary file: $SUMMARY_FILE"
    exit 1
fi
echo "Generated: $(date)" >> "$SUMMARY_FILE"
echo "==========================================" >> "$SUMMARY_FILE"

# Cleanup function for temporary files
cleanup() {
    rm -f /tmp/npm_audit.json /tmp/npm_outdated.json /tmp/backend_npm_audit.json /tmp/backend_npm_outdated.json
    rm -f /tmp/ml_requirements.txt /tmp/safety_report.json /tmp/trivy_*.json
}

# Set trap for cleanup on exit
trap cleanup EXIT

# Function to log issues
log_issue() {
    local severity="$1"
    local component="$2"
    local message="$3"
    
    case "$severity" in
        "HIGH")
            echo -e "${RED}❌ HIGH: $component - $message${NC}"
            HIGH_ISSUES=$((HIGH_ISSUES + 1))
            ;;
        "MEDIUM")
            echo -e "${YELLOW}⚠️  MEDIUM: $component - $message${NC}"
            MEDIUM_ISSUES=$((MEDIUM_ISSUES + 1))
            ;;
        "LOW")
            echo -e "${YELLOW}ℹ️  LOW: $component - $message${NC}"
            LOW_ISSUES=$((LOW_ISSUES + 1))
            ;;
    esac
    
    TOTAL_ISSUES=$((TOTAL_ISSUES + 1))
    echo "$severity: $component - $message" >> "$SUMMARY_FILE"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to get repository root
get_repo_root() {
    if git rev-parse --show-toplevel >/dev/null 2>&1; then
        git rev-parse --show-toplevel
    else
        # Fallback to script directory method if not in git repo
        echo "$(cd "$(dirname "$0")/../.." && pwd)"
    fi
}

# Function to sanitize image name for filenames
sanitize_image_name() {
    local image="$1"
    # Replace all non-alphanumeric characters with underscores
    echo "$image" | sed 's/[^a-zA-Z0-9._-]/_/g'
}

echo "🔍 Scanning Frontend Dependencies (Node.js/npm)..."
echo "=================================================="

# Check if npm is available
if command_exists npm; then
    REPO_ROOT=$(get_repo_root)
    cd "$REPO_ROOT" || {
        echo "❌ Failed to change to repository root: $REPO_ROOT"
        exit 1
    }
    
    # Run npm audit
    if npm audit --json > /tmp/npm_audit.json 2>/dev/null; then
        echo "✅ npm audit completed"
        
        # Parse npm audit results
        if command_exists jq; then
            HIGH_COUNT=$(jq -r '.vulnerabilities | to_entries | map(select(.value.severity == "high")) | length' /tmp/npm_audit.json 2>/dev/null || echo "0")
            MODERATE_COUNT=$(jq -r '.vulnerabilities | to_entries | map(select(.value.severity == "moderate")) | length' /tmp/npm_audit.json 2>/dev/null || echo "0")
            LOW_COUNT=$(jq -r '.vulnerabilities | to_entries | map(select(.value.severity == "low")) | length' /tmp/npm_audit.json 2>/dev/null || echo "0")
            
            echo "Frontend vulnerabilities found:"
            echo "  High: $HIGH_COUNT"
            echo "  Moderate: $MODERATE_COUNT"
            echo "  Low: $LOW_COUNT"
            
            # Log issues if found
            if [ "$HIGH_COUNT" -gt 0 ]; then
                log_issue "HIGH" "Frontend" "$HIGH_COUNT high-severity vulnerabilities in npm packages"
            fi
            if [ "$MODERATE_COUNT" -gt 0 ]; then
                log_issue "MEDIUM" "Frontend" "$MODERATE_COUNT moderate-severity vulnerabilities in npm packages"
            fi
            if [ "$LOW_COUNT" -gt 0 ]; then
                log_issue "LOW" "Frontend" "$LOW_COUNT low-severity vulnerabilities in npm packages"
            fi
            
            # Save npm audit results
            cp /tmp/npm_audit.json "security-reports/npm_audit_${TIMESTAMP}.json"
            
        else
            echo "⚠️ jq not found, skipping detailed npm audit analysis"
            # Check for any vulnerabilities with stricter pattern
            if grep -q '"vulnerabilities":[[:space:]]*{' /tmp/npm_audit.json; then
                log_issue "MEDIUM" "Frontend" "npm audit found vulnerabilities (install jq for detailed analysis)"
            fi
        fi
    else
        # npm audit failed, try simple check
        if npm audit 2>&1 | grep -q "vulnerabilities"; then
            log_issue "MEDIUM" "Frontend" "npm audit detected vulnerabilities"
        fi
    fi
    
    # Check for outdated packages
    echo -e "\n🔍 Checking for outdated frontend packages..."
    if npm outdated --json > /tmp/npm_outdated.json 2>/dev/null; then
        if [ -s /tmp/npm_outdated.json ] && [ "$(cat /tmp/npm_outdated.json)" != "{}" ]; then
            OUTDATED_COUNT=$(jq '. | keys | length' /tmp/npm_outdated.json 2>/dev/null || echo "unknown")
            echo "Found $OUTDATED_COUNT outdated packages"
            log_issue "LOW" "Frontend" "$OUTDATED_COUNT outdated npm packages"
        else
            echo "✅ All frontend packages are up to date"
        fi
    fi
    
else
    echo "⚠️ npm not found, skipping frontend dependency check"
    log_issue "MEDIUM" "Frontend" "npm not available for dependency scanning"
fi

echo -e "\n🔍 Scanning Backend Dependencies (Node.js/npm)..."
echo "================================================="

# Check backend dependencies
if [ -d "backend" ]; then
    cd backend || {
        echo "❌ Failed to change to backend directory"
        exit 1
    }
    
    if command_exists npm; then
        # Run backend npm audit
        if npm audit --json > /tmp/backend_npm_audit.json 2>/dev/null; then
            echo "✅ Backend npm audit completed"
            
            if command_exists jq; then
                HIGH_COUNT=$(jq -r '.vulnerabilities | to_entries | map(select(.value.severity == "high")) | length' /tmp/backend_npm_audit.json 2>/dev/null || echo "0")
                MODERATE_COUNT=$(jq -r '.vulnerabilities | to_entries | map(select(.value.severity == "moderate")) | length' /tmp/backend_npm_audit.json 2>/dev/null || echo "0")
                LOW_COUNT=$(jq -r '.vulnerabilities | to_entries | map(select(.value.severity == "low")) | length' /tmp/backend_npm_audit.json 2>/dev/null || echo "0")
                
                echo "Backend vulnerabilities found:"
                echo "  High: $HIGH_COUNT"
                echo "  Moderate: $MODERATE_COUNT"
                echo "  Low: $LOW_COUNT"
                
                if [ "$HIGH_COUNT" -gt 0 ]; then
                    log_issue "HIGH" "Backend" "$HIGH_COUNT high-severity vulnerabilities in npm packages"
                fi
                if [ "$MODERATE_COUNT" -gt 0 ]; then
                    log_issue "MEDIUM" "Backend" "$MODERATE_COUNT moderate-severity vulnerabilities in npm packages"
                fi
                if [ "$LOW_COUNT" -gt 0 ]; then
                    log_issue "LOW" "Backend" "$LOW_COUNT low-severity vulnerabilities in npm packages"
                fi
                
                cp /tmp/backend_npm_audit.json "../security-reports/backend_npm_audit_${TIMESTAMP}.json"
            else
                # Fallback check without jq
                if grep -q '"vulnerabilities":[[:space:]]*{' /tmp/backend_npm_audit.json; then
                    log_issue "MEDIUM" "Backend" "npm audit found vulnerabilities (install jq for detailed analysis)"
                fi
            fi
        fi
        
        # Check for outdated backend packages
        if npm outdated --json > /tmp/backend_npm_outdated.json 2>/dev/null; then
            if [ -s /tmp/backend_npm_outdated.json ] && [ "$(cat /tmp/backend_npm_outdated.json)" != "{}" ]; then
                OUTDATED_COUNT=$(jq '. | keys | length' /tmp/backend_npm_outdated.json 2>/dev/null || echo "unknown")
                echo "Found $OUTDATED_COUNT outdated backend packages"
                log_issue "LOW" "Backend" "$OUTDATED_COUNT outdated npm packages"
            fi
        fi
    fi
    
    cd .. || {
        echo "❌ Failed to return to parent directory"
        exit 1
    }
else
    echo "⚠️ Backend directory not found"
fi

echo -e "\n🔍 Scanning ML Service Dependencies (Python/pip)..."
echo "==================================================="

# Check Python dependencies in ML service
if [ -d "backend/segmentation" ]; then
    cd backend/segmentation || {
        echo "❌ Failed to change to ML service directory"
        exit 1
    }
    
    if command_exists python3; then
        # Check if safety is installed, install if not
        if ! command_exists safety; then
            echo "Installing safety for Python dependency checking..."
            if ! pip3 install safety --quiet 2>/dev/null; then
                echo "⚠️ Failed to install safety"
                log_issue "LOW" "ML Service" "Failed to install Python safety scanner"
            fi
        fi
        
        if command_exists safety; then
            echo "Running safety check on Python dependencies..."
            
            # Create requirements file if it doesn't exist
            if [ ! -f requirements.txt ]; then
                echo "Creating temporary requirements file..."
                if ! pip3 freeze > /tmp/ml_requirements.txt 2>/dev/null; then
                    echo "❌ Failed to generate requirements list with pip freeze"
                    log_issue "MEDIUM" "ML Service" "Failed to generate Python requirements list"
                    cd ../.. || exit 1
                    return 2>/dev/null || exit 1
                fi
                REQUIREMENTS_FILE="/tmp/ml_requirements.txt"
            else
                REQUIREMENTS_FILE="requirements.txt"
            fi
            
            # Verify requirements file exists and is readable
            if [ ! -r "$REQUIREMENTS_FILE" ]; then
                echo "❌ Requirements file is not readable: $REQUIREMENTS_FILE"
                log_issue "MEDIUM" "ML Service" "Requirements file not accessible"
                cd ../.. || exit 1
                return 2>/dev/null || exit 1
            fi
            
            # Run safety check with error handling
            echo "Running safety check on $REQUIREMENTS_FILE..."
            if safety check -r "$REQUIREMENTS_FILE" --json > /tmp/safety_report.json 2>/dev/null; then
                if command_exists jq; then
                    VULN_COUNT=$(jq '. | length' /tmp/safety_report.json 2>/dev/null || echo "0")
                    if [ "$VULN_COUNT" -gt 0 ]; then
                        echo "Found $VULN_COUNT Python package vulnerabilities"
                        log_issue "HIGH" "ML Service" "$VULN_COUNT vulnerabilities in Python packages"
                        
                        # Get details with error handling
                        if ! jq -r '.[] | "  - \(.package_name) \(.installed_version): \(.vulnerability)"' /tmp/safety_report.json >> "$SUMMARY_FILE" 2>/dev/null; then
                            echo "⚠️ Failed to extract vulnerability details"
                        fi
                    else
                        echo "✅ No vulnerabilities found in Python packages"
                    fi
                    
                    # Copy report with error handling
                    if ! cp /tmp/safety_report.json "../../security-reports/python_safety_${TIMESTAMP}.json" 2>/dev/null; then
                        echo "⚠️ Failed to save safety report"
                    fi
                else
                    echo "⚠️ jq not available, checking for vulnerabilities with basic parsing"
                    if grep -q "vulnerabilities" /tmp/safety_report.json 2>/dev/null; then
                        log_issue "MEDIUM" "ML Service" "Safety check found vulnerabilities (install jq for detailed analysis)"
                    fi
                fi
            else
                echo "⚠️ Safety check with JSON failed, trying simple format..."
                # Try simple safety check without JSON
                if safety check -r "$REQUIREMENTS_FILE" 2>&1 | grep -q "vulnerabilities"; then
                    log_issue "MEDIUM" "ML Service" "Safety check found vulnerabilities in Python packages"
                else
                    echo "⚠️ Safety check failed entirely"
                    log_issue "LOW" "ML Service" "Failed to run Python safety check"
                fi
            fi
        else
            echo "⚠️ safety not available, skipping Python vulnerability check"
            log_issue "LOW" "ML Service" "Python safety scanner not available"
        fi
        
        # Check for outdated Python packages
        if command_exists pip-outdated || command_exists pip3; then
            echo "Checking for outdated Python packages..."
            OUTDATED_OUTPUT=$(pip3 list --outdated 2>/dev/null | wc -l)
            if [ "$OUTDATED_OUTPUT" -gt 2 ]; then  # Header lines
                OUTDATED_COUNT=$((OUTDATED_OUTPUT - 2))
                echo "Found $OUTDATED_COUNT outdated Python packages"
                log_issue "LOW" "ML Service" "$OUTDATED_COUNT outdated Python packages"
            fi
        fi
        
    else
        echo "⚠️ Python3 not found, skipping ML service dependency check"
        log_issue "MEDIUM" "ML Service" "Python3 not available for dependency scanning"
    fi
    
    cd ../.. || {
        echo "❌ Failed to return to repository root"
        exit 1
    }
else
    echo "⚠️ ML service directory not found"
fi

echo -e "\n🔍 Checking Docker Images for Vulnerabilities..."
echo "==============================================="

# Check if Docker is available and images exist
if command_exists docker; then
    # Get list of project Docker images with error handling
    if ! IMAGES=$(docker images --format "{{.Repository}}:{{.Tag}}" 2>/dev/null | grep -E "(spheroseg|cell-segmentation)" || echo ""); then
        echo "⚠️ Failed to list Docker images"
        log_issue "LOW" "Docker" "Failed to enumerate Docker images"
        IMAGES=""
    fi
    
    if [ -n "$IMAGES" ]; then
        # Check if trivy is available for Docker scanning
        if command_exists trivy; then
            echo "Using Trivy to scan Docker images..."
            
            echo "$IMAGES" | while read -r image; do
                if [ -n "$image" ]; then
                    echo "Scanning Docker image: $image"
                    
                    # Sanitize image name for filename
                    SANITIZED_IMAGE=$(sanitize_image_name "$image")
                    
                    # Run trivy scan with error handling
                    if trivy image --format json --output "/tmp/trivy_${SANITIZED_IMAGE}.json" "$image" 2>/dev/null; then
                        echo "✅ Trivy scan completed for $image"
                    else
                        echo "⚠️ Trivy scan failed for $image"
                        log_issue "LOW" "Docker" "Failed to scan image: $image"
                        continue
                    fi
                    
                    if [ -f "/tmp/trivy_${SANITIZED_IMAGE}.json" ]; then
                        if command_exists jq; then
                            CRITICAL_COUNT=$(jq -r '[.Results[]?.Vulnerabilities[]? | select(.Severity == "CRITICAL")] | length' "/tmp/trivy_${SANITIZED_IMAGE}.json" 2>/dev/null || echo "0")
                            HIGH_COUNT=$(jq -r '[.Results[]?.Vulnerabilities[]? | select(.Severity == "HIGH")] | length' "/tmp/trivy_${SANITIZED_IMAGE}.json" 2>/dev/null || echo "0")
                            MEDIUM_COUNT=$(jq -r '[.Results[]?.Vulnerabilities[]? | select(.Severity == "MEDIUM")] | length' "/tmp/trivy_${SANITIZED_IMAGE}.json" 2>/dev/null || echo "0")
                            
                            echo "  Critical: $CRITICAL_COUNT, High: $HIGH_COUNT, Medium: $MEDIUM_COUNT"
                            
                            if [ "$CRITICAL_COUNT" -gt 0 ] || [ "$HIGH_COUNT" -gt 0 ]; then
                                log_issue "HIGH" "Docker" "$CRITICAL_COUNT critical + $HIGH_COUNT high vulnerabilities in $image"
                            elif [ "$MEDIUM_COUNT" -gt 0 ]; then
                                log_issue "MEDIUM" "Docker" "$MEDIUM_COUNT medium vulnerabilities in $image"
                            fi
                            
                            # Copy with error handling
                            if ! cp "/tmp/trivy_${SANITIZED_IMAGE}.json" "security-reports/"; then
                                echo "⚠️ Failed to save trivy report for $image"
                            fi
                        else
                            echo "⚠️ jq not available, skipping detailed trivy analysis for $image"
                            log_issue "LOW" "Docker" "Cannot analyze trivy results for $image (jq required)"
                        fi
                    else
                        echo "⚠️ Trivy report file not found for $image"
                    fi
                fi
            done
        else
            echo "⚠️ Trivy not found, skipping Docker image vulnerability scanning"
            log_issue "LOW" "Docker" "Docker vulnerability scanner (trivy) not available"
        fi
    else
        echo "ℹ️ No project Docker images found to scan"
    fi
else
    echo "⚠️ Docker not found, skipping Docker image scanning"
fi

echo -e "\n🔍 Additional Security Checks..."
echo "================================"

# Check for sensitive files
echo "Checking for sensitive files..."
SENSITIVE_FILES=(
    ".env"
    ".env.local" 
    ".env.production"
    "config/database.yml"
    "config/secrets.yml"
    "private.key"
    "*.pem"
    "*.p12"
    "*.pfx"
    "id_rsa"
    "id_dsa"
    "id_ecdsa"
    "id_ed25519"
)

for pattern in "${SENSITIVE_FILES[@]}"; do
    if find . -name "$pattern" -type f 2>/dev/null | head -10 | grep -q .; then
        # Count found files for better reporting
        FILE_COUNT=$(find . -name "$pattern" -type f 2>/dev/null | wc -l)
        log_issue "MEDIUM" "Files" "Sensitive file pattern found: $pattern ($FILE_COUNT files)"
    fi
done

# Check for hardcoded secrets in code
echo "Scanning for potential hardcoded secrets..."
SECRET_PATTERNS=(
    "password\s*=\s*['\"][^'\"]{8,}"
    "api_key\s*=\s*['\"][^'\"]{16,}"
    "secret\s*=\s*['\"][^'\"]{16,}"
    "token\s*=\s*['\"][^'\"]{20,}"
    "AUTH_TOKEN"
    "SECRET_KEY"
    "DATABASE_URL.*://"
    "mongodb://.*:.*@"
    "postgres://.*:.*@"
)

for pattern in "${SECRET_PATTERNS[@]}"; do
    # Search with better error handling and performance limits
    if MATCHES=$(grep -r -E "$pattern" --include="*.js" --include="*.ts" --include="*.py" --include="*.yml" --include="*.yaml" . 2>/dev/null | grep -v node_modules | grep -v ".git" | head -5); then
        if [ -n "$MATCHES" ]; then
            MATCH_COUNT=$(echo "$MATCHES" | wc -l)
            log_issue "HIGH" "Code" "Potential hardcoded secret pattern: $pattern ($MATCH_COUNT matches)"
            # Optionally log first few matches to summary (without revealing secrets)
            echo "$MATCHES" | cut -d: -f1 | sort -u | head -3 | while read -r file; do
                echo "  Found in: $file" >> "$SUMMARY_FILE"
            done
        fi
    fi
done

# Generate final report
echo -e "\n📊 Security Audit Summary"
echo "=========================="
echo "Total Issues: $TOTAL_ISSUES"
echo "  High: $HIGH_ISSUES"
echo "  Medium: $MEDIUM_ISSUES"
echo "  Low: $LOW_ISSUES"

# Add summary to file
echo -e "\n=========================" >> "$SUMMARY_FILE"
echo "SUMMARY:" >> "$SUMMARY_FILE"
echo "Total Issues: $TOTAL_ISSUES" >> "$SUMMARY_FILE"
echo "  High: $HIGH_ISSUES" >> "$SUMMARY_FILE"
echo "  Medium: $MEDIUM_ISSUES" >> "$SUMMARY_FILE"
echo "  Low: $LOW_ISSUES" >> "$SUMMARY_FILE"

# Create consolidated JSON report with error handling
if ! cat > "$REPORT_FILE" << EOF
{
  "scan_info": {
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "scan_type": "dependency_audit",
    "total_issues": $TOTAL_ISSUES
  },
  "summary": {
    "high": $HIGH_ISSUES,
    "medium": $MEDIUM_ISSUES,
    "low": $LOW_ISSUES
  },
  "components_scanned": [
    "frontend_npm",
    "backend_npm",
    "ml_python",
    "docker_images",
    "sensitive_files",
    "hardcoded_secrets"
  ]
}
EOF
then
    echo "⚠️ Failed to create JSON report file"
    log_issue "LOW" "System" "Failed to create consolidated JSON report"
fi

echo -e "\n📄 Reports saved:"
echo "  Summary: $SUMMARY_FILE"
echo "  JSON: $REPORT_FILE"

# Return appropriate exit code
if [ $HIGH_ISSUES -gt 0 ]; then
    echo -e "\n${RED}❌ High-risk security issues found!${NC}"
    exit 2
elif [ $MEDIUM_ISSUES -gt 0 ]; then
    echo -e "\n${YELLOW}⚠️  Medium-risk security issues found${NC}"
    exit 1
elif [ $LOW_ISSUES -gt 0 ]; then
    echo -e "\n${YELLOW}ℹ️  Low-risk issues found${NC}"
    exit 0
else
    echo -e "\n${GREEN}✅ No significant security issues found${NC}"
    exit 0
fi