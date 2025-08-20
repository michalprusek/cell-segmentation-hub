#!/bin/bash
# Script to switch nginx back to production

set -e

echo "🔄 Switching nginx back to production environment..."

# Restore production config
echo "📋 Restoring production nginx configuration..."
if docker exec spheroseg-nginx test -f /etc/nginx/nginx.conf.backup; then
    docker exec spheroseg-nginx cp /etc/nginx/nginx.conf.backup /etc/nginx/nginx.conf
else
    echo "⚠️  Backup not found, using original production config..."
    docker cp /home/cvat/cell-segmentation-hub/backend/docker/nginx/nginx.conf spheroseg-nginx:/etc/nginx/nginx.conf
fi

# Test nginx configuration
echo "🧪 Testing nginx configuration..."
if docker exec spheroseg-nginx nginx -t; then
    echo "✅ Configuration test passed"
    
    # Reload nginx
    echo "🔄 Reloading nginx..."
    docker exec spheroseg-nginx nginx -s reload
    
    echo "✅ Successfully switched back to PRODUCTION environment!"
    echo ""
    echo "📍 Application is now serving production content from:"
    echo "   - Frontend: frontend:5173"
    echo "   - Backend:  backend:3001"
    echo "   - ML:       ml-service:8000"
    echo ""
    echo "🌐 URL: https://spherosegapp.utia.cas.cz"
    
else
    echo "❌ Configuration test failed!"
    exit 1
fi