# WebSocket Infrastructure Comprehensive Analysis - Cell Segmentation Hub

## Overview

The Cell Segmentation Hub uses Socket.io for real-time communication with a sophisticated WebSocket infrastructure that supports project-based rooms, user authentication, and real-time updates for segmentation operations.

## Backend WebSocket Infrastructure

### Core Configuration

- **File**: `/backend/src/services/websocketService.ts`
- **Technology**: Socket.io with HTTP server integration
- **Authentication**: JWT-based using `JWT_ACCESS_SECRET`
- **CORS**: Environment-aware (development vs production)
- **Transports**: WebSocket and polling fallback

### Server Configuration Details

```typescript
// Socket.io server setup
this.io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      // Environment-aware CORS validation
      if (process.env.NODE_ENV === 'development') {
        // Allow localhost origins for development
      } else {
        // Production: validate against WS_ALLOWED_ORIGINS
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
});
```

### Authentication Middleware

- **JWT Token Verification**: Uses `JWT_ACCESS_SECRET` from environment
- **User Database Validation**: Verifies user exists in database
- **Socket Enhancement**: Adds `userId` and `userEmail` to authenticated sockets
- **Error Handling**: Proper error responses for authentication failures

### Room Management System

1. **User Rooms**: `user:${userId}` - Personal notifications
2. **Project Rooms**: `project:${projectId}` - Project-specific updates
3. **Batch Rooms**: `batch:${batchId}` - Batch operation updates

### Permission System

- **Project Access Validation**: Checks project ownership or shared access
- **Dynamic Room Joining**: `join-project` and `leave-project` events
- **Authorization Check**: Validates user access before room joining

## WebSocket Event Types and Patterns

### Core Event Categories

1. **Connection Events**: connect, disconnect, authentication
2. **Segmentation Events**: status updates, completion, failures
3. **Queue Events**: stats, position updates, batch operations
4. **Upload Events**: progress, completion, failures
5. **Project Events**: updates, deletions, sharing
6. **System Events**: errors, warnings, notifications

### Event Type Definitions

**Backend Types** (`/backend/src/types/websocket.ts`):

- 58 comprehensive event type definitions
- Strong typing with TypeScript interfaces
- Type guards for runtime validation
- Enum-based event names for consistency

**Frontend Types** (`/src/types/websocket.ts`):

- Aligned event structures with backend
- Type-safe event handlers
- Union types for message discrimination

### Key Event Structures

#### Segmentation Updates

```typescript
interface SegmentationUpdateData {
  imageId: string;
  projectId: string;
  status: QueueStatus | 'no_segmentation' | 'segmented';
  queueId?: string;
  error?: string;
  progress?: number;
  polygonCount?: number;
  processingTime?: number;
}
```

#### Queue Statistics

```typescript
interface QueueStatsData {
  projectId?: string;
  userId?: string;
  queued: number;
  processing: number;
  completed?: number;
  failed?: number;
  total: number;
  queuePosition?: number;
  estimatedTime?: number;
}
```

#### Upload Progress

```typescript
interface UploadProgressData {
  projectId: string;
  batchId: string;
  filename: string;
  fileSize: number;
  progress: number; // 0-100 for individual file
  currentFileStatus: 'uploading' | 'processing' | 'completed' | 'failed';
  filesCompleted: number;
  filesTotal: number;
  percentComplete: number; // 0-100 for overall batch
  timestamp: Date;
}
```

## Frontend WebSocket Integration

### WebSocket Manager (`/src/services/webSocketManager.ts`)

- **Singleton Pattern**: Single instance management
- **Connection Management**: Auto-reconnection with exponential backoff
- **Message Queuing**: Queues messages when disconnected
- **Event System**: Type-safe event listeners
- **Ping/Keep-Alive**: 25-second ping interval

### React Context Integration

**Provider** (`/src/contexts/WebSocketContext.tsx`):

- Manages WebSocket lifecycle with user authentication
- Provides connection state to components
- Handles cleanup on user logout

**Hook** (`/src/contexts/useWebSocket.ts`):

- Simple context consumer hook
- Provides manager instance and connection state

### Segmentation Queue Hook (`/src/hooks/useSegmentationQueue.tsx`)

- **Project-specific subscriptions**: Automatic room joining/leaving
- **Batch processing detection**: Intelligent toast notifications
- **State management**: Queue stats and last updates
- **Throttled notifications**: Prevents toast spam
- **Error handling**: Graceful failure handling

### Event Handler Patterns

```typescript
// Event listener registration
manager.on('segmentation-update', handleSegmentationUpdate);
manager.on('queue-stats-update', handleQueueStatsUpdate);
manager.on('notification', handleNotification);
manager.on('system-message', handleSystemMessage);

// Cleanup on unmount
return () => {
  manager.off('segmentation-update', handleSegmentationUpdate);
  // ... other cleanup
};
```

## Current Event Emission Patterns

### Where Events Are Emitted

#### Queue Service (`/backend/src/services/queueService.ts`)

- **Queue Stats**: Emitted after queue operations
- **Segmentation Updates**: Status changes during processing
- **Completion Notifications**: Success/failure events
- **Parallel Processing Status**: System-wide capacity updates

