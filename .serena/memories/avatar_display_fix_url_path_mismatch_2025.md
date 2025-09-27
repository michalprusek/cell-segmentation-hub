# Avatar Display Fix - URL Path Mismatch Resolution

## Issue Description

**User Report**: "napíše mi to avatar uploaded successfully, ale avatar mi to nezobrazuje"
(Translation: "it says avatar uploaded successfully, but the avatar doesn't display")

**Problem**: Avatar uploads were successful but images wouldn't display in the UI
**Date**: September 26, 2025

## Root Cause Analysis

### The URL Path Mismatch

1. **Storage Service Issue**: Backend was generating avatar URLs with incorrect paths
   - Generated: `/uploads/blue/avatars/[userId]/[filename].jpg`
   - Should be: `/uploads/avatars/[userId]/[filename].jpg`

2. **Nginx Configuration Gap**: The nginx configuration wasn't properly mapping the avatar paths
   - Missing proper alias for avatar-specific paths
   - Environment-specific paths not handled correctly

3. **Result**: 404 errors when browser tried to load avatar images

## Solution Implementation

### 1. Storage Service Fix

**File**: `/backend/src/storage/localStorage.ts`
**Change**: Corrected URL generation to use standard paths without double environment prefix

```typescript
// Before: Was adding environment prefix twice
// After: Clean URL generation
return `/uploads/${key}`;
```

### 2. Nginx Configuration Update

**File**: `/docker/nginx/nginx.blue.conf`
**Changes**: Added proper location blocks for avatar serving

```nginx
# Handle environment-specific uploads
location /uploads/blue {
    alias /app/uploads/blue/;
    # Security headers and caching
}

# Handle standard uploads (backward compatibility)
location /uploads {
    alias /app/uploads/blue/;
    # Security headers and caching
}
```

## Avatar System Architecture

### Upload Flow

1. **Frontend**: Profile.tsx → AvatarUploadButton → API call
2. **Backend**: authController → authService → Sharp processing → localStorage
3. **Storage**: Files saved to `/app/uploads/blue/avatars/[userId]/[filename].jpg`
4. **Database**: Profile table updated with avatarUrl

### Display Flow

1. **Frontend**: UserProfileDropdown/Profile.tsx requests avatarUrl
2. **URL Resolution**: `/uploads/avatars/...` path
3. **Nginx**: Maps request to physical file location
4. **Response**: Serves image with proper caching headers

### Key Components

- **Frontend**:
  - `/src/pages/Profile.tsx` - Main avatar management
  - `/src/components/header/UserProfileDropdown.tsx` - Header avatar display
  - `/src/components/avatar/AvatarCropDialog.tsx` - Image cropping
- **Backend**:
  - `/backend/src/api/controllers/authController.ts` - Upload endpoint
  - `/backend/src/services/authService.ts` - Processing logic
  - `/backend/src/storage/localStorage.ts` - URL generation
- **Infrastructure**:
  - `/docker/nginx/nginx.blue.conf` - File serving configuration
  - Upload directory structure with proper permissions (1001:docker)

## Verification Steps

### Check Avatar Accessibility

```bash
# Test avatar URL (should return 200)
curl -I https://spherosegapp.utia.cas.cz/uploads/avatars/[userId]/[filename].jpg

# Check file exists
ls -la /backend/uploads/blue/avatars/[userId]/

# Verify nginx configuration
docker exec nginx-main nginx -t
docker exec nginx-main nginx -s reload
```

### Database Verification

```sql
-- Check user profile avatar URLs
SELECT id, avatarUrl, avatarPath FROM Profile WHERE userId = '[userId]';
```

## Prevention Guidelines

1. **Consistent URL Generation**: Always use the storage provider's getUrl() method
2. **Environment Handling**: Don't add environment prefixes to public URLs
3. **Nginx Configuration**: Ensure all upload paths are properly mapped
4. **Testing**: Test file uploads in both blue and green environments
5. **Monitoring**: Check for 404 errors in nginx logs for upload paths

## Impact

- **Fixed**: Avatar display issues across the application
- **Improved**: URL generation consistency
- **Enhanced**: Nginx configuration for better file serving
- **Maintained**: Backward compatibility with existing avatar URLs

## Keywords for Future Search

- Avatar not displaying
- Upload successful but image missing
- URL path mismatch
- Nginx avatar routing
- Double environment prefix
- Avatar 404 error
