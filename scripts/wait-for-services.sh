#!/bin/bash

# wait-for-services.sh - Robust service health check with retry loop and timeout
# This script replaces hardcoded sleep calls in CI workflows with proper health endpoint polling

set -euo pipefail

# Default configuration
DEFAULT_TIMEOUT=300
DEFAULT_INTERVAL=5
DEFAULT_ENDPOINTS=""

# Color output for better visibility
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored messages
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS] ENDPOINTS...

Wait for service health endpoints to become available with retry loop and timeout.

OPTIONS:
    -t, --timeout SECONDS     Maximum time to wait for all services (default: $DEFAULT_TIMEOUT)
    -i, --interval SECONDS    Interval between health checks (default: $DEFAULT_INTERVAL)
    -h, --help               Show this help message

ENDPOINTS:
    Space-separated list of HTTP(S) URLs to check
    Examples:
        http://localhost:3001/health
        http://localhost:8000/health
        https://api.example.com/status

EXAMPLES:
    # Wait for backend and ML service
    $0 http://localhost:3001/health http://localhost:8000/health

    # With custom timeout and interval
    $0 -t 600 -i 10 http://localhost:3001/health

    # Wait for frontend to be available
    $0 http://localhost:3000

EXIT CODES:
    0    All services are healthy
    1    Invalid arguments or usage
    2    Timeout reached before all services became healthy
    3    Service check failed unexpectedly
EOF
}

# Function to check if a URL is reachable and healthy
check_service() {
    local url="$1"
    local response_code

    # Use curl with timeout and follow redirects
    if response_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 --connect-timeout 5 "$url" 2>/dev/null); then
        # Consider 2xx and 3xx responses as healthy
        if [[ "$response_code" =~ ^[23][0-9][0-9]$ ]]; then
            return 0
        else
            log_warn "Service $url returned HTTP $response_code"
            return 1
        fi
    else
        # curl failed (connection refused, timeout, etc.)
        return 1
    fi
}

# Function to wait for all services
wait_for_services() {
    local endpoints=("$@")
    local timeout="$DEFAULT_TIMEOUT"
    local interval="$DEFAULT_INTERVAL"
    local start_time
    local current_time
    local elapsed_time
    local all_healthy=false

    start_time=$(date +%s)

    log_info "Waiting for ${#endpoints[@]} service(s) to become healthy..."
    log_info "Timeout: ${timeout}s, Check interval: ${interval}s"
    
    for endpoint in "${endpoints[@]}"; do
        log_info "- $endpoint"
    done

    while [[ "$all_healthy" == false ]]; do
        current_time=$(date +%s)
        elapsed_time=$((current_time - start_time))

        # Check timeout
        if [[ $elapsed_time -ge $timeout ]]; then
            log_error "Timeout reached after ${elapsed_time}s. Not all services are healthy."
            
            # Show final status of each service
            log_error "Final service status:"
            for endpoint in "${endpoints[@]}"; do
                if check_service "$endpoint"; then
                    log_info "  ✓ $endpoint"
                else
                    log_error "  ✗ $endpoint"
                fi
            done
            
            return 2
        fi

        # Check all endpoints
        local healthy_count=0
        local total_count=${#endpoints[@]}

        for endpoint in "${endpoints[@]}"; do
            if check_service "$endpoint"; then
                ((healthy_count++))
            fi
        done

        # Print progress
        log_info "Progress: $healthy_count/$total_count services healthy (${elapsed_time}s elapsed)"

        # Check if all services are healthy
        if [[ $healthy_count -eq $total_count ]]; then
            all_healthy=true
            log_info "✓ All services are healthy after ${elapsed_time}s!"
            return 0
        fi

        # Wait before next check
        sleep "$interval"
    done
}

# Parse command line arguments
parse_arguments() {
    local endpoints=()

    while [[ $# -gt 0 ]]; do
        case $1 in
            -t|--timeout)
                if [[ -n "${2:-}" ]] && [[ "$2" =~ ^[0-9]+$ ]]; then
                    DEFAULT_TIMEOUT="$2"
                    shift 2
                else
                    log_error "Invalid timeout value: ${2:-}"
                    return 1
                fi
                ;;
            -i|--interval)
                if [[ -n "${2:-}" ]] && [[ "$2" =~ ^[0-9]+$ ]]; then
                    DEFAULT_INTERVAL="$2"
                    shift 2
                else
                    log_error "Invalid interval value: ${2:-}"
                    return 1
                fi
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            -*)
                log_error "Unknown option: $1"
                show_usage
                return 1
                ;;
            *)
                # This should be a URL endpoint
                if [[ "$1" =~ ^https?:// ]]; then
                    endpoints+=("$1")
                else
                    log_error "Invalid URL format: $1"
                    return 1
                fi
                shift
                ;;
        esac
    done

    # Check if we have at least one endpoint
    if [[ ${#endpoints[@]} -eq 0 ]]; then
        log_error "No service endpoints provided"
        show_usage
        return 1
    fi

    # Validate timeout and interval
    if [[ $DEFAULT_TIMEOUT -le 0 ]]; then
        log_error "Timeout must be greater than 0"
        return 1
    fi

    if [[ $DEFAULT_INTERVAL -le 0 ]]; then
        log_error "Interval must be greater than 0"
        return 1
    fi

    # Call wait function with collected endpoints
    wait_for_services "${endpoints[@]}"
}

# Main execution
main() {
    # Check if curl is available
    if ! command -v curl &> /dev/null; then
        log_error "curl is required but not installed. Please install curl and try again."
        exit 3
    fi

    # Parse arguments and wait for services
    if ! parse_arguments "$@"; then
        exit 1
    fi
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi