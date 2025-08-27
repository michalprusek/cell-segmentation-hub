#!/bin/bash

# Check Cleanup Status Script
# Provides information about the automatic cleanup system

set -euo pipefail

echo "===== Disk Cleanup Status ====="
echo

# Check if service is installed
if systemctl list-unit-files 2>/dev/null | grep -q disk-cleanup.service || [ -f /etc/systemd/system/disk-cleanup.service ]; then
    echo "✓ Cleanup service is installed"
    
    # Show service status
    echo
    echo "Service Status:"
    systemctl status disk-cleanup.service --no-pager 2>/dev/null || echo "Service not yet active"
    
    # Show timer status
    echo
    echo "Timer Status:"
    systemctl status disk-cleanup.timer --no-pager 2>/dev/null || echo "Timer not yet active"
    
    # Show next scheduled run
    echo
    echo "Next Scheduled Run:"
    systemctl list-timers disk-cleanup.timer --no-pager 2>/dev/null || echo "Timer not scheduled"
else
    echo "✗ Cleanup service not installed yet"
    echo "  Run: sudo ./scripts/install-cleanup-service.sh"
fi

echo
echo "===== Current Disk Usage ====="
df -h / | grep -E "Filesystem|^/"

echo
echo "===== Docker Disk Usage ====="
docker system df

echo
echo "===== Recent Cleanup Logs ====="
if [ -f /var/log/auto-cleanup.log ]; then
    echo "Last 20 lines from /var/log/auto-cleanup.log:"
    tail -20 /var/log/auto-cleanup.log
else
    echo "No cleanup logs found yet"
fi

echo
echo "===== Manual Cleanup Commands ====="
echo "Run cleanup now:        sudo systemctl start disk-cleanup.service"
echo "Check service logs:     sudo journalctl -u disk-cleanup.service -n 50"
echo "Disable auto-cleanup:   sudo systemctl disable disk-cleanup.timer"
echo "Enable auto-cleanup:    sudo systemctl enable disk-cleanup.timer"
echo