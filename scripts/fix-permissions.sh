#!/bin/bash
# =================================================================
# Cell Segmentation Hub - Automatic Permission Fixer
# =================================================================
# This script automatically fixes all file permission issues that
# commonly cause deployment failures, especially upload 500 errors.

set -euo pipefail

# Script directory and configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/config/deployment.config"

# Load deployment configuration
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "ERROR: Deployment configuration not found: $CONFIG_FILE"
    exit 1
fi

source "$CONFIG_FILE"

# Initialize logging
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/fix-permissions-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Global variables
FIXES_APPLIED=0
ERRORS_ENCOUNTERED=0
DRY_RUN_MODE=false

# Command line argument parsing
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN_MODE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--dry-run] [--help]"
            echo ""
            echo "Options:"
            echo "  --dry-run    Show what would be fixed without making changes"
            echo "  --help, -h   Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
    ((ERRORS_ENCOUNTERED++))
}

log_fix() {
    echo -e "${GREEN}[FIXED]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
    ((FIXES_APPLIED++))
}

# Function to print section headers
print_header() {
    echo ""
    echo "============================================================"
    echo "$1"
    echo "============================================================"
}

# Function to execute command with dry-run support
execute_fix() {
    local description="$1"
    shift
    local cmd=("$@")
    
    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        log_info "[DRY-RUN] Would execute: ${cmd[*]}"
        log_info "[DRY-RUN] Description: $description"
    else
        if "${cmd[@]}"; then
            log_fix "$description"
            return 0
        else
            log_error "Failed to apply fix: $description"
            log_error "Command failed: ${cmd[*]}"
            return 1
        fi
    fi
}

# Function to create directory with correct permissions
create_directory_with_permissions() {
    local dir_path="$1"
    local description="$2"
    
    if [[ ! -d "$dir_path" ]]; then
        execute_fix "Create directory: $description" \
            mkdir -p "$dir_path"
    fi
    
    execute_fix "Set ownership for $description" \
        sudo chown -R "${DOCKER_UID}:${DOCKER_GID}" "$dir_path"
    
    execute_fix "Set permissions for $description" \
        sudo chmod -R 755 "$dir_path"
}

# Function to check and fix file permissions
check_and_fix_permissions() {
    local path="$1"
    local expected_uid="$2"
    local expected_gid="$3"
    local expected_perm="$4"
    local description="$5"
    
    if [[ ! -e "$path" ]]; then
        log_warning "Path does not exist: $path"
        return 1
    fi
    
    local current_uid
    current_uid=$(stat -c %u "$path" 2>/dev/null || echo "unknown")
    local current_gid
    current_gid=$(stat -c %g "$path" 2>/dev/null || echo "unknown")
    local current_perm
    current_perm=$(stat -c %a "$path" 2>/dev/null || echo "unknown")
    
    local needs_chown=false
    local needs_chmod=false
    
    if [[ "$current_uid" != "$expected_uid" ]] || [[ "$current_gid" != "$expected_gid" ]]; then
        needs_chown=true
    fi
    
    if [[ "$current_perm" != "$expected_perm" ]]; then
        needs_chmod=true
    fi
    
    if [[ "$needs_chown" == "true" ]]; then
        execute_fix "Fix ownership for $description" \
            sudo chown -R "${expected_uid}:${expected_gid}" "$path"
    fi
    
    if [[ "$needs_chmod" == "true" ]]; then
        execute_fix "Fix permissions for $description" \
            sudo chmod -R "$expected_perm" "$path"
    fi
    
    if [[ "$needs_chown" == "false" ]] && [[ "$needs_chmod" == "false" ]]; then
        log_success "Permissions already correct for: $description"
    fi
    
    return 0
}

