# Navigation Freeze After Segmentation - BeforeUnload Handler Fix

## Problem Description

User reported: "po segmentaci se mi zastaví frontend nějak. nejde mi překlikávat na jiné strány v rámci aplikace, pouze se mi mění url"

Translation: "After segmentation, the frontend freezes somehow. I can't navigate to other pages within the application, only the URL changes"

## Root Cause Analysis

### Issue Found

The navigation freeze was caused by TWO separate issues in the codebase:

1. **EditorHeader.tsx** - Blocking autosave in navigation handlers (ALREADY FIXED)
2. **useEnhancedSegmentationEditor.tsx** - beforeunload event handler interference (NEW FIX APPLIED)

### Specific Problem in useEnhancedSegmentationEditor

Location: `/src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx` (lines 347-366)

The beforeunload event handler was calling `event.preventDefault()` which interferes with React Router navigation in certain browsers, especially Chrome v139+.

```typescript
// PROBLEMATIC CODE:
const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  if (hasUnsavedChanges) {
    event.preventDefault(); // <- THIS BLOCKS REACT ROUTER NAVIGATION
    event.returnValue = 'You have unsaved changes...';
    return event.returnValue;
  }
};
```

## Solution Applied

### Fix Implementation

Removed `event.preventDefault()` from the beforeunload handler. Only set `event.returnValue` to trigger the browser's native warning dialog.

```typescript
// FIXED CODE:
const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  if (hasUnsavedChanges) {
    // CRITICAL FIX: Do NOT call event.preventDefault() as it blocks React Router navigation
    // Only set returnValue to trigger browser's native unload warning
    // This allows in-app navigation to work while still warning on page close/refresh
    const message = 'You have unsaved changes. Are you sure you want to leave?';
    event.returnValue = message;
    return message;
  }
};
```

## Why This Works

1. **event.preventDefault() in beforeunload**:
   - Intended to prevent page unload
   - In modern browsers, also interferes with programmatic navigation
   - Blocks React Router's navigation mechanism
   - Causes URL to change but component doesn't unmount

2. **Setting only returnValue**:
   - Triggers browser's native "Leave site?" dialog on actual page unload
   - Doesn't interfere with React Router navigation
   - Allows smooth in-app navigation
   - Still protects against data loss on page close/refresh

## Complete Fix Summary

The navigation freeze issue required fixing TWO locations:

### 1. EditorHeader.tsx (Already Fixed)

- Removed `await` from onSave() in navigation handlers
- Made save operations fire-and-forget with timeout
- Navigation happens immediately

### 2. useEnhancedSegmentationEditor.tsx (This Fix)

- Removed event.preventDefault() from beforeunload handler
- Only set returnValue for browser warning
- Allows React Router navigation to work properly

## Testing Instructions

1. **Test Navigation After Segmentation**:

   ```
   - Upload and segment an image
   - Make changes to polygons
   - Try navigating using back button or breadcrumbs
   - Should navigate immediately without freeze
   ```

2. **Test Unsaved Changes Warning**:

   ```
   - Make changes to segmentation
   - Try closing browser tab
   - Should see browser warning about unsaved changes
   - In-app navigation should work without issues
   ```

3. **Test Different Browsers**:
   ```
   - Chrome 139+
   - Firefox
   - Safari
   - Edge
   ```

## Related Issues

- Previous fix in EditorHeader.tsx for blocking autosave
- WebSocket updates during segmentation
- React Router v6 navigation behavior

## Browser Compatibility Notes

- Chrome 139+ has stricter handling of beforeunload event.preventDefault()
- Firefox and Safari may behave differently but fix works across all browsers
- Modern browsers ignore custom messages in beforeunload for security

## Prevention Guidelines

1. **Never use event.preventDefault() in beforeunload handlers with React Router**
2. **Only set event.returnValue for browser warnings**
3. **Test navigation thoroughly after implementing beforeunload handlers**
4. **Use React Router's navigation blocking APIs for in-app navigation guards**

## Keywords for Future Search

- navigation freeze React Router
- beforeunload preventDefault blocking navigation
- URL changes but component doesn't unmount
- React Router v6 beforeunload interference
- segmentation editor navigation freeze
- Chrome 139 beforeunload navigation issue