#### Image Controller (`/backend/src/api/controllers/imageController.ts`)

- **Upload Progress**: Per-file progress updates
- **Upload Completion**: Batch upload summaries
- **Upload Failures**: Error notifications

#### Queue Controller (`/backend/src/api/controllers/queueController.ts`)

- **Queue Entry**: When images added to queue
- **Batch Operations**: Bulk queue additions
- **Queue Removal**: When items removed from queue

#### Thumbnail Service (`/backend/src/services/thumbnailService.ts`)

- **Thumbnail Updates**: When segmentation thumbnails generated

### Event Emission Functions

1. **`emitSegmentationUpdate(userId, update)`**: User-specific segmentation status
2. **`emitQueueStatsUpdate(projectId, stats)`**: Project-wide queue statistics
3. **`emitParallelProcessingStatus(status)`**: Global system status
4. **`broadcastThumbnailUpdate(projectId, update)`**: Project thumbnail updates
5. **`emitToUser(userId, event, data)`**: Generic user-specific events

## Error Handling and Reconnection

### Auto-Reconnection Strategy

- **Exponential Backoff**: 1s to 30s delays between attempts
- **Max Attempts**: 10 reconnection attempts
- **Socket.io Built-in**: Leverages Socket.io's reconnection logic
- **Manual Reconnection**: For server-initiated disconnects

### Connection State Management

- **Connection Tracking**: Maps userId to socket IDs
- **Multiple Sessions**: Supports multiple browser tabs
- **Graceful Cleanup**: Removes tracking on disconnect

### Error Recovery Patterns

```typescript
// Connection error handling
socket.on('connect_error', error => {
  logger.error('WebSocket CONNECTION ERROR:', error.message);
  // Throttled toast notifications
  // Automatic reconnection by Socket.io
});

// Reconnection events
socket.io.on('reconnect', attempt => {
  logger.info(`WebSocket reconnected after ${attempt} attempts`);
  webSocketEventEmitter.emit({ type: 'reconnected' });
});
```

### Toast Notification Strategy

- **Throttled Notifications**: Minimum 5-second cooldown
- **Batch Detection**: Shows start/end notifications for bulk operations
- **Error Reporting**: Immediate failure notifications
- **Success Suppression**: Prevents success spam during batch operations

## Security Features

### Authentication Requirements

- **JWT Token Required**: All connections must authenticate
- **User Validation**: Database lookup for user existence
- **Token Refresh**: Supports token rotation
- **Graceful Logout**: Cleans up connections on user logout

### Authorization Patterns

- **Project Access Control**: Validates ownership or sharing permissions
- **Room-based Security**: Users can only join authorized project rooms
- **Event Filtering**: Project-specific events only sent to authorized users

### CORS Configuration

- **Development**: Allows localhost origins
- **Production**: Validates against `WS_ALLOWED_ORIGINS` environment variable
- **Credentials**: Supports authenticated requests

## Performance Optimizations

### Connection Management

- **Ping Interval**: 25-second keep-alive pings
- **Connection Pooling**: Efficient socket management
- **Memory Cleanup**: Proper listener removal

### Message Optimization

- **Event Batching**: Bulk operations minimize individual events
- **Selective Emission**: Project/user-specific targeting
- **Data Compression**: Efficient payload structures

### Frontend Optimizations

- **Event Throttling**: Prevents UI flooding
- **State Debouncing**: Reduces unnecessary re-renders
- **Cleanup Patterns**: Prevents memory leaks

## Nginx Configuration for WebSocket

### Critical WebSocket Proxy Settings

```nginx
location /socket.io/ {
    proxy_pass http://backend/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_connect_timeout 7d;
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;
}
```

## Current Limitations and Extension Points

### Missing Real-time Events

1. **Project Card Updates**: No real-time image count updates
2. **Dashboard Metrics**: No live statistics updates
3. **Image Deletion**: No real-time project card refresh
4. **Project Sharing**: Limited real-time sharing notifications

### Extension Opportunities

1. **Project-level Events**: Image count changes, last updated timestamps
2. **Dashboard Events**: Global metrics updates
3. **User Activity**: Real-time activity feeds
4. **System Monitoring**: Performance metrics broadcasting

## Debugging Tools and Patterns

### Development Logging

- **Detailed Debug Logs**: Comprehensive event tracking in development
- **Production Logging**: Minimal, performance-focused logging
- **Error Context**: Rich error information with user/project context

### Testing Infrastructure

- **E2E Tests**: WebSocket connection testing (`/tests/e2e/websocket-queue.spec.ts`)
- **Unit Tests**: Component-level WebSocket integration tests
- **Mock Patterns**: WebSocket manager mocking for testing

## Best Practices Established

1. **Type Safety**: Strong TypeScript typing throughout
2. **Error Boundaries**: Comprehensive error handling
3. **Resource Cleanup**: Proper listener management
4. **User Experience**: Intelligent notification patterns
5. **Performance**: Efficient event targeting and batching
6. **Security**: Authentication and authorization at every level
7. **Scalability**: Room-based architecture for multi-tenant support
