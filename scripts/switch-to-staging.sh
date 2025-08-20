#!/bin/bash
# Script to switch nginx from production to staging

set -e

echo "🔄 Switching nginx to staging environment..."

# Backup current nginx config
echo "📦 Backing up current nginx config..."
docker exec spheroseg-nginx cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup

# Copy staging config to nginx container
echo "📋 Applying staging nginx configuration..."
docker cp /home/cvat/cell-segmentation-hub/backend/docker/nginx/nginx.staging.conf spheroseg-nginx:/etc/nginx/nginx.conf

# Test nginx configuration
echo "🧪 Testing nginx configuration..."
if docker exec spheroseg-nginx nginx -t; then
    echo "✅ Configuration test passed"
    
    # Reload nginx
    echo "🔄 Reloading nginx..."
    docker exec spheroseg-nginx nginx -s reload
    
    echo "✅ Successfully switched to STAGING environment!"
    echo ""
    echo "📍 Application is now serving staging content from:"
    echo "   - Frontend: staging-frontend:5173"
    echo "   - Backend:  staging-backend:3001" 
    echo "   - ML:       staging-ml:8000"
    echo ""
    echo "🌐 URL: https://spherosegapp.utia.cas.cz"
    
else
    echo "❌ Configuration test failed! Restoring backup..."
    docker exec spheroseg-nginx cp /etc/nginx/nginx.conf.backup /etc/nginx/nginx.conf
    exit 1
fi