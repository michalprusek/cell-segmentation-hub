/**
 * Centralized configuration constants for the Cell Segmentation Hub
 * Single Source of Truth (SSOT) for all magic numbers and configuration values
 *
 * @module constants
 */

/**
 * Timeout configurations in milliseconds
 * Used across the application for various operations
 */
export const TIMEOUTS = {
  /** Initial retry delay for failed operations */
  RETRY_INITIAL: 1000,
  /** Short retry delay for quick operations */
  RETRY_SHORT: 2000,
  /** Production retry delay with higher tolerance */
  RETRY_PRODUCTION: 3000,
  /** Maximum retry delay to prevent excessive waiting */
  RETRY_MAX: 30000,

  /** Standard API request timeout */
  API_REQUEST: 5000,
  /** Extended API timeout for complex operations */
  API_REQUEST_LONG: 30000,
  /** Database query timeout */
  DATABASE_QUERY: 10000,
  /** Database transaction timeout */
  DATABASE_TRANSACTION: 30000,

  /** WebSocket connection establishment */
  WEBSOCKET_CONNECT: 30000,
  /** WebSocket heartbeat interval */
  WEBSOCKET_HEARTBEAT: 25000,
  /** WebSocket reconnection delay */
  WEBSOCKET_RECONNECT: 5000,

  /** Email sending timeout (UTIA server is slow) */
  EMAIL_SEND: 300000, // 5 minutes
  /** Email socket timeout for UTIA */
  EMAIL_SOCKET: 600000, // 10 minutes

  /** Image segmentation processing */
  SEGMENTATION_PROCESS: 300000, // 5 minutes
  /** Export operation timeout */
  EXPORT_PROCESS: 600000, // 10 minutes
  /** File upload operation */
  FILE_UPLOAD: 120000, // 2 minutes

  /** Health check interval */
  HEALTH_CHECK: 30000,
  /** Metrics collection interval */
  METRICS_COLLECTION: 60000,
} as const;

/**
 * Retry attempt configurations for different operation types
 */
export const RETRY_ATTEMPTS = {
  /** Standard API calls */
  API: 3,
  /** File upload operations (higher due to network variability) */
  UPLOAD: 5,
  /** Authentication operations (lower to prevent account lockout) */
  AUTH: 2,
  /** Email operations */
  EMAIL: 3,
  /** WebSocket connections (infinite retries with backoff) */
  WEBSOCKET: Infinity,
  /** Database operations */
  DATABASE: 3,
  /** Export operations */
  EXPORT: 3,
} as const;

/**
 * File size and upload limitations
 */
export const FILE_LIMITS = {
  /** Maximum file size in megabytes */
  MAX_FILE_SIZE_MB: 20,
  /** Maximum file size in bytes */
  MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024,
  /** Maximum total file size for batch uploads in MB */
  MAX_TOTAL_SIZE_MB: 500,
  /** Maximum total file size for batch uploads in bytes */
  MAX_TOTAL_SIZE_BYTES: 500 * 1024 * 1024,
  /** Maximum number of files in a single batch */
  MAX_FILES_PER_BATCH: 10000,
  /** Chunk size for batch processing */
  CHUNK_SIZE_FILES: 100,
  /** Chunk size in bytes for streaming */
  CHUNK_SIZE_BYTES: 5 * 1024 * 1024, // 5MB chunks
  /** Supported image formats */
  SUPPORTED_FORMATS: ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif'] as const,
} as const;

/**
 * Rate limiting configurations (must match nginx settings)
 */
export const RATE_LIMITS = {
  /** General API requests per second */
  GENERAL: 10,
  /** API endpoint requests per second */
  API: 30,
  /** API burst capacity */
  API_BURST: 80,
  /** Segmentation requests per second */
  SEGMENTATION: 100,
  /** Segmentation burst capacity */
  SEGMENTATION_BURST: 100,
  /** Upload requests per second */
  UPLOAD: 5,
  /** Upload burst capacity */
  UPLOAD_BURST: 10,
  /** Download requests per second */
  DOWNLOAD: 10,
} as const;

/**
 * Cache and storage configurations
 */
export const STORAGE = {
  /** Export state expiration time (2 hours) */
  EXPORT_STATE_EXPIRATION: 2 * 60 * 60 * 1000,
  /** Export state cleanup interval (30 minutes) */
  EXPORT_STATE_CLEANUP: 30 * 60 * 1000,
  /** Thumbnail cache duration (1 day) */
  THUMBNAIL_CACHE: 24 * 60 * 60 * 1000,
  /** Converted image cache duration (1 hour) */
  CONVERTED_IMAGE_CACHE: 60 * 60 * 1000,
  /** localStorage quota warning threshold (5MB) */
  LOCAL_STORAGE_WARNING: 5 * 1024 * 1024,
  /** localStorage quota critical threshold (10MB) */
  LOCAL_STORAGE_CRITICAL: 10 * 1024 * 1024,
} as const;

/**
 * Pagination and list configurations
 */
