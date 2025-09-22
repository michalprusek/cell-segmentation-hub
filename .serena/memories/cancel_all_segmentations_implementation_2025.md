# Cancel All Segmentations Implementation

## Overview

Comprehensive implementation of a "Cancel All Segmentations" feature that allows users to cancel all their concurrent segmentation tasks across all projects with a single action.

## Implementation Date

2025-09-21

## Architecture

### Backend Implementation

#### 1. Queue Service Method

**File**: `/backend/src/services/queueService.ts`
**Method**: `cancelAllUserSegmentations(userId: string)`

Key features:

- Cancels all queued and processing tasks for a specific user
- Tracks affected projects and batch IDs
- Emits WebSocket notifications for each cancelled task
- Returns comprehensive cancellation statistics
- Handles both single and batch segmentation tasks

```typescript
async cancelAllUserSegmentations(userId: string): Promise<{
  cancelledCount: number;
  affectedProjects: string[];
  affectedBatches: string[];
}>
```

#### 2. Controller Endpoint

**File**: `/backend/src/api/controllers/queueController.ts`
**Method**: `cancelAllUserSegmentations`

- Authenticates user from JWT token
- Calls queue service to cancel all user tasks
- Emits global WebSocket event for cancelled tasks
- Returns success response with statistics

#### 3. API Route

**File**: `/backend/src/api/routes/queueRoutes.ts`
**Route**: `POST /api/queue/cancel-all-user`

- Protected route requiring authentication
- No body parameters required (user extracted from JWT)

### Frontend Implementation

#### 1. Cancel All Button Component

**File**: `/src/components/ui/cancel-all-segmentations-button.tsx`

Features:

- Confirmation dialog to prevent accidental cancellation
- Shows processing and queued task counts
- Loading state during cancellation
- Toast notifications for success/failure
- Only visible when there are active tasks
- Integrates with existing alert dialog pattern

Props:

- `processingCount`: Number of currently processing tasks
- `queuedCount`: Number of queued tasks
- `className`: Optional styling
- `size`: Button size variant
- `variant`: Button style variant
- `showIcon`: Whether to show cancel icon
- `showCount`: Whether to show task count

#### 2. Dashboard Header Integration

**File**: `/src/components/DashboardHeader.tsx`

- Displays cancel all button when tasks are active
- Uses `useSegmentationQueue` hook for real-time queue stats
- Button appears between Documentation link and Model badge
- Triggers cancel through the button component

#### 3. Mobile Menu Support

**File**: `/src/components/header/MobileMenu.tsx`

- Added cancel all option in mobile navigation
- Shows task count inline
- Orange color for visual distinction
- Triggers same cancel functionality as desktop

#### 4. API Client Method

**File**: `/src/lib/api.ts`

```typescript
async cancelAllUserSegmentations(): Promise<{
  success: boolean;
  cancelledCount: number;
  affectedProjects: string[];
  affectedBatches: string[];
}>
```

### Translations

Added comprehensive translations for all 6 supported languages:

- English (en.ts)
- Czech (cs.ts)
- Spanish (es.ts)
- German (de.ts)
- French (fr.ts)
- Chinese (zh.ts)

Translation keys added to `queue` section:

- `cancelAll`: Button text
- `cancelAllTooltip`: Hover tooltip
- `confirmCancelAll`: Confirmation dialog title
- `confirmCancelAllDescription`: Dialog description
- `processingTasks`: Processing count text
- `queuedTasks`: Queued count text
- `cancelAllWarning`: Warning message
- `confirmCancelAllButton`: Confirm button text
- `cancellingAllSegmentations`: Loading message
- `allSegmentationsCancelled`: Success message
- `affectedProjects`: Affected projects count
- `cancelAllFailed`: Failure message
- `cancelAllError`: Error message
- `cancelling`: Generic cancelling text

## WebSocket Integration

The implementation integrates with the existing WebSocket infrastructure:

- Emits `segmentationCancelled` events for each cancelled task
- Updates are propagated to all relevant project rooms
- Real-time UI updates through existing queue hooks

## Security Considerations

- User can only cancel their own segmentation tasks
- Authentication required via JWT token
- No cross-user cancellation possible
- Audit trail through logging

## Testing Checklist

1. ✅ TypeScript compilation passes
2. ✅ ESLint validation passes
3. ✅ Component renders only when tasks present
4. ✅ Confirmation dialog prevents accidental cancellation
5. ✅ API endpoint properly authenticated
6. ✅ Database updates are atomic
7. ✅ WebSocket notifications sent correctly
8. ✅ Translations complete for all languages

## Related Systems

- Builds on existing universal cancel button pattern
- Extends queue service cancellation infrastructure
- Uses established WebSocket notification system
- Integrates with existing authentication middleware

## Performance Considerations

- Database query optimized with single transaction
- Batch WebSocket emissions for multiple cancellations
- UI updates debounced to prevent flicker
- Component only renders when necessary (tasks > 0)

## Future Enhancements

Potential improvements for future iterations:

1. Add undo functionality (restore cancelled tasks)
2. Selective cancellation (filter by project/model)
3. Cancel history tracking
4. Batch cancellation statistics dashboard
5. Admin ability to cancel any user's tasks

## Known Limitations

- Cannot restore cancelled tasks
- No partial cancellation (all or nothing)
- Desktop button click workaround for mobile trigger
- No cancellation reason tracking
