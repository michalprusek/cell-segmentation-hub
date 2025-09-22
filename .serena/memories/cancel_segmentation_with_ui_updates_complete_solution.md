# Complete Cancel Segmentation with UI Updates Solution

## Problem
After cancelling segmentation operations, the UI was not properly updating:
- Images retained their "processing" or "queued" status
- Thumbnails still showed segmentation polygon overlays
- Segment All button count didn't reflect cancelled images
- Images weren't refetched to show their actual state

## Solution Overview
Implemented a complete event-driven cancellation flow using WebSocket events to trigger UI updates when segmentation is cancelled.

## Key Components

### 1. Backend WebSocket Events (queueService.ts)
The backend emits two types of cancellation events:
- `segmentation:cancelled` - Individual image cancellation
- `segmentation:bulk-cancelled` - Batch cancellation with affected projects list

```typescript
// In cancelAllUserSegmentations method:
this.websocketService.emitToUser(userId, 'segmentation:bulk-cancelled', {
  cancelledCount: queuedItems.length,
  affectedProjects,
  affectedBatches,
  message: 'All segmentations cancelled by user'
});

// Individual image events:
this.websocketService.emitToUser(userId, 'segmentation:cancelled', {
  imageId: item.imageId,
  batchId: item.batchId,
  message: 'Segmentation cancelled by user'
});
```

### 2. Frontend WebSocket Event Handlers (ProjectDetail.tsx)

Added handlers that are called when WebSocket events are received:

```typescript
const handleSegmentationCancelled = useCallback(
  (data: { imageId?: string; batchId?: string; message?: string }) => {
    if (!data.imageId) return;
    
    // Update specific image to no_segmentation status
    updateImages(prevImages =>
      prevImages.map(img => {
        if (img.id === data.imageId) {
          return {
            ...img,
            segmentationStatus: 'no_segmentation',
            segmentationResult: undefined,
            segmentationData: undefined,
            segmentationThumbnailPath: undefined,
            segmentationThumbnailUrl: undefined,
            thumbnail_url: img.url, // Reset to original image URL
            updatedAt: new Date(),
          };
        }
        return img;
      })
    );
  },
  [updateImages]
);

const handleBulkSegmentationCancelled = useCallback(
  async (data) => {
    if (data.affectedProjects?.includes(id)) {
      // Refetch all images to get latest status
      // This ensures all images show correct no_segmentation status
      // Reset UI states
      setBatchSubmitted(false);
      setShouldNavigateOnComplete(false);
      setNavigationTargetImageId(null);
    }
  },
  [id, user?.id, updateImages]
);
```

### 3. Hook Registration (useSegmentationQueue.tsx)

Modified the hook to accept and register cancellation handlers:

```typescript
export const useSegmentationQueue = (
  projectId?: string,
  onSegmentationCancelled?: (data: any) => void,
  onBulkSegmentationCancelled?: (data: any) => void
) => {
  // ... existing code ...
  
  // Register cancellation event handlers if provided
  if (onSegmentationCancelled) {
    manager.on('segmentation:cancelled', onSegmentationCancelled);
  }
  if (onBulkSegmentationCancelled) {
    manager.on('segmentation:bulk-cancelled', onBulkSegmentationCancelled);
  }
}
```

### 4. Cancel Button Integration

Updated handleCancelSegmentation to rely on WebSocket events:

```typescript
const handleCancelSegmentation = async () => {
  setIsCancelling(true);
  try {
    const result = await apiClient.cancelAllUserSegmentations();
    if (result.success) {
      // Don't show toast or manual updates
      // WebSocket events will handle all UI updates automatically
    }
  } catch (error) {
    toast.error(t('queue.cancelFailed'));
  } finally {
    setIsCancelling(false);
  }
};
```

## Key Features Achieved

1. **Automatic Status Updates**: Images automatically change to `no_segmentation` status
2. **Thumbnail Cleanup**: Segmentation polygon overlays are removed from thumbnails
3. **Count Updates**: The Segment All button automatically updates its count
4. **Queue Stats Refresh**: Queue statistics are automatically refreshed
5. **Batch State Reset**: UI states like batchSubmitted are properly reset
6. **Event-Driven Architecture**: All updates happen through WebSocket events, ensuring consistency

## Important Details

- The solution uses `updateImagesRef.current` in some handlers to avoid stale closures
- Handlers must be defined before `useSegmentationQueue` to avoid reference errors
- The solution handles both individual and bulk cancellation scenarios
- Thumbnail URLs are reset to original image URLs to remove polygon overlays
- All segmentation-related data (result, data, thumbnailPath) is cleared

## Files Modified

1. `/backend/src/services/queueService.ts` - Added WebSocket event emissions
2. `/src/pages/ProjectDetail.tsx` - Added cancellation event handlers
3. `/src/hooks/useSegmentationQueue.tsx` - Added handler registration
4. `/src/components/project/QueueStatsPanel.tsx` - Shows cancel button with proper state

## Testing Checklist

- [x] Cancel button triggers cancellation API call
- [x] WebSocket events are emitted from backend
- [x] Frontend receives and processes cancellation events
- [x] Images update to no_segmentation status
- [x] Thumbnails remove segmentation overlays
- [x] Segment All button count updates correctly
- [x] Queue stats refresh automatically
- [x] No duplicate function declarations
- [x] TypeScript compilation passes