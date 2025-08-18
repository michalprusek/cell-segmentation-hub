#!/bin/bash
# Install and start production auto-deploy script as background process

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
AUTO_DEPLOY_SCRIPT="$SCRIPT_DIR/auto-deploy-production.sh"
LOG_FILE="/home/cvat/cell-segmentation-hub/production-auto-deploy.log"
PID_FILE="/home/cvat/cell-segmentation-hub/production-auto-deploy.pid"

echo "🔴 Installing PRODUCTION auto-deploy..."
echo "⚠️  WARNING: This will auto-deploy to PRODUCTION when main branch changes!"
echo ""
echo "Are you sure you want to enable automatic production deployments? (yes/no)"
read -r response

if [ "$response" != "yes" ]; then
    echo "❌ Installation cancelled"
    exit 0
fi

# Check if auto-deploy script exists
if [ ! -f "$AUTO_DEPLOY_SCRIPT" ]; then
    echo "❌ auto-deploy-production.sh not found!"
    exit 1
fi

# Check if already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo "⚠️  Production auto-deploy is already running (PID: $OLD_PID)"
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
echo "🚀 Starting production auto-deploy script..."
nohup "$AUTO_DEPLOY_SCRIPT" > "$LOG_FILE" 2>&1 &
NEW_PID=$!

# Save PID
echo $NEW_PID > "$PID_FILE"

# Wait a moment to check if it started successfully
sleep 2

# Check if process is running
if ps -p "$NEW_PID" > /dev/null; then
    echo ""
    echo "✅ PRODUCTION auto-deploy started successfully!"
    echo ""
    echo "📋 Production auto-deploy info:"
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
    echo "🔴 PRODUCTION auto-deploy is monitoring main branch every 60 seconds"
    echo "⚠️  Any merge to main will be automatically deployed to PRODUCTION!"
    echo ""
    echo "📋 Production will be available at:"
    echo "  Frontend: http://localhost:3000"
    echo "  Backend API: http://localhost:3001/api"
    echo "  ML Service: http://localhost:8000"
else
    echo "❌ Failed to start production auto-deploy"
    echo "Check log file: $LOG_FILE"
    exit 1
fi