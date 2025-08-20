#!/bin/bash
# Docker entrypoint script for logrotate service

set -e

echo "Starting SpheroSeg logrotate service..."

# Function to handle shutdown
shutdown() {
    echo "Shutting down logrotate service..."
    exit 0
}

# Trap signals
trap shutdown SIGTERM SIGINT

# Initialize log rotation setup
if [ -f "/usr/local/bin/setup-log-rotation.sh" ]; then
    echo "Running initial log rotation setup..."
    /usr/local/bin/setup-log-rotation.sh
fi

# Function to run logrotate
run_logrotate() {
    echo "Running logrotate at $(date)"
    
    # Run logrotate with verbose output
    if /usr/sbin/logrotate -v /etc/logrotate.conf; then
        echo "Logrotate completed successfully at $(date)"
    else
        echo "Warning: Logrotate completed with errors at $(date)"
    fi
    
    # Log some statistics
    echo "Current log directory sizes:"
    du -sh /var/log/spheroseg/* 2>/dev/null || true
    du -sh /var/log/nginx/* 2>/dev/null || true
}

# Main loop - run logrotate every hour
echo "Starting logrotate daemon (runs every hour)..."
while true; do
    run_logrotate
    
    # Sleep for 1 hour (3600 seconds)
    sleep 3600 &
    wait $!
done