import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { ExportController } from '../exportController';
import { ExportService } from '../../../services/exportService';
import { authenticate } from '../../../middleware/auth';
import path from 'path';
import fs from 'fs/promises';

// Mock dependencies
vi.mock('../../../services/exportService');
vi.mock('../../../middleware/auth');
vi.mock('fs/promises');
vi.mock('../../../db/index', () => ({
  getProjectById: vi.fn(),
}));

const MockExportService = vi.mocked(ExportService);
const mockAuthenticate = vi.mocked(authenticate);
const mockFs = vi.mocked(fs);

describe('ExportController - Cancellation Protection Tests', () => {
  let app: express.Application;
  let exportController: ExportController;
  let mockExportService: ReturnType<typeof vi.mocked<typeof ExportService>>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    username: 'testuser',
  };

  const mockProject = {
    id: 'project-123',
    title: 'Test Project',
    userId: 'user-123',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup express app
    app = express();
    app.use(express.json());

    // Mock authentication middleware
    mockAuthenticate.mockImplementation((req: any, res, next) => {
      req.user = mockUser;
      next();
    });

    // Create controller instance with mocked service
    mockExportService = {
      getExportFilePath: vi.fn(),
      getJobStatus: vi.fn(),
      cancelJob: vi.fn(),
      startExportJob: vi.fn(),
      getExportHistory: vi.fn(),
      getInstance: vi.fn(),
    } as any;

    MockExportService.getInstance = vi.fn().mockReturnValue(mockExportService);
    exportController = new ExportController();

    // Setup routes
    app.get('/api/projects/:projectId/exports/:jobId/download',
      mockAuthenticate,
      exportController.downloadExport.bind(exportController)
    );
    app.delete('/api/projects/:projectId/exports/:jobId',
      mockAuthenticate,
      exportController.cancelExport.bind(exportController)
    );
    app.get('/api/projects/:projectId/exports/:jobId/status',
      mockAuthenticate,
      exportController.getExportStatus.bind(exportController)
    );

    // Mock file system
    mockFs.stat = vi.fn().mockResolvedValue({ isFile: () => true } as any);

    // Mock getProjectById
    const { getProjectById } = await import('../../../db/index');
    vi.mocked(getProjectById).mockResolvedValue(mockProject);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('downloadExport - Cancellation Protection (Priority 1 - CRITICAL)', () => {
    it('should return 410 when trying to download cancelled export', async () => {
      // Arrange: Mock cancelled job status
      const jobId = 'test-cancelled-job';
      const projectId = 'project-123';

      mockExportService.getJobStatus!.mockResolvedValue({
        id: jobId,
        projectId,
        status: 'cancelled',
        filePath: '/exports/test.zip',
        createdAt: new Date(),
        userId: mockUser.id,
      });

      // Act: Attempt download
      const response = await request(app)
        .get(`/api/projects/${projectId}/exports/${jobId}/download`)
        .expect(410);

      // Assert: Should be rejected with 410 Gone
      expect(response.body.error).toContain('Export was cancelled');
      expect(response.body.jobId).toBe(jobId);
      expect(mockExportService.getJobStatus).toHaveBeenCalledWith(jobId, projectId, mockUser.id);
      expect(mockExportService.getExportFilePath).not.toHaveBeenCalled();
    });

    it('should return 409 for processing jobs (not completed)', async () => {
      // Arrange: Mock processing job
      const jobId = 'test-processing-job';
      const projectId = 'project-123';

      mockExportService.getJobStatus!.mockResolvedValue({
        id: jobId,
        projectId,
        status: 'processing',
        filePath: null,
        createdAt: new Date(),
        userId: mockUser.id,
      });

      // Act: Attempt download
      const response = await request(app)
        .get(`/api/projects/${projectId}/exports/${jobId}/download`)
        .expect(409);

      // Assert: Should be rejected with 409 Conflict
      expect(response.body.error).toContain('Export not completed');
      expect(mockExportService.getExportFilePath).not.toHaveBeenCalled();
    });

    it('should return 409 for failed jobs', async () => {
      // Arrange: Mock failed job
      const jobId = 'test-failed-job';
      const projectId = 'project-123';

      mockExportService.getJobStatus!.mockResolvedValue({
        id: jobId,
        projectId,
        status: 'failed',
        filePath: null,
        createdAt: new Date(),
        userId: mockUser.id,
        message: 'Export failed due to error',
      });

      // Act: Attempt download
      const response = await request(app)
        .get(`/api/projects/${projectId}/exports/${jobId}/download`)
        .expect(409);

      // Assert: Should be rejected with 409 Conflict
      expect(response.body.error).toContain('Export not completed');
    });

    it('should download successfully for completed non-cancelled jobs', async () => {
      // Arrange: Mock completed job
      const jobId = 'test-completed-job';
      const projectId = 'project-123';
      const filePath = '/exports/test-completed.zip';

      mockExportService.getJobStatus!.mockResolvedValue({
        id: jobId,
        projectId,
        status: 'completed',
        filePath,
        createdAt: new Date(),
        userId: mockUser.id,
      });

      mockExportService.getExportFilePath!.mockResolvedValue(filePath);

      // Mock file exists check
      const resolvedPath = path.resolve(filePath);
      mockFs.stat = vi.fn().mockResolvedValue({ isFile: () => true } as any);

      // Act: Attempt download
      const response = await request(app)
        .get(`/api/projects/${projectId}/exports/${jobId}/download`);

      // Assert: Should proceed to download (headers set correctly)
      expect(response.status).not.toBe(410);
      expect(response.status).not.toBe(409);
      expect(mockExportService.getJobStatus).toHaveBeenCalledWith(jobId, projectId, mockUser.id);
      expect(mockExportService.getExportFilePath).toHaveBeenCalledWith(jobId, projectId, mockUser.id);
    });

    it('should handle race condition: cancelled after status check but before file access', async () => {
      // Arrange: Mock job that gets cancelled between status check and file access
      const jobId = 'test-race-job';
      const projectId = 'project-123';

      // First call returns completed, second call returns cancelled (simulating race condition)
      mockExportService.getJobStatus!
        .mockResolvedValueOnce({
          id: jobId,
          projectId,
          status: 'completed',
          filePath: '/exports/test.zip',
          createdAt: new Date(),
          userId: mockUser.id,
        })
        .mockResolvedValueOnce({
          id: jobId,
          projectId,
          status: 'cancelled',
          filePath: null,
          createdAt: new Date(),
          userId: mockUser.id,
        });

      mockExportService.getExportFilePath!.mockResolvedValue(null); // File path cleared due to cancellation

      // Act: Attempt download
      const response = await request(app)
        .get(`/api/projects/${projectId}/exports/${jobId}/download`)
        .expect(404);

      // Assert: Should fail safely when file path is null
      expect(response.body.error).toContain('Export file not found');
    });

    it('should handle missing job (404)', async () => {
      // Arrange: Mock non-existent job
      const jobId = 'non-existent-job';
      const projectId = 'project-123';

      mockExportService.getJobStatus!.mockResolvedValue(null);

      // Act: Attempt download
      const response = await request(app)
        .get(`/api/projects/${projectId}/exports/${jobId}/download`)
        .expect(404);

      // Assert: Should return 404 for missing job
      expect(response.body.error).toContain('Export job not found');
    });

    it('should validate project access for cancelled exports', async () => {
      // Arrange: Mock cancelled job with access denied
      const jobId = 'test-access-denied-job';
      const projectId = 'project-123';

      mockExportService.getJobStatus!.mockResolvedValue(null); // Access denied returns null

      // Act: Attempt download
      const response = await request(app)
        .get(`/api/projects/${projectId}/exports/${jobId}/download`)
        .expect(404);

      // Assert: Should return 404 when access is denied
      expect(response.body.error).toContain('Export job not found');
      expect(mockExportService.getJobStatus).toHaveBeenCalledWith(jobId, projectId, mockUser.id);
    });
  });

  describe('cancelExport - Immediate State Changes', () => {
    it('should successfully cancel processing export', async () => {
      // Arrange: Mock processing job
      const jobId = 'test-cancel-job';
      const projectId = 'project-123';

      mockExportService.cancelJob!.mockResolvedValue();

      // Act: Cancel export
      const response = await request(app)
        .delete(`/api/projects/${projectId}/exports/${jobId}`)
        .expect(200);

      // Assert: Should confirm cancellation
      expect(response.body.message).toContain('Export cancelled successfully');
      expect(mockExportService.cancelJob).toHaveBeenCalledWith(jobId, projectId, mockUser.id);
    });

    it('should handle cancellation errors gracefully', async () => {
      // Arrange: Mock cancellation error
      const jobId = 'test-error-job';
      const projectId = 'project-123';

      mockExportService.cancelJob!.mockRejectedValue(new Error('Cancellation failed'));

      // Act: Attempt cancellation
      const response = await request(app)
        .delete(`/api/projects/${projectId}/exports/${jobId}`)
        .expect(500);

      // Assert: Should handle error gracefully
      expect(response.body.error).toContain('Failed to cancel export');
      expect(mockExportService.cancelJob).toHaveBeenCalledWith(jobId, projectId, mockUser.id);
    });
  });

  describe('getExportStatus - Status Validation', () => {
    it('should return cancelled status correctly', async () => {
      // Arrange: Mock cancelled job
      const jobId = 'test-status-job';
      const projectId = 'project-123';

      const cancelledJob = {
        id: jobId,
        projectId,
        status: 'cancelled',
        filePath: null,
        createdAt: new Date(),
        userId: mockUser.id,
        message: 'Export was cancelled by user',
      };

      mockExportService.getJobStatus!.mockResolvedValue(cancelledJob);

      // Act: Get status
      const response = await request(app)
        .get(`/api/projects/${projectId}/exports/${jobId}/status`)
        .expect(200);

      // Assert: Should return cancelled status
      expect(response.body.status).toBe('cancelled');
      expect(response.body.message).toContain('cancelled');
      expect(response.body.filePath).toBeNull();
    });

    it('should return completed status for valid completed jobs', async () => {
      // Arrange: Mock completed job
      const jobId = 'test-completed-status-job';
      const projectId = 'project-123';

      const completedJob = {
        id: jobId,
        projectId,
        status: 'completed',
        filePath: '/exports/completed.zip',
        createdAt: new Date(),
        userId: mockUser.id,
      };

      mockExportService.getJobStatus!.mockResolvedValue(completedJob);

      // Act: Get status
      const response = await request(app)
        .get(`/api/projects/${projectId}/exports/${jobId}/status`)
        .expect(200);

      // Assert: Should return completed status
      expect(response.body.status).toBe('completed');
      expect(response.body.filePath).toBe('/exports/completed.zip');
    });
  });

  describe('Edge Cases - Race Condition Scenarios', () => {
    it('should handle rapid cancel/status/download sequence', async () => {
      // Arrange: Mock job that transitions states rapidly
      const jobId = 'test-rapid-job';
      const projectId = 'project-123';

      mockExportService.cancelJob!.mockResolvedValue();
      mockExportService.getJobStatus!.mockResolvedValue({
        id: jobId,
        projectId,
        status: 'cancelled',
        filePath: null,
        createdAt: new Date(),
        userId: mockUser.id,
      });

      // Act: Rapid sequence of operations
      const cancelResponse = await request(app)
        .delete(`/api/projects/${projectId}/exports/${jobId}`)
        .expect(200);

      const statusResponse = await request(app)
        .get(`/api/projects/${projectId}/exports/${jobId}/status`)
        .expect(200);

      const downloadResponse = await request(app)
        .get(`/api/projects/${projectId}/exports/${jobId}/download`)
        .expect(410);

      // Assert: Should handle sequence correctly
      expect(cancelResponse.body.message).toContain('cancelled');
      expect(statusResponse.body.status).toBe('cancelled');
      expect(downloadResponse.body.error).toContain('cancelled');
    });

    it('should prevent download when job status changes to cancelled during request', async () => {
      // This test simulates the exact race condition described in the bug report
      const jobId = 'f574e1b4-b0a5-4035-95d0-18fef944762d'; // Real job ID from bug report
      const projectId = 'project-123';

      // Mock the exact timing scenario: job completes just as user cancels
      mockExportService.getJobStatus!.mockResolvedValue({
        id: jobId,
        projectId,
        status: 'cancelled', // Already cancelled by user
        filePath: null, // File path cleared due to cancellation
        createdAt: new Date(),
        userId: mockUser.id,
      });

      // Act: Attempt download (simulating the 8-second delayed download from logs)
      const response = await request(app)
        .get(`/api/projects/${projectId}/exports/${jobId}/download`)
        .expect(410);

      // Assert: Should prevent download with proper error
      expect(response.body.error).toContain('Export was cancelled');
      expect(response.body.jobId).toBe(jobId);
      expect(mockExportService.getExportFilePath).not.toHaveBeenCalled();
    });
  });

  describe('Authentication and Authorization', () => {
    it('should require authentication for download', async () => {
      // Arrange: Remove authentication
      const appNoAuth = express();
      appNoAuth.use(express.json());
      appNoAuth.get('/api/projects/:projectId/exports/:jobId/download',
        exportController.downloadExport.bind(exportController)
      );

      // Act: Attempt download without auth
      const response = await request(appNoAuth)
        .get('/api/projects/project-123/exports/job-123/download')
        .expect(401);

      // Assert: Should require authentication
      expect(response.body.error).toContain('Unauthorized');
    });

    it('should require authentication for cancellation', async () => {
      // Arrange: Remove authentication
      const appNoAuth = express();
      appNoAuth.use(express.json());
      appNoAuth.delete('/api/projects/:projectId/exports/:jobId',
        exportController.cancelExport.bind(exportController)
      );

      // Act: Attempt cancellation without auth
      const response = await request(appNoAuth)
        .delete('/api/projects/project-123/exports/job-123')
        .expect(401);

      // Assert: Should require authentication
      expect(response.body.error).toContain('Unauthorized');
    });
  });
});