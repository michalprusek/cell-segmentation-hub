#!/bin/bash
# Install and start auto-deploy script as background process with nohup

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
AUTO_DEPLOY_SCRIPT="$SCRIPT_DIR/auto-deploy-staging.sh"
LOG_FILE="/home/cvat/cell-segmentation-hub/auto-deploy.log"
PID_FILE="/home/cvat/cell-segmentation-hub/auto-deploy.pid"

echo "📦 Installing staging auto-deploy..."

# Check if auto-deploy script exists
if [ ! -f "$AUTO_DEPLOY_SCRIPT" ]; then
    echo "❌ auto-deploy-staging.sh not found!"
    exit 1
fi

# Check if already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo "⚠️  Auto-deploy is already running (PID: $OLD_PID)"
        echo "Do you want to restart it? (y/n)"
        read -r response
        if [ "$response" = "y" ]; then
            echo "Stopping old process..."
            kill "$OLD_PID" 2>/dev/null || true
            sleep 2
        else
            echo "Keeping existing process."
            exit 0
        fi
    fi
fi

# Create log file if it doesn't exist
touch "$LOG_FILE"

# Start auto-deploy with nohup
echo "🚀 Starting auto-deploy script..."
nohup "$AUTO_DEPLOY_SCRIPT" > "$LOG_FILE" 2>&1 &
NEW_PID=$!

# Save PID
echo $NEW_PID > "$PID_FILE"

# Wait a moment to check if it started successfully
sleep 2

# Check if process is running
if ps -p "$NEW_PID" > /dev/null; then
    echo "✅ Auto-deploy started successfully!"
    echo ""
    echo "📋 Auto-deploy info:"
    echo "  PID:        $NEW_PID"
    echo "  Log file:   $LOG_FILE"
    echo "  PID file:   $PID_FILE"
    echo ""
    echo "📝 Useful commands:"
    echo "  View logs:      tail -f $LOG_FILE"
    echo "  Check status:   ps -p \$(cat $PID_FILE)"
    echo "  Stop:           kill \$(cat $PID_FILE)"
    echo "  Restart:        $0"
    echo ""
    echo "🔄 Auto-deploy is monitoring staging branch every 30 seconds"
    echo "📦 Any push to staging will be automatically deployed!"
else
    echo "❌ Failed to start auto-deploy"
    echo "Check log file: $LOG_FILE"
    exit 1
fi