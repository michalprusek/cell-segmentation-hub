#!/bin/bash

# Install Automatic Cleanup Service
# This script installs and enables the daily disk cleanup service

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "===== Installing Automatic Disk Cleanup Service ====="
echo

# Check if running with sudo
if [ "$EUID" -ne 0 ]; then 
    echo "Please run with sudo: sudo $0"
    exit 1
fi

# Copy service files to systemd directory
echo "1. Installing systemd service files..."
cp "$SCRIPT_DIR/disk-cleanup.service" /etc/systemd/system/
cp "$SCRIPT_DIR/disk-cleanup.timer" /etc/systemd/system/

# Reload systemd daemon
echo "2. Reloading systemd daemon..."
systemctl daemon-reload

# Enable timer (but don't start it yet)
echo "3. Enabling cleanup timer..."
systemctl enable disk-cleanup.timer

# Create log file with proper permissions
echo "4. Creating log file..."
touch /var/log/auto-cleanup.log
chown cvat:cvat /var/log/auto-cleanup.log
chmod 644 /var/log/auto-cleanup.log

# Test the cleanup script (dry run)
echo "5. Testing cleanup script..."
echo "Running test cleanup (this won't affect your system)..."
if sudo -u cvat "$SCRIPT_DIR/auto-cleanup-disk.sh"; then
    echo "✓ Cleanup script test successful"
else
    echo "✗ Cleanup script test failed. Please check the script."
    exit 1
fi

# Start the timer
echo "6. Starting cleanup timer..."
systemctl start disk-cleanup.timer

# Show status
echo
echo "===== Installation Complete ====="
echo
echo "Status:"
systemctl status disk-cleanup.timer --no-pager

echo
echo "Next scheduled cleanup:"
systemctl list-timers disk-cleanup.timer --no-pager

echo
echo "===== Available Commands ====="
echo "Check status:     $SCRIPT_DIR/check-cleanup-status.sh"
echo "View logs:        sudo journalctl -u disk-cleanup.service -f"
echo "Run now:          sudo systemctl start disk-cleanup.service"
echo "Disable:          sudo systemctl disable disk-cleanup.timer"
echo "Re-enable:        sudo systemctl enable disk-cleanup.timer"
echo
echo "The cleanup service will run daily at 3:00 AM."
echo "It will automatically clean Docker cache, old containers, and temp files."
echo