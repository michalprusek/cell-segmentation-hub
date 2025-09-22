/**
 * Upload Configuration - Supports up to 10,000 images
 * Centralized configuration for all upload-related limits
 */

export interface UploadLimits {
  maxTotalFiles: number; // Maximum total files in one session
  maxFilesPerChunk: number; // Files per individual request
  maxFileSize: number; // Individual file size in bytes
  maxTotalUploadSize: number; // Total upload size limit
  chunkConcurrency: number; // Parallel chunk uploads
  retryAttempts: number; // Retry failed chunks
  retryDelayMs: number; // Delay between retries
  nginxBodySizeLimit: string; // Nginx client_max_body_size
  expressBodyLimit: string; // Express body parser limit
}

export interface UploadMessages {
  fileLimitExceeded: {
    cs: string;
    en: string;
    es: string;
    de: string;
    fr: string;
    zh: string;
  };
  uploadStarted: {
    cs: string;
    en: string;
    es: string;
    de: string;
    fr: string;
    zh: string;
  };
  chunkProgress: {
    cs: string;
    en: string;
    es: string;
    de: string;
    fr: string;
    zh: string;
  };
}

// Environment-specific upload limits
// With 1.5MB average per image, 10,000 images = ~15GB total
const UPLOAD_CONFIGS: Record<string, UploadLimits> = {
  development: {
    maxTotalFiles: 10000, // Support 10,000 files in dev
    maxFilesPerChunk: 50, // 50 files per chunk (75MB per request)
    maxFileSize: 50 * 1024 * 1024, // 50MB per file (large safety margin)
    maxTotalUploadSize: 20 * 1024 * 1024 * 1024, // 20GB total (15GB + buffer)
    chunkConcurrency: 3, // 3 parallel uploads
    retryAttempts: 3,
    retryDelayMs: 1000,
    nginxBodySizeLimit: '200M', // 50 files * 1.5MB avg + overhead
    expressBodyLimit: '200mb',
  },
  staging: {
    maxTotalFiles: 10000, // Support 10,000 files in staging
    maxFilesPerChunk: 100, // 100 files per chunk (150MB per request)
    maxFileSize: 50 * 1024 * 1024, // 50MB per file
    maxTotalUploadSize: 20 * 1024 * 1024 * 1024, // 20GB total
    chunkConcurrency: 5, // 5 parallel uploads
    retryAttempts: 3,
    retryDelayMs: 2000,
    nginxBodySizeLimit: '300M', // 100 files * 1.5MB avg * 2 safety
    expressBodyLimit: '300mb',
  },
  production: {
    maxTotalFiles: 10000, // Support 10,000 files in production
    maxFilesPerChunk: 100, // 100 files per chunk (150MB per request)
    maxFileSize: 100 * 1024 * 1024, // 100MB per file (very large images)
    maxTotalUploadSize: 20 * 1024 * 1024 * 1024, // 20GB total (15GB typical + buffer)
    chunkConcurrency: 5, // 5 parallel uploads
    retryAttempts: 5,
    retryDelayMs: 3000,
    nginxBodySizeLimit: '500M', // 100 files * 1.5MB avg * 3+ safety
    expressBodyLimit: '500mb',
  },
  test: {
    maxTotalFiles: 100, // Smaller for tests
    maxFilesPerChunk: 10,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxTotalUploadSize: 100 * 1024 * 1024, // 100MB
    chunkConcurrency: 1,
    retryAttempts: 1,
    retryDelayMs: 100,
    nginxBodySizeLimit: '100M',
    expressBodyLimit: '100mb',
  },
};

