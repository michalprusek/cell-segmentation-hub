/**
 * WebSocket Type Definitions
 * 
 * Comprehensive TypeScript interfaces for WebSocket events and real-time updates.
 */

import { QueueStatus, SegmentationModel } from './queue';

// ============================================================================
// WebSocket Event Names
// ============================================================================

/**
 * WebSocket event names enum for type safety
 */
export enum WebSocketEvent {
  // Connection events
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  CONNECTION_STATUS = 'connectionStatus',
  
  // Authentication events
  AUTHENTICATE = 'authenticate',
  AUTHENTICATION_ERROR = 'authenticationError',
  
  // Segmentation events
  SEGMENTATION_STATUS = 'segmentationStatus',
  SEGMENTATION_UPDATE = 'segmentationUpdate',
  SEGMENTATION_COMPLETED = 'segmentationCompleted',
  SEGMENTATION_FAILED = 'segmentationFailed',
  SEGMENTATION_PROGRESS = 'segmentationProgress',
  
  // Queue events
  QUEUE_STATS = 'queueStats',
  QUEUE_POSITION = 'queuePosition',
  QUEUE_UPDATE = 'queueUpdate',
  
  // Project events
  PROJECT_UPDATE = 'projectUpdate',
  PROJECT_DELETED = 'projectDeleted',
  
  // Sharing events
  SHARE_RECEIVED = 'shareReceived',
  SHARE_ACCEPTED = 'shareAccepted',
  SHARE_REJECTED = 'shareRejected',
  
  // Error events
  ERROR = 'error',
  VALIDATION_ERROR = 'validationError'
}

// ============================================================================
// Connection Events
// ============================================================================

/**
 * Connection status data
 */
export interface ConnectionStatusData {
  status: 'connected' | 'disconnected' | 'reconnecting';
  userId?: string;
  timestamp: Date;
  reconnectAttempt?: number;
  maxReconnectAttempts?: number;
}

/**
 * Authentication data
 */
export interface AuthenticateData {
  token: string;
  userId?: string;
}

/**
 * Authentication error data
 */
export interface AuthenticationErrorData {
  error: string;
  code: 'INVALID_TOKEN' | 'TOKEN_EXPIRED' | 'USER_NOT_FOUND';
  message: string;
}

// ============================================================================
// Segmentation Events
// ============================================================================

/**
 * Segmentation status update
 */
export interface SegmentationStatusData {
  imageId: string;
  projectId: string;
  status: QueueStatus;
  queueId?: string;
  progress?: number;
  message?: string;
  estimatedTimeRemaining?: number;
}

/**
 * Segmentation update event (generic)
 */
export interface SegmentationUpdateData {
  imageId: string;
  projectId: string;
  status: QueueStatus | 'no_segmentation';
  queueId?: string;
  error?: string;
  progress?: number;
  polygonCount?: number;
  processingTime?: number;
}

/**
 * Segmentation completed event
 */
export interface SegmentationCompletedData {
  imageId: string;
  projectId: string;
  segmentationId: string;
  polygonCount: number;
  processingTime: number;
  model: SegmentationModel;
  threshold: number;
  detectHoles: boolean;
  batchId?: string;
  queuePosition?: number;
}

/**
 * Segmentation failed event
 */
export interface SegmentationFailedData {
  imageId: string;
  projectId: string;
  queueId: string;
  error: string;
  errorCode?: 'TIMEOUT' | 'MODEL_ERROR' | 'INVALID_IMAGE' | 'OUT_OF_MEMORY' | 'UNKNOWN';
  suggestion?: string;
  model: SegmentationModel;
  retryable: boolean;
  retryCount?: number;
  maxRetries?: number;
}

/**
 * Segmentation progress event
 */
export interface SegmentationProgressData {
  imageId: string;
  projectId: string;
  queueId: string;
  progress: number; // 0-100
  stage: 'preprocessing' | 'inference' | 'postprocessing' | 'saving';
  message?: string;
  estimatedTimeRemaining?: number;
}

// ============================================================================
// Queue Events
// ============================================================================

/**
 * Queue statistics update
 */
export interface QueueStatsData {
  projectId?: string;
  userId?: string;
  queued: number;
  processing: number;
  completed?: number;
  failed?: number;
  total: number;
  queuePosition?: number;
  estimatedTime?: number;
  averageProcessingTime?: number;
  currentThroughput?: number; // items per minute
}

/**
 * Queue position update
 */
export interface QueuePositionData {
  imageId: string;
  projectId: string;
  queueId: string;
  position: number;
  totalInQueue: number;
  estimatedWaitTime?: number;
  estimatedStartTime?: Date;
}

/**
 * Queue update event (batch operations)
 */
export interface QueueUpdateData {
  projectId: string;
  operation: 'added' | 'removed' | 'cancelled' | 'reset';
  affectedCount: number;
  queueIds?: string[];
  newStats: QueueStatsData;
}

