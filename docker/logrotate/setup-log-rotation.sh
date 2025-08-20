#!/bin/bash
# Setup script for log rotation in Docker containers

set -e

echo "Setting up log rotation for SpheroSeg Cell Segmentation Hub..."

# Create log directories with proper permissions
create_log_dirs() {
    echo "Creating log directories..."
    
    mkdir -p /var/log/spheroseg/backend
    mkdir -p /var/log/spheroseg/ml
    mkdir -p /var/log/spheroseg/prometheus
    mkdir -p /var/log/spheroseg/grafana
    mkdir -p /var/log/nginx
    
    # Set proper ownership and permissions
    LOG_UID=${LOG_UID:-1000}
    LOG_GID=${LOG_GID:-1000}
    
    # Validate UID/GID are numeric
    if ! [[ "$LOG_UID" =~ ^[0-9]+$ ]]; then
        echo "Invalid LOG_UID: $LOG_UID, using default 1000"
        LOG_UID=1000
    fi
    if ! [[ "$LOG_GID" =~ ^[0-9]+$ ]]; then
        echo "Invalid LOG_GID: $LOG_GID, using default 1000"
        LOG_GID=1000
    fi
    
    chown -R ${LOG_UID}:${LOG_GID} /var/log/spheroseg/
    chmod -R 755 /var/log/spheroseg/
    
    if id "nginx" &>/dev/null; then
        chown -R nginx:nginx /var/log/nginx/
    fi
    
    echo "Log directories created successfully."
}

# Install logrotate if not present
install_logrotate() {
    if ! command -v logrotate &> /dev/null; then
        echo "Installing logrotate..."
        if command -v apt-get &> /dev/null; then
            apt-get update && apt-get install -y logrotate
        elif command -v yum &> /dev/null; then
            yum install -y logrotate
        elif command -v apk &> /dev/null; then
            apk add --no-cache logrotate
        else
            echo "Error: Package manager not found. Please install logrotate manually."
            exit 1
        fi
    fi
}

# Setup cron job for log rotation
setup_cron() {
    echo "Setting up cron job for log rotation..."
    
    # Create logrotate state directory
    mkdir -p /var/lib/logrotate
    
    # Create cron job that runs hourly
    cat > /etc/cron.d/spheroseg-logrotate << 'EOF'
# SpheroSeg log rotation - runs every hour
0 * * * * root /usr/sbin/logrotate -s /var/lib/logrotate/status /etc/logrotate.conf
EOF
    
    chmod 644 /etc/cron.d/spheroseg-logrotate
    
    # Start cron if not running
    cron_started=false
    
    if command -v service &> /dev/null; then
        if service cron start 2>/dev/null; then
            echo "Started cron service"
            cron_started=true
        elif service crond start 2>/dev/null; then
            echo "Started crond service"
            cron_started=true
        fi
    fi
    
    if [ "$cron_started" = false ] && command -v systemctl &> /dev/null; then
        if systemctl start cron 2>/dev/null; then
            echo "Started cron via systemctl"
            cron_started=true
        elif systemctl start crond 2>/dev/null; then
            echo "Started crond via systemctl"
            cron_started=true
        fi
    fi
    
    if [ "$cron_started" = false ]; then
        # Try direct cron daemon start
        if cron 2>/dev/null; then
            echo "Started cron directly"
            cron_started=true
        elif crond 2>/dev/null; then
            echo "Started crond directly"
            cron_started=true
        fi
    fi
    
    # Verify cron is actually running
    if [ "$cron_started" = true ]; then
        sleep 1
        if pgrep -x cron >/dev/null 2>&1 || pgrep -x crond >/dev/null 2>&1; then
            echo "Cron daemon verified as running"
        else
            echo "Error: Cron daemon failed to start properly"
            exit 1
        fi
    else
        echo "Error: Could not start cron daemon"
        exit 1
    fi
    
    echo "Cron job setup completed."
}

# Test logrotate configuration
test_config() {
    echo "Testing logrotate configuration..."
    
    # Test with a temporary state file (debug mode only, no actual rotation)
    if logrotate -d --state /tmp/logrotate.state /etc/logrotate.conf 2>&1; then
        echo "Logrotate configuration is valid."
        rm -f /tmp/logrotate.state
        return 0
    else
        echo "Error: Logrotate configuration test failed."
        rm -f /tmp/logrotate.state
        exit 1
    fi
}

# Main execution
main() {
    echo "Starting log rotation setup..."
    
    create_log_dirs
    install_logrotate
    setup_cron
    test_config
    
    echo "Log rotation setup completed successfully!"
    echo "Logs will be rotated daily and kept for 30 days."
}

# Execute main function
main "$@"