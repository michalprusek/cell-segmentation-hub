# Automatic Disk Cleanup System

## Overview

An automated disk cleanup system has been implemented to prevent disk space issues on the server. The system runs daily at 3:00 AM UTC and performs safe, conservative cleanup operations.

## What Gets Cleaned

The cleanup script performs the following operations in order of safety:

### Always Cleaned (Safe Operations)

1. **Docker build cache** - Removes build cache older than 24 hours
2. **Stopped containers** - Removes containers stopped for more than 7 days
3. **Dangling images** - Removes untagged Docker images
4. **Unused networks** - Removes Docker networks not in use
5. **Old log files** - Truncates logs older than 7 days
6. **Temporary files** - Removes /tmp files older than 7 days

### Conditionally Cleaned (When disk < 50GB free)

7. **NPM cache** - Clears Node.js package cache
8. **Pip cache** - Clears Python package cache

## Safety Features

- **Conservative approach**: Only removes truly unnecessary items
- **Age-based filtering**: Keeps recent items (7-day retention)
- **Production protection**: Never touches running containers or their images
- **Comprehensive logging**: All operations logged to `/var/log/auto-cleanup.log`
- **Space monitoring**: Alerts if disk remains low after cleanup

## Installation Status

✅ **Service installed and active**

- Next scheduled run: Daily at 03:00 UTC
- Service: `disk-cleanup.service`
- Timer: `disk-cleanup.timer`

## Manual Operations

### Check Status

```bash
# View cleanup system status
./scripts/check-cleanup-status.sh

# Check timer schedule
sudo systemctl list-timers disk-cleanup.timer

# View service logs
sudo journalctl -u disk-cleanup.service -n 50
```

### Manual Cleanup

```bash
# Run cleanup immediately
sudo systemctl start disk-cleanup.service

# Or run script directly
./scripts/auto-cleanup-disk.sh
```

### Control Service

```bash
# Disable automatic cleanup
sudo systemctl disable disk-cleanup.timer
sudo systemctl stop disk-cleanup.timer

# Re-enable automatic cleanup
sudo systemctl enable disk-cleanup.timer
sudo systemctl start disk-cleanup.timer
```

## Configuration

Edit `/home/cvat/spheroseg-app/scripts/auto-cleanup-disk.sh` to adjust:

- `MIN_FREE_SPACE_GB=50` - Minimum free space threshold
- `CLEANUP_AGE_DAYS=7` - Age of items to clean

## Monitoring

Cleanup logs are stored in:

- System logs: `journalctl -u disk-cleanup.service`
- Application log: `/var/log/auto-cleanup.log`

## Troubleshooting

### Service not running

```bash
sudo systemctl status disk-cleanup.timer
sudo systemctl restart disk-cleanup.timer
```

### Cleanup not working

```bash
# Check for errors
sudo journalctl -u disk-cleanup.service -p err

# Test script manually
./scripts/auto-cleanup-disk.sh
```

### Reinstall service

```bash
sudo ./scripts/install-cleanup-service.sh
```

## Results from Today's Cleanup

- **Initial state**: Disk 100% full (237GB/250GB)
- **Space recovered**: ~118GB
- **Final state**: Disk 49% used (116GB/250GB)
- **Automatic cleanup**: Enabled for daily maintenance

## Important Notes

- The cleanup service runs with limited permissions for safety
- Production (green) environment is always protected
- Manual intervention may be needed if disk usage exceeds 200GB
- Consider archiving old projects if disk usage remains high
