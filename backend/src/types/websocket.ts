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

  // Parallel processing events
  PARALLEL_PROCESSING_STATUS = 'parallelProcessingStatus',
  
  // Upload events
  UPLOAD_PROGRESS = 'uploadProgress',
  UPLOAD_COMPLETED = 'uploadCompleted',
  UPLOAD_FAILED = 'uploadFailed',
  
  // Project events
  PROJECT_UPDATE = 'projectUpdate',
  PROJECT_DELETED = 'projectDeleted',
  
  // Sharing events
  SHARE_RECEIVED = 'shareReceived',
  SHARE_ACCEPTED = 'shareAccepted',
  SHARE_REJECTED = 'shareRejected',

  // Project statistics events
  PROJECT_STATS_UPDATE = 'projectStatsUpdate',
  PROJECT_IMAGE_COUNT_CHANGE = 'projectImageCountChange',
  SHARED_PROJECT_UPDATE = 'sharedProjectUpdate',

  // Dashboard metrics events
  DASHBOARD_METRICS_UPDATE = 'dashboardMetricsUpdate',
  USER_ACTIVITY_UPDATE = 'userActivityUpdate',

  // Image deletion events
  IMAGE_DELETED = 'imageDeleted',
  BATCH_IMAGES_DELETED = 'batchImagesDeleted',

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

/**
 * Parallel processing status update
 */
export interface ParallelProcessingStatusData {
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
  timestamp: Date;
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
// Project Statistics Events
// ============================================================================

/**
 * Project statistics data structure
 */
export interface ProjectStats {
  imageCount: number;
  segmentedCount: number;
  pendingCount: number;
  failedCount: number;
  lastUpdated: Date;
  lastImageAdded?: Date;
  lastSegmentationCompleted?: Date;
  totalFileSize?: number;
}

/**
 * Project statistics update event
 */
export interface ProjectStatsUpdateData {
  projectId: string;
  userId: string; // Project owner
  stats: ProjectStats;
  operation: 'images_added' | 'images_deleted' | 'segmentation_completed' | 'segmentation_failed' | 'batch_uploaded' | 'batch_deleted';
  affectedImageIds?: string[];
  timestamp: Date;
}

/**
 * Project image count change event
 */
export interface ProjectImageCountChangeData {
  projectId: string;
  userId: string;
  previousCount: number;
  newCount: number;
  changeType: 'upload' | 'delete' | 'bulk_delete' | 'bulk_upload';
  affectedImageIds: string[];
  timestamp: Date;
}

/**
 * Shared project update event
 */
export interface SharedProjectUpdateData {
  projectId: string;
  ownerId: string;
  sharedWithUserIds: string[];
  updateType: 'images_added' | 'images_deleted' | 'segmentation_completed' | 'project_updated';
  stats: ProjectStats;
  timestamp: Date;
}

// ============================================================================
// Dashboard Metrics Events
// ============================================================================

/**
 * Dashboard metrics data structure
 */
export interface DashboardMetrics {
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
  storageStats: {
    totalStorageMB: number;
    totalStorageGB: number;
    averageImageSizeMB: number;
  };
}

/**
 * Dashboard metrics update event
 */
export interface DashboardMetricsUpdateData {
  userId: string;
  metrics: DashboardMetrics;
  changedFields: string[]; // Array of field names that changed
  timestamp: Date;
}

/**
 * User activity update event
 */
export interface UserActivityUpdateData {
  userId: string;
  activity: {
    type: 'project_created' | 'images_uploaded' | 'segmentation_completed' | 'project_shared' | 'images_deleted';
    projectId?: string;
    projectName?: string;
    details: {
      count?: number;
      duration?: number;
      success?: boolean;
      fileNames?: string[];
    };
    timestamp: Date;
  };
}

// ============================================================================
// Image Deletion Events
// ============================================================================

/**
 * Image deleted event
 */
export interface ImageDeletedData {
  imageId: string;
  projectId: string;
  userId: string;
  imageName: string;
  timestamp: Date;
}

/**
 * Batch images deleted event
 */
export interface BatchImagesDeletedData {
  projectId: string;
  userId: string;
  deletedImageIds: string[];
  deletedCount: number;
  timestamp: Date;
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
    ['hrnet', 'cbam_resunet'].includes(d.model as string)
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
 * Type guard for ParallelProcessingStatusData
 */
export function isParallelProcessingStatusData(data: unknown): data is ParallelProcessingStatusData {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  return (
    typeof d.concurrentOperations === 'object' &&
    typeof d.mlWorkers === 'object' &&
    typeof d.batchProcessing === 'object' &&
    d.timestamp !== undefined
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

/**
 * Type guard for ProjectStatsUpdateData
 */
export function isProjectStatsUpdateData(data: unknown): data is ProjectStatsUpdateData {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  return (
    typeof d.projectId === 'string' &&
    typeof d.userId === 'string' &&
    typeof d.stats === 'object' &&
    typeof d.operation === 'string' &&
    d.timestamp !== undefined
  );
}

/**
 * Type guard for DashboardMetricsUpdateData
 */
export function isDashboardMetricsUpdateData(data: unknown): data is DashboardMetricsUpdateData {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  return (
    typeof d.userId === 'string' &&
    typeof d.metrics === 'object' &&
    Array.isArray(d.changedFields) &&
    d.timestamp !== undefined
  );
}

/**
 * Type guard for SharedProjectUpdateData
 */
export function isSharedProjectUpdateData(data: unknown): data is SharedProjectUpdateData {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  return (
    typeof d.projectId === 'string' &&
    typeof d.ownerId === 'string' &&
    Array.isArray(d.sharedWithUserIds) &&
    typeof d.updateType === 'string' &&
    typeof d.stats === 'object' &&
    d.timestamp !== undefined
  );
}

/**
 * Type guard for ImageDeletedData
 */
export function isImageDeletedData(data: unknown): data is ImageDeletedData {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  return (
    typeof d.imageId === 'string' &&
    typeof d.projectId === 'string' &&
    typeof d.userId === 'string' &&
    typeof d.imageName === 'string' &&
    d.timestamp !== undefined
  );
}

/**
 * Type guard for BatchImagesDeletedData
 */
export function isBatchImagesDeletedData(data: unknown): data is BatchImagesDeletedData {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  return (
    typeof d.projectId === 'string' &&
    typeof d.userId === 'string' &&
    Array.isArray(d.deletedImageIds) &&
    typeof d.deletedCount === 'number' &&
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
  isParallelProcessingStatusData,
  isWebSocketMessage,
  isProjectStatsUpdateData,
  isDashboardMetricsUpdateData,
  isSharedProjectUpdateData,
  isImageDeletedData,
  isBatchImagesDeletedData
};