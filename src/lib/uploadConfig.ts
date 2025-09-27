/**
 * Upload configuration that matches backend limits
 * Centralized configuration for upload limits across the application
 */

export const UPLOAD_CONFIG = {
  // File limits
  MAX_FILE_SIZE_MB: 20, // 20MB per file (optimized for better performance)
  MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024, // 20MB in bytes

  // Chunk limits
  FILES_PER_CHUNK: 100, // Max files per chunk (matches backend MAX_FILES_PER_REQUEST)
  MAX_SIZE_PER_CHUNK_MB: 500, // 500MB per chunk (matches nginx client_max_body_size)
  MAX_SIZE_PER_CHUNK_BYTES: 500 * 1024 * 1024, // 500MB in bytes

  // Total limits
  MAX_TOTAL_FILES: 10000, // Maximum files per project (matches backend MAX_TOTAL_FILES)

  // Supported file types
  SUPPORTED_FILE_TYPES: [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/tiff',
    'image/tif',
    'image/bmp',
  ],

  // Upload behavior
  MAX_CONCURRENT_CHUNKS: 2, // Number of chunks to upload in parallel
  RETRY_ATTEMPTS: 3, // Number of retry attempts for failed chunks
  RETRY_DELAY_MS: 2000, // Delay between retries

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
