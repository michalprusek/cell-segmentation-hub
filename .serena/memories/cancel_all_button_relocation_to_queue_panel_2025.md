# Cancel All Button Relocation to Queue Stats Panel

## Date

2025-09-21

## Summary

Moved the "Cancel All Segmentations" button from the global DashboardHeader to the QueueStatsPanel component in ProjectDetail page for better contextual relevance.

## Rationale

The user requested (in Czech: "tlačítko mi přesuň do ukazatele segmentační fronty v project detail") to move the Cancel All button to the segmentation queue indicator in the project detail page. This makes more sense because:

1. Users see and manage the segmentation queue directly in ProjectDetail
2. The button is contextually relevant where queue operations happen
3. Better UX having all queue controls in one place

## Implementation Changes

### 1. Removed from DashboardHeader

**File**: `/src/components/DashboardHeader.tsx`

- Removed import of `CancelAllSegmentationsButton`
- Removed the button component from desktop navigation
- Removed `isCancelDialogOpen` state
- Removed `handleCancelAllSegmentations` function
- Cleaned up props passed to MobileMenu

### 2. Removed from MobileMenu

**File**: `/src/components/header/MobileMenu.tsx`

- Removed `queueStats` and `onCancelAllSegmentations` props
- Removed the cancel all menu item
- Removed unused imports (XCircle icon, apiClient, AlertDialog components)

### 3. Added to QueueStatsPanel

**File**: `/src/components/project/QueueStatsPanel.tsx`

- Added import for `CancelAllSegmentationsButton`
- Added `globalQueueStats?: QueueStats | null` prop for global queue statistics
- Added the button in the right actions section before Settings button
- Button shows when `globalQueueStats` has tasks (processing > 0 or pending > 0)
- Styled with orange border to distinguish from other actions

### 4. Updated ProjectDetail

**File**: `/src/pages/ProjectDetail.tsx`

- Added second `useSegmentationQueue(undefined)` hook to get global stats
- Pass `globalQueueStats` prop to `QueueStatsPanel`

## Visual Changes

- Button now appears in the Queue Stats Panel (blue gradient panel at top of ProjectDetail)
- Positioned in the right actions area with Settings and Segment All buttons
- Shows total count of tasks across ALL projects
- Orange border styling for visual distinction
- Only visible when user has active tasks globally

## Benefits

1. **Better Context**: Button is where users manage segmentation tasks
2. **Improved UX**: All queue controls in one logical location
3. **Cleaner Header**: Dashboard header is less cluttered
4. **Project Focus**: Users can cancel all tasks while viewing specific project

## Technical Notes

- Uses two instances of `useSegmentationQueue` hook:
  - One for project-specific stats (with project ID)
  - One for global stats (with undefined)
- Maintains same functionality, just relocated
- All translations and API calls remain unchanged
- TypeScript compilation successful
- No linting errors introduced
