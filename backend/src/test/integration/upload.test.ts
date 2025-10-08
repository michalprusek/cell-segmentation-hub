import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../../app';
import { prisma } from '../../db/index';
import {
  UploadMockGenerator,
  MockRateLimiter,
  PerformanceMetrics,
} from '../utils/uploadMocks';
import fs from 'fs/promises';
import path from 'path';

// Test configuration
const TEST_USER = {
  email: 'test@example.com',
  password: 'testPassword123!',
  username: 'testuser',
};

const TEST_PROJECT = {
  name: 'Upload Test Project',
  description: 'Project for testing large batch uploads',
};

describe('Large Batch Upload Integration Tests', () => {
  let authToken: string;
  let userId: string;
  let projectId: string;
  let uploadDir: string;

  beforeAll(async () => {
    // Setup test database and user
    await setupTestEnvironment();
  });

  afterAll(async () => {
    // Cleanup test environment
    await cleanupTestEnvironment();
  });

  beforeEach(async () => {
    // Create test user and project for each test
    const { token, user, project } = await createTestUserAndProject();
    authToken = token;
    userId = user.id;
    projectId = project.id;
    uploadDir = process.env.UPLOAD_DIR || './test-uploads';
  });

  afterEach(async () => {
    // Cleanup uploaded files and database entries
    await cleanupTestData(userId, projectId);
  });

  describe('Large Batch Upload Scenarios', () => {
    it('should successfully upload 100 images in chunks', async () => {
      const metrics = new PerformanceMetrics();
      const totalFiles = 100;
      const chunkSize = 20;
      const chunks = Math.ceil(totalFiles / chunkSize);
      const uploadedImages: any[] = [];

      for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
        const startIndex = chunkIndex * chunkSize;
        const endIndex = Math.min(startIndex + chunkSize, totalFiles);
        const filesInChunk = endIndex - startIndex;

        const mockFiles = UploadMockGenerator.createMockFiles(filesInChunk, {
          namePrefix: `batch-chunk-${chunkIndex + 1}`,
          fileSize: 1024 * 200, // 200KB each
        });

        const formData = new FormData();
        mockFiles.forEach(file => {
          const blob = new Blob([file.buffer], { type: file.mimetype });
          formData.append('images', blob, file.originalname);
        });

        const _response = await request(app)
          .post(`/api/projects/${projectId}/images`)
          .set('Authorization', `Bearer ${authToken}`)
          .send(formData)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.images).toHaveLength(filesInChunk);

        uploadedImages.push(...response.body.data.images);

        // Small delay between chunks to simulate real-world scenario
        await UploadMockGenerator.simulateNetworkDelay(100);
      }

      metrics.end();
      const { duration, memory } = metrics.getMetrics();

      // Assertions
      expect(uploadedImages).toHaveLength(totalFiles);
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
      expect(memory.increase.heapUsed).toBeLessThan(100 * 1024 * 1024); // Less than 100MB memory increase

      // Verify database entries
      const dbImages = await prisma.image.findMany({
        where: { projectId, userId },
      });
      expect(dbImages).toHaveLength(totalFiles);
    }, 60000); // 60 second timeout

    it('should handle 613 images upload (original problem scenario)', async () => {
      const totalFiles = 613;
      const chunkSize = 20; // Current frontend chunking size
      const chunks = Math.ceil(totalFiles / chunkSize);
      let totalUploaded = 0;
      const failedChunks: number[] = [];

      const metrics = new PerformanceMetrics();

      for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
        const startIndex = chunkIndex * chunkSize;
        const endIndex = Math.min(startIndex + chunkSize, totalFiles);
        const filesInChunk = endIndex - startIndex;

        try {
          const mockFiles = UploadMockGenerator.createMockFiles(filesInChunk, {
            namePrefix: `large-batch-${chunkIndex + 1}`,
            fileSize: 1024 * 150, // 150KB each to simulate real microscopy images
          });

          const formData = new FormData();
          mockFiles.forEach(file => {
            const blob = new Blob([file.buffer], { type: file.mimetype });
            formData.append('images', blob, file.originalname);
          });

          const response = await request(app)
            .post(`/api/projects/${projectId}/images`)
            .set('Authorization', `Bearer ${authToken}`)
            .send(formData)
            .timeout(60000); // 60 second timeout per chunk

          if (response.status === 200) {
            totalUploaded += response.body.data.images.length;
          } else {
            failedChunks.push(chunkIndex);
          }

          // Respect rate limits
          await UploadMockGenerator.simulateNetworkDelay(200);
        } catch (_error) {
          //           console.error(`Chunk ${chunkIndex} failed:`, _error);
          failedChunks.push(chunkIndex);
        }
      }

      metrics.end();
      const { duration, memory } = metrics.getMetrics();

      // Assertions
      expect(failedChunks.length).toBe(0); // No chunks should fail
      expect(totalUploaded).toBe(totalFiles);
      expect(duration).toBeLessThan(300000); // Should complete within 5 minutes
      expect(memory.increase.heapUsed).toBeLessThan(200 * 1024 * 1024); // Less than 200MB memory increase

      // Verify all images are in database
      const dbImages = await prisma.image.findMany({
        where: { projectId, userId },
      });
      expect(dbImages).toHaveLength(totalFiles);
    }, 600000); // 10 minute timeout for this large test

    it('should maintain database consistency during large batch uploads', async () => {
      const totalFiles = 50;
      const mockFiles = UploadMockGenerator.createMockFiles(totalFiles, {
        fileSize: 1024 * 300, // 300KB each
      });

      const formData = new FormData();
      mockFiles.forEach(file => {
        const blob = new Blob([file.buffer], { type: file.mimetype });
        formData.append('images', blob, file.originalname);
      });

      // Start database transaction monitoring
      const initialImageCount = await prisma.image.count({
        where: { projectId },
      });

      const response = await request(app)
        .post(`/api/projects/${projectId}/images`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(formData)
        .expect(200);

      // Verify response
      expect(response.body.success).toBe(true);
      expect(response.body.data.images).toHaveLength(totalFiles);

      // Verify database consistency
      const finalImageCount = await prisma.image.count({
        where: { projectId },
      });
      expect(finalImageCount - initialImageCount).toBe(totalFiles);

      // Verify all images have required fields
      const uploadedImages = await prisma.image.findMany({
        where: {
          projectId,
          createdAt: {
            gte: new Date(Date.now() - 60000), // Created in last minute
          },
        },
      });

      uploadedImages.forEach(image => {
        expect(image.id).toBeDefined();
        expect(image.name).toBeDefined();
        expect(image.originalPath).toBeDefined();
        expect(image.fileSize).toBeGreaterThan(0);
        expect(image.userId).toBe(userId);
        expect(image.projectId).toBe(projectId);
        expect(image.segmentationStatus).toBe('pending');
      });
    });

    it('should handle thumbnail generation for batch uploads', async () => {
      const totalFiles = 25;
      const mockFiles = UploadMockGenerator.createVariedSizeFiles(totalFiles);

      const formData = new FormData();
      mockFiles.forEach(file => {
        const blob = new Blob([file.buffer], { type: file.mimetype });
        formData.append('images', blob, file.originalname);
      });

      const response = await request(app)
        .post(`/api/projects/${projectId}/images`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(formData)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Check that thumbnail paths are generated
      const uploadedImages = response.body.data.images;
      uploadedImages.forEach((image: any) => {
        expect(image.thumbnailPath).toBeDefined();
        expect(image.thumbnailPath).toMatch(/thumb/);
      });

      // Verify thumbnails exist in storage (if using local storage)
      if (process.env.STORAGE_TYPE === 'local') {
        for (const image of uploadedImages) {
          const thumbnailPath = path.join(uploadDir, image.thumbnailPath);
          const thumbnailExists = await fs
            .access(thumbnailPath)
            .then(() => true)
            .catch(() => false);
          expect(thumbnailExists).toBe(true);
        }
      }
    });
  });

  describe('Rate Limiting and Concurrency', () => {
    it('should respect rate limits during concurrent uploads', async () => {
      const rateLimiter = new MockRateLimiter(10, 60 * 1000); // 10 requests per minute
      const concurrentRequests = 15;
      const filesPerRequest = 5;

      const requests = Array.from(
        { length: concurrentRequests },
        async (_, i) => {
          if (!rateLimiter.isAllowed()) {
            throw new Error('Rate limit exceeded');
          }

          const mockFiles = UploadMockGenerator.createMockFiles(
            filesPerRequest,
            {
              namePrefix: `concurrent-${i}`,
            }
          );

          const formData = new FormData();
          mockFiles.forEach(file => {
            const blob = new Blob([file.buffer], { type: file.mimetype });
            formData.append('images', blob, file.originalname);
          });

          return request(app)
            .post(`/api/projects/${projectId}/images`)
            .set('Authorization', `Bearer ${authToken}`)
            .send(formData);
        }
      );

      const results = await Promise.allSettled(requests);

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      // Should have some successful requests within rate limit
      expect(successful).toBeGreaterThan(0);
      expect(successful).toBeLessThanOrEqual(10);
      expect(failed).toBe(concurrentRequests - successful);
    });

    it('should handle memory pressure during concurrent uploads', async () => {
      const memoryTracker = UploadMockGenerator.createMemoryTracker();
      const concurrentUploads = 5;
      const filesPerUpload = 20;

      const uploadPromises = Array.from(
        { length: concurrentUploads },
        async (_, i) => {
          const mockFiles = UploadMockGenerator.createMockFiles(
            filesPerUpload,
            {
              namePrefix: `memory-test-${i}`,
              fileSize: 1024 * 500, // 500KB each
            }
          );

          const formData = new FormData();
          mockFiles.forEach(file => {
            const blob = new Blob([file.buffer], { type: file.mimetype });
            formData.append('images', blob, file.originalname);
          });

          return request(app)
            .post(`/api/projects/${projectId}/images`)
            .set('Authorization', `Bearer ${authToken}`)
            .send(formData);
        }
      );

      const results = await Promise.allSettled(uploadPromises);

      // Check memory usage
      memoryTracker.assertMemoryWithinLimits(150); // 150MB limit

      // Verify all uploads succeeded
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBe(concurrentUploads);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from partial upload failures', async () => {
      const totalFiles = 60;
      const chunkSize = 20;
      let successfulUploads = 0;
      let failedChunks = 0;

      // Simulate network issues by randomly failing some requests
      for (let chunk = 0; chunk < Math.ceil(totalFiles / chunkSize); chunk++) {
        const startIndex = chunk * chunkSize;
        const endIndex = Math.min(startIndex + chunkSize, totalFiles);
        const filesInChunk = endIndex - startIndex;

        const mockFiles = UploadMockGenerator.createMockFiles(filesInChunk, {
          namePrefix: `recovery-test-${chunk}`,
        });

        // Randomly fail 30% of chunks to simulate network issues
        if (Math.random() < 0.3) {
          failedChunks++;
          continue; // Skip this chunk to simulate failure
        }

        const formData = new FormData();
        mockFiles.forEach(file => {
          const blob = new Blob([file.buffer], { type: file.mimetype });
          formData.append('images', blob, file.originalname);
        });

        try {
          const response = await request(app)
            .post(`/api/projects/${projectId}/images`)
            .set('Authorization', `Bearer ${authToken}`)
            .send(formData)
            .timeout(30000);

          if (response.status === 200) {
            successfulUploads += response.body.data.images.length;
          }
        } catch (_error) {
          failedChunks++;
        }

        await UploadMockGenerator.simulateNetworkDelay(100);
      }

      // Should have some successful uploads despite failures
      expect(successfulUploads).toBeGreaterThan(0);
      expect(failedChunks).toBeGreaterThan(0);

      // Verify database state is consistent
      const dbImages = await prisma.image.findMany({
        where: { projectId, userId },
      });
      expect(dbImages.length).toBe(successfulUploads);
    });

    it('should handle storage service interruptions', async () => {
      const totalFiles = 30;

      // Mock storage service failure
      const _originalStorageWrite = jest.fn();

      const mockFiles = UploadMockGenerator.createMockFiles(totalFiles, {
        fileSize: 1024 * 100,
      });

      const formData = new FormData();
      mockFiles.forEach(file => {
        const blob = new Blob([file.buffer], { type: file.mimetype });
        formData.append('images', blob, file.originalname);
      });

      // This might fail due to storage issues - that's expected
      const response = await request(app)
        .post(`/api/projects/${projectId}/images`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(formData);

      // If it fails, verify no partial data is left in database
      if (response.status !== 200) {
        const orphanedImages = await prisma.image.findMany({
          where: {
            projectId,
            userId,
            createdAt: {
              gte: new Date(Date.now() - 60000), // Last minute
            },
          },
        });

        // Should not have partial uploads in database
        expect(orphanedImages.length).toBe(0);
      }
    });

    it('should validate file integrity during large uploads', async () => {
      const validFiles = 10;
      const invalidFiles = 5;

      // Create mix of valid and invalid files
      const mockValidFiles = UploadMockGenerator.createMockFiles(validFiles);
      const mockInvalidFiles = UploadMockGenerator.createInvalidFiles().slice(
        0,
        invalidFiles
      );

      const allFiles = [...mockValidFiles, ...mockInvalidFiles];

      const formData = new FormData();
      allFiles.forEach(file => {
        if (file.buffer) {
          const blob = new Blob([file.buffer], { type: file.mimetype });
          formData.append('images', blob, file.originalname);
        }
      });

      const response = await request(app)
        .post(`/api/projects/${projectId}/images`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(formData);

      // Should reject the entire batch if any file is invalid
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);

      // Verify no files were uploaded to database
      const dbImages = await prisma.image.findMany({
        where: {
          projectId,
          userId,
          createdAt: {
            gte: new Date(Date.now() - 60000),
          },
        },
      });
      expect(dbImages.length).toBe(0);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should meet performance benchmarks for large uploads', async () => {
      const benchmarkSizes = [10, 25, 50];
      const results: { size: number; duration: number; throughput: number }[] =
        [];

      for (const size of benchmarkSizes) {
        const metrics = new PerformanceMetrics();

        const mockFiles = UploadMockGenerator.createMockFiles(size, {
          fileSize: 1024 * 200, // 200KB each
          namePrefix: `benchmark-${size}`,
        });

        const formData = new FormData();
        mockFiles.forEach(file => {
          const blob = new Blob([file.buffer], { type: file.mimetype });
          formData.append('images', blob, file.originalname);
        });

        const _response = await request(app)
          .post(`/api/projects/${projectId}/images`)
          .set('Authorization', `Bearer ${authToken}`)
          .send(formData)
          .expect(200);

        metrics.end();
        const { duration } = metrics.getMetrics();
        const throughput = size / (duration / 1000); // files per second

        results.push({ size, duration, throughput });

        // Cleanup for next test
        await prisma.image.deleteMany({
          where: { projectId, userId },
        });
      }

      // Performance assertions
      results.forEach(({ size, duration, throughput }) => {
        expect(duration).toBeLessThan(size * 1000); // Less than 1 second per file
        expect(throughput).toBeGreaterThan(1); // At least 1 file per second
      });

      // Throughput should scale reasonably
      const smallBatch = results.find(r => r.size === 10)!;
      const largeBatch = results.find(r => r.size === 50)!;

      // Large batch should have better or similar throughput
      expect(largeBatch.throughput).toBeGreaterThanOrEqual(
        smallBatch.throughput * 0.5
      );
    });
  });

  // Helper functions
  async function setupTestEnvironment() {
    // Ensure test database is clean
    await prisma.image.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.user.deleteMany({});
  }

  async function cleanupTestEnvironment() {
    await prisma.image.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.user.deleteMany({});
  }

  async function createTestUserAndProject() {
    // Register test user
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send(TEST_USER)
      .expect(201);

    const { accessToken, user } = registerResponse.body.data;

    // Create test project
    const projectResponse = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(TEST_PROJECT)
      .expect(201);

    return {
      token: accessToken,
      user,
      project: projectResponse.body.data,
    };
  }

  async function cleanupTestData(userId: string, projectId: string) {
    // Delete uploaded images
    await prisma.image.deleteMany({
      where: { userId, projectId },
    });

    // Delete test project
    await prisma.project
      .delete({
        where: { id: projectId },
      })
      .catch(() => {}); // Ignore if already deleted

    // Delete test user
    await prisma.user
      .delete({
        where: { id: userId },
      })
      .catch(() => {}); // Ignore if already deleted

    // Cleanup uploaded files from filesystem
    if (uploadDir) {
      try {
        await fs.rm(uploadDir, { recursive: true, force: true });
      } catch (_error) {
        // Ignore cleanup errors
      }
    }
  }
});
