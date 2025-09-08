# Backend Debugging Session - Prisma Model Reference Errors

## Problem Description

- Queue service at line 493 was trying to use `this.prisma.projectImage.updateMany()` but getting "Cannot read properties of undefined (reading 'updateMany')"
- UNet segmentation requests were stuck in "queued" status

## Root Cause Analysis

Multiple incorrect Prisma model references were found in the codebase:

1. **`projectImage`** instead of **`image`** - This was the primary issue
2. **`segmentationResult`** instead of **`segmentation`**
3. **`queueItem`** instead of **`segmentationQueue`**

## Prisma Schema Model Names (from /backend/prisma/schema.prisma)

- `User` ✓
- `Profile` ✓
- `Project` ✓
- `Image` ✓ (NOT `projectImage`)
- `Segmentation` ✓ (NOT `segmentationResult`)
- `SegmentationThumbnail` ✓
- `SegmentationQueue` ✓ (NOT `queueItem`)
- `Session` ✓
- `ProjectShare` ✓

## Fixed Files and Lines

### 1. /backend/src/services/queueService.ts

**Line 493-495** - Fixed batch image status update:

```typescript
// BEFORE (ERROR):
await this.prisma.projectImage.updateMany({

// AFTER (FIXED):
await this.prisma.image.updateMany({
```

### 2. /backend/src/services/authService.ts

**Line 572-574** - Fixed segmentation deletion:

```typescript
// BEFORE (ERROR):
await tx.segmentationResult.deleteMany({
  where: { projectImageId: image.id },
});

// AFTER (FIXED):
await tx.segmentation.deleteMany({
  where: { imageId: image.id },
});
```

**Line 577-579** - Fixed queue deletion:

```typescript
// BEFORE (ERROR):
await tx.queueItem.deleteMany({

// AFTER (FIXED):
await tx.segmentationQueue.deleteMany({
```

**Line 583-585** - Fixed image deletion:

```typescript
// BEFORE (ERROR):
await tx.projectImage.deleteMany({

// AFTER (FIXED):
await tx.image.deleteMany({
```

### 3. /backend/src/utils/database.ts

**Line 144** - Fixed orphaned segmentation cleanup:

```typescript
// BEFORE (ERROR):
await tx.segmentationResult.deleteMany({

// AFTER (FIXED):
await tx.segmentation.deleteMany({
```

**Line 146-148** - Fixed relation reference:

```typescript
// BEFORE (ERROR):
where: {
  projectImage: {
    is: null;
  }
}

// AFTER (FIXED):
where: {
  image: {
    is: null;
  }
}
```

**Line 153** - Fixed queue cleanup:

```typescript
// BEFORE (ERROR):
await tx.queueItem.deleteMany({

// AFTER (FIXED):
await tx.segmentationQueue.deleteMany({
```

## Verification Steps

1. **Prisma Client Generation**: `npx prisma generate` ✓
2. **Backend Health Check**: `curl http://localhost:3001/health` ✓
3. **Service Logs**: Backend running without model errors ✓
4. **Database Connection**: Healthy connection pool ✓

## Testing Results

- Backend service started successfully
- Health endpoint returns 200 OK
- Database connection healthy
- Redis connection healthy
- No more "Cannot read properties of undefined" errors
- Queue service can now process UNet segmentation requests

## Prevention

- Always verify Prisma model names against schema before using
- Use TypeScript for better type checking
- Run `npx prisma generate` after schema changes
- Test model references with simple queries before deployment

## Common Debug Commands

```bash
# Check backend logs
make logs-be

# Test health endpoint
curl http://localhost:3001/health

# Generate Prisma client
npx prisma generate

# Check queue status
curl http://localhost:3001/api/queue/stats
```
