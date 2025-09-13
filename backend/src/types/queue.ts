/**
 * Queue Type Definitions
 * 
 * Comprehensive TypeScript interfaces for queue-related operations,
 * providing full type safety from HTTP requests to database operations.
 */

import { Request } from 'express';
// import { z } from 'zod';

// ============================================================================
// Type Aliases
// ============================================================================

/**
 * Available segmentation models
 */
export type SegmentationModel = 'hrnet' | 'cbam_resunet' | 'unet_spherohq' | 'resunet_advanced' | 'resunet_small';

/**
 * Queue item status
 */
export type QueueStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * Queue priority levels (0 = lowest, 10 = highest)
 */
export type QueuePriority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * Polygon types for segmentation results
 */
export type PolygonType = 'external' | 'internal';

// ============================================================================
// Request Data Interfaces (validated by Zod schemas)
// ============================================================================

/**
 * Data for adding a single image to queue
 */
export interface AddImageToQueueData {
  model?: SegmentationModel;
  threshold?: number;
  priority?: QueuePriority;
  detectHoles?: boolean;
}

/**
 * Data for batch queue operations
 */
export interface BatchQueueData {
  imageIds: string[];
  projectId: string;
  model?: SegmentationModel;
  threshold?: number;
  priority?: QueuePriority;
  forceResegment?: boolean;
  detectHoles?: boolean;
}

/**
 * Data for resetting stuck items
 */
export interface ResetStuckItemsData {
  maxProcessingMinutes?: number;
}

/**
 * Data for cleaning up old queue entries
 */
export interface CleanupQueueData {
  daysOld?: number;
}

// ============================================================================
// Route Parameter Interfaces
// ============================================================================

/**
 * Parameters for routes with imageId
 */
export interface ImageIdParams {
  imageId: string;
  [key: string]: string;
}

/**
 * Parameters for routes with projectId
 */
export interface ProjectIdParams {
  projectId: string;
  [key: string]: string;
}

/**
 * Parameters for routes with queueId
 */
export interface QueueIdParams {
  queueId: string;
  [key: string]: string;
}

// ============================================================================
// Response Data Interfaces
// ============================================================================

/**
 * Queue entry response
 */
export interface QueueEntryResponse {
  id: string;
  imageId: string;
  projectId: string;
  userId: string;
  model: SegmentationModel;
  threshold: number;
  detectHoles: boolean;
  priority: QueuePriority;
  status: QueueStatus;
  error?: string | null;
  batchId?: string | null;
  retryCount?: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

/**
 * Batch queue response
 */
export interface BatchQueueResponse {
  queuedCount: number;
  totalRequested: number;
  queueEntries: QueueEntryResponse[];
}

/**
 * Queue statistics response
 */
export interface QueueStatsResponse {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
  averageWaitTime?: number;
  averageProcessingTime?: number;
  estimatedTimeRemaining?: number;
  queuePosition?: number;
}

/**
 * Queue health status response
 */
export interface QueueHealthResponse {
  healthy: boolean;
  mlServiceStatus: 'online' | 'offline' | 'degraded';
  queueStats: QueueStatsResponse;
  issues: string[];
  lastProcessed?: Date;
  processingRate?: number;
}

/**
 * Reset stuck items response
 */
export interface ResetStuckItemsResponse {
  resetCount: number;
  items: Array<{
    id: string;
    imageId: string;
    processingTime: number;
  }>;
}

/**
 * Cleanup response
 */
export interface CleanupResponse {
  deletedCount: number;
  freedSpace?: number;
}

// ============================================================================
// WebSocket Event Interfaces
// ============================================================================

/**
 * Segmentation status update event
 */
export interface SegmentationUpdateData {
  imageId: string;
  projectId: string;
  status: QueueStatus;
  queueId?: string;
  error?: string;
  progress?: number;
  polygonCount?: number;
}

/**
 * Queue statistics update event
 */
export interface QueueStatsUpdateData {
  projectId: string;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  queuePosition?: number;
  estimatedTime?: number;
}

/**
 * Segmentation completed event
 */
export interface SegmentationCompletedData {
  imageId: string;
  projectId: string;
  polygonCount: number;
  processingTime: number;
  model: SegmentationModel;
}

/**
 * Segmentation failed event
 */
export interface SegmentationFailedData {
  imageId: string;
  projectId: string;
  error: string;
  errorCode?: string;
  suggestion?: string;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base queue error
 */
export class QueueError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode = 500
  ) {
    super(message);
    this.name = 'QueueError';
  }
}

/**
 * Queue timeout error
 */
export class QueueTimeoutError extends QueueError {
  constructor(
    public model: SegmentationModel,
    public timeout: number,
    public imageSize?: [number, number]
  ) {
    super(
      `Segmentation timeout for model '${model}' after ${timeout}s`,
      'QUEUE_TIMEOUT',
      504
    );
    this.name = 'QueueTimeoutError';
  }
}

/**
 * Queue capacity error
 */
export class QueueCapacityError extends QueueError {
  constructor(
    public currentSize: number,
    public maxSize: number
  ) {
    super(
      `Queue capacity exceeded: ${currentSize}/${maxSize}`,
      'QUEUE_CAPACITY_EXCEEDED',
      503
    );
    this.name = 'QueueCapacityError';
  }
}

