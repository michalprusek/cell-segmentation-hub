#!/bin/bash

echo "========================================="
echo "Fixing Green Upload Directories - IMMEDIATE"
echo "========================================="

# Create the green upload directories on host
echo "Creating upload directories..."
sudo mkdir -p backend/uploads/green/images
sudo mkdir -p backend/uploads/green/thumbnails
sudo mkdir -p backend/uploads/green/temp

# Set ownership to match container's nodejs user (UID 1001)
echo "Setting correct permissions..."
sudo chown -R 1001:1001 backend/uploads/green

# Verify
echo "Verifying directory structure:"
ls -la backend/uploads/green/

# Now the directories exist and container can see them
echo ""
echo "Testing container access..."
docker exec green-backend sh -c "ls -la /app/uploads/ && echo 'Container can access uploads!'"

echo ""
echo "✅ Upload directories fixed! Try uploading again."