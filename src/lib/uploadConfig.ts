/**
 * Upload configuration that matches backend limits
 * Uses centralized constants from SSOT (Single Source of Truth)
 * @module uploadConfig
 */

import { FILE_LIMITS, RETRY_ATTEMPTS, TIMEOUTS } from './constants';

export const UPLOAD_CONFIG = {
  // File limits - using centralized constants
  MAX_FILE_SIZE_MB: FILE_LIMITS.MAX_FILE_SIZE_MB,
  MAX_FILE_SIZE_BYTES: FILE_LIMITS.MAX_FILE_SIZE_BYTES,

  // Chunk limits - using centralized constants
  FILES_PER_CHUNK: FILE_LIMITS.CHUNK_SIZE_FILES,
  MAX_SIZE_PER_CHUNK_MB: FILE_LIMITS.MAX_TOTAL_SIZE_MB,
  MAX_SIZE_PER_CHUNK_BYTES: FILE_LIMITS.MAX_TOTAL_SIZE_BYTES,

  // Total limits - using centralized constants
  MAX_TOTAL_FILES: FILE_LIMITS.MAX_FILES_PER_BATCH,

  // Supported file types - mapped from centralized formats
  SUPPORTED_FILE_TYPES: [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/tiff',
    'image/tif',
    'image/bmp',
  ],

  // Upload behavior - using centralized constants
  MAX_CONCURRENT_CHUNKS: 2, // Number of chunks to upload in parallel
  RETRY_ATTEMPTS: RETRY_ATTEMPTS.UPLOAD,
  RETRY_DELAY_MS: TIMEOUTS.RETRY_SHORT,

  // Average file sizes for estimation (in MB)
  AVG_FILE_SIZES: {
    'image/jpeg': 1.5,
    'image/jpg': 1.5,
    'image/png': 2,
    'image/tiff': 10,
    'image/tif': 10,
    'image/bmp': 30, // BMP files are much larger (uncompressed)
  },

  // Get average file size for a given type
  getAvgFileSize(fileType: string): number {
    return (
      this.AVG_FILE_SIZES[fileType as keyof typeof this.AVG_FILE_SIZES] || 2
    );
  },

  // Calculate if files will fit in chunks
  willFilesExceedChunkLimit(files: File[]): boolean {
    const chunks = Math.ceil(files.length / this.FILES_PER_CHUNK);

    for (let i = 0; i < chunks; i++) {
      const chunkFiles = files.slice(
        i * this.FILES_PER_CHUNK,
        (i + 1) * this.FILES_PER_CHUNK
      );
      const chunkSize = chunkFiles.reduce((sum, file) => sum + file.size, 0);

      if (chunkSize > this.MAX_SIZE_PER_CHUNK_BYTES) {
        return true;
      }
    }

    return false;
  },

  // Format size for display
  formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  },
};

export default UPLOAD_CONFIG;
