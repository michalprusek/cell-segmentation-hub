# WebSocket Extension Recommendations: Real-time Project Card and Dashboard Updates

## Executive Summary

Based on the comprehensive analysis of the existing WebSocket infrastructure, this document provides specific recommendations for extending the system to support real-time project card updates and dashboard metric refreshes.

## Recommended New Event Types

### 1. Project-Level Events

#### PROJECT_STATS_UPDATE Event

```typescript
interface ProjectStatsUpdateData {
  projectId: string;
  userId: string; // Project owner
  stats: {
    imageCount: number;
    segmentedCount: number;
    pendingCount: number;
    failedCount: number;
    lastUpdated: Date;
    lastImageAdded?: Date;
    lastSegmentationCompleted?: Date;
  };
  operation:
    | 'images_added'
    | 'images_deleted'
    | 'segmentation_completed'
    | 'segmentation_failed';
  affectedImageIds?: string[];
  timestamp: Date;
}
```

#### PROJECT_IMAGE_COUNT_CHANGE Event

```typescript
interface ProjectImageCountChangeData {
  projectId: string;
  userId: string;
  previousCount: number;
  newCount: number;
  changeType: 'upload' | 'delete' | 'bulk_delete';
  affectedImageIds: string[];
  timestamp: Date;
}
```

### 2. Dashboard-Level Events

#### DASHBOARD_METRICS_UPDATE Event

```typescript
interface DashboardMetricsUpdateData {
  userId: string;
  metrics: {
    totalProjects: number;
    totalImages: number;
    totalSegmented: number;
    recentActivity: {
      imagesUploadedToday: number;
      segmentationsCompletedToday: number;
      projectsCreatedThisWeek: number;
    };
    systemStats: {
      queueLength: number;
      processingImages: number;
      avgProcessingTime: number;
    };
  };
  changedFields: string[]; // Array of field names that changed
  timestamp: Date;
}
```

#### USER_ACTIVITY_UPDATE Event

```typescript
interface UserActivityUpdateData {
  userId: string;
  activity: {
    type:
      | 'project_created'
      | 'images_uploaded'
      | 'segmentation_completed'
      | 'project_shared';
    projectId?: string;
    projectName?: string;
    details: {
      count?: number;
      duration?: number;
      success?: boolean;
    };
    timestamp: Date;
  };
}
```

### 3. Shared Project Events

#### SHARED_PROJECT_UPDATE Event

```typescript
interface SharedProjectUpdateData {
  projectId: string;
  ownerId: string;
  sharedWithUserIds: string[];
  updateType:
    | 'images_added'
    | 'images_deleted'
    | 'segmentation_completed'
    | 'project_updated';
  stats: {
    imageCount: number;
    segmentedCount: number;
    lastUpdated: Date;
  };
  timestamp: Date;
}
```

## Implementation Strategy

### Phase 1: Core Project Card Updates

#### 1. Backend Event Emission Points

**Image Upload Completion** (`/backend/src/api/controllers/imageController.ts`):

```typescript
// After successful upload in uploadImages method
const projectStats = await this.getProjectStats(projectId);
const projectStatsUpdate: ProjectStatsUpdateData = {
  projectId,
  userId,
  stats: projectStats,
  operation: 'images_added',
  affectedImageIds: uploadedImages.map(img => img.id),
  timestamp: new Date(),
};

// Emit to project owner
wsService.emitToUser(
  userId,
  WebSocketEvent.PROJECT_STATS_UPDATE,
  projectStatsUpdate
);

// Emit to shared project users
const sharedUsers = await this.getSharedProjectUsers(projectId);
sharedUsers.forEach(sharedUserId => {
  wsService.emitToUser(sharedUserId, WebSocketEvent.SHARED_PROJECT_UPDATE, {
    projectId,
    ownerId: userId,
    sharedWithUserIds: sharedUsers,
    updateType: 'images_added',
    stats: projectStats,
    timestamp: new Date(),
  });
});
```

