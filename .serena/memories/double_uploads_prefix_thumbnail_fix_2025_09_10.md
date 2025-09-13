# Double /uploads/ Prefix in Segmentation Thumbnail URLs - Fixed

## Problem

Segmentation thumbnail URLs were returning 404 errors because they contained double `/uploads/` prefix:

- URL: `https://spherosegapp.utia.cas.cz/uploads//uploads/user/project/segmentation_thumbnails/file.jpg`
- Error: 404 Not Found

## Root Cause Analysis

### Issue Location

The double prefix was introduced at two points:

1. **SegmentationThumbnailService** (line 163): Stored paths WITH `/uploads/` prefix in database
2. **LocalStorageProvider.getUrl()** (line 171): Added ANOTHER `/uploads/` prefix when generating URLs

### Data Flow

1. SegmentationThumbnailService creates: `userId/projectId/segmentation_thumbnails/file.jpg`
2. SegmentationThumbnailService stores in DB: `/uploads/userId/projectId/segmentation_thumbnails/file.jpg`
3. ImageService retrieves path and calls storage.getUrl()
4. LocalStorageProvider.getUrl() adds prefix: `/uploads//uploads/userId/projectId/segmentation_thumbnails/file.jpg`

### Inconsistency

- `originalPath`: Stored WITHOUT `/uploads/` prefix ✅
- `thumbnailPath`: Stored WITHOUT `/uploads/` prefix ✅
- `segmentationThumbnailPath`: Stored WITH `/uploads/` prefix ❌ (inconsistent)

## Solution Implemented

### 1. Code Fix

Modified `/backend/src/services/segmentationThumbnailService.ts` line 163-179:

```typescript
// Before: Stored with /uploads/ prefix
const segmentationThumbnailUrl = `/uploads/${thumbnailRelativePath}`;

// After: Store relative path without prefix (consistent with other path fields)
await this.prisma.image.update({
  where: { id: image.id },
  data: {
    segmentationThumbnailPath: thumbnailRelativePath, // No /uploads/ prefix
    updatedAt: new Date(),
  },
});
```

### 2. Database Migration

Created and ran migration script to fix existing 516 images:

```javascript
// fix-thumbnail-paths.cjs
// Removes /uploads/ prefix from all existing segmentationThumbnailPath values
const fixedPath = currentPath.substring(9); // Remove '/uploads/'
```

## SSOT Principles Applied

### Identified Violations

1. **URL Generation Logic Duplication**: 4 different implementations across codebase
2. **Base URL Configuration Fragmentation**: 3 different base URL utilities
3. **Static File Path Duplication**: Multiple services referencing `/uploads/` independently

### Recommended Architecture

Create centralized URL service as single source of truth:

```typescript
class URLService {
  getUploadUrl(path: string): string {
    const cleanPath = path.replace(/^\/uploads\//, '');
    return this.isProduction()
      ? `/uploads/${cleanPath}`
      : `${this.getBaseUrl()}/uploads/${cleanPath}`;
  }
}
```

## Testing & Verification

- Fixed all 516 images in database
- Verified files exist at corrected paths
- Tested URL returns 200: `https://spherosegapp.utia.cas.cz/uploads/user/project/segmentation_thumbnails/file.jpg`
- No more double `/uploads/` prefix in URLs

## Key Learnings

1. **Consistency is Critical**: All path fields should follow same storage pattern
2. **Storage Provider Responsibility**: URL prefix addition should be centralized in storage provider
3. **SSOT Enforcement**: Multiple URL generation implementations lead to inconsistencies
4. **Database Migration Required**: When fixing path storage patterns, existing data must be migrated

## Files Modified

- `/backend/src/services/segmentationThumbnailService.ts` - Fixed path storage
- `/backend/fix-thumbnail-paths.cjs` - Migration script for existing data

## Prevention Strategy

1. Establish clear convention: Database stores relative paths, storage provider adds prefixes
2. Create centralized URL service to eliminate duplication
3. Add tests to verify URL generation consistency
4. Document path storage conventions in codebase
