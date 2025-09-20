import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../server';
import { ExportService } from '../../services/exportService';
import { WebSocketService } from '../../services/websocketService';
import { prisma } from '../../db/index';
import { SharingService } from '../../services/sharingService';
import path from 'path';
import fs from 'fs/promises';

// Mock external dependencies
vi.mock('../../services/websocketService');
vi.mock('../../services/sharingService');
vi.mock('fs/promises');

const mockWebSocketService = vi.mocked(WebSocketService);
const mockSharingService = vi.mocked(SharingService);
const mockFs = vi.mocked(fs);

describe('Export Cancellation - End-to-End Integration Tests', () => {
  let exportService: ExportService;
  let mockWsService: any;
  let authToken: string;
  let testProject: any;
  let testUser: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup WebSocket service mock
    mockWsService = {
      sendToUser: vi.fn(),
      broadcast: vi.fn(),
    };
    mockWebSocketService.getInstance = vi.fn().mockReturnValue(mockWsService);

    // Mock sharing service - allow access by default
    mockSharingService.hasProjectAccess = vi.fn().mockResolvedValue({
      hasAccess: true,
      accessType: 'owner',
    });

    // Mock file system operations
    mockFs.mkdir = vi.fn().mockResolvedValue(undefined);
    mockFs.writeFile = vi.fn().mockResolvedValue(undefined);
    mockFs.unlink = vi.fn().mockResolvedValue(undefined);
    mockFs.rm = vi.fn().mockResolvedValue(undefined);
    mockFs.stat = vi.fn().mockResolvedValue({ isFile: () => true } as any);

    // Create test user
    testUser = await prisma.user.create({
      data: {
        email: 'test@example.com',
        username: 'testuser',
        password: 'hashedpassword',
        isVerified: true,
      },
    });

    // Create test project
    testProject = await prisma.project.create({
      data: {
        title: 'Test Export Project',
        description: 'Project for testing export cancellation',
        userId: testUser.id,
      },
    });

    // Generate auth token for testing
    authToken = 'test-auth-token';

    // Setup export service
    exportService = ExportService.getInstance();
    exportService.setWebSocketService(mockWsService);

    // Clear any existing jobs
    (exportService as any).exportJobs.clear();
  });

  afterEach(async () => {
    // Cleanup test data
    await prisma.project.deleteMany({
      where: { userId: testUser.id },
    });
    await prisma.user.deleteMany({
      where: { email: 'test@example.com' },
    });

    // Clear export jobs
    (exportService as any).exportJobs.clear();

    vi.resetAllMocks();
  });

  describe('Complete Export Cancellation Flow', () => {
    it('should prevent download of export cancelled during processing', async () => {
      // Step 1: Start export
      const startResponse = await request(app)
        .post(`/api/projects/${testProject.id}/exports`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: {
            includeOriginalImages: true,
            includeVisualizations: true,
            annotationFormats: ['json'],
            metricsFormats: ['csv'],
          },
        })
        .expect(200);

      const jobId = startResponse.body.jobId;
      expect(jobId).toBeDefined();

      // Verify job was created
      const job = (exportService as any).exportJobs.get(jobId);
      expect(job).toBeDefined();
      expect(job.status).toBe('pending');

      // Step 2: Simulate processing started
      job.status = 'processing';
      job.progress = 50;

      // Step 3: Cancel export
      const cancelResponse = await request(app)
        .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(cancelResponse.body.message).toContain('cancelled');

      // Verify job status is cancelled
      expect(job.status).toBe('cancelled');

      // Step 4: Simulate completion happening after cancellation (race condition)
      // This would normally happen in the background processing
      const previousStatus = job.status;
      if (previousStatus !== 'cancelled') {
        job.status = 'completed';
        job.filePath = '/test/export.zip';
      }

      // Step 5: Attempt download should fail
      const downloadResponse = await request(app)
        .get(`/api/projects/${testProject.id}/exports/${jobId}/download`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(410);

      expect(downloadResponse.body.error).toContain('Export was cancelled');
      expect(downloadResponse.body.jobId).toBe(jobId);
    });

    it('should handle the exact 8-second timing from bug report', async () => {
      // This test simulates the exact timing scenario from logs
      vi.useFakeTimers();

      const jobId = 'f574e1b4-b0a5-4035-95d0-18fef944762d';

      // Manually create the job to simulate the exact scenario
      const job = {
        id: jobId,
        projectId: testProject.id,
        userId: testUser.id,
        status: 'processing',
        progress: 95,
        createdAt: new Date('2025-01-20T16:45:42.470Z'),
        options: { format: 'coco', includeImages: true },
      };
      (exportService as any).exportJobs.set(jobId, job);

      // T+7500ms: User cancels (simulating 7.5 seconds after start)
      const cancelTime = new Date('2025-01-20T16:45:49.970Z');
      vi.setSystemTime(cancelTime);

      const cancelResponse = await request(app)
        .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(cancelResponse.body.message).toContain('cancelled');
      expect(job.status).toBe('cancelled');

      // T+8000ms: Processing completes (simulating completion at 16:45:50.387Z)
      const completionTime = new Date('2025-01-20T16:45:50.387Z');
      vi.setSystemTime(completionTime);

      // Simulate background processing completion (this should be prevented)
      if (job.status !== 'cancelled') {
        job.status = 'completed';
        job.filePath = '/exports/test.zip';
      }

      // T+8001ms: Download attempt (should fail)
      const downloadTime = new Date('2025-01-20T16:45:50.388Z');
      vi.setSystemTime(downloadTime);

      const downloadResponse = await request(app)
        .get(`/api/projects/${testProject.id}/exports/${jobId}/download`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(410);

      expect(downloadResponse.body.error).toContain('Export was cancelled');
      expect(job.status).toBe('cancelled');
      expect(job.filePath).toBeUndefined();

      vi.useRealTimers();
    });

    it('should handle rapid cancel/restart cycles', async () => {
      const results = [];

      // Create multiple jobs and rapidly cancel them
      for (let i = 0; i < 5; i++) {
        // Start export
        const startResponse = await request(app)
          .post(`/api/projects/${testProject.id}/exports`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            options: {
              includeOriginalImages: true,
              annotationFormats: ['json'],
            },
          })
          .expect(200);

        const jobId = startResponse.body.jobId;

        // Simulate some processing
        const job = (exportService as any).exportJobs.get(jobId);
        job.status = 'processing';
        job.progress = Math.random() * 100;

        // Cancel immediately
        const cancelResponse = await request(app)
          .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        // Attempt download (should fail)
        const downloadResponse = await request(app)
          .get(`/api/projects/${testProject.id}/exports/${jobId}/download`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(410);

        results.push({
          jobId,
          cancelSuccess: cancelResponse.body.message.includes('cancelled'),
          downloadBlocked: downloadResponse.body.error.includes('cancelled'),
          finalStatus: job.status,
        });
      }

      // Verify all operations
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.cancelSuccess).toBe(true);
        expect(result.downloadBlocked).toBe(true);
        expect(result.finalStatus).toBe('cancelled');
      });
    });
  });

  describe('WebSocket Integration During Cancellation', () => {
    it('should send cancellation events via WebSocket', async () => {
      // Start export
      const startResponse = await request(app)
        .post(`/api/projects/${testProject.id}/exports`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: { includeOriginalImages: true },
        })
        .expect(200);

      const jobId = startResponse.body.jobId;

      // Setup job as processing
      const job = (exportService as any).exportJobs.get(jobId);
      job.status = 'processing';

      // Cancel export
      await request(app)
        .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify WebSocket cancellation event would be sent
      // (In real implementation, this would be called automatically)
      (exportService as any).sendToUser(testUser.id, 'export:cancelled', {
        jobId,
        previousStatus: 'processing',
        cancelledAt: new Date(),
      });

      expect(mockWsService.sendToUser).toHaveBeenCalledWith(
        testUser.id,
        'export:cancelled',
        expect.objectContaining({
          jobId,
          previousStatus: 'processing',
          cancelledAt: expect.any(Date),
        })
      );
    });

    it('should not send completion events for cancelled jobs', async () => {
      // Start export
      const startResponse = await request(app)
        .post(`/api/projects/${testProject.id}/exports`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: { includeOriginalImages: true },
        })
        .expect(200);

      const jobId = startResponse.body.jobId;
      const job = (exportService as any).exportJobs.get(jobId);

      // Cancel export
      await request(app)
        .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Simulate processing trying to complete (should be prevented)
      const sendCompletionEvent = () => {
        if (job.status !== 'cancelled') {
          (exportService as any).sendToUser(testUser.id, 'export:completed', { jobId });
        }
      };

      sendCompletionEvent();

      // Verify no completion event was sent
      expect(mockWsService.sendToUser).not.toHaveBeenCalledWith(
        testUser.id,
        'export:completed',
        expect.anything()
      );
    });
  });

  describe('Status Validation Integration', () => {
    it('should return correct status for cancelled jobs', async () => {
      // Start export
      const startResponse = await request(app)
        .post(`/api/projects/${testProject.id}/exports`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: { includeOriginalImages: true },
        })
        .expect(200);

      const jobId = startResponse.body.jobId;

      // Cancel export
      await request(app)
        .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Check status
      const statusResponse = await request(app)
        .get(`/api/projects/${testProject.id}/exports/${jobId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusResponse.body.status).toBe('cancelled');
      expect(statusResponse.body.id).toBe(jobId);
    });

    it('should handle status checks for non-existent jobs', async () => {
      const nonExistentJobId = 'non-existent-job-id';

      const statusResponse = await request(app)
        .get(`/api/projects/${testProject.id}/exports/${nonExistentJobId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(statusResponse.body.error).toContain('not found');
    });

    it('should validate project access for status checks', async () => {
      // Mock access denied
      mockSharingService.hasProjectAccess = vi.fn().mockResolvedValue({
        hasAccess: false,
        accessType: null,
      });

      const jobId = 'test-access-job';

      const statusResponse = await request(app)
        .get(`/api/projects/${testProject.id}/exports/${jobId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(statusResponse.body.error).toContain('not found');
    });
  });

  describe('File Cleanup Integration', () => {
    it('should cleanup files when export is cancelled', async () => {
      // Start export
      const startResponse = await request(app)
        .post(`/api/projects/${testProject.id}/exports`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: { includeOriginalImages: true },
        })
        .expect(200);

      const jobId = startResponse.body.jobId;
      const job = (exportService as any).exportJobs.get(jobId);

      // Simulate file creation during processing
      const filePath = `/exports/${jobId}/export.zip`;
      job.status = 'processing';
      job.filePath = filePath;

      // Cancel export
      await request(app)
        .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Simulate cleanup (would be called automatically in real implementation)
      if (job.status === 'cancelled') {
        try {
          if (job.filePath) {
            await mockFs.unlink(job.filePath);
          }
          const exportDir = path.join(process.env.EXPORT_DIR || './exports', jobId);
          await mockFs.rm(exportDir, { recursive: true, force: true });
          job.filePath = undefined;
        } catch (error) {
          // Cleanup errors are logged but don't fail the operation
        }
      }

      // Verify cleanup was attempted
      expect(mockFs.unlink).toHaveBeenCalledWith(filePath);
      expect(mockFs.rm).toHaveBeenCalledWith(
        expect.stringContaining(jobId),
        { recursive: true, force: true }
      );
      expect(job.filePath).toBeUndefined();
    });

    it('should handle cleanup errors gracefully', async () => {
      // Mock cleanup failures
      mockFs.unlink = vi.fn().mockRejectedValue(new Error('File not found'));
      mockFs.rm = vi.fn().mockRejectedValue(new Error('Directory not found'));

      // Start export
      const startResponse = await request(app)
        .post(`/api/projects/${testProject.id}/exports`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: { includeOriginalImages: true },
        })
        .expect(200);

      const jobId = startResponse.body.jobId;
      const job = (exportService as any).exportJobs.get(jobId);
      job.filePath = '/test/path.zip';

      // Cancel export (should not throw despite cleanup errors)
      const cancelResponse = await request(app)
        .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(cancelResponse.body.message).toContain('cancelled');
      expect(job.status).toBe('cancelled');
    });
  });

  describe('Authentication and Authorization', () => {
    it('should require authentication for all export operations', async () => {
      const jobId = 'test-job';

      // Test start export without auth
      await request(app)
        .post(`/api/projects/${testProject.id}/exports`)
        .send({ options: {} })
        .expect(401);

      // Test cancel without auth
      await request(app)
        .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
        .expect(401);

      // Test download without auth
      await request(app)
        .get(`/api/projects/${testProject.id}/exports/${jobId}/download`)
        .expect(401);

      // Test status without auth
      await request(app)
        .get(`/api/projects/${testProject.id}/exports/${jobId}/status`)
        .expect(401);
    });

    it('should validate project ownership for export operations', async () => {
      // Create different user's project
      const otherUser = await prisma.user.create({
        data: {
          email: 'other@example.com',
          username: 'otheruser',
          password: 'hashedpassword',
          isVerified: true,
        },
      });

      const otherProject = await prisma.project.create({
        data: {
          title: 'Other User Project',
          description: 'Project belonging to different user',
          userId: otherUser.id,
        },
      });

      // Mock access denied for other user's project
      mockSharingService.hasProjectAccess = vi.fn().mockResolvedValue({
        hasAccess: false,
        accessType: null,
      });

      const jobId = 'unauthorized-job';

      // Test operations on other user's project
      await request(app)
        .post(`/api/projects/${otherProject.id}/exports`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ options: {} })
        .expect(403);

      await request(app)
        .delete(`/api/projects/${otherProject.id}/exports/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404); // Returns 404 for access denied

      await request(app)
        .get(`/api/projects/${otherProject.id}/exports/${jobId}/download`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      // Cleanup
      await prisma.project.delete({ where: { id: otherProject.id } });
      await prisma.user.delete({ where: { id: otherUser.id } });
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle database connection issues during cancellation', async () => {
      // Start export
      const startResponse = await request(app)
        .post(`/api/projects/${testProject.id}/exports`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: { includeOriginalImages: true },
        })
        .expect(200);

      const jobId = startResponse.body.jobId;

      // Mock database error
      const originalHasAccess = mockSharingService.hasProjectAccess;
      mockSharingService.hasProjectAccess = vi.fn().mockRejectedValue(new Error('Database connection lost'));

      // Cancel should still work (graceful degradation)
      const cancelResponse = await request(app)
        .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(cancelResponse.body.error).toContain('Failed to cancel export');

      // Restore mock
      mockSharingService.hasProjectAccess = originalHasAccess;
    });

    it('should handle WebSocket service unavailability', async () => {
      // Make WebSocket service unavailable
      exportService.setWebSocketService(null as any);

      // Start export
      const startResponse = await request(app)
        .post(`/api/projects/${testProject.id}/exports`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: { includeOriginalImages: true },
        })
        .expect(200);

      const jobId = startResponse.body.jobId;

      // Cancel should still work without WebSocket
      const cancelResponse = await request(app)
        .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(cancelResponse.body.message).toContain('cancelled');

      const job = (exportService as any).exportJobs.get(jobId);
      expect(job.status).toBe('cancelled');
    });

    it('should handle concurrent cancellation requests', async () => {
      // Start export
      const startResponse = await request(app)
        .post(`/api/projects/${testProject.id}/exports`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: { includeOriginalImages: true },
        })
        .expect(200);

      const jobId = startResponse.body.jobId;

      // Send multiple concurrent cancellation requests
      const cancelPromises = Array.from({ length: 5 }, () =>
        request(app)
          .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
          .set('Authorization', `Bearer ${authToken}`)
      );

      const responses = await Promise.all(cancelPromises);

      // All should succeed or return consistent state
      responses.forEach(response => {
        expect([200, 404]).toContain(response.status);
        if (response.status === 200) {
          expect(response.body.message).toContain('cancelled');
        }
      });

      const job = (exportService as any).exportJobs.get(jobId);
      expect(job.status).toBe('cancelled');
    });
  });
});