# Real-time Project Card and Dashboard Metric Updates Implementation

## Overview

Comprehensive implementation of real-time updates for project cards and dashboard metrics in the Cell Segmentation Hub application, providing immediate feedback when images are uploaded, deleted, or segmentation is completed.

## Backend Implementation

### 1. WebSocket Event Types (`/backend/src/types/websocket.ts`)

Added new event types:

- `PROJECT_STATS_UPDATE` - Real-time project statistics updates
- `PROJECT_IMAGE_COUNT_CHANGE` - Image count changes
- `SHARED_PROJECT_UPDATE` - Updates for shared project users
- `DASHBOARD_METRICS_UPDATE` - Dashboard-wide metric updates
- `USER_ACTIVITY_UPDATE` - User activity notifications
- `IMAGE_DELETED` / `BATCH_IMAGES_DELETED` - Image deletion events

### 2. ProjectStatsService (`/backend/src/services/projectStatsService.ts`)

**Single Source of Truth (SSOT)** service for project statistics:

- **Centralized statistics calculation** for projects and dashboards
- **Automatic WebSocket emissions** for real-time updates
- **Shared project notifications** to all authorized users
- **Cache invalidation** integration
- **Handles all image operations**: upload, delete, segmentation completion

Key methods:

- `getProjectStats()` - Comprehensive project statistics
- `getDashboardMetrics()` - User dashboard metrics
- `emitProjectStatsUpdate()` - Real-time project updates
- `emitDashboardMetricsUpdate()` - Dashboard metric updates
- `handleImageUpload()` - Upload operation handling
- `handleImageDeletion()` - Delete operation handling
- `handleSegmentationCompletion()` - Segmentation completion handling

### 3. Cache Service Extensions (`/backend/src/services/cacheService.ts`)

Enhanced cache invalidation strategies:

- `projectStats()` - Invalidates project-specific caches
- `dashboardMetrics()` - Invalidates user dashboard caches
- `sharedProject()` - Invalidates caches for multiple shared users
- `imageWithStats()` - Combined image and stats cache invalidation

### 4. Integration Points

#### Image Controller (`/backend/src/api/controllers/imageController.ts`)

- **Upload completion**: Emits project stats updates and cache invalidation
- **Single image deletion**: Gets project ID before deletion, emits updates
- **Batch deletion**: Handles bulk operations with statistics updates

#### Queue Service (`/backend/src/services/queueService.ts`)

- **Segmentation completion**: Emits project stats after successful segmentation
- **Failed segmentation**: Also triggers stats update for completion tracking
- **Batch processing**: Handles multiple segmentations efficiently

## Frontend Implementation

### 1. WebSocket Type Definitions (`/src/types/websocket.ts`)

Extended frontend types to match backend events:

- `ProjectStats` interface
- `ProjectStatsUpdateMessage`
- `SharedProjectUpdateMessage`
- `DashboardMetrics` interface
- `DashboardMetricsUpdateMessage`
- Type guards and event map updates

### 2. Real-time Hooks

#### `useProjectCardUpdates` (`/src/hooks/useProjectCardUpdates.tsx`)

- **Real-time project statistics** with fallback to initial data
- **Shared project support** with different notification styles
- **Optimistic updates** for immediate UI feedback
- **Error handling** and connection status tracking
- **Toast notifications** for significant changes

Features:

- Automatic WebSocket event subscription/cleanup
- Different handling for owned vs shared projects
- 5-second optimistic update timeout
- Graceful degradation when WebSocket unavailable

#### `useDashboardMetrics` (`/src/hooks/useDashboardMetrics.tsx`)

- **Dashboard-wide metrics** with real-time updates
- **Activity tracking** with recent activity feed
- **Configurable notifications** with threshold controls
- **Formatted metrics** for display (storage, efficiency, trends)
- **Manual refresh** capability

Features:

- Previous value comparison for change detection
- Throttled notifications (configurable threshold)
- Activity feed (last 10 activities)
- Storage formatting (MB/GB automatic switching)
- Connection error handling

#### `useSharedProjectNotifications` (`/src/hooks/useSharedProjectNotifications.tsx`)

- **Shared project notifications** for collaborative features
- **Owner activity alerts** for project sharing
- **Actionable toasts** with navigation links
- **Quiet mode support** for reduced notifications

### 3. Component Updates

#### ProjectCard (`/src/components/ProjectCard.tsx`)

Enhanced with real-time features:

- **Real-time stats display** (image count, segmented count)
- **Segmentation progress bar** with percentage
- **Last updated timestamps** with relative time formatting
- **Recent update indicator** with animated activity icon
- **WebSocket error indicator** for connection issues
- **Graceful fallback** to initial props when WebSocket unavailable

New features:

- Progress bar for segmentation completion percentage
- "Recently updated" indicator with animation
- Real-time timestamp updates
- Enhanced metadata display

#### StatsOverview (`/src/components/StatsOverview.tsx`)

Enhanced dashboard metrics display:

