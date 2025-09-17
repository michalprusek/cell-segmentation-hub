# Upload Directory 404 and Batch API Fix - September 7, 2025

## Issues Identified

### 1. Upload Directory 404 Errors

**Problem**: Thumbnails returning 404 errors in production

- Path: `/uploads/{userId}/{projectId}/thumbnails/*.jpg`
- Example: `/uploads/dfd53950-e01e-41e5-8852-c5affa4aadd4/9ce96986-aacd-4dd7-80dc-ee575beeb832/thumbnails/1757259691265_f5_75.jpg`

**Root Cause**: Double-nested directory structure `blue/blue` in Docker volume mapping

- Docker compose had: `./backend/uploads/blue/blue:/app/uploads`
- Created path mismatch where files couldn't be found

### 2. Batch API Validation Error

**Problem**: POST `/api/queue/batch` returning 400 Bad Request

**Root Cause**: Client sending incorrectly formatted request

- API validation working correctly
- Frontend needs to send proper format

**Required Format**:

```json
{
  "imageIds": ["uuid1", "uuid2"],  // Required: Array of 1-100 UUIDs
  "projectId": "uuid",             // Required: Valid UUID
  "model": "hrnet|cbam_resunet",   // Optional: Exact values only
  "threshold": 0.1-0.9,            // Optional: Float
  "priority": 0-10,                // Optional: Integer
  "forceResegment": true|false,    // Optional: Boolean
  "detectHoles": true|false        // Optional: Boolean
}
```

## Solutions Applied

### Upload Directory Fix

1. **Fixed Docker Volume Mapping**:
   - File: `/home/cvat/spheroseg-app/docker-compose.blue.yml`
   - Line 73: Changed from `./backend/uploads/blue/blue:/app/uploads`
   - Changed to: `./backend/uploads/blue:/app/uploads`

2. **Directory Structure**:
   - Files currently in nested `blue/blue` structure
   - Need to restructure: Move files from `blue/blue/*` to `blue/*`
   - Symbolic links present causing complications

3. **Container Recreation**:
   ```bash
   export BLUE_JWT_ACCESS_SECRET=supersecretaccesstokenatleast32chars
   export BLUE_JWT_REFRESH_SECRET=supersecretrefreshtokenatleast32chars
   export DB_PASSWORD=spheroseg_blue_2024
   docker compose -f docker-compose.blue.yml up -d blue-backend
   ```

### Batch API Fix

No code changes needed - API validation is working correctly.
Frontend needs to:

1. Ensure `imageIds` is an array of valid UUIDs
2. Include required `projectId` field
3. Use exact model names: `'hrnet'` or `'cbam_resunet'`
4. Validate array length (1-100 items)

## SSOT Violations Found

1. **Volume Path Inconsistency**:
   - Blue uses `blue/blue` nested structure
   - Green uses flat `green` structure
   - Should standardize to `./backend/uploads/{environment}:/app/uploads`

2. **Nginx Upload Routing Duplication**:
   - Three different nginx configs with different patterns
   - Should create single template with environment variables

3. **Directory Initialization**:
   - Shell script and TypeScript have different directory lists
   - Should sync required directories

## File Permissions

Required for Docker compatibility:

```bash
sudo chown -R 1001:1001 backend/uploads/blue/
sudo chmod -R 755 backend/uploads/blue/
```

## Nginx Configuration

File: `/home/cvat/spheroseg-app/docker/nginx/nginx.ssl.conf`

```nginx
location /uploads/ {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    add_header Cache-Control "public, max-age=86400";
}
```

## Verification

- Backend can serve files: `http://localhost:4001/uploads/...` returns 200
- Nginx routing needs fix for nested structure
- Container must be recreated after volume change

## Remaining Work

1. **Manual Directory Restructure Needed**:
   - Move all files from `backend/uploads/blue/blue/*` to `backend/uploads/blue/*`
   - Remove symbolic links
   - Fix permissions (1001:1001)

2. **Long-term Fixes**:
   - Standardize volume patterns across environments
   - Create nginx template for upload routing
   - Add upload directory health checks
   - Document proper deployment procedures

## Key Lessons

1. Docker volume changes require container recreation, not just restart
2. Symbolic links in upload directories cause routing issues
3. Blue-green deployments need consistent volume patterns
4. JWT secrets are required for backend startup in production mode
5. Batch API validation provides detailed error messages in response
