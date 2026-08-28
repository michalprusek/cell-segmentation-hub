/**
 * Strongly typed WebSocket message payloads for segmentation queue
 */

/**
 * Segmentation status types that can be received via WebSocket
 */
export type SegmentationStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'segmented'
  | 'completed'
  | 'failed'
  | 'no_segmentation';

/**
 * Base interface for all WebSocket messages
 */
interface BaseWebSocketMessage {
  timestamp: number;
  projectId?: string;
}

/**
 * Segmentation status update message
 */
export interface SegmentationStatusMessage extends BaseWebSocketMessage {
  type: 'segmentationStatus';
  imageId: string;
  status: SegmentationStatus;
  polygonCount?: number;
  error?: string;
  metadata?: {
    processingTime?: number;
    modelUsed?: string;
    imageSize?: { width: number; height: number };
  };
}

/**
 * Queue statistics message
 */
export interface QueueStatsMessage extends BaseWebSocketMessage {
  type: 'queueStats';
  // Wire shape from backend queueService.emitQueueStatsUpdate: queued,
  // processing, and total are always present. queueLength is a deprecated
  // alias retained for older test fixtures and will be removed once they
  // migrate; nothing on the wire populates it.
  queued: number;
  processing: number;
  total: number;
  queueLength?: number;
  userPosition?: number;
  estimatedWaitTime?: number; // in seconds
  averageProcessingTime?: number; // in seconds
  // Parallel processing fields
  parallelProcessing?: {
    totalSlots: number;
    activeSlots: number;
    concurrentUsers: number;
    userSlotId?: number;
    isEnabled: boolean;
  };
}

/**
 * Segmentation completed message
 */
export interface SegmentationCompletedMessage extends BaseWebSocketMessage {
  type: 'segmentationCompleted';
  imageId: string;
  polygonCount: number;
  processingTime: number; // in milliseconds
  modelUsed?: string;
  confidence?: number;
}

/**
 * Segmentation failed message
 */
export interface SegmentationFailedMessage extends BaseWebSocketMessage {
  type: 'segmentationFailed';
  imageId: string;
  error: string;
  errorCode?: string;
  retry?: boolean;
  retryCount?: number;
}

/**
 * Progress update message for long-running segmentations
 */
export interface SegmentationProgressMessage extends BaseWebSocketMessage {
  type: 'segmentationProgress';
  imageId: string;
  progress: number; // 0-100
  stage?: 'preprocessing' | 'inference' | 'postprocessing';
  message?: string;
}

/**
 * Connection status message
 */
export interface ConnectionStatusMessage extends BaseWebSocketMessage {
  type: 'connectionStatus';
  status: 'connected' | 'disconnected' | 'reconnecting';
  reason?: string;
  attemptNumber?: number;
}

/**
 * Parallel processing status message
 */
export interface ParallelProcessingStatusMessage extends BaseWebSocketMessage {
  type: 'parallelProcessingStatus';
  totalSlots: number;
  activeSlots: {
    id: number;
    userId: string;
    userName?: string;
    imageId?: string;
    startTime: number;
    estimatedCompletion?: number;
    progress?: number;
  }[];
  waitingUsers: number;
  avgProcessingTime?: number;
}

/**
 * Concurrent user count message
 */
export interface ConcurrentUserMessage extends BaseWebSocketMessage {
  type: 'concurrentUsers';
  count: number;
  activeUsers: {
    userId: string;
    userName?: string;
    slotId?: number;
  }[];
}

/**
 * Processing stream update message
 */
export interface ProcessingStreamUpdateMessage extends BaseWebSocketMessage {
  type: 'processingStreamUpdate';
  slotId: number;
  userId?: string;
  status: 'started' | 'progress' | 'completed' | 'failed' | 'idle';
  imageId?: string;
  progress?: number; // 0-100
  estimatedCompletion?: number; // seconds
}

/**
 * Queue position update for parallel processing
 */
export interface QueuePositionUpdateMessage extends BaseWebSocketMessage {
  type: 'queuePositionUpdate';
  userPosition: number;
  estimatedWaitTime: number; // seconds
  queueLength: number;
  activeSlots: number;
  reason?: 'user_added' | 'user_completed' | 'slot_freed' | 'position_changed';
}

/**
 * Union type of all possible WebSocket messages
 */
export type WebSocketMessage =
  | SegmentationStatusMessage
  | QueueStatsMessage
  | SegmentationCompletedMessage
  | SegmentationFailedMessage
  | SegmentationProgressMessage
  | ConnectionStatusMessage
  | ParallelProcessingStatusMessage
  | ConcurrentUserMessage
  | ProcessingStreamUpdateMessage
  | QueuePositionUpdateMessage;

/**
 * WebSocket event names mapped to their payload types
 */
export interface WebSocketEventMap {
  segmentationStatus: SegmentationStatusMessage;
  queueStats: QueueStatsMessage;
  segmentationCompleted: SegmentationCompletedMessage;
  segmentationFailed: SegmentationFailedMessage;
  segmentationProgress: SegmentationProgressMessage;
  connectionStatus: ConnectionStatusMessage;
  // Parallel processing events
  parallelProcessingStatus: ParallelProcessingStatusMessage;
  concurrentUsers: ConcurrentUserMessage;
  processingStreamUpdate: ProcessingStreamUpdateMessage;
  queuePositionUpdate: QueuePositionUpdateMessage;
  // Connection events
  connect: void;
  disconnect: { reason?: string };
  error: Error;
  reconnect: { attemptNumber: number };
}

/**
 * Segmentation update for UI components
 */
export interface SegmentationUpdate {
  imageId: string;
  status: SegmentationStatus;
  timestamp: number;
  polygonCount?: number;
  error?: string;
  queuePosition?: number;
  projectId?: string; // Added to match backend SegmentationUpdateData
}

/**
 * Queue statistics for UI display
 */
export interface QueueStats {
  // Match backend QueueStatsData wire shape. queueLength is retained as
  // a deprecated alias for older fixtures; runtime never populates it.
  queued: number;
  processing: number;
  total: number;
  queueLength?: number;
  userPosition?: number;
  estimatedWaitTime?: number;
  projectId?: string;
  // Parallel processing fields
  parallelProcessing?: {
    totalSlots: number;
    activeSlots: number;
    concurrentUsers: number;
    userSlotId?: number;
    isEnabled: boolean;
    avgProcessingTime?: number;
  };
}

/**
 * WebSocket connection options
 */
export interface WebSocketConnectionOptions {
  projectId?: string;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
  timeout?: number;
  autoConnect?: boolean;
}