/**
 * ML service unavailable error
 */
export class MLServiceUnavailableError extends QueueError {
  constructor(reason?: string) {
    super(
      `ML service is unavailable${reason ? `: ${reason}` : ''}`,
      'ML_SERVICE_UNAVAILABLE',
      503
    );
    this.name = 'MLServiceUnavailableError';
  }
}

// ============================================================================
// Request Type Guards
// ============================================================================

/**
 * Type guard for AddImageToQueueData
 */
export function isAddImageToQueueData(data: unknown): data is AddImageToQueueData {
  if (typeof data !== 'object' || data === null) {return false;}
  const d = data as Record<string, unknown>;
  
  if (d.model !== undefined && !isSegmentationModel(d.model)) {return false;}
  if (d.threshold !== undefined && (typeof d.threshold !== 'number' || d.threshold < 0.1 || d.threshold > 0.9)) {return false;}
  if (d.priority !== undefined && !isQueuePriority(d.priority)) {return false;}
  if (d.detectHoles !== undefined && typeof d.detectHoles !== 'boolean') {return false;}
  
  return true;
}

/**
 * Type guard for SegmentationModel
 */
export function isSegmentationModel(value: unknown): value is SegmentationModel {
  return value === 'hrnet' || value === 'cbam_resunet' || value === 'unet_spherohq' || value === 'resunet_advanced' || value === 'resunet_small';
}

/**
 * Type guard for QueuePriority
 */
export function isQueuePriority(value: unknown): value is QueuePriority {
  return typeof value === 'number' && value >= 0 && value <= 10 && Number.isInteger(value);
}

/**
 * Type guard for QueueStatus
 */
export function isQueueStatus(value: unknown): value is QueueStatus {
  return ['queued', 'processing', 'completed', 'failed', 'cancelled'].includes(value as string);
}

// ============================================================================
// Typed Request Interfaces
// ============================================================================

/**
 * Base request with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    emailVerified: boolean;
    profile?: {
      id: string;
      userId: string;
      username?: string | null;
      avatarUrl?: string | null;
      avatarPath?: string | null;
      avatarMimeType?: string | null;
      avatarSize?: number | null;
      bio?: string | null;
      organization?: string | null;
      location?: string | null;
      title?: string | null;
      publicProfile: boolean;
      preferredModel: string;
      modelThreshold: number;
      preferredLang: string;
      preferredTheme: string;
      emailNotifications: boolean;
      consentToMLTraining: boolean;
      consentToAlgorithmImprovement: boolean;
      consentToFeatureDevelopment: boolean;
      consentUpdatedAt?: Date | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
  };
}

/**
 * Request for adding image to queue
 */
export interface AddImageToQueueRequest extends AuthenticatedRequest {
  params: ImageIdParams;
  body: AddImageToQueueData;
}

/**
 * Request for batch queue operations
 */
export interface BatchQueueRequest extends AuthenticatedRequest {
  body: BatchQueueData;
}

/**
 * Request for getting queue stats
 */
export interface GetQueueStatsRequest extends AuthenticatedRequest {
  params: ProjectIdParams;
}

/**
 * Request for getting queue items
 */
export interface GetQueueItemsRequest extends AuthenticatedRequest {
  params: ProjectIdParams;
}

/**
 * Request for removing from queue
 */
export interface RemoveFromQueueRequest extends AuthenticatedRequest {
  params: QueueIdParams;
}

/**
 * Request for resetting stuck items
 */
export interface ResetStuckItemsRequest extends AuthenticatedRequest {
  body: ResetStuckItemsData;
}

/**
 * Request for cleaning up queue
 */
export interface CleanupQueueRequest extends AuthenticatedRequest {
  body: CleanupQueueData;
}

// ============================================================================
// Configuration Interfaces
// ============================================================================

/**
 * Queue configuration
 */
export interface QueueConfig {
  maxQueueSize: number;
  maxBatchSize: number;
  defaultTimeout: number;
  maxRetries: number;
  stuckThresholdMinutes: number;
  cleanupThresholdDays: number;
  priorityBoost: {
    premium: number;
    shared: number;
  };
}

/**
 * Model-specific configuration
 */
export interface ModelConfig {
  model: SegmentationModel;
  defaultThreshold: number;
  timeout: number;
  maxImageSize: [number, number];
  batchSize: number;
  memoryRequirement: number; // in MB
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Make all properties of T optional except for K
 */
export type RequireOnly<T, K extends keyof T> = Partial<T> & Pick<T, K>;

/**
 * Queue entry creation data
 */
export type CreateQueueEntry = RequireOnly<QueueEntryResponse, 'imageId' | 'projectId' | 'userId'>;

/**
 * Queue entry update data
 */
export type UpdateQueueEntry = Partial<Pick<QueueEntryResponse, 'status' | 'error' | 'startedAt' | 'completedAt'>>;

export default {
  // Re-export everything for convenient import
  isAddImageToQueueData,
  isSegmentationModel,
  isQueuePriority,
  isQueueStatus,
  QueueError,
  QueueTimeoutError,
  QueueCapacityError,
  MLServiceUnavailableError
};