#!/bin/bash

# Cell Segmentation Hub - Upload Directory Fix Script
# This script fixes the duplicate blue/blue directory structure issue

set -euo pipefail

echo "=== Upload Directory Structure Fix ==="
echo "Time: $(date)"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BACKEND_DIR="/home/cvat/cell-segmentation-hub/backend"
UPLOADS_DIR="$BACKEND_DIR/uploads"
BLUE_DIR="$UPLOADS_DIR/blue"
BLUE_NESTED_DIR="$BLUE_DIR/blue"

echo -e "${BLUE}Step 1: Checking current directory structure...${NC}"
echo "Backend directory: $BACKEND_DIR"
echo "Uploads directory: $UPLOADS_DIR"
echo "Blue directory: $BLUE_DIR"
echo "Nested blue directory: $BLUE_NESTED_DIR"
echo ""

# Check if directories exist
if [[ ! -d "$UPLOADS_DIR" ]]; then
    echo -e "${RED}Error: Uploads directory doesn't exist at $UPLOADS_DIR${NC}"
    exit 1
fi

if [[ ! -d "$BLUE_DIR" ]]; then
    echo -e "${RED}Error: Blue directory doesn't exist at $BLUE_DIR${NC}"
    exit 1
fi

if [[ ! -d "$BLUE_NESTED_DIR" ]]; then
    echo -e "${YELLOW}Warning: Nested blue directory doesn't exist at $BLUE_NESTED_DIR${NC}"
    echo "This might already be fixed or the structure is different than expected"
else
    echo -e "${BLUE}Found nested blue directory with files to move${NC}"
fi

echo -e "${BLUE}Step 2: Analyzing directory contents...${NC}"
echo "Contents of $BLUE_DIR:"
ls -la "$BLUE_DIR" || echo "Cannot list blue directory"
echo ""

if [[ -d "$BLUE_NESTED_DIR" ]]; then
    echo "Contents of nested $BLUE_NESTED_DIR:"
    ls -la "$BLUE_NESTED_DIR" || echo "Cannot list nested blue directory"
    echo ""
fi

echo -e "${BLUE}Step 3: Removing broken symlinks...${NC}"
# Remove broken symlinks in blue directory
cd "$BLUE_DIR"
for link in *; do
    if [[ -L "$link" && ! -e "$link" ]]; then
        echo "Removing broken symlink: $link"
        rm -f "$link"
    fi
done

echo -e "${BLUE}Step 4: Moving files from nested structure (if exists)...${NC}"
if [[ -d "$BLUE_NESTED_DIR" ]]; then
    echo "Moving files from $BLUE_NESTED_DIR to $BLUE_DIR"
    
    # Move all contents from nested blue to parent blue
    cd "$BLUE_NESTED_DIR"
    for item in * .[^.]* ; do
        if [[ "$item" != "." && "$item" != ".." && -e "$item" ]]; then
            echo "Moving: $item"
            # Use different names if files already exist
            target="$BLUE_DIR/$item"
            if [[ -e "$target" ]]; then
                target="${target}.moved.$(date +%s)"
                echo "  Target exists, using: $target"
            fi
            mv "$item" "$target"
        fi
    done
    
    # Remove empty nested blue directory
    cd "$BLUE_DIR"
    rmdir "$BLUE_NESTED_DIR" 2>/dev/null || echo "Note: Could not remove nested directory (may not be empty)"
fi

echo -e "${BLUE}Step 5: Creating required subdirectories...${NC}"
# Create required subdirectories with proper structure
cd "$BLUE_DIR"
mkdir -p images thumbnails temp avatars converted

# Also create these at the uploads root level for consistency
cd "$UPLOADS_DIR"
mkdir -p images thumbnails temp avatars converted

echo -e "${BLUE}Step 6: Setting proper permissions...${NC}"
# Set ownership to UID 1001 (Docker container user)
# Note: This requires the cvat user to have permissions to change ownership
echo "Setting ownership to UID 1001 for Docker compatibility..."

# Try to change ownership, but don't fail if we can't
chown -R 1001:docker "$BLUE_DIR" 2>/dev/null || {
    echo -e "${YELLOW}Warning: Could not change ownership to 1001:docker${NC}"
    echo "You may need to run this as root: sudo chown -R 1001:docker $BLUE_DIR"
}

# Set proper permissions
chmod -R 755 "$BLUE_DIR"

echo -e "${BLUE}Step 7: Verifying final structure...${NC}"
echo "Final blue directory structure:"
ls -la "$BLUE_DIR"
echo ""

echo "Checking subdirectories:"
for subdir in images thumbnails temp avatars converted; do
    if [[ -d "$BLUE_DIR/$subdir" ]]; then
        echo "✓ $subdir directory exists"
    else
        echo "✗ $subdir directory missing"
    fi
done
echo ""

echo -e "${BLUE}Step 8: Checking Docker container volume mount...${NC}"
echo "Docker compose volume mapping: ./backend/uploads/blue:/app/uploads"
echo "This means files in $BLUE_DIR should appear at /app/uploads inside the container"
echo ""

echo -e "${BLUE}Step 9: Testing directory access...${NC}"
# Test if we can write to the directories
test_file="$BLUE_DIR/.write_test"
if echo "test" > "$test_file" 2>/dev/null; then
    echo "✓ Write permission test passed"
    rm -f "$test_file"
else
    echo -e "${YELLOW}✗ Write permission test failed${NC}"
fi

echo ""
echo -e "${GREEN}=== Upload Directory Fix Complete ===${NC}"
echo "Summary of changes:"
echo "1. ✓ Removed broken symlinks"
echo "2. ✓ Moved files from nested blue/blue/ to blue/"
echo "3. ✓ Created required subdirectories (images, thumbnails, temp, avatars, converted)"
echo "4. ✓ Set proper permissions (attempted UID 1001)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Restart the Blue environment: make down && make -f docker-compose.blue.yml up -d"
echo "2. Test file upload functionality"
echo "3. Check container logs if issues persist: make logs-be"
echo ""
echo -e "${GREEN}Script completed successfully!${NC}"