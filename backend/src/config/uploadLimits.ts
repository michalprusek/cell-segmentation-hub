/**
 * Upload Configuration for Production (10,000 files support)
 * Optimized for 1.5MB average image size = ~15GB total
 */

export interface UploadLimitsConfig {
  MAX_FILES_PER_REQUEST: number;
  MAX_FILE_SIZE_BYTES: number;
  MAX_TOTAL_FILES: number;
  MAX_FIELDS: number;
  MAX_FIELD_SIZE_KB: number;
  CHUNK_SIZE: number;
  NGINX_BODY_LIMIT: string;
}

// Production-optimized configuration for 10,000 files
const PRODUCTION_LIMITS: UploadLimitsConfig = {
  MAX_FILES_PER_REQUEST: 100,        // 100 files per chunk
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024,  // 100MB per file (safety margin)
  MAX_TOTAL_FILES: 10000,            // Support 10,000 total files
  MAX_FIELDS: 20,                    // Additional form fields
  MAX_FIELD_SIZE_KB: 100,            // Field size limit
  CHUNK_SIZE: 100,                   // Files per chunk for frontend
  NGINX_BODY_LIMIT: '500M'           // 100 files * 1.5MB * safety factor
};

const DEVELOPMENT_LIMITS: UploadLimitsConfig = {
  MAX_FILES_PER_REQUEST: 50,
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,
  MAX_TOTAL_FILES: 1000,
  MAX_FIELDS: 10,
  MAX_FIELD_SIZE_KB: 50,
  CHUNK_SIZE: 50,
  NGINX_BODY_LIMIT: '200M'
};

const TEST_LIMITS: UploadLimitsConfig = {
  MAX_FILES_PER_REQUEST: 20,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  MAX_TOTAL_FILES: 100,
  MAX_FIELDS: 5,
  MAX_FIELD_SIZE_KB: 10,
  CHUNK_SIZE: 20,
  NGINX_BODY_LIMIT: '50M'
};

/**
 * Get upload limits based on environment
 */
export function getUploadLimitsForEnvironment(env?: string): UploadLimitsConfig {
  const environment = env || process.env.NODE_ENV || 'development';
  
  switch (environment) {
    case 'production':
      return PRODUCTION_LIMITS;
    case 'test':
      return TEST_LIMITS;
    case 'development':
    default:
      return DEVELOPMENT_LIMITS;
  }
}

/**
 * Calculate number of chunks needed for file count
 */
export function calculateChunks(fileCount: number, env?: string): number {
  const limits = getUploadLimitsForEnvironment(env);
  return Math.ceil(fileCount / limits.CHUNK_SIZE);
}

/**
 * Estimate upload time in minutes
 */
export function estimateUploadTime(fileCount: number, avgFileSizeMB: number = 1.5): number {
  const chunks = calculateChunks(fileCount, 'production');
  // Assume 10 seconds per chunk (network + processing)
  const secondsPerChunk = 10;
  return Math.ceil((chunks * secondsPerChunk) / 60);
}

/**
 * Validate if file count is within limits
 */
export function validateFileCount(fileCount: number, env?: string): { valid: boolean; message?: string } {
  const limits = getUploadLimitsForEnvironment(env);
  
  if (fileCount > limits.MAX_TOTAL_FILES) {
    return {
      valid: false,
      message: `Maximum ${limits.MAX_TOTAL_FILES} files allowed. You tried to upload ${fileCount} files.`
    };
  }
  
  return { valid: true };
}

// Export default configuration
export const UPLOAD_LIMITS = getUploadLimitsForEnvironment();

// Rate limiting configuration
export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

// Base configuration for all environments
const baseConfig = {
  // Upload rate limits - very permissive for 10,000 files
  UPLOAD_WINDOW_MS: 5 * 60 * 1000, // 5 minutes
  UPLOAD_MAX_REQUESTS: 200, // 200 chunks per 5 minutes (supports 20,000 files)
  
  // Bulk upload rate limits
  BULK_UPLOAD_WINDOW_MS: 5 * 60 * 1000, // 5 minutes
  BULK_UPLOAD_MAX_REQUESTS: 10000, // 10,000 requests per 5 minutes
  
  // Processing rate limits
  PROCESSING_WINDOW_MS: 10 * 60 * 1000, // 10 minutes
  PROCESSING_MAX_REQUESTS: 20, // 20 processing requests per 10 minutes
  
  // API rate limits
  API_WINDOW_MS: 5 * 60 * 1000, // 5 minutes
  API_MAX_REQUESTS: 1000, // 1000 requests per 5 minutes
  
  // Auth rate limits (keep strict for security)
  AUTH_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  AUTH_MAX_REQUESTS: 20, // 20 auth attempts per 15 minutes
};

// Environment-specific overrides
export function getRateLimitsForEnvironment(env: string = process.env.NODE_ENV || 'development') {
  switch (env) {
    case 'development':
      return {
        ...baseConfig,
        UPLOAD_MAX_REQUESTS: 1000,
        API_MAX_REQUESTS: 5000,
        PROCESSING_MAX_REQUESTS: 100,
      };
    case 'production':
      return {
        ...baseConfig,
        UPLOAD_MAX_REQUESTS: 200,  // Allow 200 chunks per 5 min for 10,000 files
        BULK_UPLOAD_MAX_REQUESTS: 10000,  // Very permissive for bulk operations
      };
    case 'test':
      return {
        ...baseConfig,
        UPLOAD_MAX_REQUESTS: 10000,
        API_MAX_REQUESTS: 10000,
        PROCESSING_MAX_REQUESTS: 1000,
        AUTH_MAX_REQUESTS: 1000,
      };
    default:
      return baseConfig;
  }
}

// Export configured limits
export const RATE_LIMITS = getRateLimitsForEnvironment();

// Helper function to create rate limit config
export function createRateLimitConfig(
  windowMs: number = RATE_LIMITS.API_WINDOW_MS,
  max: number = RATE_LIMITS.API_MAX_REQUESTS
): RateLimitConfig {
  return { windowMs, max };
}

// Tier-based rate limits for different user types
export const TIER_LIMITS = {
  anonymous: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
  },
  authenticated: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 300, // 300 requests per minute
  },
  premium: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 500, // 500 requests per minute
  },
  admin: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 1000, // 1000 requests per minute
  },
};