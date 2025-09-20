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
  queueLength: number;
  processing: number;
  userPosition?: number;
  estimatedWaitTime?: number; // in seconds
  averageProcessingTime?: number; // in seconds
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
  concurrentOperations: {
    active: number;
    max: number;
  };
  mlWorkers: {
    active: number;
    max: number;
  };
  batchProcessing: {
    currentBatchSize: number;
    modelOptimalSizes: {
      hrnet: number;
      cbam_resunet: number;
    };
  };
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
  | ParallelProcessingStatusMessage;

/**
 * Type guard functions for message type checking
 */
export const isSegmentationStatusMessage = (
  msg: WebSocketMessage
): msg is SegmentationStatusMessage => msg.type === 'segmentationStatus';

export const isQueueStatsMessage = (
  msg: WebSocketMessage
): msg is QueueStatsMessage => msg.type === 'queueStats';

export const isSegmentationCompletedMessage = (
  msg: WebSocketMessage
): msg is SegmentationCompletedMessage => msg.type === 'segmentationCompleted';

export const isSegmentationFailedMessage = (
  msg: WebSocketMessage
): msg is SegmentationFailedMessage => msg.type === 'segmentationFailed';

export const isSegmentationProgressMessage = (
  msg: WebSocketMessage
): msg is SegmentationProgressMessage => msg.type === 'segmentationProgress';

export const isConnectionStatusMessage = (
  msg: WebSocketMessage
): msg is ConnectionStatusMessage => msg.type === 'connectionStatus';

export const isParallelProcessingStatusMessage = (
  msg: WebSocketMessage
): msg is ParallelProcessingStatusMessage =>
  msg.type === 'parallelProcessingStatus';

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
  parallelProcessingStatus: ParallelProcessingStatusMessage;
  connect: void;
  disconnect: { reason?: string };
  error: Error;
  reconnect: { attemptNumber: number };
}

/**
 * Typed event emitter interface
 */
export interface TypedEventEmitter<T extends Record<string, any>> {
  on<K extends keyof T>(event: K, listener: (data: T[K]) => void): this;
  off<K extends keyof T>(event: K, listener: (data: T[K]) => void): this;
  emit<K extends keyof T>(event: K, data: T[K]): boolean;
  once<K extends keyof T>(event: K, listener: (data: T[K]) => void): this;
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
}

/**
 * Queue statistics for UI display
 */
export interface QueueStats {
  queueLength: number;
  processing: number;
  userPosition?: number;
  estimatedWaitTime?: number;
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

/**
 * WebSocket manager interface
 */
export interface IWebSocketManager
  extends TypedEventEmitter<WebSocketEventMap> {
  connect(options?: WebSocketConnectionOptions): void;
  disconnect(): void;
  isConnected(): boolean;
  send<K extends keyof WebSocketEventMap>(
    event: K,
    data: WebSocketEventMap[K]
  ): void;
}