# Fix upload directories and permissions
fix_upload_directories() {
    print_header "Fixing Upload Directory Permissions"
    
    local upload_dirs=("$BLUE_UPLOAD_DIR" "$GREEN_UPLOAD_DIR")
    
    for base_dir in "${upload_dirs[@]}"; do
        local full_base_path="$PROJECT_ROOT/$base_dir"
        
        # Create base upload directory
        create_directory_with_permissions "$full_base_path" "$base_dir"
        
        # Create all required subdirectories
        for subdir in $UPLOAD_SUBDIRS; do
            local full_sub_path="$full_base_path/$subdir"
            create_directory_with_permissions "$full_sub_path" "$base_dir/$subdir"
        done
        
        # Special handling for blue environment duplicate structure issue
        if [[ "$base_dir" == "$BLUE_UPLOAD_DIR" ]]; then
            local duplicate_path="$full_base_path/blue"
            if [[ -d "$duplicate_path" ]]; then
                log_warning "Found duplicate blue directory structure: $duplicate_path"
                
                # Check if there are files in the duplicate structure
                if find "$duplicate_path" -type f | head -1 | grep -q .; then
                    log_info "Moving files from duplicate structure to correct location"
                    
                    # Move files from duplicate structure to correct location
                    for subdir in $UPLOAD_SUBDIRS; do
                        local src_path="$duplicate_path/$subdir"
                        local dest_path="$full_base_path/$subdir"
                        
                        if [[ -d "$src_path" ]] && [[ "$(find "$src_path" -type f 2>/dev/null | wc -l)" -gt 0 ]]; then
                            execute_fix "Move files from $src_path to $dest_path" \
                                sudo find "$src_path" -type f -exec mv {} "$dest_path/" \;
                        fi
                    done
                    
                    # Remove duplicate structure after moving files
                    execute_fix "Remove duplicate blue directory structure" \
                        sudo rm -rf "$duplicate_path"
                else
                    # Empty duplicate structure, just remove it
                    execute_fix "Remove empty duplicate blue directory structure" \
                        sudo rm -rf "$duplicate_path"
                fi
            fi
        fi
    done
    
    return 0
}

# Fix backend data directories
fix_backend_data_directories() {
    print_header "Fixing Backend Data Directory Permissions"
    
    local data_dirs=("./backend/data/blue" "./backend/data/green")
    
    for data_dir in "${data_dirs[@]}"; do
        local full_path="$PROJECT_ROOT/$data_dir"
        create_directory_with_permissions "$full_path" "$data_dir (SQLite database)"
    done
    
    return 0
}

# Fix log directories
fix_log_directories() {
    print_header "Fixing Log Directory Permissions"
    
    local log_dirs=("$LOG_DIR" "./logs/nginx" "./logs/backend" "./logs/frontend" "./logs/ml")
    
    for log_dir in "${log_dirs[@]}"; do
        local full_path
        if [[ "$log_dir" =~ ^/ ]]; then
            full_path="$log_dir"
        else
            full_path="$PROJECT_ROOT/$log_dir"
        fi
        
        create_directory_with_permissions "$full_path" "$log_dir (application logs)"
    done
    
    return 0
}

# Fix backup directories
fix_backup_directories() {
    print_header "Fixing Backup Directory Permissions"
    
    local full_path="$PROJECT_ROOT/$BACKUP_DIR"
    create_directory_with_permissions "$full_path" "$BACKUP_DIR (database and file backups)"
    
    return 0
}

# Fix ML weights directory permissions
fix_ml_weights_permissions() {
    print_header "Fixing ML Weights Directory Permissions"
    
    local weights_path="$PROJECT_ROOT/$ML_WEIGHTS_DIR"
    
    if [[ -d "$weights_path" ]]; then
        # ML weights should be readable by the Docker containers
        check_and_fix_permissions "$weights_path" "$DOCKER_UID" "$DOCKER_GID" "755" "ML weights directory"
        
        # Ensure all weight files are readable
        if find "$weights_path" -name "*.pth" -type f | head -1 | grep -q .; then
            execute_fix "Set read permissions for ML weight files" \
                sudo find "$weights_path" -name "*.pth" -type f -exec chmod 644 {} \;
        fi
    else
        log_warning "ML weights directory does not exist: $weights_path"
    fi
    
    return 0
}

# Fix Docker socket permissions (if needed for deployment scripts)
fix_docker_socket_permissions() {
    print_header "Checking Docker Socket Permissions"
    
    local docker_socket="/var/run/docker.sock"
    
    if [[ -S "$docker_socket" ]]; then
        local current_perm
        current_perm=$(stat -c %a "$docker_socket" 2>/dev/null || echo "unknown")
        
        # Check if current user can access docker socket
        if docker info >/dev/null 2>&1; then
            log_success "Docker socket is accessible"
        else
            log_warning "Docker socket may not be accessible for deployment"
            log_info "Consider adding user to docker group: sudo usermod -aG docker \$USER"
        fi
    else
        log_warning "Docker socket not found at expected location: $docker_socket"
    fi
    
    return 0
}

