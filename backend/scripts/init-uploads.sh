#!/bin/bash
# This script runs inside the Docker container to ensure proper directory structure

UPLOAD_DIR=${UPLOAD_DIR:-/app/uploads}

echo "Initializing upload directories in container..."
mkdir -p "$UPLOAD_DIR/images"
mkdir -p "$UPLOAD_DIR/thumbnails" 
mkdir -p "$UPLOAD_DIR/temp"
mkdir -p "$UPLOAD_DIR/avatars"
mkdir -p "$UPLOAD_DIR/converted"

# Set proper permissions
chmod -R 755 "$UPLOAD_DIR"

echo "Upload directories initialized:"
ls -la "$UPLOAD_DIR"
