# HTTP 413 "Payload Too Large" Upload Error Solution

## Problem Summary

- **Issue**: Users uploading 123 files experienced HTTP 413 errors during chunked uploads
- **Symptoms**: Chunked upload split into 2 chunks: 100 files (failed with HTTP 413) + 23 files (succeeded)
- **Result**: Only 23 successful uploads out of 123 total files

## Root Cause Analysis

- **Primary Issue**: nginx `client_max_body_size` limit set to 100M (insufficient for large batches)
- **Backend Configuration**: Properly configured for 500M uploads
- **Actual Payload Size**: ~165MB for 100 files (100 files × 1.5MB average + FormData overhead)
- **Configuration Mismatch**: nginx limit (100M) < backend expectation (500M)

## Technical Details

### Upload Limit Hierarchy

```
nginx: client_max_body_size (was 100M, now 500M)
  ↓
Express: bodyParser limit (50MB for JSON/URL-encoded)
  ↓
Multer: fileSize and file count limits (100 files max per chunk)
```

### Chunk Size Calculation

- **Files per chunk**: 100 files
- **Average file size**: ~1.5MB
- **FormData overhead**: ~15MB (metadata, boundaries, encoding)
- **Total chunk payload**: ~165MB

## Solution Implemented

### 1. Environment Variable Configuration

**File**: `.env.common`

```bash
# Added/Updated
NGINX_BODY_LIMIT=500M
```

### 2. Environment Switch Script Enhancement

**File**: `scripts/switch-environment.sh`

```bash
# Added export for nginx configuration
export NGINX_BODY_LIMIT
```

### 3. Nginx Template Configuration

**File**: `docker/nginx/nginx.template.conf`

```nginx
# Global setting
client_max_body_size ${NGINX_BODY_LIMIT};

# Specific upload location
location /api/images/upload {
    client_max_body_size ${NGINX_BODY_LIMIT};
    # ... other settings
}
```

### 4. Configuration Regeneration

```bash
# Regenerate nginx configuration from template
./scripts/switch-environment.sh blue

# Reload nginx without downtime
docker exec nginx-main nginx -s reload
```

## Verification Steps

### 1. Check nginx Configuration

```bash
# Verify generated configuration
grep "client_max_body_size" docker/nginx/nginx.blue.conf
# Should show: client_max_body_size 500M;
```

### 2. Test Upload Endpoint

```bash
# Test without files (should return 401 auth, not 413 payload)
curl -X POST http://localhost/api/images/upload
# Expected: 401 Unauthorized (not 413 Payload Too Large)
```

### 3. Configuration Synchronization Check

- nginx: `client_max_body_size 500M` ✓
- Backend: Express/Multer properly configured for large uploads ✓
- Environment variables: Properly exported and templated ✓

## Key Files Modified

1. `/home/cvat/cell-segmentation-hub/.env.common` - Added NGINX_BODY_LIMIT
2. `/home/cvat/cell-segmentation-hub/scripts/switch-environment.sh` - Export NGINX_BODY_LIMIT
3. `/home/cvat/cell-segmentation-hub/docker/nginx/nginx.template.conf` - Use ${NGINX_BODY_LIMIT}
4. `/home/cvat/cell-segmentation-hub/docker/nginx/nginx.blue.conf` - Generated with 500M limit

## Prevention Strategy

### 1. Template-Based Configuration

- Use environment variables in nginx templates
- Single Source of Truth (SSOT) approach via `.env.common`
- Automatic synchronization between nginx and backend limits

### 2. Testing Protocol

- Test with realistic file counts (100+ files) during deployment
- Verify upload limits match across entire stack
- Monitor nginx error logs for 413 errors

### 3. Monitoring

```bash
# Watch for 413 errors in nginx logs
docker logs nginx-main | grep "413"

# Monitor upload success rates
# Check backend logs for upload processing
```

## Environment Variables Reference

```bash
# In .env.common
NGINX_BODY_LIMIT=500M          # nginx client_max_body_size
UPLOAD_MAX_FILE_SIZE=50MB      # Backend multer fileSize limit
UPLOAD_MAX_FILES=100           # Backend multer files limit per chunk
```

## Related Configuration Files

- `docker/nginx/nginx.template.conf` - Master template
- `docker/nginx/nginx.blue.conf` - Generated blue environment config
- `docker/nginx/nginx.green.conf` - Generated green environment config
- `scripts/switch-environment.sh` - Environment switching and config generation
- `.env.common` - Shared environment variables

## Blue-Green Deployment Notes

- Configuration changes require regeneration of nginx configs for both environments
- Use `./scripts/switch-environment.sh [blue|green]` to regenerate configurations
- Nginx reload is non-disruptive: `docker exec nginx-main nginx -s reload`

## Troubleshooting

1. **Still getting 413 errors**: Check if nginx config was properly regenerated
2. **Upload fails with different error**: Verify backend multer configuration
3. **Configuration not taking effect**: Ensure nginx reload was executed
4. **Environment mismatch**: Verify active environment with `cat .active-environment`
