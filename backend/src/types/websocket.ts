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

  // Upload events
  UPLOAD_PROGRESS = 'uploadProgress',
  UPLOAD_COMPLETED = 'uploadCompleted',
  UPLOAD_FAILED = 'uploadFailed',

  // Project events
  PROJECT_UPDATE = 'projectUpdate',
  PROJECT_DELETED = 'projectDeleted',

  // Dashboard events
  DASHBOARD_UPDATE = 'dashboardUpdate',

  // Sharing events
  SHARE_RECEIVED = 'shareReceived',
  SHARE_ACCEPTED = 'shareAccepted',
  SHARE_REJECTED = 'shareRejected',

  // Export events
  EXPORT_STARTED = 'export:started',
  EXPORT_PROGRESS = 'export:progress',
  EXPORT_COMPLETED = 'export:completed',
  EXPORT_FAILED = 'export:failed',
  EXPORT_CANCELLED = 'export:cancelled',
  EXPORT_PHASE_CHANGED = 'export:phase-changed',

  // Error events
  ERROR = 'error',
  VALIDATION_ERROR = 'validationError',
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
  status: QueueStatus | 'no_segmentation' | 'segmented';
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
  errorCode?:
    | 'TIMEOUT'
    | 'MODEL_ERROR'
    | 'INVALID_IMAGE'
    | 'OUT_OF_MEMORY'
    | 'UNKNOWN';
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
// Upload Events
// ============================================================================

/**
 * Upload progress event data
 */
export interface UploadProgressData {
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

/**
 * Upload completed event data
 */
export interface UploadCompletedData {
  projectId: string;
  batchId: string;
  summary: {
    totalFiles: number;
    successCount: number;
    failedCount: number;
    failedFiles?: string[];
  };
  uploadedImages: Array<{
    id: string;
    name: string;
    originalUrl: string;
    thumbnailUrl?: string;
  }>;
  timestamp: Date;
}

/**
 * Upload failed event data
 */
export interface UploadFailedData {
  projectId: string;
  batchId: string;
  filename: string;
  error: string;
  fileIndex: number;
  filesTotal: number;
  canContinue: boolean;
  timestamp: Date;
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
// Dashboard Events
// ============================================================================

/**
 * Dashboard metrics update event
 */
export interface DashboardUpdateData {
  userId: string;
  metrics: {
    totalProjects: number;
    totalImages: number;
    processedImages: number;
    imagesUploadedToday: number;
    storageUsed: string;
    storageUsedBytes: number;
  };
  timestamp: Date;
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
// Export Events
// ============================================================================

/**
 * Export started event data
 */
export interface ExportStartedData {
  jobId: string;
  projectId: string;
  projectName?: string;
  estimatedDuration?: number;
  options: {
    includeOriginalImages?: boolean;
    includeVisualizations?: boolean;
    annotationFormats?: string[];
    metricsFormats?: string[];
  };
  timestamp: Date;
}

/**
 * Export progress event data with enhanced context
 */
export interface ExportProgressData {
  jobId: string;
  progress: number; // 0-100
  phase: 'processing' | 'downloading';
  stage?:
    | 'images'
    | 'visualizations'
    | 'annotations'
    | 'metrics'
    | 'compression';
  message: string;
  stageProgress?: {
    current: number;
    total: number;
    currentItem?: string;
  };
  estimatedTimeRemaining?: number;
  timestamp: Date;
}

/**
 * Export phase change event
 */
export interface ExportPhaseChangeData {
  jobId: string;
  fromPhase: string;
  toPhase: string;
  progress: number;
  message: string;
  timestamp: Date;
}

/**
 * Export completed event data
 */
export interface ExportCompletedData {
  jobId: string;
  projectId: string;
  filePath: string;
  fileSize?: number;
  processingTime: number;
  summary: {
    totalImages: number;
    includedFormats: string[];
    exportOptions: Record<string, unknown>;
  };
  timestamp: Date;
}

/**
 * Export failed event data
 */
export interface ExportFailedData {
  jobId: string;
  projectId: string;
  error: string;
  errorCode?:
    | 'INSUFFICIENT_SPACE'
    | 'PERMISSION_DENIED'
    | 'TIMEOUT'
    | 'UNKNOWN';
  stage?: string;
  recoverable: boolean;
  retryable: boolean;
  timestamp: Date;
}

/**
 * Export cancelled event data
 */
export interface ExportCancelledData {
  jobId: string;
  projectId: string;
  cancelledBy: 'user' | 'system' | 'timeout';
  progress: number;
  cleanupCompleted: boolean;
  message: string;
  timestamp: Date;
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
 * Generate room name for export-specific events
 */
export function getExportRoom(jobId: string): string {
  return `export:${jobId}`;
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
export function isSegmentationStatusData(
  data: unknown
): data is SegmentationStatusData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
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
export function isSegmentationUpdateData(
  data: unknown
): data is SegmentationUpdateData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const d = data as Record<string, unknown>;
  return (
    typeof d.imageId === 'string' &&
    typeof d.projectId === 'string' &&
    typeof d.status === 'string' &&
    [
      'queued',
      'processing',
      'completed',
      'failed',
      'cancelled',
      'no_segmentation',
    ].includes(d.status as string)
  );
}

/**
 * Type guard for QueueStatsData
 */
export function isQueueStatsData(data: unknown): data is QueueStatsData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
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
export function isSegmentationCompletedData(
  data: unknown
): data is SegmentationCompletedData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const d = data as Record<string, unknown>;
  return (
    typeof d.imageId === 'string' &&
    typeof d.projectId === 'string' &&
    typeof d.segmentationId === 'string' &&
    typeof d.polygonCount === 'number' &&
    typeof d.processingTime === 'number' &&
    typeof d.model === 'string' &&
    ['hrnet', 'cbam_resunet'].includes(d.model as string)
  );
}

/**
 * Type guard for SegmentationFailedData
 */
export function isSegmentationFailedData(
  data: unknown
): data is SegmentationFailedData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
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
  if (typeof data !== 'object' || data === null) {
    return false;
  }
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
  isWebSocketMessage,
};
