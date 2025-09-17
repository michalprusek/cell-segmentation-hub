#!/bin/bash

# Cell Segmentation Hub - Safe Upload Directory Fix Script
# This script fixes the duplicate blue/blue directory structure using Docker volume remapping

set -euo pipefail

echo "=== Safe Upload Directory Structure Fix ==="
echo "Time: $(date)"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="/home/cvat/spheroseg-app"
BACKEND_DIR="$PROJECT_ROOT/backend"
UPLOADS_DIR="$BACKEND_DIR/uploads"
BLUE_DIR="$UPLOADS_DIR/blue"
BLUE_NESTED_DIR="$BLUE_DIR/blue"

echo -e "${BLUE}Problem Analysis:${NC}"
echo "Current structure: uploads/blue/blue/ (nested)"
echo "Docker mapping: ./backend/uploads/blue:/app/uploads"
echo "Container expects: /app/uploads (direct access)"
echo "But files are at: /app/uploads/blue (nested)"
echo ""

echo -e "${BLUE}Solution: Update Docker volume mapping to point to nested directory${NC}"
echo "Change mapping from: ./backend/uploads/blue:/app/uploads"
echo "                 to: ./backend/uploads/blue/blue:/app/uploads"
echo ""

# Check if nested directory exists
if [[ ! -d "$BLUE_NESTED_DIR" ]]; then
    echo -e "${RED}Error: Nested blue directory doesn't exist at $BLUE_NESTED_DIR${NC}"
    echo "The directory structure might be different than expected"
    exit 1
fi

echo -e "${BLUE}Step 1: Backing up docker-compose.blue.yml${NC}"
cd "$PROJECT_ROOT"
cp docker-compose.blue.yml docker-compose.blue.yml.backup.$(date +%Y%m%d_%H%M%S)
echo "✓ Backup created"

echo -e "${BLUE}Step 2: Updating Docker volume mapping${NC}"
# Update the volume mapping to point to the nested blue directory
sed -i 's|./backend/uploads/blue:/app/uploads|./backend/uploads/blue/blue:/app/uploads|g' docker-compose.blue.yml

# Also update ML service volume mapping
sed -i 's|./backend/uploads/blue:/app/uploads|./backend/uploads/blue/blue:/app/uploads|g' docker-compose.blue.yml

echo "✓ Updated volume mappings in docker-compose.blue.yml"

echo -e "${BLUE}Step 3: Verifying the change${NC}"
echo "New volume mappings:"
grep -n "uploads.*:/app/uploads" docker-compose.blue.yml || echo "No matches found"

echo -e "${BLUE}Step 4: Ensuring directory permissions for Docker${NC}"
# Create an initialization script that will be run by the container
cat > "$BACKEND_DIR/scripts/init-uploads.sh" << 'EOF'
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
EOF

chmod +x "$BACKEND_DIR/scripts/init-uploads.sh"
echo "✓ Created container initialization script"

echo -e "${BLUE}Step 5: Checking directory contents${NC}"
echo "Files in nested blue directory (what container will see):"
ls -la "$BLUE_NESTED_DIR" | head -10

echo -e "${BLUE}Step 6: Creating restart instructions${NC}"
cat << EOF

${GREEN}=== Fix Applied Successfully ===${NC}

${YELLOW}Next Steps:${NC}

1. Stop the current Blue environment:
   cd /home/cvat/spheroseg-app
   docker-compose -f docker-compose.blue.yml down

2. Start the Blue environment with new mapping:
   docker-compose -f docker-compose.blue.yml up -d

3. Check container logs to verify upload directory access:
   docker logs blue-backend

4. Test file upload functionality in the web interface

${YELLOW}What Changed:${NC}
- Volume mapping updated: ./backend/uploads/blue/blue:/app/uploads
- Container now directly accesses the files instead of looking for them in a nested structure
- Initialization script created to ensure proper directory structure

${YELLOW}Verification Commands:${NC}
- Check container volume: docker exec blue-backend ls -la /app/uploads
- Test upload: Use web interface to upload an image
- View logs: docker logs blue-backend | grep -i upload

EOF

echo -e "${GREEN}Safe fix completed!${NC}"
echo "The Docker volume mapping has been updated to resolve the path issue."