import { describe, it, expect } from 'vitest';
import UPLOAD_CONFIG from '@/lib/uploadConfig';
import { FILE_LIMITS, RETRY_ATTEMPTS, TIMEOUTS } from '@/lib/constants';

// Create a file with a given logical size without allocating the actual bytes.
// The File polyfill in setup.ts computes size from the content, so we pass
// a minimal body and override the size property for large-file tests.
const makeFile = (size: number, type = 'image/jpeg'): File => {
  const f = new File(['x'], 'file.jpg', { type });
  Object.defineProperty(f, 'size', { value: size, configurable: true });
  return f;
};

describe('UPLOAD_CONFIG', () => {
  describe('constant values (match centralized constants)', () => {
    it('MAX_FILE_SIZE_MB matches FILE_LIMITS', () => {
      expect(UPLOAD_CONFIG.MAX_FILE_SIZE_MB).toBe(FILE_LIMITS.MAX_FILE_SIZE_MB);
    });

    it('MAX_FILE_SIZE_BYTES matches FILE_LIMITS', () => {
      expect(UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES).toBe(
        FILE_LIMITS.MAX_FILE_SIZE_BYTES
      );
    });

    it('FILES_PER_CHUNK matches FILE_LIMITS.CHUNK_SIZE_FILES', () => {
      expect(UPLOAD_CONFIG.FILES_PER_CHUNK).toBe(FILE_LIMITS.CHUNK_SIZE_FILES);
    });

    it('MAX_SIZE_PER_CHUNK_BYTES matches FILE_LIMITS.MAX_TOTAL_SIZE_BYTES', () => {
      expect(UPLOAD_CONFIG.MAX_SIZE_PER_CHUNK_BYTES).toBe(
        FILE_LIMITS.MAX_TOTAL_SIZE_BYTES
      );
    });

    it('MAX_TOTAL_FILES matches FILE_LIMITS.MAX_FILES_PER_BATCH', () => {
      expect(UPLOAD_CONFIG.MAX_TOTAL_FILES).toBe(
        FILE_LIMITS.MAX_FILES_PER_BATCH
      );
    });

    it('RETRY_ATTEMPTS matches centralized RETRY_ATTEMPTS.UPLOAD', () => {
      expect(UPLOAD_CONFIG.RETRY_ATTEMPTS).toBe(RETRY_ATTEMPTS.UPLOAD);
    });

    it('RETRY_DELAY_MS matches TIMEOUTS.RETRY_SHORT', () => {
      expect(UPLOAD_CONFIG.RETRY_DELAY_MS).toBe(TIMEOUTS.RETRY_SHORT);
    });
  });

  describe('formatSize', () => {
    it('formats bytes correctly', () => {
      expect(UPLOAD_CONFIG.formatSize(512)).toBe('512.0 B');
    });

    it('formats kilobytes correctly', () => {
      expect(UPLOAD_CONFIG.formatSize(1024)).toBe('1.0 KB');
    });

    it('formats megabytes correctly', () => {
      expect(UPLOAD_CONFIG.formatSize(2 * 1024 * 1024)).toBe('2.0 MB');
    });

    it('formats gigabytes correctly', () => {
      expect(UPLOAD_CONFIG.formatSize(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
    });

    it('formats zero bytes', () => {
      expect(UPLOAD_CONFIG.formatSize(0)).toBe('0.0 B');
    });
  });

  describe('getAvgFileSize', () => {
    it('returns 1.5 for image/jpeg', () => {
      expect(UPLOAD_CONFIG.getAvgFileSize('image/jpeg')).toBe(1.5);
    });

    it('returns 1.5 for image/jpg', () => {
      expect(UPLOAD_CONFIG.getAvgFileSize('image/jpg')).toBe(1.5);
    });

    it('returns 2 for image/png', () => {
      expect(UPLOAD_CONFIG.getAvgFileSize('image/png')).toBe(2);
    });

    it('returns 10 for image/tiff', () => {
      expect(UPLOAD_CONFIG.getAvgFileSize('image/tiff')).toBe(10);
    });

    it('returns 10 for image/tif', () => {
      expect(UPLOAD_CONFIG.getAvgFileSize('image/tif')).toBe(10);
    });

    it('returns 30 for image/bmp', () => {
      expect(UPLOAD_CONFIG.getAvgFileSize('image/bmp')).toBe(30);
    });

    it('returns 2 as default for an unknown MIME type', () => {
      expect(UPLOAD_CONFIG.getAvgFileSize('image/webp')).toBe(2);
    });
  });

  describe('willFilesExceedChunkLimit', () => {
    it('returns false for files well within the chunk size limit', () => {
      const files = [makeFile(1024), makeFile(1024)];
      expect(UPLOAD_CONFIG.willFilesExceedChunkLimit(files)).toBe(false);
    });

    it('returns true when a single chunk exceeds MAX_SIZE_PER_CHUNK_BYTES', () => {
      const oversized = makeFile(UPLOAD_CONFIG.MAX_SIZE_PER_CHUNK_BYTES + 1);
      expect(UPLOAD_CONFIG.willFilesExceedChunkLimit([oversized])).toBe(true);
    });

    it('returns false for an empty file list', () => {
      expect(UPLOAD_CONFIG.willFilesExceedChunkLimit([])).toBe(false);
    });

    it('checks each chunk independently — only flags the oversized chunk', () => {
      // First chunk is fine, second would be oversized
      const normalFiles = Array.from(
        { length: UPLOAD_CONFIG.FILES_PER_CHUNK },
        () => makeFile(100)
      );
      const oversized = makeFile(UPLOAD_CONFIG.MAX_SIZE_PER_CHUNK_BYTES + 1);
      const mixed = [...normalFiles, oversized];

      expect(UPLOAD_CONFIG.willFilesExceedChunkLimit(mixed)).toBe(true);
    });
  });
});