- **Real-time metric cards** with live data indicators
- **Connection status indicators** (WiFi icons with animation)
- **Recent update highlighting** (green ring around updated cards)
- **Loading states** with skeleton animations
- **Trend indicators** (efficiency, queue length)
- **Retry functionality** for connection errors
- **Real-time status footer** with last update time

New StatCard features:

- Real-time indicators (WiFi icon)
- Recent update highlighting
- Loading skeleton states
- Enhanced trend displays
- Connection status awareness

### 4. Global Integration (`/src/App.tsx`)

Added `SharedProjectNotificationsHandler` component:

- **Global shared project notifications** throughout the app
- **Automatic activation** when user is authenticated
- **No UI rendering** - pure notification handling
- **Integrated with existing WebSocket infrastructure**

## Key Features Implemented

### 1. Real-time Updates

- **Image upload/delete**: Immediate project card updates
- **Segmentation completion**: Live progress tracking
- **Shared projects**: Collaborative update notifications
- **Dashboard metrics**: Live statistics across all projects

### 2. Performance Optimizations

- **SSOT principle**: Single ProjectStatsService for all calculations
- **Efficient caching**: Targeted cache invalidation
- **Debounced updates**: Prevents excessive notifications
- **Optimistic updates**: Immediate UI feedback
- **Selective emissions**: Only to authorized users

### 3. User Experience

- **Immediate feedback**: No page refresh needed
- **Visual indicators**: Real-time status, recent updates
- **Progressive enhancement**: Works without WebSocket
- **Graceful degradation**: Fallback to initial data
- **Configurable notifications**: User can control verbosity

### 4. Collaborative Features

- **Shared project notifications**: All collaborators see updates
- **Owner activity alerts**: When projects are shared
- **Real-time collaboration**: Multiple users see same data
- **Permission-aware**: Only authorized users receive updates

## Database Integration

- **Efficient queries**: Optimized statistics calculations
- **Transaction safety**: Atomic operations where needed
- **Real-time triggers**: Updates emit immediately after database changes
- **Cache consistency**: Invalidation prevents stale data

## WebSocket Architecture

- **Event-driven**: All updates flow through WebSocket events
- **Type-safe**: Full TypeScript coverage for all events
- **Scalable**: Room-based targeting for efficient distribution
- **Reliable**: Auto-reconnection and error handling
- **Secure**: Authorization checks before event emission

## Testing Strategy

- **Manual testing**: Upload/delete operations trigger updates
- **Real-time verification**: Check WebSocket event flow
- **Shared project testing**: Multi-user scenario validation
- **Error scenario testing**: Connection loss handling
- **Performance testing**: Large batch operations

## Files Modified/Created

### Backend Files Created:

- `/backend/src/services/projectStatsService.ts` - SSOT statistics service

### Backend Files Modified:

- `/backend/src/types/websocket.ts` - New event types and interfaces
- `/backend/src/services/cacheService.ts` - Enhanced invalidation strategies
- `/backend/src/api/controllers/imageController.ts` - WebSocket integration
- `/backend/src/services/queueService.ts` - Segmentation completion updates

### Frontend Files Created:

- `/src/hooks/useProjectCardUpdates.tsx` - Project card real-time updates
- `/src/hooks/useDashboardMetrics.tsx` - Dashboard metrics real-time updates
- `/src/hooks/useSharedProjectNotifications.tsx` - Shared project notifications

### Frontend Files Modified:

- `/src/types/websocket.ts` - New event types and type guards
- `/src/components/ProjectCard.tsx` - Real-time stats display
- `/src/components/StatsOverview.tsx` - Real-time dashboard metrics
- `/src/App.tsx` - Global notification handler integration

## Usage Examples

### Project Card Updates

```typescript
const { stats, lastUpdate, updateOptimistically } = useProjectCardUpdates({
  projectId: 'project-123',
  isShared: false,
});

// Real-time stats available in stats object
// Optimistic updates for immediate feedback
updateOptimistically('add_images', 5);
```

### Dashboard Metrics

```typescript
const { metrics, formattedMetrics, refreshMetrics } = useDashboardMetrics({
  enableNotifications: true,
  notificationThreshold: 1,
});

// Real-time metrics with formatted display values
// Manual refresh capability
```

### Shared Project Notifications

```typescript
// Automatically enabled in App.tsx - no manual setup needed
// Notifications appear automatically for shared project updates
```

## Implementation Benefits

1. **Immediate User Feedback**: No waiting for page refreshes
2. **Collaborative Awareness**: Users see each other's changes in real-time
3. **Performance**: Efficient updates without full page reloads
4. **Scalability**: Event-driven architecture scales well
5. **Maintainability**: SSOT principle reduces code duplication
6. **User Experience**: Smooth, responsive interface
7. **Data Consistency**: Cache invalidation prevents stale data

## Future Enhancements

1. **Batch Optimization**: Further optimize bulk operation notifications
2. **Presence Indicators**: Show who else is viewing/editing projects
3. **Conflict Resolution**: Handle simultaneous edits gracefully
4. **Offline Support**: Queue updates when connection is lost
5. **Metrics History**: Track metrics over time for trends
6. **Advanced Filtering**: More granular notification controls