// ============================================================================
// Project Events
// ============================================================================

/**
 * Project update event
 */
export interface ProjectUpdateData {
  projectId: string;
  userId: string;
  operation: 'created' | 'updated' | 'deleted' | 'shared';
  updates?: {
    title?: string;
    description?: string;
    imageCount?: number;
    segmentedCount?: number;
  };
  timestamp: Date;
}

/**
 * Project deleted event
 */
export interface ProjectDeletedData {
  projectId: string;
  userId: string;
  deletedAt: Date;
  imageCount: number;
  segmentationCount: number;
}

// ============================================================================
// Sharing Events
// ============================================================================

/**
 * Share received event
 */
export interface ShareReceivedData {
  shareId: string;
  projectId: string;
  projectTitle: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  sharedWithEmail: string;
  message?: string;
  expiresAt?: Date;
  permissions: SharePermissions;
}

/**
 * Share accepted event
 */
export interface ShareAcceptedData {
  shareId: string;
  projectId: string;
  acceptedBy: string;
  acceptedAt: Date;
}

/**
 * Share rejected event
 */
export interface ShareRejectedData {
  shareId: string;
  projectId: string;
  rejectedBy: string;
  rejectedAt: Date;
  reason?: string;
}

/**
 * Share permissions
 */
export interface SharePermissions {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canSegment: boolean;
  canExport: boolean;
}

// ============================================================================
// Error Events
// ============================================================================

/**
 * Generic error event
 */
export interface ErrorData {
  code: string;
  message: string;
  details?: unknown;
  timestamp: Date;
  recoverable: boolean;
  action?: string;
}

/**
 * Validation error event
 */
export interface ValidationErrorData {
  field: string;
  value: unknown;
  error: string;
  constraints?: Record<string, unknown>;
}

// ============================================================================
// WebSocket Message Envelope
// ============================================================================

/**
 * WebSocket message envelope for typed events
 */
export interface WebSocketMessage<T = unknown> {
  event: WebSocketEvent | string;
  data: T;
  timestamp: Date;
  userId?: string;
  sessionId?: string;
  correlationId?: string;
}

// ============================================================================
// WebSocket Room Names
// ============================================================================

/**
 * Generate room name for user-specific events
 */
export function getUserRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Generate room name for project-specific events
 */
export function getProjectRoom(projectId: string): string {
  return `project:${projectId}`;
}

/**
 * Generate room name for batch operations
 */
export function getBatchRoom(batchId: string): string {
  return `batch:${batchId}`;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for SegmentationStatusData
 */
export function isSegmentationStatusData(data: unknown): data is SegmentationStatusData {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  return (
    typeof d.imageId === 'string' &&
    typeof d.projectId === 'string' &&
    typeof d.status === 'string'
  );
}

/**
 * Type guard for SegmentationUpdateData
 */
export function isSegmentationUpdateData(data: unknown): data is SegmentationUpdateData {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  return (
    typeof d.imageId === 'string' &&
    typeof d.projectId === 'string' &&
    typeof d.status === 'string' &&
    ['queued', 'processing', 'completed', 'failed', 'cancelled', 'no_segmentation'].includes(d.status as string)
  );
}

/**
 * Type guard for QueueStatsData
 */
export function isQueueStatsData(data: unknown): data is QueueStatsData {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  return (
    typeof d.queued === 'number' &&
    typeof d.processing === 'number' &&
    typeof d.total === 'number'
  );
}

/**
 * Type guard for SegmentationCompletedData
 */
export function isSegmentationCompletedData(data: unknown): data is SegmentationCompletedData {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  return (
    typeof d.imageId === 'string' &&
    typeof d.projectId === 'string' &&
    typeof d.segmentationId === 'string' &&
    typeof d.polygonCount === 'number' &&
    typeof d.processingTime === 'number' &&
    typeof d.model === 'string' &&
    ['hrnet', 'resunet_advanced', 'resunet_small'].includes(d.model as string)
  );
}

/**
 * Type guard for SegmentationFailedData
 */
export function isSegmentationFailedData(data: unknown): data is SegmentationFailedData {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  return (
    typeof d.imageId === 'string' &&
    typeof d.projectId === 'string' &&
    typeof d.queueId === 'string' &&
    typeof d.error === 'string' &&
    typeof d.model === 'string' &&
    typeof d.retryable === 'boolean'
  );
}

/**
 * Type guard for WebSocketMessage
 */
export function isWebSocketMessage(data: unknown): data is WebSocketMessage {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  return (
    typeof d.event === 'string' &&
    d.data !== undefined &&
    d.timestamp !== undefined
  );
}

// ============================================================================
// Export
// ============================================================================

export default {
  WebSocketEvent,
  getUserRoom,
  getProjectRoom,
  getBatchRoom,
  isSegmentationStatusData,
  isSegmentationUpdateData,
  isSegmentationCompletedData,
  isSegmentationFailedData,
  isQueueStatsData,
  isWebSocketMessage
};