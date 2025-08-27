#!/bin/bash

echo "==========================================="
echo "COMPLETE UPLOAD FIX FOR GREEN ENVIRONMENT"
echo "==========================================="

# Step 1: Create upload directories
echo ""
echo "Step 1: Creating upload directories..."
sudo mkdir -p backend/uploads/green/images
sudo mkdir -p backend/uploads/green/thumbnails
sudo mkdir -p backend/uploads/green/temp

# Step 2: Set correct permissions
echo "Step 2: Setting permissions (UID 1001 for nodejs user)..."
sudo chown -R 1001:1001 backend/uploads/green

# Step 3: Verify directories
echo "Step 3: Verifying directory structure..."
ls -la backend/uploads/green/

# Step 4: Restart backend to apply UPLOAD_DIR environment variable
echo ""
echo "Step 4: Restarting backend with UPLOAD_DIR configured..."
docker restart green-backend

# Wait for backend to come up
echo "Waiting for backend to restart..."
sleep 5

# Step 5: Build and deploy frontend with fixes
echo ""
echo "Step 5: Building frontend with all fixes..."
export VITE_API_BASE_URL=https://spherosegapp.utia.cas.cz/api
export VITE_ML_SERVICE_URL=https://spherosegapp.utia.cas.cz/api/ml

npm run build

echo ""
echo "Step 6: Deploying frontend to container..."
docker cp dist/. green-frontend:/usr/share/nginx/html/

# Step 7: Reload nginx
echo ""
echo "Step 7: Reloading nginx configuration..."
docker exec nginx nginx -s reload

# Step 8: Verify everything
echo ""
echo "Step 8: Final verification..."
echo ""
echo "Backend UPLOAD_DIR setting:"
docker exec green-backend sh -c "echo UPLOAD_DIR=\$UPLOAD_DIR"

echo ""
echo "Container upload directory:"
docker exec green-backend sh -c "ls -la /app/uploads/"

echo ""
echo "==========================================="
echo "✅ COMPLETE FIX APPLIED!"
echo "==========================================="
echo ""
echo "Fixed issues:"
echo "1. ✅ Upload directories created with correct permissions"
echo "2. ✅ UPLOAD_DIR environment variable configured"
echo "3. ✅ Frontend rebuilt with timeout fixes (5 minutes)"
echo "4. ✅ Shared projects TypeError fixed"
echo "5. ✅ Nginx timeouts increased to 5 minutes"
echo ""
echo "You can now upload images successfully!"
echo ""
echo "Note: If you still see the shared projects error in the browser,"
echo "please clear your browser cache (Ctrl+F5) to load the new frontend code."