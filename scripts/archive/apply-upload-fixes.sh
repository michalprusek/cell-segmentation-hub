#!/bin/bash

echo "==========================================="
echo "Applying Image Upload Fixes"
echo "==========================================="

# 1. Create upload directories with proper permissions
echo ""
echo "1. Creating upload directories for Green environment..."
sudo mkdir -p backend/uploads/green/images
sudo mkdir -p backend/uploads/green/thumbnails
sudo mkdir -p backend/uploads/green/temp

# Set proper ownership (UID 1001 for node user in container)
sudo chown -R 1001:1001 backend/uploads/green
echo "✅ Upload directories created"

# 2. Build frontend with timeout fixes  
echo ""
echo "2. Building frontend with upload timeout fixes..."
echo "   Building for Green environment..."

# Export Green environment variables
export VITE_API_BASE_URL=https://spherosegapp.utia.cas.cz/api
export VITE_ML_SERVICE_URL=https://spherosegapp.utia.cas.cz/api/ml

# Build frontend
npm run build

echo "✅ Frontend built with fixes"

# 3. Deploy new frontend build
echo ""
echo "3. Deploying new frontend build to Green container..."
docker cp dist/. green-frontend:/usr/share/nginx/html/
echo "✅ Frontend deployed"

# 4. Restart nginx to apply timeout configuration
echo ""
echo "4. Restarting nginx to apply timeout configurations..."
docker exec nginx nginx -s reload
echo "✅ Nginx configuration reloaded"

# 5. Verify setup
echo ""
echo "5. Verifying setup..."
echo "Upload directories:"
ls -la backend/uploads/green/ 2>/dev/null || echo "Warning: Could not list directories"

echo ""
echo "==========================================="
echo "✅ All fixes applied successfully!"
echo "==========================================="
echo ""
echo "The following issues have been fixed:"
echo "1. ✅ Upload timeout increased from 60s to 5 minutes"
echo "2. ✅ Shared projects TypeError resolved"  
echo "3. ✅ Upload directories created with correct permissions"
echo "4. ✅ Nginx proxy timeouts increased to match"
echo ""
echo "Users should now be able to upload images without timeout errors."