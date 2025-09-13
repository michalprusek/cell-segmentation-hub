# React unstable_batchedUpdates Fix

## Issue

After upgrading to React 18, the application crashed with:

```
TypeError: pe.unstable_batchedUpdates is not a function
```

This occurred in the SegmentationEditor component when processing polygons after image segmentation.

## Root Cause

In React 18+, `unstable_batchedUpdates` is not available on the React object. It must be imported from 'react-dom' instead of 'react'.

## Solution

Fixed in `/src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx`:

1. Added import from react-dom:

```typescript
import { unstable_batchedUpdates } from 'react-dom';
```

2. Changed usage from:

```typescript
React.unstable_batchedUpdates(() => {
```

to:

```typescript
unstable_batchedUpdates(() => {
```

## Impact

This function is used to batch state updates when switching images in the segmentation editor, preventing multiple re-renders and improving performance.

## Prevention

When using React 18+ APIs, always check the correct package:

- Core React APIs: import from 'react'
- DOM-specific APIs (including batching): import from 'react-dom'
- Server APIs: import from 'react-dom/server'

## Related Files

- `/src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx` (line 266)

## Date Fixed

2025-09-10
