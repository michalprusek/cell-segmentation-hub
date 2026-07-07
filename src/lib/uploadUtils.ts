/**
 * Upload utilities for handling large file batches with chunking
 */

import UPLOAD_CONFIG from './uploadConfig';
import { sleep } from './retryUtils';

const TRUE_VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.nd2'];

const MULTI_PAGE_TIFF_EXTENSIONS = ['.tif', '.tiff'];

// SSOT for "is this upload a video / microscopy stack". A bare extension
// check was duplicated in DropZone + UploadContext; both must agree on
// the routing (image multer caps at 20 MB, video multer at 100 GB), so
// any drift between the two manifests as "small TIFF fails to upload"
// or "large TIFF silently rejected client-side".
//
// Multi-page TIFFs are extension-ambiguous with single-page TIFFs (same
// .tif extension), so the heuristic is size-based: anything over the
// image cap is assumed to be a multi-page stack and routed through the
// video pipeline (`tifffile`-driven extractor on the backend). This
// keeps single-image TIFF uploads (< 20 MB) on the bulk image route.
export function isVideoLikeUpload(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  const lower = file.name.toLowerCase();
  if (TRUE_VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext))) return true;
  if (
    MULTI_PAGE_TIFF_EXTENSIONS.some(ext => lower.endsWith(ext)) &&
    file.size > UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES
  ) {
    return true;
  }
  return false;
}

function hasTiffExtension(file: File): boolean {
  const lower = file.name.toLowerCase();
  return MULTI_PAGE_TIFF_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Detect a multi-page (stack / multi-channel) TIFF by walking its IFD
 * chain directly from the file bytes. ImageJ / MetaMorph store every
 * channel *and* every timepoint as its own IFD ("page"), so page-count
 * > 1 ⇔ the file is a microscopy stack that must go through the frame
 * extractor — even when it's small. A 2-channel 512×512 IRM+TIRF frame
 * is only ~1 MB, well under the image cap, so the size heuristic in
 * `isVideoLikeUpload` alone would misroute it to the single-image Sharp
 * path (which reads only page 0 and renders 16-bit data near-black).
 *
 * Reads only a few bytes per IFD via `Blob.slice`, so it stays cheap
 * even for the largest classic TIFF. Ambiguity resolves conservatively:
 *  - BigTIFF (magic 43): always a stack in practice → multi-page.
 *  - non-TIFF / unreadable header / no Blob API → `false` (fall back to
 *    the size heuristic).
 */
export async function isMultiPageTiff(file: File): Promise<boolean> {
  try {
    if (typeof file.slice !== 'function') return false;
    const head = new DataView(await file.slice(0, 8).arrayBuffer());
    if (head.byteLength < 8) return false;
    const le = head.getUint8(0) === 0x49 && head.getUint8(1) === 0x49; // 'II'
    const be = head.getUint8(0) === 0x4d && head.getUint8(1) === 0x4d; // 'MM'
    if (!le && !be) return false;
    const magic = head.getUint16(2, le);
    if (magic === 43) return true; // BigTIFF → always a stack
    if (magic !== 42) return false; // not a classic TIFF
    let ifdOffset = head.getUint32(4, le);
    // Walk the IFD chain; the existence of a 2nd IFD is all we need.
    // Cap the walk to guard against a malformed self-referential chain.
    for (let seen = 0; ifdOffset !== 0 && seen < 4; seen++) {
      if (seen >= 1) return true; // reached a 2nd IFD → multi-page
      const cntBuf = await file.slice(ifdOffset, ifdOffset + 2).arrayBuffer();
      if (cntBuf.byteLength < 2) break;
      const entryCount = new DataView(cntBuf).getUint16(0, le);
      // Next-IFD offset sits right after the entry block (12 bytes each).
      const nextPos = ifdOffset + 2 + entryCount * 12;
      const nextBuf = await file.slice(nextPos, nextPos + 4).arrayBuffer();
      if (nextBuf.byteLength < 4) break;
      ifdOffset = new DataView(nextBuf).getUint32(0, le);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Async routing decision for the upload pipeline: is this file a video /
 * microscopy stack that must go through the `/videos` extractor endpoint?
 *
 * Superset of `isVideoLikeUpload` — adds an IFD-chain sniff so a *small*
 * multi-page TIFF (which the size heuristic would leave on the image
 * route) is routed to the extractor. Single-page TIFF stills stay on the
 * bulk image route unchanged.
 */
export async function shouldRouteAsVideo(file: File): Promise<boolean> {
  if (isVideoLikeUpload(file)) return true;
  if (hasTiffExtension(file)) return isMultiPageTiff(file);
  return false;
}

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
 * Default chunking configuration from centralized config
 */
export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  chunkSize: UPLOAD_CONFIG.FILES_PER_CHUNK, // Files per chunk - matches backend MAX_FILES_PER_REQUEST
  maxConcurrentChunks: UPLOAD_CONFIG.MAX_CONCURRENT_CHUNKS, // Parallel chunk uploads
  retryAttempts: UPLOAD_CONFIG.RETRY_ATTEMPTS, // Retry failed chunks
  retryDelayMs: UPLOAD_CONFIG.RETRY_DELAY_MS, // Delay between retries
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
 * Updated to validate per chunk instead of total size
 */
export function validateFiles(
  files: File[],
  maxFileSize: number = UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES, // From centralized config
  maxTotalSizePerChunk: number = UPLOAD_CONFIG.MAX_SIZE_PER_CHUNK_BYTES, // From centralized config
  supportedTypes: string[] = UPLOAD_CONFIG.SUPPORTED_FILE_TYPES // From centralized config
): { valid: File[]; invalid: Array<{ file: File; reason: string }> } {
  const valid: File[] = [];
  const invalid: Array<{ file: File; reason: string }> = [];

  // First pass: validate individual files
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

    valid.push(file);
  });

  // Second pass: validate chunk sizes (100 files per chunk)
  const chunkSize = DEFAULT_CHUNKING_CONFIG.chunkSize; // 100 files
  const chunks = chunkFiles(valid, chunkSize);

  chunks.forEach((chunk, chunkIndex) => {
    const chunkTotalSize = chunk.reduce((sum, file) => sum + file.size, 0);

    if (chunkTotalSize > maxTotalSizePerChunk) {
      // Mark all files in this chunk as invalid
      chunk.forEach(file => {
        const validIndex = valid.indexOf(file);
        if (validIndex !== -1) {
          valid.splice(validIndex, 1);
          invalid.push({
            file,
            reason: `Chunk ${chunkIndex + 1} total size (${(chunkTotalSize / (1024 * 1024)).toFixed(1)}MB) exceeds limit of ${maxTotalSizePerChunk / (1024 * 1024)}MB per chunk`,
          });
        }
      });
    }
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