**Image Deletion** (`/backend/src/api/controllers/imageController.ts`):

```typescript
// After successful deletion in deleteImage/deleteBatch methods
const projectStats = await this.getProjectStats(projectId);
const projectStatsUpdate: ProjectStatsUpdateData = {
  projectId,
  userId,
  stats: projectStats,
  operation: 'images_deleted',
  affectedImageIds: deletedImageIds,
  timestamp: new Date(),
};

wsService.emitToUser(
  userId,
  WebSocketEvent.PROJECT_STATS_UPDATE,
  projectStatsUpdate
);
```

**Segmentation Completion** (`/backend/src/services/queueService.ts`):

```typescript
// After successful segmentation processing
const projectStats = await this.getProjectStats(projectId);
const projectStatsUpdate: ProjectStatsUpdateData = {
  projectId,
  userId: item.userId,
  stats: projectStats,
  operation: 'segmentation_completed',
  affectedImageIds: [item.imageId],
  timestamp: new Date(),
};

this.websocketService?.emitToUser(
  item.userId,
  WebSocketEvent.PROJECT_STATS_UPDATE,
  projectStatsUpdate
);
```

#### 2. Frontend Integration

**New Hook: useProjectCardUpdates**:

```typescript
// /src/hooks/useProjectCardUpdates.ts
export const useProjectCardUpdates = (projectId?: string) => {
  const { manager } = useWebSocket();
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null);

  useEffect(() => {
    if (!manager || !projectId) return;

    const handleProjectStatsUpdate = (update: ProjectStatsUpdateData) => {
      if (update.projectId === projectId) {
        setProjectStats(update.stats);

        // Show appropriate toast notification
        if (update.operation === 'images_added') {
          toast.success(
            `${update.affectedImageIds?.length} images added to project`
          );
        } else if (update.operation === 'segmentation_completed') {
          toast.success(`Segmentation completed for image`);
        }
      }
    };

    manager.on('project-stats-update', handleProjectStatsUpdate);

    return () => {
      manager.off('project-stats-update', handleProjectStatsUpdate);
    };
  }, [manager, projectId]);

  return { projectStats };
};
```

**Project Card Component Updates**:

```typescript
// /src/components/ProjectCard.tsx
const ProjectCard = ({ project }: { project: Project }) => {
  const { projectStats } = useProjectCardUpdates(project.id);

  // Use real-time stats when available, fallback to initial project data
  const displayStats = projectStats || {
    imageCount: project.imageCount,
    segmentedCount: project.segmentedCount,
    lastUpdated: project.updatedAt
  };

  return (
    <Card>
      <CardContent>
        <h3>{project.title}</h3>
        <div className="stats">
          <span>Images: {displayStats.imageCount}</span>
          <span>Segmented: {displayStats.segmentedCount}</span>
          <span>Last updated: {formatDate(displayStats.lastUpdated)}</span>
        </div>
      </CardContent>
    </Card>
  );
};
```

### Phase 2: Dashboard Metrics Updates

#### 1. Dashboard Metrics Service

**New Service: DashboardMetricsService** (`/backend/src/services/dashboardMetricsService.ts`):

```typescript
export class DashboardMetricsService {
  constructor(
    private prisma: PrismaClient,
    private websocketService?: WebSocketService
  ) {}

  async calculateUserMetrics(userId: string): Promise<DashboardMetrics> {
    // Calculate comprehensive dashboard metrics
    const metrics = await this.prisma.$transaction(async tx => {
      const totalProjects = await tx.project.count({ where: { userId } });
      const totalImages = await tx.image.count({
        where: { project: { userId } },
      });
      const totalSegmented = await tx.image.count({
        where: {
          project: { userId },
          segmentationStatus: 'segmented',
        },
      });

      // Additional metrics calculations...
      return { totalProjects, totalImages, totalSegmented /* ... */ };
    });

    return metrics;
  }

  async emitDashboardUpdate(userId: string, changedFields: string[]) {
    if (!this.websocketService) return;

    const metrics = await this.calculateUserMetrics(userId);
    const updateData: DashboardMetricsUpdateData = {
      userId,
      metrics,
      changedFields,
      timestamp: new Date(),
    };

    this.websocketService.emitToUser(
      userId,
      WebSocketEvent.DASHBOARD_METRICS_UPDATE,
      updateData
    );
  }
}
```