export const PAGINATION = {
  /** Default page size for lists */
  DEFAULT_PAGE_SIZE: 20,
  /** Maximum page size allowed */
  MAX_PAGE_SIZE: 100,
  /** Default items per row in grid view */
  GRID_COLUMNS: 4,
  /** Items to preload for infinite scroll */
  PRELOAD_THRESHOLD: 5,
} as const;

/**
 * WebSocket event names (must match backend)
 */
export const WEBSOCKET_EVENTS = {
  // Connection events
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  ERROR: 'error',

  // Segmentation events
  SEGMENTATION_STATUS: 'segmentationStatus',
  SEGMENTATION_COMPLETED: 'segmentationCompleted',
  SEGMENTATION_FAILED: 'segmentationFailed',
  SEGMENTATION_PROGRESS: 'segmentationProgress',

  // Queue events
  QUEUE_STATS: 'queueStats',
  QUEUE_UPDATE: 'queueUpdate',

  // Export events
  EXPORT_PROGRESS: 'exportProgress',
  EXPORT_COMPLETED: 'exportCompleted',
  EXPORT_FAILED: 'exportFailed',

  // Upload events
  UPLOAD_PROGRESS: 'uploadProgress',

  // Project events
  PROJECT_UPDATE: 'projectUpdate',
  PROJECT_DELETE: 'projectDelete',
} as const;

/**
 * HTTP status codes for consistent error handling
 */
export const HTTP_STATUS = {
  // Success
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,

  // Client errors
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  GONE: 410,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,

  // Server errors
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

/**
 * Test timeout configurations
 */
export const TEST_TIMEOUTS = {
  /** Unit test timeout */
  UNIT: 1000,
  /** Integration test timeout */
  INTEGRATION: 5000,
  /** End-to-end test timeout */
  E2E: 30000,
  /** Long-running test timeout */
  LONG_RUNNING: 300000,
} as const;

/**
 * Animation and UI timing
 */
export const UI_TIMING = {
  /** Debounce delay for search inputs */
  SEARCH_DEBOUNCE: 300,
  /** Throttle delay for scroll handlers */
  SCROLL_THROTTLE: 100,
  /** Toast notification duration */
  TOAST_DURATION: 5000,
  /** Animation duration for transitions */
  ANIMATION_DURATION: 200,
  /** Delay before showing loading spinner */
  LOADING_DELAY: 500,
} as const;

/**
 * Environment-specific configurations
 */
export const ENVIRONMENT = {
  /** Check if running in development */
  IS_DEVELOPMENT: process.env.NODE_ENV === 'development',
  /** Check if running in production */
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  /** Check if running in test */
  IS_TEST: process.env.NODE_ENV === 'test',
  /** API base URL */
  API_BASE_URL: process.env.VITE_API_BASE_URL || 'http://localhost:3001',
  /** ML service URL */
  ML_SERVICE_URL: process.env.VITE_ML_SERVICE_URL || 'http://localhost:8000',
  /** WebSocket URL */
  WS_URL: process.env.VITE_WS_URL || 'ws://localhost:3001',
} as const;

/**
 * Validation patterns
 */
export const VALIDATION = {
  /** Email validation regex */
  EMAIL_REGEX: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
  /** Password minimum length */
  PASSWORD_MIN_LENGTH: 8,
  /** Project name maximum length */
  PROJECT_NAME_MAX_LENGTH: 100,
  /** Description maximum length */
  DESCRIPTION_MAX_LENGTH: 500,
  /** Username pattern */
  USERNAME_REGEX: /^[a-zA-Z0-9_-]{3,30}$/,
} as const;

/**
 * Export configuration type for use in other modules
 */
export type TimeoutConfig = typeof TIMEOUTS;
export type RetryConfig = typeof RETRY_ATTEMPTS;
export type FileLimitConfig = typeof FILE_LIMITS;
export type RateLimitConfig = typeof RATE_LIMITS;
export type StorageConfig = typeof STORAGE;
export type PaginationConfig = typeof PAGINATION;
export type WebSocketEventConfig = typeof WEBSOCKET_EVENTS;
export type HttpStatusConfig = typeof HTTP_STATUS;
export type TestTimeoutConfig = typeof TEST_TIMEOUTS;
export type UITimingConfig = typeof UI_TIMING;
export type EnvironmentConfig = typeof ENVIRONMENT;
export type ValidationConfig = typeof VALIDATION;

/**
 * Helper function to get timeout with environment-specific overrides
 */
export function getTimeout(
  key: keyof TimeoutConfig,
  environmentOverride?: number
): number {
  if (environmentOverride && ENVIRONMENT.IS_PRODUCTION) {
    return environmentOverride;
  }
  return TIMEOUTS[key];
}

/**
 * Helper function to get retry attempts with environment-specific overrides
 */
export function getRetryAttempts(
  key: keyof RetryConfig,
  environmentOverride?: number
): number {
  if (environmentOverride && ENVIRONMENT.IS_PRODUCTION) {
    return environmentOverride;
  }
  return RETRY_ATTEMPTS[key];
}
