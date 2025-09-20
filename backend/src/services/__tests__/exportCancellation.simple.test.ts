import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ExportService } from '../exportService';
import * as SharingService from '../sharingService';

// Mock dependencies
jest.mock('../websocketService');
jest.mock('../sharingService');
jest.mock('fs/promises');
jest.mock('../../db', () => ({
  prisma: {
    project: {
      findUnique: jest.fn()
    }
  }
}));

const mockSharingService = SharingService as jest.Mocked<typeof SharingService>;

describe('ExportService - Cancellation Bug Fixes', () => {
  let exportService: ExportService;
  let mockWsService: any;

  const mockUserId = 'user-123';
  const mockProjectId = 'project-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock WebSocket service
    mockWsService = {
      emitToUser: jest.fn(),
    };

    // Mock sharing service - allow access by default
    (mockSharingService.hasProjectAccess as jest.Mock) = jest.fn().mockResolvedValue({
      hasAccess: true,
      isOwner: true,
      shareId: undefined,
    });

    // Create fresh service instance
    exportService = ExportService.getInstance();
    exportService.setWebSocketService(mockWsService);

    // Clear any existing jobs
    (exportService as any).exportJobs.clear();
  });

  afterEach(() => {
    // Cleanup
    (exportService as any).exportJobs.clear();
    jest.resetAllMocks();
  });

  describe('Critical Race Condition Fixes', () => {
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
      expect(job.cancelledAt).toBeDefined();

      // Clear previous calls
      mockWsService.emitToUser.mockClear();

      // Try to send completion event (should be blocked by new logic)
      (exportService as any).sendToUser(mockUserId, 'export:completed', { jobId });

      // Verify completion event was NOT sent
      expect(mockWsService.emitToUser).not.toHaveBeenCalled();
    });

    it('should prevent progress updates for cancelled jobs', async () => {
      const options = { includeOriginalImages: true };

      // Start job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);

      // Cancel the job
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // Clear previous WebSocket calls
      mockWsService.emitToUser.mockClear();

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

      // Try to get file path (should return null for cancelled jobs)
      const filePath = await exportService.getExportFilePath(jobId, mockProjectId, mockUserId);

      expect(filePath).toBeNull();
      expect(job.filePath).toBeUndefined();
    });

    it('should handle double cancellation gracefully', async () => {
      const options = { includeOriginalImages: true };

      // Start job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);
      const job = (exportService as any).exportJobs.get(jobId);
      job.status = 'processing';

      // Cancel the job twice
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);
      const firstCancelTime = job.cancelledAt;

      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // Should remain cancelled with original timestamp
      expect(job.status).toBe('cancelled');
      expect(job.cancelledAt).toEqual(firstCancelTime);
    });

    it('should validate completed job status before returning file path', async () => {
      const options = { includeOriginalImages: true };

      // Start job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);
      const job = (exportService as any).exportJobs.get(jobId);

      // Simulate processing job with file path
      job.status = 'processing';
      job.filePath = '/test/export.zip';

      // Should return null for processing jobs
      let filePath = await exportService.getExportFilePath(jobId, mockProjectId, mockUserId);
      expect(filePath).toBeNull();

      // Complete the job
      job.status = 'completed';

      // Should return file path for completed jobs
      filePath = await exportService.getExportFilePath(jobId, mockProjectId, mockUserId);
      expect(filePath).toBe('/test/export.zip');

      // Cancel the job after completion attempt
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // Should return null again after cancellation
      filePath = await exportService.getExportFilePath(jobId, mockProjectId, mockUserId);
      expect(filePath).toBeNull();
    });

    it('should correctly validate job status in getJobWithStatus', async () => {
      const options = { includeOriginalImages: true };

      // Start job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);

      // Check initial status
      let jobWithStatus = await exportService.getJobWithStatus(jobId, mockProjectId, mockUserId);
      expect(jobWithStatus?.status).toBe('pending');

      // Cancel the job
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // Check cancelled status
      jobWithStatus = await exportService.getJobWithStatus(jobId, mockProjectId, mockUserId);
      expect(jobWithStatus?.status).toBe('cancelled');
      expect(jobWithStatus?.cancelledAt).toBeDefined();
    });
  });

  describe('Enhanced State Transition Logging', () => {
    it('should log and emit cancellation events correctly', async () => {
      const options = { includeOriginalImages: true };

      // Start job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);
      const job = (exportService as any).exportJobs.get(jobId);
      job.status = 'processing';

      // Clear previous calls to focus on cancellation event
      mockWsService.emitToUser.mockClear();

      // Cancel the job
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // Verify cancellation WebSocket event was sent
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

    it('should prevent completion event emission during sendToUser validation', async () => {
      const options = { includeOriginalImages: true };

      // Start and immediately cancel job
      const jobId = await exportService.startExportJob(mockProjectId, mockUserId, options);
      await exportService.cancelJob(jobId, mockProjectId, mockUserId);

      // Clear previous calls
      mockWsService.emitToUser.mockClear();

      // Attempt to send completion event (simulating race condition)
      (exportService as any).sendToUser(mockUserId, 'export:completed', {
        jobId,
        filePath: '/test/path.zip'
      });

      // Should not have emitted the completion event
      expect(mockWsService.emitToUser).not.toHaveBeenCalledWith(
        mockUserId,
        'export:completed',
        expect.anything()
      );
    });
  });
});