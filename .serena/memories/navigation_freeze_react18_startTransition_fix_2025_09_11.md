# Navigation Freeze Fix - React 18 startTransition - 2025-09-11

## Problem Summary

User reported: "stále mám freeznutou stránku po segmentaci - nejde mi mačkat image cards (navigate na segmentační editor) a také tlačítko back nefunguje - prostě mi nefunguje navigate. funguje mi jen advanced export, sort atd."

Translation: "I still have a frozen page after segmentation - I can't click image cards (navigate to segmentation editor) and the back button doesn't work - navigation just doesn't work. Only advanced export, sort, etc. work."

## Root Cause Analysis

### Issue Identified

**React Router v6 with v7_startTransition Conflict**

- The app uses React Router v6 with `v7_startTransition: true` enabled in BrowserRouter
- This enables React 18's concurrent features for navigation transitions
- However, navigation calls were not wrapped in `startTransition`, causing them to get stuck
- The conflict was with `unstable_batchedUpdates` used in the segmentation editor

### Technical Details

1. **BrowserRouter Configuration** (`/src/App.tsx`):

```tsx
<BrowserRouter
  future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
>
```

2. **Batched Updates in Editor** (`/src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx`):

```tsx
import { unstable_batchedUpdates } from 'react-dom';
// ...
unstable_batchedUpdates(() => {
  setPolygons(initialPolygons);
  setSelectedPolygonId(null);
  // ... more state updates
});
```

3. **Navigation Without Transition**:

- Navigation was called directly: `navigate('/path')`
- Should be wrapped in startTransition for React 18 concurrent mode

## Solution Implementation

### Files Modified

#### 1. `/src/hooks/useProjectImageActions.tsx`

```tsx
// Added import
import { useState, useRef, useEffect, startTransition } from 'react';

// Modified handleOpenSegmentationEditor
const handleOpenSegmentationEditor = async (imageId: string) => {
  if (!projectId) return;
  const image = imagesRef.current.find(img => img.id === imageId);
  if (!image) return;

  // Use startTransition to ensure proper React 18 concurrent rendering
  // This fixes navigation freezing after segmentation
  startTransition(() => {
    navigate(`/segmentation/${projectId}/${imageId}`);
  });
};
```

#### 2. `/src/pages/segmentation/components/EditorHeader.tsx`

```tsx
// Added import
import React, { startTransition } from 'react';

// Modified handleBackClick
const handleBackClick = () => {
  // Use startTransition to ensure navigation works with React 18 concurrent features
  // This fixes navigation freezing issues after segmentation
  startTransition(() => {
    // Navigate immediately - don't block UI
    navigate(`/project/${projectId}`);
  });

  // Fire background save if needed
  // ... autosave logic
};

// Modified handleHomeClick
const handleHomeClick = () => {
  startTransition(() => {
    navigate('/dashboard');
  });
  // ... autosave logic
};
```

#### 3. `/src/pages/segmentation/SegmentationEditor.tsx`

```tsx
// Added import
import React, {
  // ... other imports
  startTransition,
} from 'react';

// Modified navigateToImage
const navigateToImage = (direction: 'prev' | 'next') => {
  // ... navigation logic

  const nextImage = projectImages[nextIndex];
  if (nextImage) {
    // Use startTransition to ensure navigation works with React 18 concurrent features
    // This fixes navigation freezing issues after segmentation
    startTransition(() => {
      navigate(`/segmentation/${projectId}/${nextImage.id}`);
    });
  }
};
```

## Why This Fixes The Issue

1. **React 18 Concurrent Mode**
   - React Router v6 with v7_startTransition uses React 18's concurrent rendering
   - Navigation updates are treated as transitions, not urgent updates
   - Without startTransition, navigation can get "stuck" behind other state updates

2. **Conflict Resolution**
   - unstable_batchedUpdates forces synchronous state updates
   - Navigation without startTransition tries to update synchronously
   - This creates a deadlock where navigation can't proceed
   - Wrapping navigation in startTransition moves it to concurrent queue

3. **Proper Update Priority**
   - startTransition marks navigation as non-urgent
   - React can interrupt navigation to handle urgent updates
   - Prevents UI freezing and ensures smooth transitions

## Testing Verification

### Test Scenarios

1. ✅ Navigate from project page to segmentation editor via image cards
2. ✅ Navigate back from segmentation editor using back button
3. ✅ Navigate home from segmentation editor
4. ✅ Navigate between images in segmentation editor (prev/next)
5. ✅ All navigation works after completing segmentation

### Success Metrics

- **Instant Navigation**: All navigation happens without freezing
- **URL Updates**: URL and component both update together
- **No Blocking**: UI remains responsive during navigation
- **Background Saves**: Autosave continues without blocking navigation

## Related Patterns

This fix follows React 18 best practices:

- Use startTransition for non-urgent updates
- Separate urgent (user input) from non-urgent (navigation) updates
- Ensure compatibility with concurrent features

## Prevention Guidelines

### For Future Development

1. **Always Use startTransition for Navigation**

   ```tsx
   // Good
   startTransition(() => {
     navigate('/path');
   });

   // Bad (can freeze with React 18)
   navigate('/path');
   ```

2. **Check React Router Configuration**
   - If using v7_startTransition, wrap all navigation in startTransition
   - Consider impact on existing state management patterns

3. **Avoid Mixing Update Patterns**
   - Don't mix unstable_batchedUpdates with concurrent features
   - Choose either legacy batching or React 18 transitions consistently

## Keywords for Future Search

- React 18 navigation freeze
- startTransition React Router v6
- v7_startTransition navigation stuck
- unstable_batchedUpdates conflict navigation
- React concurrent mode navigation freeze
- URL changes but page doesn't navigate
- React Router transition deadlock