// Localized messages for upload limits
export const UPLOAD_MESSAGES: UploadMessages = {
  fileLimitExceeded: {
    cs: 'Překročen maximální počet souborů. Limit je 10 000 souborů najednou.',
    en: 'Maximum file limit exceeded. The limit is 10,000 files at once.',
    es: 'Se excedió el límite máximo de archivos. El límite es de 10,000 archivos a la vez.',
    de: 'Maximale Dateianzahl überschritten. Das Limit beträgt 10.000 Dateien auf einmal.',
    fr: 'Limite maximale de fichiers dépassée. La limite est de 10 000 fichiers à la fois.',
    zh: '超出最大文件限制。限制为一次10,000个文件。',
  },
  uploadStarted: {
    cs: 'Nahrávání {count} souborů zahájeno...',
    en: 'Uploading {count} files started...',
    es: 'Carga de {count} archivos iniciada...',
    de: 'Upload von {count} Dateien gestartet...',
    fr: 'Téléchargement de {count} fichiers commencé...',
    zh: '开始上传{count}个文件...',
  },
  chunkProgress: {
    cs: 'Nahrávání: Část {current} z {total} ({percentage}%)',
    en: 'Uploading: Chunk {current} of {total} ({percentage}%)',
    es: 'Subiendo: Parte {current} de {total} ({percentage}%)',
    de: 'Hochladen: Teil {current} von {total} ({percentage}%)',
    fr: 'Téléchargement: Partie {current} sur {total} ({percentage}%)',
    zh: '上传中：第{current}部分，共{total}部分（{percentage}%）',
  },
};

// Get configuration for current environment
export function getUploadConfig(env?: string): UploadLimits {
  const environment = env || process.env.NODE_ENV || 'development';
  return UPLOAD_CONFIGS[environment] || UPLOAD_CONFIGS.development;
}

// Calculate chunk count for given file count
export function calculateChunkCount(
  fileCount: number,
  config?: UploadLimits
): number {
  const limits = config || getUploadConfig();
  return Math.ceil(fileCount / limits.maxFilesPerChunk);
}

// Validate upload request
export function validateUploadRequest(
  fileCount: number,
  totalSize: number,
  config?: UploadLimits
): {
  valid: boolean;
  error?: string;
  errorKey?: keyof UploadMessages;
} {
  const limits = config || getUploadConfig();

  if (fileCount > limits.maxTotalFiles) {
    return {
      valid: false,
      error: `Maximum ${limits.maxTotalFiles} files allowed`,
      errorKey: 'fileLimitExceeded',
    };
  }

  if (totalSize > limits.maxTotalUploadSize) {
    return {
      valid: false,
      error: `Total upload size exceeds ${limits.maxTotalUploadSize / (1024 * 1024 * 1024)}GB limit`,
    };
  }

  return { valid: true };
}

// Get upload statistics
export function getUploadStats(
  fileCount: number,
  config?: UploadLimits
): {
  chunkCount: number;
  estimatedTimeMinutes: number;
  maxFileSize: number;
  maxTotalSize: number;
} {
  const limits = config || getUploadConfig();
  const chunkCount = calculateChunkCount(fileCount, limits);
  const estimatedTimeMinutes = Math.ceil(
    (chunkCount / limits.chunkConcurrency) * 0.5
  ); // Assume 30s per chunk

  return {
    chunkCount,
    estimatedTimeMinutes,
    maxFileSize: limits.maxFileSize,
    maxTotalSize: limits.maxTotalUploadSize,
  };
}

// Export current configuration
export const UPLOAD_CONFIG = getUploadConfig();

// Memory optimization settings for large uploads
export const MEMORY_SETTINGS = {
  // Use disk storage for files over 5MB to prevent memory issues
  memoryThreshold: 5 * 1024 * 1024,
  // Temporary directory for upload processing
  tempDirectory: process.env.UPLOAD_TEMP_DIR || '/tmp/uploads',
  // Clean up temp files after processing
  cleanupInterval: 60 * 1000, // 1 minute
  // Maximum memory usage before forcing garbage collection
  maxMemoryUsage: 1024 * 1024 * 1024, // 1GB
};

// Rate limiting for upload endpoints
export const UPLOAD_RATE_LIMITS = {
  // Chunk upload endpoint - very permissive for 10,000 files
  chunk: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 500, // 500 chunks per 5 minutes (supports 50,000 files)
  },
  // Batch initialization - prevent spam
  init: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // 10 batch sessions per minute
  },
  // Status checks - allow frequent polling
  status: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 600, // 10 requests per second
  },
};

export default {
  UPLOAD_CONFIG,
  UPLOAD_MESSAGES,
  MEMORY_SETTINGS,
  UPLOAD_RATE_LIMITS,
  getUploadConfig,
  calculateChunkCount,
  validateUploadRequest,
  getUploadStats,
};
