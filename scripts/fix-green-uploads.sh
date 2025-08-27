#!/bin/bash

# Fix Green environment upload directories and permissions

echo "Creating Green environment upload directories..."

# Create directories with proper permissions
sudo mkdir -p backend/uploads/green/images
sudo mkdir -p backend/uploads/green/thumbnails  
sudo mkdir -p backend/uploads/green/temp

# Set proper ownership (UID 1001 for node user in container)
sudo chown -R 1001:1001 backend/uploads/green

echo "Green upload directories created with proper permissions"

# List the directories to verify
echo "Verifying directory structure:"
ls -la backend/uploads/green/