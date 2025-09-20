import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExportService } from '../exportService';
import { WebSocketService } from '../websocketService';
import * as SharingService from '../sharingService';
import fs from 'fs/promises';

// Mock dependencies
vi.mock('../websocketService');
vi.mock('../sharingService');
vi.mock('fs/promises');
vi.mock('../../db', () => ({
  prisma: {
    project: {
      findUnique: vi.fn()
    }
  }
}));

const mockWebSocketService = vi.mocked(WebSocketService);
const mockSharingService = vi.mocked(SharingService);
const mockFs = vi.mocked(fs);

describe('ExportService - Cancellation Bug Fixes', () => {
  let exportService: ExportService;
  let mockWsService: any;

  const mockUserId = 'user-123';
  const mockProjectId = 'project-123';

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock WebSocket service
    mockWsService = {
      emitToUser: vi.fn(),
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

    // Create fresh service instance
    exportService = ExportService.getInstance();
    exportService.setWebSocketService(mockWsService);

    // Clear any existing jobs
    (exportService as any).exportJobs.clear();
  });

  afterEach(() => {
    // Cleanup
    (exportService as any).exportJobs.clear();
    vi.resetAllMocks();
  });

  describe('Race Condition Fixes', () => {
    it('should not send completion events for cancelled jobs', async () => {
      const options = { includeOriginalImages: true };

      // Start job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);
      const job = (exportService as any).exportJobs.get(jobId);
      expect(job).toBeDefined();

      // Cancel the job
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // Verify job is cancelled
      expect(job.status).toBe('cancelled');

      // Try to send completion event (should be blocked)
      (exportService as any).sendToUser(mockUserId, 'export:completed', { jobId });

      // Verify completion event was not sent
      expect(mockWsService.emitToUser).not.toHaveBeenCalledWith(
        mockUserId,
        'export:completed',
        expect.anything()
      );
    });

    it('should prevent progress updates for cancelled jobs', async () => {
      const options = { includeOriginalImages: true };

      // Start job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);
      const job = (exportService as any).exportJobs.get(jobId);

      // Cancel the job
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // Try to update progress (should be blocked)
      (exportService as any).updateJobProgress(jobId, 50);

      // Verify progress event was not sent
      expect(mockWsService.emitToUser).not.toHaveBeenCalledWith(
        mockUserId,
        'export:progress',
        expect.anything()
      );
    });

    it('should return null file path for cancelled jobs', async () => {
      const options = { includeOriginalImages: true };

      // Start job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);
      const job = (exportService as any).exportJobs.get(jobId);

      // Simulate job being in processing with file path
      job.status = 'processing';
      job.filePath = '/test/export.zip';

      // Cancel the job
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // Try to get file path
      const filePath = await exportService.getExportFilePath(jobId, mockProjectId, mockUserId);

      // Should return null for cancelled jobs
      expect(filePath).toBeNull();
    });

    it('should handle double cancellation gracefully', async () => {
      const options = { includeOriginalImages: true };

      // Start job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);

      // Cancel the job twice
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      const job = (exportService as any).exportJobs.get(jobId);
      expect(job.status).toBe('cancelled');
    });

    it('should validate job status in getJobWithStatus', async () => {
      const options = { includeOriginalImages: true };

      // Start job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);

      // Cancel the job
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // Get job with status
      const jobWithStatus = await exportService.getJobWithStatus(jobId, mockProjectId, mockUserId);

      expect(jobWithStatus).toBeDefined();
      expect(jobWithStatus!.status).toBe('cancelled');
      expect(jobWithStatus!.cancelledAt).toBeDefined();
    });

    it('should cleanup files when job is cancelled', async () => {
      const options = { includeOriginalImages: true };

      // Start job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);
      const job = (exportService as any).exportJobs.get(jobId);

      // Simulate file creation
      const filePath = '/test/export.zip';
      job.filePath = filePath;

      // Cancel the job
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // File path should be cleared
      expect(job.filePath).toBeUndefined();
    });
  });

  describe('State Transition Logging', () => {
    it('should log cancellation events', async () => {
      const options = { includeOriginalImages: true };

      // Start job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);
      const job = (exportService as any).exportJobs.get(jobId);
      job.status = 'processing';

      // Cancel the job
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // Verify WebSocket cancellation event was sent
      expect(mockWsService.emitToUser).toHaveBeenCalledWith(
        mockUserId,
        'export:cancelled',
        expect.objectContaining({
          jobId,
          projectId: mockProjectId,
          previousStatus: 'processing',
          cancelledAt: expect.any(Date)
        })
      );
    });
  });
});