#### 2. Dashboard Hook Integration

**New Hook: useDashboardMetrics**:

```typescript
// /src/hooks/useDashboardMetrics.ts
export const useDashboardMetrics = () => {
  const { manager } = useWebSocket();
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (!manager || !user) return;

    const handleDashboardUpdate = (update: DashboardMetricsUpdateData) => {
      if (update.userId === user.id) {
        setMetrics(update.metrics);
        setLastUpdated(update.timestamp);

        // Show subtle notification for significant changes
        if (update.changedFields.includes('totalImages')) {
          toast.info('Dashboard metrics updated');
        }
      }
    };

    manager.on('dashboard-metrics-update', handleDashboardUpdate);

    return () => {
      manager.off('dashboard-metrics-update', handleDashboardUpdate);
    };
  }, [manager, user]);

  return { metrics, lastUpdated };
};
```

### Phase 3: Advanced Features

#### 1. Real-time Activity Feed

**Activity Feed Component**:

```typescript
// /src/components/ActivityFeed.tsx
const ActivityFeed = () => {
  const { manager } = useWebSocket();
  const [activities, setActivities] = useState<UserActivity[]>([]);

  useEffect(() => {
    if (!manager) return;

    const handleUserActivity = (activity: UserActivityUpdateData) => {
      setActivities(prev => [activity.activity, ...prev.slice(0, 9)]); // Keep last 10
    };

    manager.on('user-activity-update', handleUserActivity);

    return () => {
      manager.off('user-activity-update', handleUserActivity);
    };
  }, [manager]);

  return (
    <div className="activity-feed">
      <h3>Recent Activity</h3>
      {activities.map((activity, index) => (
        <div key={index} className="activity-item">
          <ActivityIcon type={activity.type} />
          <div className="activity-content">
            <span>{getActivityMessage(activity)}</span>
            <time>{formatTimeAgo(activity.timestamp)}</time>
          </div>
        </div>
      ))}
    </div>
  );
};
```

#### 2. Optimistic Updates

**Optimistic Project Card Updates**:

```typescript
// /src/hooks/useOptimisticProjectUpdates.ts
export const useOptimisticProjectUpdates = (projectId: string) => {
  const [optimisticStats, setOptimisticStats] = useState<ProjectStats | null>(
    null
  );
  const { projectStats: realTimeStats } = useProjectCardUpdates(projectId);

  const updateOptimistically = useCallback(
    (operation: 'add_images' | 'delete_images', count: number) => {
      setOptimisticStats(prev => {
        if (!prev) return null;

        const newStats = { ...prev };
        if (operation === 'add_images') {
          newStats.imageCount += count;
        } else if (operation === 'delete_images') {
          newStats.imageCount -= count;
        }
        newStats.lastUpdated = new Date();

        return newStats;
      });

      // Clear optimistic update after real update arrives
      setTimeout(() => setOptimisticStats(null), 5000);
    },
    []
  );

  // Real-time stats override optimistic stats
  const displayStats = realTimeStats || optimisticStats;

  return { displayStats, updateOptimistically };
};
```

## Backend Implementation Details

### 1. WebSocket Event Extensions

**Add to WebSocketEvent enum** (`/backend/src/types/websocket.ts`):

```typescript
export enum WebSocketEvent {
  // ... existing events

  // Project events
  PROJECT_STATS_UPDATE = 'projectStatsUpdate',
  PROJECT_IMAGE_COUNT_CHANGE = 'projectImageCountChange',
  SHARED_PROJECT_UPDATE = 'sharedProjectUpdate',

  // Dashboard events
  DASHBOARD_METRICS_UPDATE = 'dashboardMetricsUpdate',
  USER_ACTIVITY_UPDATE = 'userActivityUpdate',
}
```

