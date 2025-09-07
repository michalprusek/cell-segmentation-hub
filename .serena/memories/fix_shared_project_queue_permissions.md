# Fix for Shared Project Queue Permission Issue

## Problem Description

Users with access to shared projects could not add images to the segmentation queue. The system showed "0 images added to segmentation queue" even though the API returned success. Images were stuck in "pending" status.

## Root Cause

The `updateSegmentationStatus` method in `/backend/src/services/imageService.ts` (line 628) only checked for project ownership, not shared project access. This caused status updates to fail silently for shared projects.

**Buggy Code** (line 628):

```typescript
if (userId) {
  where.project = { userId }; // Only checks ownership!
}
```

## The Fix Applied

### File Modified

`/backend/src/services/imageService.ts` - `updateSegmentationStatus` method (lines 619-676)

### Changes Made

Replaced the ownership-only check with comprehensive permission validation that includes shared project access:

```typescript
async updateSegmentationStatus(
  imageId: string,
  status: 'no_segmentation' | 'queued' | 'processing' | 'segmented' | 'failed',
  userId?: string
): Promise<void> {
  let where: Prisma.ImageWhereInput = { id: imageId };

  if (userId) {
    // Get user email for share checking
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Check both ownership AND shared access
    where = {
      id: imageId,
      project: {
        OR: [
          { userId }, // User owns the project
          {
            shares: {
              some: {
                status: 'accepted',
                OR: [
                  { sharedWithId: userId },
                  { email: user.email }
                ]
              }
            }
          }
        ]
      }
    };
  }

  const image = await this.prisma.image.findFirst({ where });

  if (!image) {
    throw new Error('Image not found or no access');
  }

  await this.prisma.image.update({
    where: { id: imageId },
    data: { segmentationStatus: status }
  });
}
```

## Why This Fix Works

1. **Consistent Permission Model**: Uses the same OR-based permission check as other methods like `getImageById`
2. **Handles Both Share Types**: Checks both `sharedWithId` (direct user sharing) and `email` (email-based sharing)
3. **Status Filter**: Only accepts shares with 'accepted' status
4. **Complete Authorization**: Validates user has legitimate access before allowing status updates

## Testing Verification

After applying the fix:

1. Shared project users can add images to segmentation queue ✅
2. Queue count shows correct number of added images ✅
3. Image status updates from 'pending' to 'queued' ✅
4. WebSocket notifications work correctly ✅

## Related Methods Using Correct Pattern

These methods already use the correct permission pattern and served as templates:

- `ImageService.getImageById()` - line 284
- `ImageService.getProjectImages()` - line 339
- `ImageService.deleteImage()` - line 527
- `QueueController.addBatchToQueue()` - line 220

## Prevention

All methods that check image/project permissions should follow the same OR-based pattern:

1. Check if user owns the project (`userId` match)
2. OR check if project is shared with user (via `sharedWithId` or `email`)
3. Verify share status is 'accepted'

## Impact

- **Before Fix**: Shared project collaboration was broken for segmentation features
- **After Fix**: Full functionality restored for shared project users
- **Security**: No security impact - fix only extends existing permission model consistently
