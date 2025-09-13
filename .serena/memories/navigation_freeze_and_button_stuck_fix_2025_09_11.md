# Navigation Freeze and Button Stuck Fix - 2025-09-11

## Problem Description

User reported: "když na frontendu v aplikaci kliknu na tlačítko segment na stránce project detail, tak mi nefunguje tlačítko back (zpět na dashboard), ani kliknout na image card a přesměrovat se do segmentačního editoru. a samotné tlačítko se zasekne na 'adding to queue...' ačkoliv už jsou všechny obrázky dosegmentovné. musím vždy refreshnout stránku."

Translation: "When I click the segment button on the project detail page in the frontend application, the back button (back to dashboard) doesn't work, nor can I click on image cards to navigate to the segmentation editor. And the button itself gets stuck on 'adding to queue...' even though all images are already segmented. I always have to refresh the page."

## Root Cause Analysis

### Issue 1: Button Stuck on "Adding to Queue..."

- The `batchSubmitted` state is set to `true` when clicking the "Segment" button
- When all images are already segmented, the function returns early with `toast.info()`
- However, the `batchSubmitted` state was not being reset in this early return case
- This caused the button to remain disabled and show "Adding to queue..." indefinitely

### Issue 2: Navigation Freeze

- The application uses React Router v6 with `v7_startTransition: true` enabled
- This enables React 18's concurrent features for navigation transitions
- However, navigation calls in ProjectDetail were not wrapped in `startTransition`
- This could cause navigation to get stuck, especially after state updates

## Solution Implementation

### Files Modified

#### 1. `/src/pages/ProjectDetail.tsx`

**Import Addition:**

```tsx
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  startTransition, // Added
} from 'react';
```

**Fix 1: Reset batchSubmitted when no images to process**

```tsx
// Before (line 994-997):
if (allImagesToProcess.length === 0) {
  toast.info(t('projects.allImagesAlreadySegmented'));
  return;
}

// After (line 994-999):
if (allImagesToProcess.length === 0) {
  toast.info(t('projects.allImagesAlreadySegmented'));
  // Reset batchSubmitted state since we're not actually processing anything
  setBatchSubmitted(false);
  return;
}
```

**Fix 2: Wrap navigation in startTransition**

```tsx
// Before (line 654):
navigate(`/segmentation/${id}/${navigationTargetImageId}`);

// After (line 654-657):
// Use startTransition to ensure navigation works with React 18 concurrent features
startTransition(() => {
  navigate(`/segmentation/${id}/${navigationTargetImageId}`);
});
```

## Why These Fixes Work

### Fix 1: Button State Management

- Ensures `batchSubmitted` is always reset when the function exits early
- Prevents the button from getting stuck in the "Adding to queue..." state
- Maintains proper UI state consistency

### Fix 2: React 18 Concurrent Mode Compatibility

- `startTransition` marks navigation updates as non-urgent transitions
- Prevents navigation from getting blocked by other state updates
- Ensures smooth navigation even during complex state changes
- Compatible with React Router v6's v7_startTransition feature

## Related Systems

### Navigation System

- Already fixed in `useProjectImageActions` hook (uses startTransition)
- EditorHeader navigation also uses startTransition (from previous fixes)
- This completes the navigation freeze fixes across the application

### Queue Management

- QueueStatsPanel properly shows button state based on `batchSubmitted` prop
- WebSocket updates properly reset `batchSubmitted` when queue completes
- Safety timeout (30 seconds) also resets state if WebSocket fails

## Testing Verification

### Test Scenarios

1. ✅ Click "Segment" when all images are already segmented
   - Button should briefly show "Adding to queue..." then reset
   - Toast should show "All images already segmented"
   - Button should be clickable again

2. ✅ Navigate using image cards after clicking "Segment"
   - Should navigate immediately to segmentation editor
   - No freezing or blocking

3. ✅ Use back button functionality
   - Should navigate back to dashboard without freezing
   - Works even after segmentation operations

4. ✅ Normal segmentation workflow
   - Button shows "Adding to queue..." during processing
   - Resets when queue completes
   - Navigation works throughout

## Prevention Guidelines

### For Future Development

1. **Always reset state in early returns**

   ```tsx
   if (earlyReturnCondition) {
     // Reset any state that was set optimistically
     setSubmittedState(false);
     return;
   }
   ```

2. **Use startTransition for navigation in React 18**

   ```tsx
   startTransition(() => {
     navigate('/path');
   });
   ```

3. **Consider all code paths**
   - Check every return statement in async functions
   - Ensure state is properly managed in all scenarios
   - Add safety timeouts for operations that depend on external events

## Keywords for Future Search

- Button stuck "Adding to queue"
- Navigation freeze React 18
- batchSubmitted state not resetting
- startTransition navigation fix
- React Router v7_startTransition
- ProjectDetail navigation freeze
- Segment button stuck disabled