### 2. Helper Functions

**Project Stats Calculation**:

```typescript
// /backend/src/services/projectStatsService.ts
export class ProjectStatsService {
  constructor(private prisma: PrismaClient) {}

  async getProjectStats(projectId: string): Promise<ProjectStats> {
    const [imageCount, segmentedCount, pendingCount, failedCount] =
      await Promise.all([
        this.prisma.image.count({ where: { projectId } }),
        this.prisma.image.count({
          where: { projectId, segmentationStatus: 'segmented' },
        }),
        this.prisma.image.count({
          where: { projectId, segmentationStatus: 'pending' },
        }),
        this.prisma.image.count({
          where: { projectId, segmentationStatus: 'failed' },
        }),
      ]);

    const lastImage = await this.prisma.image.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    const lastSegmentation = await this.prisma.image.findFirst({
      where: { projectId, segmentationStatus: 'segmented' },
      orderBy: { updatedAt: 'desc' },
    });

    return {
      imageCount,
      segmentedCount,
      pendingCount,
      failedCount,
      lastUpdated: new Date(),
      lastImageAdded: lastImage?.createdAt,
      lastSegmentationCompleted: lastSegmentation?.updatedAt,
    };
  }

  async getSharedProjectUsers(projectId: string): Promise<string[]> {
    const shares = await this.prisma.projectShare.findMany({
      where: { projectId, status: 'accepted' },
      select: { sharedWithId: true },
    });

    return shares.map(share => share.sharedWithId);
  }
}
```

## Performance Considerations

### 1. Event Batching

- **Batch Multiple Changes**: Combine rapid successive updates into single events
- **Debouncing**: Prevent excessive event emission during bulk operations
- **Rate Limiting**: Limit events per user per time period

### 2. Selective Updates

- **Targeted Emission**: Only emit to affected users (project owners/collaborators)
- **Changed Fields**: Include only fields that actually changed
- **Lazy Loading**: Load full metrics only when needed

### 3. Caching Strategy

- **Redis Caching**: Cache frequently accessed metrics
- **TTL Management**: Set appropriate cache expiration times
- **Cache Invalidation**: Clear cache on relevant data changes

## Testing Strategy

### 1. Unit Tests

- Test event emission functions
- Test data transformation logic
- Test WebSocket connection management

### 2. Integration Tests

- Test end-to-end event flow
- Test multi-user scenarios
- Test error handling and recovery

### 3. Performance Tests

- Test with high concurrent users
- Test with rapid event generation
- Test memory usage and cleanup

## Migration Strategy

### Phase 1: Foundation (Week 1-2)

1. Add new event types to backend
2. Implement basic project stats service
3. Add WebSocket event emission for image upload/delete

### Phase 2: Frontend Integration (Week 3-4)

1. Create project card update hooks
2. Update project card components
3. Add optimistic updates

### Phase 3: Dashboard Enhancement (Week 5-6)

1. Implement dashboard metrics service
2. Create dashboard update hooks
3. Add real-time activity feed

### Phase 4: Optimization (Week 7-8)

1. Add caching layer
2. Implement event batching
3. Performance testing and optimization

## Backward Compatibility

- All new events are additive (no breaking changes)
- Existing event handlers continue to work
- Progressive enhancement approach
- Graceful degradation when WebSocket unavailable

## Security Considerations

- **Authorization**: Verify user access before emitting project-specific events
- **Data Filtering**: Only include data user is authorized to see
- **Rate Limiting**: Prevent abuse through excessive event generation
- **Input Validation**: Validate all event payloads

## Monitoring and Observability

- **Event Metrics**: Track event emission rates and types
- **Connection Metrics**: Monitor WebSocket connection health
- **Performance Metrics**: Track event processing times
- **Error Tracking**: Log and alert on WebSocket failures

This comprehensive extension plan provides a robust foundation for real-time project card and dashboard updates while maintaining the existing system's performance and security standards.