# Fix nginx configuration file permissions
fix_nginx_config_permissions() {
    print_header "Fixing Nginx Configuration Permissions"
    
    local nginx_configs=("$NGINX_PROD_CONFIG" "$NGINX_BLUE_CONFIG" "$NGINX_GREEN_CONFIG")
    
    for config in "${nginx_configs[@]}"; do
        local full_path="$PROJECT_ROOT/$config"
        
        if [[ -f "$full_path" ]]; then
            check_and_fix_permissions "$full_path" "root" "root" "644" "nginx config: $config"
        else
            log_warning "Nginx config file not found: $full_path"
        fi
    done
    
    return 0
}

# Fix SSL certificate permissions
fix_ssl_certificate_permissions() {
    print_header "Fixing SSL Certificate Permissions"
    
    if [[ "$ENABLE_SSL" == "true" ]] && [[ -d "$SSL_CERT_DIR" ]]; then
        # SSL certificates should be readable by nginx
        local cert_file="$SSL_CERT_DIR/$SSL_CERT_FILE"
        local key_file="$SSL_CERT_DIR/$SSL_KEY_FILE"
        
        if [[ -f "$cert_file" ]]; then
            check_and_fix_permissions "$cert_file" "root" "root" "644" "SSL certificate"
        fi
        
        if [[ -f "$key_file" ]]; then
            check_and_fix_permissions "$key_file" "root" "root" "600" "SSL private key"
        fi
    else
        log_info "SSL is disabled or certificates not found, skipping SSL permission fixes"
    fi
    
    return 0
}

# Fix project root permissions
fix_project_root_permissions() {
    print_header "Fixing Project Root Permissions"
    
    # Ensure project root is accessible
    execute_fix "Set project root permissions" \
        sudo chmod 755 "$PROJECT_ROOT"
    
    # Fix common permission issues with hidden files
    local hidden_files=(".env*" ".git")
    for pattern in "${hidden_files[@]}"; do
        if find "$PROJECT_ROOT" -maxdepth 1 -name "$pattern" -type f | head -1 | grep -q .; then
            execute_fix "Fix permissions for $pattern files" \
                sudo find "$PROJECT_ROOT" -maxdepth 1 -name "$pattern" -type f -exec chmod 644 {} \;
        fi
    done
    
    return 0
}

# Clean up temporary files and fix their permissions
cleanup_temporary_files() {
    print_header "Cleaning Up Temporary Files"
    
    local temp_dirs=("/tmp/spheroseg*" "$PROJECT_ROOT/tmp" "$PROJECT_ROOT/.tmp")
    
    for pattern in "${temp_dirs[@]}"; do
        # Use find to handle patterns safely
        if find "$(dirname "$pattern")" -maxdepth 1 -name "$(basename "$pattern")" -type d 2>/dev/null | head -1 | grep -q .; then
            execute_fix "Clean temporary directory: $pattern" \
                sudo rm -rf $pattern  # Don't quote this one as it's a pattern
        fi
    done
    
    # Clean Docker build cache if it's taking up too much space
    local build_cache_size
    build_cache_size=$(docker system df --format "table {{.Type}}\t{{.Size}}" | grep "Build Cache" | awk '{print $3}' | sed 's/[^0-9.]//g' | head -1 || echo "0")
    
    if [[ -n "$build_cache_size" ]] && (( $(echo "$build_cache_size > 5" | bc -l 2>/dev/null || echo 0) )); then
        log_info "Docker build cache size: ${build_cache_size}GB"
        if [[ "$DRY_RUN_MODE" != "true" ]]; then
            read -p "Clean Docker build cache? [y/N]: " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                execute_fix "Clean Docker build cache" \
                    docker builder prune -f
            fi
        else
            log_info "[DRY-RUN] Would prompt to clean Docker build cache"
        fi
    fi
    
    return 0
}

