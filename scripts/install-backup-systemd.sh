#!/bin/bash
# Install scripts/spheroseg-backup.{service,timer} as a systemd timer
# that runs daily at 03:30 local time.
#
# Idempotent: re-running just refreshes the unit files in place.
#
# Requires sudo (writes to /etc/systemd/system/). Does NOT modify the
# database; only schedules existing scripts/backup-database.sh.

set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
    echo "Don't run this as root directly — use sudo so the User= field"
    echo "in the service unit stays correct (the unit runs as cvat by default)."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

UNIT_DIR=/etc/systemd/system

echo "Installing systemd units from $SCRIPT_DIR …"

# Replace ${PROJECT_ROOT} placeholder so the unit doesn't depend on the
# install location matching the source tree.
TMP_SERVICE=$(mktemp)
TMP_TIMER=$(mktemp)
trap 'rm -f "$TMP_SERVICE" "$TMP_TIMER"' EXIT

sed "s#/home/cvat/cell-segmentation-hub#$PROJECT_ROOT#g" \
    "$SCRIPT_DIR/spheroseg-backup.service" > "$TMP_SERVICE"
cp "$SCRIPT_DIR/spheroseg-backup.timer" "$TMP_TIMER"

sudo install -m 0644 "$TMP_SERVICE" "$UNIT_DIR/spheroseg-backup.service"
sudo install -m 0644 "$TMP_TIMER"   "$UNIT_DIR/spheroseg-backup.timer"

# Ensure backup directory and log file exist with the right ownership.
sudo install -d -m 0750 -o "$USER" -g "$USER" /home/"$USER"/spheroseg-backups
sudo touch /home/"$USER"/spheroseg-backups/backup.log
sudo chown "$USER:$USER" /home/"$USER"/spheroseg-backups/backup.log
sudo chmod 0640 /home/"$USER"/spheroseg-backups/backup.log

sudo systemctl daemon-reload
sudo systemctl enable --now spheroseg-backup.timer

echo
echo "Installed. Next run:"
sudo systemctl list-timers spheroseg-backup.timer --no-pager | head -5
echo
echo "Run a backup right now (won't wait for the timer):"
echo "    sudo systemctl start spheroseg-backup.service"
echo
echo "View logs:"
echo "    journalctl -u spheroseg-backup.service -n 50"
echo "    tail -f /home/$USER/spheroseg-backups/backup.log"
