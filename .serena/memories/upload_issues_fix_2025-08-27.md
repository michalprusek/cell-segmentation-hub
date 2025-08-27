# Image Upload Issues Fix - August 27, 2025

## Problem Description

Users reported images were not uploading properly and getting stuck on the upload screen with multiple errors:

1. **Timeout Error**: `timeout of 60000ms exceeded` - uploads timing out after 60 seconds
2. **Blob URL Errors**: Multiple `ERR_FILE_NOT_FOUND` for blob URLs
3. **TypeError**: `Cannot read properties of undefined (reading 'length')` when fetching shared projects

## Root Causes

### 1. Upload Timeout (60 seconds)

- Frontend had 60-second timeout in `src/lib/api.ts`
- Nginx proxy had 60-second timeout for `/api/` routes
- Large image files couldn't upload in time

### 2. Missing Upload Directories

- Green environment (`backend/uploads/green/`) directories didn't exist
- Parent directory owned by root, preventing container from creating subdirectories
- Volume mount pointing to non-existent directories

### 3. Shared Projects Response Format

- Backend returns array wrapped in response object
- Frontend expected plain array, causing TypeError
- Hook didn't handle different response formats properly

## Solutions Implemented

### 1. Increased Upload Timeouts

**File**: `src/lib/api.ts`

- Changed upload timeout from 60000ms to 300000ms (5 minutes)

**File**: `docker/nginx/nginx.prod.conf`

- Updated proxy timeouts for `/api/` location:
  - `proxy_send_timeout 300s` (was 60s)
  - `proxy_read_timeout 300s` (was 60s)

### 2. Fixed Shared Projects Response Handling

**File**: `src/hooks/useDashboardProjects.ts`

- Added proper response format handling:

```typescript
if (Array.isArray(response)) {
  sharedResponse = response;
} else if (response && typeof response === 'object') {
  sharedResponse = response.data || response.projects || [];
}
```

### 3. Created Upload Directories Script

**File**: `scripts/apply-upload-fixes.sh`

- Creates missing directories with proper permissions
- Rebuilds frontend with fixes
- Deploys to container
- Reloads nginx configuration

## Deployment Instructions

To apply these fixes to production:

```bash
# Run the fix script
./scripts/apply-upload-fixes.sh
```

This script will:

1. Create upload directories with UID 1001 permissions
2. Build frontend with timeout fixes
3. Deploy to Green container
4. Reload nginx configuration

## Verification

After applying fixes:

1. Try uploading a large image (>10MB)
2. Check that upload completes without timeout
3. Verify shared projects load without errors
4. Check that image previews display correctly

## Prevention

For future deployments:

1. Always ensure upload directories exist before starting containers
2. Use consistent timeout values across stack (frontend, nginx, backend)
3. Test with large files during QA
4. Include directory creation in deployment scripts
