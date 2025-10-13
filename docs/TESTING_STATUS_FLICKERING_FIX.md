# Testing Guide: Status Flickering Fix

**Date**: 2025-10-13
**Issue Fixed**: Image status flickering from "completed" → "no segmentation" → "completed"

## Quick Test Procedure

### 1. Start the Application

```bash
cd /home/cvat/cell-segmentation-hub
make up
make logs-f
```

### 2. Trigger Segmentation

1. Open browser: http://localhost:3000
2. Navigate to a project
3. Select 1-2 images
4. Click "Segment Images"
5. Watch the image cards during processing

### 3. What to Observe

#### ✅ Expected Behavior (Fixed)

**Image card status progression**:

```
[pending] → [completed] (no flicker)
```

**Console logs**:

```
DEBUG: Updating image status (fromStatus: pending, toStatus: completed)
DEBUG: Fetching polygon data for display enrichment
INFO: ✅ Polygon data loaded successfully (statusKept: completed)
```

**Visual**:

- Status badge updates once: gray → green
- No flashing between states
- Polygons appear smoothly after status is already "completed"

#### ❌ Bug Behavior (If Fix Failed)

**Image card status progression**:

```
[pending] → [completed] → [no segmentation] → [completed] (flickering!)
```

**Console logs**:

```
DEBUG: Updating image status (fromStatus: pending, toStatus: completed)
DEBUG: Updating image status (fromStatus: completed, toStatus: no_segmentation)  ❌ BAD!
DEBUG: Updating image status (fromStatus: no_segmentation, toStatus: completed)
```

**Visual**:

- Status badge flashes: gray → green → yellow → green
- User sees "no segmentation" message briefly
- Confusing user experience

### 4. Test Batch Operations

```bash
# Select 10+ images and trigger segmentation
# Status should update smoothly without flickering
```

**Expected**:

- All images progress: pending → completed
- No images show "no segmentation" unless actually empty
- Batch updates happen smoothly

### 5. Browser Console Checks

Open DevTools → Console tab

**Look for**:

```javascript
// ✅ Good logs
'Fetching polygon data for display enrichment';
'✅ Polygon data loaded successfully';

// ❌ Bad logs (indicates bug still exists)
'Image polygon count: 0';
'finalStatus: no_segmentation';
```

### 6. Network Tab Checks

Open DevTools → Network tab → WS (WebSocket)

**WebSocket messages should show**:

```json
{
  "event": "segmentationStatus",
  "data": {
    "imageId": 123,
    "status": "segmented", // Backend says "segmented"
    "message": "Segmentation completed"
  }
}
```

**Frontend should**:

- Receive: `status = 'segmented'`
- Normalize to: `normalizedStatus = 'completed'`
- **Keep it**: Never change to `'no_segmentation'`

## Advanced Testing

### Test Edge Cases

1. **Slow network** (throttle in DevTools):
   - Status should still not flicker
   - Polygons may take longer to load
   - Status already correct from WebSocket

2. **Segmentation with no cells**:
   - Backend sends: `status = 'no_segmentation'`
   - Frontend shows: "No segmentation"
   - No flickering to "completed"

3. **Error during segmentation**:
   - Backend sends: `status = 'failed'`
   - Frontend shows: "Error"
   - No status changes after error

### Verify SSOT Principle

**Test**: Manually edit backend database status while frontend is open

```bash
# In backend shell
npx prisma studio

# Change image status to 'segmented'
# Frontend should receive WebSocket and update immediately
# Status should NEVER change after WebSocket update
```

## Automated Test (Future)

```typescript
// test/integration/status-flickering.spec.ts
describe('Image Status Flickering Fix', () => {
  it('should not flicker status after segmentation', async () => {
    // 1. Trigger segmentation
    await triggerSegmentation(imageId);

    // 2. Track status changes
    const statusChanges = [];
    watchImageStatus(imageId, status => {
      statusChanges.push(status);
    });

    // 3. Wait for completion
    await waitForSegmentation(imageId);

    // 4. Verify no flickering
    expect(statusChanges).toEqual([
      'pending',
      'completed', // Only one transition
    ]);

    // 5. Should NOT have intermediate 'no_segmentation'
    expect(statusChanges).not.toContain('no_segmentation');
  });
});
```

## Rollback Plan

If this fix causes issues:

```bash
# Revert the change
cd /home/cvat/cell-segmentation-hub
git checkout src/pages/ProjectDetail.tsx

# Or manually revert to previous commit
git log --oneline src/pages/ProjectDetail.tsx
git checkout <previous-commit> -- src/pages/ProjectDetail.tsx
```

## Success Criteria

✅ **Fix is successful if**:

1. No status flickering visible to user
2. Console shows proper logging
3. Status updates exactly once from WebSocket
4. Polygons load independently without affecting status
5. Batch operations work smoothly
6. No TypeScript errors

❌ **Fix failed if**:

1. Status still flickers
2. Console shows multiple status updates
3. Status changes after polygon loading
4. TypeScript compilation errors
5. Runtime errors in console

## References

- **Fix Documentation**: `/docs/SSOT_FIX_STATUS_FLICKERING.md`
- **Modified File**: `/src/pages/ProjectDetail.tsx` (lines 826-867)
- **Principle**: Single Source of Truth (SSOT)
- **Pattern**: Trust backend WebSocket, fetch polygons async for display only
