#!/bin/bash

# Auto Disk Cleanup Script - Safe Conservative Approach
# Runs daily via systemd timer to prevent disk space issues
# Only cleans truly safe items that won't affect running services

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/var/log/auto-cleanup.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
MIN_FREE_SPACE_GB=50  # Minimum free space to maintain
CLEANUP_AGE_DAYS=7     # Age of items to clean

# Ensure log file exists (try with sudo first, fallback to local)
if [ -w "$LOG_FILE" ] || sudo touch "$LOG_FILE" 2>/dev/null; then
    LOG_FILE="$LOG_FILE"
else
    LOG_FILE="$HOME/auto-cleanup.log"
    touch "$LOG_FILE"
fi

# Logging function
log_message() {
    echo "[$TIMESTAMP] $1" | tee -a "$LOG_FILE"
}

# Get free space in GB
get_free_space_gb() {
    df / | awk 'NR==2 {print int($4/1048576)}'
}

# Calculate space saved
calculate_saved_space() {
    local before=$1
    local after=$2
    echo $((after - before))
}

log_message "===== Starting Auto Cleanup ====="
log_message "Host: $(hostname)"
log_message "User: $(whoami)"

# Initial space check
INITIAL_FREE_GB=$(get_free_space_gb)
log_message "Initial free space: ${INITIAL_FREE_GB}GB"

# Check if cleanup is needed
if [ "$INITIAL_FREE_GB" -gt "$MIN_FREE_SPACE_GB" ]; then
    log_message "Sufficient free space available (${INITIAL_FREE_GB}GB > ${MIN_FREE_SPACE_GB}GB). Performing routine cleanup only."
fi

# Track total space saved
TOTAL_SAVED=0

# 1. Clean Docker build cache (safest operation)
log_message "Cleaning Docker build cache..."
BEFORE=$(get_free_space_gb)
docker builder prune -f --filter "until=24h" 2>&1 | tee -a "$LOG_FILE" || log_message "Warning: Docker builder prune failed"
AFTER=$(get_free_space_gb)
SAVED=$(calculate_saved_space $BEFORE $AFTER)
log_message "Docker build cache cleaned. Space saved: ${SAVED}GB"
TOTAL_SAVED=$((TOTAL_SAVED + SAVED))

# 2. Remove stopped containers older than 7 days
log_message "Removing old stopped containers..."
BEFORE=$(get_free_space_gb)
docker container prune -f --filter "until=${CLEANUP_AGE_DAYS}0h" 2>&1 | tee -a "$LOG_FILE" || log_message "Warning: Container prune failed"
AFTER=$(get_free_space_gb)
SAVED=$(calculate_saved_space $BEFORE $AFTER)
log_message "Old containers removed. Space saved: ${SAVED}GB"
TOTAL_SAVED=$((TOTAL_SAVED + SAVED))

# 3. Remove dangling images (images with <none> tag)
log_message "Removing dangling Docker images..."
BEFORE=$(get_free_space_gb)
docker image prune -f 2>&1 | tee -a "$LOG_FILE" || log_message "Warning: Image prune failed"
AFTER=$(get_free_space_gb)
SAVED=$(calculate_saved_space $BEFORE $AFTER)
log_message "Dangling images removed. Space saved: ${SAVED}GB"
TOTAL_SAVED=$((TOTAL_SAVED + SAVED))

# 4. Remove unused Docker networks (safe operation)
log_message "Cleaning unused Docker networks..."
docker network prune -f 2>&1 | tee -a "$LOG_FILE" || log_message "Warning: Network prune failed"

# 5. Clean old log files
log_message "Cleaning old log files..."
BEFORE=$(get_free_space_gb)

# Clean systemd journal logs older than 7 days (only if running as root)
if [ "$EUID" -eq 0 ] && command -v journalctl &> /dev/null; then
    journalctl --vacuum-time=7d 2>&1 | tee -a "$LOG_FILE" || log_message "Warning: Journal cleanup failed"
fi

# Clean old Docker container logs
find /var/lib/docker/containers -name "*.log" -type f -mtime +7 -exec truncate -s 0 {} \; 2>/dev/null || true

# Clean project log files older than 7 days
find "$PROJECT_ROOT" -type f \( -name "*.log" -o -name "*.tmp" \) -mtime +7 -delete 2>/dev/null || true

AFTER=$(get_free_space_gb)
SAVED=$(calculate_saved_space $BEFORE $AFTER)
log_message "Log files cleaned. Space saved: ${SAVED}GB"
TOTAL_SAVED=$((TOTAL_SAVED + SAVED))

# 6. Clean NPM cache if needed (only if low on space)
if [ "$INITIAL_FREE_GB" -lt "$MIN_FREE_SPACE_GB" ]; then
    log_message "Low disk space detected. Cleaning NPM cache..."
    BEFORE=$(get_free_space_gb)
    npm cache clean --force 2>&1 | tee -a "$LOG_FILE" || log_message "Warning: NPM cache clean failed"
    AFTER=$(get_free_space_gb)
    SAVED=$(calculate_saved_space $BEFORE $AFTER)
    log_message "NPM cache cleaned. Space saved: ${SAVED}GB"
    TOTAL_SAVED=$((TOTAL_SAVED + SAVED))
fi

# 7. Clean pip cache if needed
if [ "$INITIAL_FREE_GB" -lt "$MIN_FREE_SPACE_GB" ]; then
    log_message "Cleaning pip cache..."
    BEFORE=$(get_free_space_gb)
    rm -rf /home/cvat/.cache/pip/* 2>/dev/null || true
    AFTER=$(get_free_space_gb)
    SAVED=$(calculate_saved_space $BEFORE $AFTER)
    log_message "Pip cache cleaned. Space saved: ${SAVED}GB"
    TOTAL_SAVED=$((TOTAL_SAVED + SAVED))
fi

# 8. Remove old temporary files
log_message "Cleaning temporary files..."
BEFORE=$(get_free_space_gb)
find /tmp -type f -atime +7 -delete 2>/dev/null || true
find /var/tmp -type f -atime +7 -delete 2>/dev/null || true
AFTER=$(get_free_space_gb)
SAVED=$(calculate_saved_space $BEFORE $AFTER)
log_message "Temporary files cleaned. Space saved: ${SAVED}GB"
TOTAL_SAVED=$((TOTAL_SAVED + SAVED))

# Final space check
FINAL_FREE_GB=$(get_free_space_gb)
log_message "===== Cleanup Complete ====="
log_message "Final free space: ${FINAL_FREE_GB}GB"
log_message "Total space saved: ${TOTAL_SAVED}GB"
log_message "=============================\n"

# Alert if still low on space
if [ "$FINAL_FREE_GB" -lt "$MIN_FREE_SPACE_GB" ]; then
    log_message "WARNING: Disk space still low after cleanup! Manual intervention required."
    # Could add email notification here if SMTP is configured
    exit 1
fi

exit 0