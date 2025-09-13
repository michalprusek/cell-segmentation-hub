/**
 * Upload utilities for handling large file batches with chunking
 */

export interface ChunkingConfig {
  chunkSize: number;
  maxConcurrentChunks: number;
  retryAttempts: number;
  retryDelayMs: number;
}

export interface ChunkProgress {
  chunkIndex: number;
  totalChunks: number;
  filesInChunk: number;
  totalFiles: number;
  chunkProgress: number;
  overallProgress: number;
  currentOperation: string;
}

export interface ChunkedUploadResult<T> {
  success: T[];
  failed: Array<{
    files: File[];
    error: Error;
    chunkIndex: number;
  }>;
  totalProcessed: number;
}

/**
 * Default chunking configuration
 */
export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  chunkSize: 100, // Files per chunk - matches backend MAX_FILES_PER_REQUEST in production
  maxConcurrentChunks: 2, // Parallel chunk uploads - reduced to avoid overwhelming server
  retryAttempts: 3, // Retry failed chunks
  retryDelayMs: 2000, // Delay between retries
};

/**
 * Split files into chunks
 */
export function chunkFiles(files: File[], chunkSize: number): File[][] {
  const chunks: File[][] = [];
  for (let i = 0; i < files.length; i += chunkSize) {
    chunks.push(files.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Calculate optimal chunk size based on total files
 */
export function calculateOptimalChunkSize(
  totalFiles: number,
  config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG
): number {
  if (totalFiles <= config.chunkSize) {
    return totalFiles;
  }

  // Calculate chunk size to minimize total chunks while staying within limits
  const idealChunks = Math.ceil(totalFiles / config.maxConcurrentChunks);
  const optimalChunkSize = Math.min(
    Math.ceil(totalFiles / idealChunks),
    config.chunkSize
  );

  return Math.max(1, optimalChunkSize);
}

/**
 * Sleep utility for retry delays
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Process chunks with controlled concurrency and retry logic
 */
export async function processChunksWithConcurrency<T>(
  chunks: File[][],
  processor: (chunk: File[], chunkIndex: number) => Promise<T>,
  config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
  onProgress?: (progress: ChunkProgress) => void
): Promise<ChunkedUploadResult<T>> {
  const results: ChunkedUploadResult<T> = {
    success: [],
    failed: [],
    totalProcessed: 0,
  };

  const totalFiles = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const totalChunks = chunks.length;
  let processedChunks = 0;

  // Process chunks in batches with controlled concurrency
  for (let i = 0; i < chunks.length; i += config.maxConcurrentChunks) {
    const batchChunks = chunks.slice(i, i + config.maxConcurrentChunks);

    // Process batch concurrently
    const batchPromises = batchChunks.map(async (chunk, batchIndex) => {
      const globalChunkIndex = i + batchIndex;

      // Retry logic for each chunk
      for (let attempt = 0; attempt <= config.retryAttempts; attempt++) {
        try {
          // Update progress
          if (onProgress) {
            onProgress({
              chunkIndex: globalChunkIndex,
              totalChunks,
              filesInChunk: chunk.length,
              totalFiles,
              chunkProgress: 0,
              overallProgress: Math.round(
                (processedChunks / totalChunks) * 100
              ),
              currentOperation:
                attempt > 0
                  ? `Retrying chunk ${globalChunkIndex + 1} (attempt ${attempt + 1})`
                  : `Processing chunk ${globalChunkIndex + 1} of ${totalChunks}`,
            });
          }

          const result = await processor(chunk, globalChunkIndex);
          return { success: true, result, chunk, chunkIndex: globalChunkIndex };
        } catch (error) {
          if (attempt === config.retryAttempts) {
            // Final attempt failed
            return {
              success: false,
              error: error as Error,
              chunk,
              chunkIndex: globalChunkIndex,
            };
          } else {
            // Wait before retry
            await sleep(config.retryDelayMs * Math.pow(2, attempt)); // Exponential backoff
          }
        }
      }
    });

    // Wait for batch to complete
    const batchResults = await Promise.all(batchPromises);

    // Process batch results
    batchResults.forEach(result => {
      if (result) {
        processedChunks++;
        results.totalProcessed += result.chunk.length;

        if (result.success) {
          results.success.push(result.result);
        } else {
          results.failed.push({
            files: result.chunk,
            error: result.error,
            chunkIndex: result.chunkIndex,
          });
        }
      }
    });

    // Update overall progress
    if (onProgress) {
      onProgress({
        chunkIndex: processedChunks - 1,
        totalChunks,
        filesInChunk: 0,
        totalFiles,
        chunkProgress: 100,
        overallProgress: Math.round((processedChunks / totalChunks) * 100),
        currentOperation: `Completed ${processedChunks} of ${totalChunks} chunks`,
      });
    }
  }

  return results;
}

/**
 * Estimate upload time based on file sizes and network speed
 */
export function estimateUploadTime(
  files: File[],
  avgUploadSpeedMbps: number = 10 // Default 10 Mbps
): number {
  const totalSizeBytes = files.reduce((sum, file) => sum + file.size, 0);
  const totalSizeMb = totalSizeBytes / (1024 * 1024);
  const estimatedTimeSeconds = totalSizeMb / avgUploadSpeedMbps;

  return Math.max(estimatedTimeSeconds, 30); // Minimum 30 seconds
}

/**
 * Validate files before upload
 */
export function validateFiles(
  files: File[],
  maxFileSize: number = 50 * 1024 * 1024, // 50MB default
  maxTotalSize: number = 500 * 1024 * 1024, // 500MB default
  supportedTypes: string[] = [
    'image/jpeg',
    'image/png',
    'image/tiff',
    'image/bmp',
  ]
): { valid: File[]; invalid: Array<{ file: File; reason: string }> } {
  const valid: File[] = [];
  const invalid: Array<{ file: File; reason: string }> = [];

  let totalSize = 0;

  files.forEach(file => {
    // Check file size
    if (file.size > maxFileSize) {
      invalid.push({
        file,
        reason: `File too large: ${(file.size / (1024 * 1024)).toFixed(1)}MB (max: ${maxFileSize / (1024 * 1024)}MB)`,
      });
      return;
    }

    // Check file type
    if (!supportedTypes.includes(file.type)) {
      invalid.push({
        file,
        reason: `Unsupported file type: ${file.type}`,
      });
      return;
    }

    // Check total size
    if (totalSize + file.size > maxTotalSize) {
      invalid.push({
        file,
        reason: `Total upload size would exceed limit of ${maxTotalSize / (1024 * 1024)}MB`,
      });
      return;
    }

    valid.push(file);
    totalSize += file.size;
  });

  return { valid, invalid };
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Format upload speed for display
 */
export function formatUploadSpeed(bytesPerSecond: number): string {
  const mbps = (bytesPerSecond * 8) / (1024 * 1024); // Convert to Mbps
  if (mbps < 1) {
    const kbps = (bytesPerSecond * 8) / 1024;
    return `${kbps.toFixed(1)} Kbps`;
  }
  return `${mbps.toFixed(1)} Mbps`;
}
