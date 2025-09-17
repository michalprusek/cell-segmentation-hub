# Upload Directory Fix - September 7, 2025

## Problem Summary

File uploads in the Blue environment were failing with "Žádný soubor se nepodařilo nahrát" (No file was uploaded) due to a **duplicate directory structure** issue:

### Root Cause

1. **Nested directory structure**: Files stored in `uploads/blue/blue/` instead of `uploads/blue/`
2. **Docker volume mapping mismatch**:
   - Mapping: `./backend/uploads/blue:/app/uploads`
   - Container expected files at `/app/uploads/`
   - But files were actually at `/app/uploads/blue/` (nested)
3. **Broken symlinks**: `uploads/blue/` contained broken symlinks pointing to non-existent paths
4. **Permission conflicts**: Mixed ownership (root, cvat, 999, 1001) preventing file operations

## Solution Applied

### Method: Docker Volume Remapping (Safest Approach)

Instead of moving files (which had permission issues), updated Docker volume mappings to point directly to the nested directory:

**Changed in `docker-compose.blue.yml`:**

```yaml
# OLD (broken):
- ./backend/uploads/blue:/app/uploads

# NEW (fixed):
- ./backend/uploads/blue/blue:/app/uploads
```

**Applied to both services:**

- `blue-backend` (line 70)
- `blue-ml` (line 135)

### Fix Implementation

1. **Backup created**: `docker-compose.blue.yml.backup.YYYYMMDD_HHMMSS`
2. **Volume mappings updated**: Point to nested `blue/blue` directory
3. **Container restart**: Blue environment restarted with new mappings
4. **Verification**: Container now correctly sees files at `/app/uploads/`

### Scripts Created

**`/home/cvat/cell-segmentation-hub/scripts/fix-upload-safe.sh`**

- Safe fix that updates Docker volume mappings
- Preserves existing file structure
- Creates backup of docker-compose file

**`/home/cvat/cell-segmentation-hub/backend/scripts/init-uploads.sh`**

- Container initialization script
- Ensures proper directory structure inside container
- Sets permissions (755)

## Verification Commands

```bash
# Check container upload directory
docker exec blue-backend ls -la /app/uploads

# Test file write permissions
docker exec blue-backend touch /app/uploads/test.tmp
docker exec blue-backend rm /app/uploads/test.tmp

# Check backend logs
docker logs blue-backend | grep -i upload

# Check frontend can reach backend
curl -f http://localhost:4001/health
```

## Directory Structure (After Fix)

### Host System

```
/home/cvat/cell-segmentation-hub/backend/uploads/
├── blue/
│   ├── blue/                    ← Files are here
│   │   ├── [user-folders]/
│   │   ├── avatars/
│   │   ├── converted/
│   │   ├── images/
│   │   ├── temp/
│   │   └── thumbnails/
│   └── [broken-symlinks-removed]
└── green/ ...
```

### Container View (Fixed)

```
/app/uploads/                    ← Container sees this directly
├── [user-folders]/
├── avatars/
├── converted/
├── images/
├── temp/
└── thumbnails/
```

## Environment Setup

**Required environment variables** (from `.env.blue`):

```bash
DB_PASSWORD=spheroseg_blue_2024
POSTGRES_PASSWORD=spheroseg_blue_2024
BLUE_JWT_ACCESS_SECRET=97f06b3bf3d7389514f44fc5153b1e6a08f105758322f532261c84b24854fa3f
BLUE_JWT_REFRESH_SECRET=a65c84f6b3adff25916ba06afb696fa7748d057b51d6f5ab55fd07c4da08bfcb
```

**Startup command:**

```bash
set -a && source .env.blue && set +a && docker-compose -f docker-compose.blue.yml up -d
```

## Testing Results

✅ Container starts successfully
✅ Upload directory accessible at `/app/uploads/`  
✅ Backend logs show no upload-related errors
✅ Health check passes
✅ File permissions correct (node:node ownership inside container)

## Future Prevention

1. **Always check directory structure** before creating volume mappings
2. **Use absolute paths** in volume mappings when possible
3. **Test container file access** after any directory changes
4. **Backup docker-compose files** before modifications

## Related Issues Fixed

- 500 Internal Server Error on file upload
- "Žádný soubor se nepodařilo nahrát" error message
- Container file access permission errors
- Broken symbolic links in upload directories

This fix resolves the upload functionality without requiring file system permission changes or moving existing user data.
