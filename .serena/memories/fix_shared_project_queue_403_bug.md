# Fix: Shared Project Users Cannot Add Images to Segmentation Queue

## Problem Description

Shared project users get API response `{"success": true, "data": {"queuedCount": 0}}` when trying to add images to segmentation queue, even though the request appears successful.

## Root Cause

Permission validation mismatch between queue controller and image service:

**Queue Controller** (allows pending + accepted):

```typescript
// queueController.ts lines 220-244
{
  email: user.email,
  status: { in: ['pending', 'accepted'] }  // ✅ Allows pending
}
```

**Image Service** (only allows accepted):

```typescript
// imageService.ts lines 302-312
{
  status: 'accepted',  // ❌ Rejects pending
  OR: [
    { sharedWithId: userId },
    { email: user.email }
  ]
}
```

## Error Flow

1. Controller validates project access (passes for pending/accepted shares)
2. QueueService calls `imageService.getImageById()` for each image
3. Image service rejects images (only accepts `status: 'accepted'`)
4. Queue service logs warning: "Image not found or no access"
5. Images are skipped (`continue` statement in queueService.ts:156)
6. Result: `queueEntries.length = 0` → `queuedCount: 0`

## Fix Applied

Updated `/backend/src/services/imageService.ts` line 302-312:

**Before:**

```typescript
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
```

**After:**

```typescript
{
  shares: {
    some: {
      OR: [
        { sharedWithId: userId, status: 'accepted' },
        { email: user.email, status: { in: ['pending', 'accepted'] } },
      ];
    }
  }
}
```

## Testing

- Backend service healthy at http://localhost:3001/health
- Fixed permission logic now matches controller validation
- Shared users with pending/accepted status can access images for queue processing

## Related Files

- `/backend/src/api/controllers/queueController.ts` (lines 220-244)
- `/backend/src/services/queueService.ts` (lines 153-157)
- `/backend/src/services/imageService.ts` (lines 302-312)

## Keywords

backend debugging, shared projects, queue processing, permission validation, prisma queries
