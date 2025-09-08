# Queue Processing Prisma Model Fix - 2025-09-07

## Problem Summary

UNet segmentation requests were stuck in "queued" status due to incorrect Prisma model references in the queue service.

## Root Cause

The backend code was using `prisma.projectImage` but the actual Prisma model is named `Image` (mapped to `images` table in the database).

## Error Details

```
Error: Cannot read properties of undefined (reading 'updateMany')
Location: /backend/src/services/queueService.ts:493
Stack: TypeError at QueueService.processBatch
```

## Files Fixed

### 1. queueService.ts

- **Line 493**: Changed `this.prisma.projectImage.updateMany()` to `this.prisma.image.updateMany()`

### 2. authService.ts

- **Line 572**: Changed `tx.segmentationResult.deleteMany()` to `tx.segmentation.deleteMany()`
- **Line 577**: Changed `tx.queueItem.deleteMany()` to `tx.segmentationQueue.deleteMany()`
- **Line 583**: Changed `tx.projectImage.deleteMany()` to `tx.image.deleteMany()`

### 3. database.ts

- **Line 144**: Changed `tx.segmentationResult.deleteMany()` to `tx.segmentation.deleteMany()`
- **Line 153**: Changed `tx.queueItem.deleteMany()` to `tx.segmentationQueue.deleteMany()`

## Correct Prisma Model Names

From `/backend/prisma/schema.prisma`:

- `User` ✓
- `Project` ✓
- `Image` ✓ (NOT `projectImage`)
- `Segmentation` ✓ (NOT `segmentationResult`)
- `SegmentationQueue` ✓ (NOT `queueItem`)
- `Session` ✓
- `ProjectShare` ✓

## Fix Implementation

1. Updated all incorrect model references to match Prisma schema
2. Rebuilt blue-backend container with fixes
3. Restarted backend service with proper environment variables

## Verification

- Queue processing: ✅ Working
- UNet segmentation: ✅ Processing successfully
- Polygon detection: ✅ 2 polygons detected
- Processing time: ✅ 0.22-0.42 seconds

## Prevention

- Always verify Prisma model names match schema.prisma
- Use TypeScript auto-completion to catch these errors
- Run `npx prisma generate` after schema changes
- Test queue processing after model changes

## Related Issues

This error affected:

- All segmentation model processing (HRNet, CBAM-ResUNet, UNet)
- User deletion cleanup operations
- Database orphaned record cleanup

## Commands for Testing

```bash
# Check for remaining incorrect references
grep -r "projectImage" backend/src/
grep -r "segmentationResult" backend/src/
grep -r "queueItem" backend/src/

# Rebuild and restart backend
docker-compose -f docker-compose.blue.yml build blue-backend
docker-compose -f docker-compose.blue.yml up -d blue-backend

# Monitor queue processing
docker logs -f blue-backend | grep -i queue
```
