import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import {
  uploadImages,
  handleUploadError,
  validateUploadedFiles,
} from '../upload';
import * as UploadMocksRaw from '../../test/utils/uploadMocks';

// Provide a class-style namespace for the individual exported functions
const UploadMockGenerator = {
  createMockFiles: UploadMocksRaw.createMockFiles,
  createMockFormData: UploadMocksRaw.createMockFormData,
  createInvalidFiles: UploadMocksRaw.createInvalidFiles,
};

/**
 * Helper to attach mock files to a supertest request.
 * Multer requires proper multipart/form-data; supertest's .send() doesn't work for this.
 */
function attachFiles(
  req: ReturnType<ReturnType<typeof request>['post']>,
  files: Express.Multer.File[]
): ReturnType<ReturnType<typeof request>['post']> {
  let r = req;
  files.forEach(file => {
    r = r.attach('images', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
  });
  return r;
}

describe('Upload Middleware - Large Batch Support', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('File Count Limits', () => {
    // Tests run under TEST_LIMITS (MAX_FILES_PER_REQUEST: 20). These
    // intentionally differ from PRODUCTION_LIMITS so boundary conditions
    // are exercised with a small, predictable cap (issue #73).
    it('should accept exactly MAX_FILES_PER_REQUEST files (20 at test cap)', async () => {
      app.post('/test-upload', uploadImages, (req, res) => {
        const files = req.files as Express.Multer.File[];
        res.json({ success: true, fileCount: files.length });
      });

      const mockFiles = UploadMockGenerator.createMockFiles(20, {
        fileSize: 1024 * 100, // 100KB each
      });

      const response = await attachFiles(
        request(app).post('/test-upload'),
        mockFiles
      ).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.fileCount).toBe(20);
    });

    it('should reject 21 files (exceeds test cap)', async () => {
      app.post(
        '/test-upload',
        uploadImages,
        handleUploadError,
        (req: any, res: any) => {
          const files = req.files as Express.Multer.File[];
          res.json({ success: true, fileCount: files.length });
        }
      );

      const mockFiles = UploadMockGenerator.createMockFiles(21, {
        fileSize: 1024 * 100,
      });

      const response = await attachFiles(
        request(app).post('/test-upload'),
        mockFiles
      ).expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Příliš mnoho souborů');
    });
  });

  describe('File Size Limits', () => {
    it('should accept files up to increased size limit', async () => {
      app.post('/test-upload', uploadImages, (req, res) => {
        const files = req.files as Express.Multer.File[];
        const totalSize = files.reduce((sum, file) => sum + file.size, 0);
        res.json({ success: true, fileCount: files.length, totalSize });
      });

      // Test with files that would be acceptable under new limits (under 20MB per file)
      const mockFiles = UploadMockGenerator.createMockFiles(10, {
        fileSize: 1024 * 1024 * 1, // 1MB each (under 20MB test limit)
      });

      const response = await attachFiles(
        request(app).post('/test-upload'),
        mockFiles
      ).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.fileCount).toBe(10);
      expect(response.body.totalSize).toBe(10 * 1024 * 1024 * 1); // 10MB total
    });

    it('should reject individual files exceeding size limit', async () => {
      app.post('/test-upload', uploadImages, handleUploadError, (req: any, res: any) => {
        const files = req.files as Express.Multer.File[];
        res.json({ success: true, fileCount: files.length });
      });

      // Create a file that exceeds the individual file size limit (20MB in test env)
      const mockFiles = UploadMockGenerator.createMockFiles(1, {
        fileSize: 1024 * 1024 * 21, // 21MB - exceeds 20MB test limit
      });

      const response = await attachFiles(
        request(app).post('/test-upload'),
        mockFiles
      ).expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('příliš velký');
    });
  });

  describe('MIME Type Validation', () => {
    it('should accept all supported image MIME types', async () => {
      app.post('/test-upload', uploadImages, (req, res) => {
        const files = req.files as Express.Multer.File[];
        res.json({ success: true, fileCount: files.length });
      });

      const supportedTypes = [
        { ext: 'jpg', mime: 'image/jpeg' },
        { ext: 'png', mime: 'image/png' },
        { ext: 'tiff', mime: 'image/tiff' },
        { ext: 'bmp', mime: 'image/bmp' },
        { ext: 'webp', mime: 'image/webp' },
      ];

      for (const { ext, mime } of supportedTypes) {
        const mockFiles = UploadMockGenerator.createMockFiles(1, {
          mimeType: mime,
          extension: ext,
        });

        const response = await attachFiles(
          request(app).post('/test-upload'),
          mockFiles
        );

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      }
    });

    it('should reject unsupported MIME types', async () => {
      app.post('/test-upload', uploadImages, handleUploadError, (req: any, res: any) => {
        const files = req.files as Express.Multer.File[];
        res.json({ success: true, fileCount: files.length });
      });

      const unsupportedTypes = [
        { ext: 'txt', mime: 'text/plain' },
        { ext: 'pdf', mime: 'application/pdf' },
        { ext: 'mp4', mime: 'video/mp4' },
        { ext: 'zip', mime: 'application/zip' },
      ];

      for (const { ext, mime } of unsupportedTypes) {
        const mockFiles = UploadMockGenerator.createMockFiles(1, {
          mimeType: mime,
          extension: ext,
        });

        const response = await attachFiles(
          request(app).post('/test-upload'),
          mockFiles
        );

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Nepodporovaný formát');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle LIMIT_FILE_COUNT error with new message', async () => {
      app.post('/test-upload', uploadImages, handleUploadError, (req: any, res: any) => {
        res.json({ success: true });
      });

      // Simulate the error by creating too many files
      const mockFiles = UploadMockGenerator.createMockFiles(25); // Exceeds test cap of 20

      const response = await attachFiles(
        request(app).post('/test-upload'),
        mockFiles
      ).expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('20 souborů'); // TEST_LIMITS cap
    });

    it('should handle LIMIT_FILE_SIZE error', async () => {
      app.post('/test-upload', uploadImages, handleUploadError, (req: any, res: any) => {
        res.json({ success: true });
      });

      const mockFiles = UploadMockGenerator.createMockFiles(1, {
        fileSize: 1024 * 1024 * 21, // 21MB - exceeds 20MB test limit
      });

      const response = await attachFiles(
        request(app).post('/test-upload'),
        mockFiles
      ).expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('příliš velký');
    });

    it('should handle multiple error types in batch', async () => {
      app.post('/test-upload', uploadImages, handleUploadError, (req: any, res: any) => {
        res.json({ success: true });
      });

      // Mix of invalid files: wrong MIME types, too large, etc.
      const invalidFiles = UploadMockGenerator.createInvalidFiles();

      const response = await attachFiles(
        request(app).post('/test-upload'),
        invalidFiles
      ).expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('File Validation Middleware', () => {
    it('should validate uploaded files', async () => {
      app.post(
        '/test-validate',
        (req, res, next) => {
          // Simulate files being added to request
          req.files = UploadMockGenerator.createMockFiles(10);
          next();
        },
        validateUploadedFiles,
        (req, res) => {
          res.json({ success: true, message: 'Files validated' });
        }
      );

      const response = await request(app).post('/test-validate').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Files validated');
    });

    it('should reject when no files uploaded', async () => {
      app.post(
        '/test-validate',
        (req, res, next) => {
          req.files = []; // No files
          next();
        },
        validateUploadedFiles,
        (req, res) => {
          res.json({ success: true });
        }
      );

      const response = await request(app).post('/test-validate').expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('alespoň jeden soubor');
    });
  });

  describe('Performance and Memory', () => {
    it('should handle large file batches efficiently', async () => {
      const startMemory = process.memoryUsage();

      app.post('/test-performance', uploadImages, (req, res) => {
        const files = req.files as Express.Multer.File[];
        const totalSize = files.reduce((sum, file) => sum + file.size, 0);
        res.json({
          success: true,
          fileCount: files.length,
          totalSize,
          memoryUsage: process.memoryUsage(),
        });
      });

      const mockFiles = UploadMockGenerator.createMockFiles(20, {
        fileSize: 1024 * 500, // 500KB each = 10MB total
      });

      const response = await attachFiles(
        request(app).post('/test-performance'),
        mockFiles
      ).expect(200);

      const endMemory = process.memoryUsage();
      const memoryIncrease = endMemory.heapUsed - startMemory.heapUsed;

      expect(response.body.success).toBe(true);
      expect(response.body.fileCount).toBe(20);
      expect(response.body.totalSize).toBe(20 * 1024 * 500);

      // Memory increase should be reasonable (less than 100MB for this test)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
    });

    it('should not leak memory between requests', async () => {
      app.post('/test-memory-leak', uploadImages, (req, res) => {
        const files = req.files as Express.Multer.File[];
        res.json({ success: true, fileCount: files.length });
      });

      const initialMemory = process.memoryUsage().heapUsed;

      // Make multiple requests
      for (let i = 0; i < 5; i++) {
        const mockFiles = UploadMockGenerator.createMockFiles(20, {
          fileSize: 1024 * 100, // 100KB each
        });

        await attachFiles(
          request(app).post('/test-memory-leak'),
          mockFiles
        ).expect(200);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory should not have increased significantly
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB
    });
  });

  describe('Concurrent Upload Handling', () => {
    it('should handle concurrent upload requests', async () => {
      app.post('/test-concurrent', uploadImages, (req, res) => {
        const files = req.files as Express.Multer.File[];
        res.json({ success: true, fileCount: files.length });
      });

      const concurrentRequests = 3;
      const requests = Array.from({ length: concurrentRequests }, () => {
        const mockFiles = UploadMockGenerator.createMockFiles(15, {
          fileSize: 1024 * 100,
        });

        return attachFiles(request(app).post('/test-concurrent'), mockFiles);
      });

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.fileCount).toBe(15);
      });
    });

    it('should maintain file integrity during concurrent uploads', async () => {
      const uploadResults: Array<{ id: string; fileCount: number }> = [];

      app.post('/test-integrity/:id', uploadImages, (req, res) => {
        const { id } = req.params;
        const files = req.files as Express.Multer.File[];

        uploadResults.push({ id, fileCount: files.length });
        res.json({ success: true, id, fileCount: files.length });
      });

      const concurrentRequests = 4;
      const requests = Array.from({ length: concurrentRequests }, (_, i) => {
        const mockFiles = UploadMockGenerator.createMockFiles(10 + i, {
          // Different file counts
          fileSize: 1024 * 100,
        });

        return attachFiles(
          request(app).post(`/test-integrity/upload-${i}`),
          mockFiles
        );
      });

      const responses = await Promise.all(requests);

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Verify no cross-contamination of files between requests
      // Sort by fileCount since concurrent requests may complete out of order
      const sortedResults = uploadResults.sort((a, b) => a.fileCount - b.fileCount);
      expect(sortedResults).toHaveLength(concurrentRequests);
      expect(sortedResults[0].fileCount).toBe(10);
      expect(sortedResults[1].fileCount).toBe(11);
      expect(sortedResults[2].fileCount).toBe(12);
      expect(sortedResults[3].fileCount).toBe(13);
    });
  });
});