# Verify all fixes were applied correctly
verify_fixes() {
    print_header "Verifying Applied Fixes"
    
    local verification_errors=0
    
    # Verify upload directories
    for base_dir in "$BLUE_UPLOAD_DIR" "$GREEN_UPLOAD_DIR"; do
        local full_path="$PROJECT_ROOT/$base_dir"
        
        if [[ ! -d "$full_path" ]]; then
            log_error "Upload directory was not created: $full_path"
            ((verification_errors++))
            continue
        fi
        
        local owner_uid
        owner_uid=$(stat -c %u "$full_path" 2>/dev/null || echo "unknown")
        if [[ "$owner_uid" != "$DOCKER_UID" ]]; then
            log_error "Upload directory has incorrect ownership: $full_path (UID: $owner_uid, expected: $DOCKER_UID)"
            ((verification_errors++))
        fi
        
        # Verify subdirectories exist
        for subdir in $UPLOAD_SUBDIRS; do
            local sub_path="$full_path/$subdir"
            if [[ ! -d "$sub_path" ]]; then
                log_error "Upload subdirectory missing: $sub_path"
                ((verification_errors++))
            fi
        done
    done
    
    # Verify no duplicate blue structure exists
    local blue_duplicate="$PROJECT_ROOT/$BLUE_UPLOAD_DIR/blue"
    if [[ -d "$blue_duplicate" ]]; then
        log_error "Duplicate blue directory structure still exists: $blue_duplicate"
        ((verification_errors++))
    fi
    
    if [[ $verification_errors -eq 0 ]]; then
        log_success "All fixes verified successfully"
    else
        log_error "Verification found $verification_errors issues"
    fi
    
    return $verification_errors
}

# Generate permission fix report
generate_report() {
    print_header "Permission Fix Summary"
    
    echo "Permission fix operation completed at $(date)"
    echo "Log file: $LOG_FILE"
    echo "Mode: $(if [[ "$DRY_RUN_MODE" == "true" ]]; then echo "DRY RUN"; else echo "LIVE EXECUTION"; fi)"
    echo ""
    echo "Results:"
    echo "  Fixes Applied: $FIXES_APPLIED"
    echo "  Errors Encountered: $ERRORS_ENCOUNTERED"
    echo ""
    
    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        echo -e "${BLUE}ℹ DRY RUN COMPLETED${NC} - No changes were made"
        echo "Run without --dry-run to apply the fixes"
    elif [[ $ERRORS_ENCOUNTERED -eq 0 ]]; then
        echo -e "${GREEN}✓ ALL PERMISSIONS FIXED${NC} - System is ready for deployment"
        echo ""
        echo "Fixed permissions for:"
        echo "  • Upload directories (blue/green environments)"
        echo "  • Backend data directories"
        echo "  • Log directories"
        echo "  • Backup directories"
        echo "  • ML model weights"
        echo "  • Nginx configuration files"
        echo "  • SSL certificates (if enabled)"
        echo "  • Project root structure"
    else
        echo -e "${RED}✗ SOME ERRORS OCCURRED${NC} - Review the log file for details"
        echo "You may need to run this script as root or fix remaining issues manually"
    fi
    
    echo ""
    echo "Next steps:"
    echo "  1. Run pre-deployment validation: ./scripts/pre-deployment-check.sh"
    echo "  2. Start deployment: ./scripts/deploy-production.sh"
    echo ""
    
    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        return 0
    else
        return $ERRORS_ENCOUNTERED
    fi
}

# Main function
main() {
    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        log_info "Starting permission fix in DRY-RUN mode"
    else
        log_info "Starting permission fix operation"
    fi
    
    log_info "Project root: $PROJECT_ROOT"
    log_info "Docker UID: $DOCKER_UID"
    log_info "Docker GID: $DOCKER_GID"
    
    # Check if we need sudo for some operations
    if [[ $EUID -ne 0 ]] && [[ "$DRY_RUN_MODE" != "true" ]]; then
        log_info "This script will use sudo for file ownership changes"
        log_info "You may be prompted for your password"
        
        # Test sudo access
        if ! sudo -n true 2>/dev/null; then
            log_info "Testing sudo access..."
            if ! sudo true; then
                log_error "Sudo access required but not available"
                exit 1
            fi
        fi
    fi
    
    # Run all permission fixes
    local fix_functions=(
        "fix_upload_directories"
        "fix_backend_data_directories"
        "fix_log_directories"
        "fix_backup_directories"
        "fix_ml_weights_permissions"
        "fix_nginx_config_permissions"
        "fix_ssl_certificate_permissions"
        "fix_project_root_permissions"
        "cleanup_temporary_files"
        "fix_docker_socket_permissions"
    )
    
    for fix_function in "${fix_functions[@]}"; do
        if ! "$fix_function"; then
            log_error "Permission fix function failed: $fix_function"
        fi
    done
    
    # Verify fixes if not in dry-run mode
    if [[ "$DRY_RUN_MODE" != "true" ]]; then
        verify_fixes
    fi
    
    # Generate final report
    generate_report
}

# Handle script termination
cleanup() {
    log_info "Permission fix script terminated"
}
trap cleanup EXIT

# Run main function
main "$@"