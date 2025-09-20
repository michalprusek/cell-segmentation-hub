/**
 * ProjectStatsService Unit Tests
 *
 * Tests for the new real-time project statistics service
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ProjectStatsService } from '../projectStatsService';
import { prismaMock } from '../../test/setup';

// Mock WebSocket service
const mockWebSocketService = {
  emitToUser: jest.fn(),
  emitToUserRooms: jest.fn(),
};

describe('ProjectStatsService', () => {
  let projectStatsService: ProjectStatsService;

  beforeEach(() => {
    jest.clearAllMocks();
    projectStatsService = new ProjectStatsService(
      prismaMock as any,
      mockWebSocketService as any
    );
  });

  describe('getProjectStats', () => {
    it('should calculate basic project statistics', async () => {
      const projectId = 'test-project-id';

      // Mock Prisma responses
      (prismaMock.image as any).count
        .mockResolvedValueOnce(10) // total images
        .mockResolvedValueOnce(7)  // segmented images
        .mockResolvedValueOnce(2)  // pending images
        .mockResolvedValueOnce(1); // failed images

      (prismaMock.image as any).findFirst
        .mockResolvedValueOnce({ createdAt: new Date('2024-01-01') }) // last image
        .mockResolvedValueOnce({ updatedAt: new Date('2024-01-02') }); // last segmentation

      (prismaMock.image as any).aggregate
        .mockResolvedValueOnce({ _sum: { fileSize: 1024000 } }); // total file size

      const stats = await projectStatsService.getProjectStats(projectId);

      expect(stats).toEqual({
        projectId,
        totalImages: 10,
        segmentedImages: 7,
        pendingImages: 2,
        failedImages: 1,
        segmentationProgress: 70, // 7/10 * 100
        lastImageUpload: new Date('2024-01-01'),
        lastSegmentation: new Date('2024-01-02'),
        totalStorageBytes: 1024000,
        lastUpdate: expect.any(Date),
      });
    });

    it('should handle projects with no images', async () => {
      const projectId = 'empty-project-id';

      // Mock empty project
      (prismaMock.image as any).count.mockResolvedValue(0);
      (prismaMock.image as any).findFirst.mockResolvedValue(null);
      (prismaMock.image as any).aggregate.mockResolvedValue({ _sum: { fileSize: null } });

      const stats = await projectStatsService.getProjectStats(projectId);

      expect(stats).toEqual({
        projectId,
        totalImages: 0,
        segmentedImages: 0,
        pendingImages: 0,
        failedImages: 0,
        segmentationProgress: 0,
        lastImageUpload: null,
        lastSegmentation: null,
        totalStorageBytes: 0,
        lastUpdate: expect.any(Date),
      });
    });
  });

  describe('getDashboardMetrics', () => {
    it('should calculate dashboard metrics for a user', async () => {
      const userId = 'test-user-id';
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Mock Prisma responses
      (prismaMock.project as any).count.mockResolvedValue(5);
      (prismaMock.image as any).count
        .mockResolvedValueOnce(50)  // total images
        .mockResolvedValueOnce(35)  // segmented images
        .mockResolvedValueOnce(10)  // recent uploads
        .mockResolvedValueOnce(8);  // recent segmentations

      (prismaMock.image as any).aggregate.mockResolvedValue({
        _sum: { fileSize: 5242880 },
        _avg: { fileSize: 104857.6 }
      });

      (prismaMock.segmentationQueue as any).aggregate.mockResolvedValue({
        _count: { id: 5 }
      });

      (prismaMock.segmentationQueue as any).findMany.mockResolvedValue([
        { startedAt: new Date(), completedAt: new Date(Date.now() + 5000) },
        { startedAt: new Date(), completedAt: new Date(Date.now() + 3000) },
      ]);

      const metrics = await projectStatsService.getDashboardMetrics(userId);

      expect(metrics).toEqual({
        userId,
        totalProjects: 5,
        totalImages: 50,
        segmentedImages: 35,
        totalStorageMB: 5,
        recentUploads: 10,
        recentSegmentations: 8,
        queueLength: 5,
        averageProcessingTime: expect.any(Number),
        segmentationEfficiency: 70, // 35/50 * 100
        lastUpdate: expect.any(Date),
      });
    });
  });

  describe('emitProjectStatsUpdate', () => {
    it('should emit WebSocket events for project stats updates', async () => {
      const projectId = 'test-project-id';
      const userId = 'test-user-id';

      // Mock project stats
      const mockStats = {
        projectId,
        totalImages: 10,
        segmentedImages: 5,
        pendingImages: 3,
        failedImages: 2,
        segmentationProgress: 50,
        lastImageUpload: new Date(),
        lastSegmentation: new Date(),
        totalStorageBytes: 1024000,
        lastUpdate: new Date(),
      };

      // Mock getProjectStats to return our mock stats
      jest.spyOn(projectStatsService, 'getProjectStats').mockResolvedValue(mockStats);

      await projectStatsService.emitProjectStatsUpdate(projectId, userId);

      expect(mockWebSocketService.emitToUser).toHaveBeenCalledWith(
        userId,
        'project_stats_update',
        {
          projectId,
          stats: mockStats,
          timestamp: expect.any(Date),
        }
      );
    });

    it('should emit shared project updates to all collaborators', async () => {
      const projectId = 'shared-project-id';
      const ownerId = 'owner-id';
      const collaboratorIds = ['collab1', 'collab2'];

      // Mock project shares
      (prismaMock.projectShare as any).findMany.mockResolvedValue([
        { sharedWithId: 'collab1', status: 'accepted' },
        { sharedWithId: 'collab2', status: 'accepted' },
      ]);

      const mockStats = {
        projectId,
        totalImages: 15,
        segmentedImages: 10,
        pendingImages: 3,
        failedImages: 2,
        segmentationProgress: 66.67,
        lastImageUpload: new Date(),
        lastSegmentation: new Date(),
        totalStorageBytes: 1536000,
        lastUpdate: new Date(),
      };

      jest.spyOn(projectStatsService, 'getProjectStats').mockResolvedValue(mockStats);

      await projectStatsService.emitSharedProjectUpdate(projectId, ownerId, 'image_upload');

      expect(mockWebSocketService.emitToUserRooms).toHaveBeenCalledWith(
        collaboratorIds,
        'shared_project_update',
        expect.objectContaining({
          projectId,
          activityType: 'image_upload',
          stats: mockStats,
        })
      );
    });
  });

  describe('emitDashboardMetricsUpdate', () => {
    it('should emit dashboard metrics updates', async () => {
      const userId = 'test-user-id';

      // Mock dashboard metrics
      const mockMetrics = {
        userId,
        totalProjects: 3,
        totalImages: 25,
        segmentedImages: 20,
        totalStorageMB: 10,
        recentUploads: 5,
        recentSegmentations: 4,
        queueLength: 2,
        averageProcessingTime: 4.5,
        segmentationEfficiency: 80,
        lastUpdate: new Date(),
      };

      jest.spyOn(projectStatsService, 'getDashboardMetrics').mockResolvedValue(mockMetrics);

      await projectStatsService.emitDashboardMetricsUpdate(userId);

      expect(mockWebSocketService.emitToUser).toHaveBeenCalledWith(
        userId,
        'dashboard_metrics_update',
        {
          metrics: mockMetrics,
          timestamp: expect.any(Date),
        }
      );
    });
  });

  describe('handleImageUpload', () => {
    it('should handle image upload and emit appropriate events', async () => {
      const projectId = 'test-project-id';
      const userId = 'test-user-id';
      const imageCount = 3;

      // Mock project and user details
      (prismaMock.project as any).findUnique.mockResolvedValue({
        id: projectId,
        userId,
        title: 'Test Project',
      });

      (prismaMock.user as any).findUnique.mockResolvedValue({
        id: userId,
        email: 'test@example.com',
      });

      const mockStats = {
        projectId,
        totalImages: 10 + imageCount,
        segmentedImages: 5,
        pendingImages: 3,
        failedImages: 2,
        segmentationProgress: 38.46,
        lastImageUpload: new Date(),
        lastSegmentation: new Date(),
        totalStorageBytes: 1536000,
        lastUpdate: new Date(),
      };

      jest.spyOn(projectStatsService, 'getProjectStats').mockResolvedValue(mockStats);
      jest.spyOn(projectStatsService, 'emitProjectStatsUpdate').mockResolvedValue();
      jest.spyOn(projectStatsService, 'emitSharedProjectUpdate').mockResolvedValue();

      await projectStatsService.handleImageUpload(projectId, userId, imageCount);

      expect(projectStatsService.emitProjectStatsUpdate).toHaveBeenCalledWith(projectId, userId);
      expect(projectStatsService.emitSharedProjectUpdate).toHaveBeenCalledWith(
        projectId,
        userId,
        'image_upload'
      );
    });
  });

  describe('handleImageDeletion', () => {
    it('should handle image deletion and emit appropriate events', async () => {
      const projectId = 'test-project-id';
      const userId = 'test-user-id';
      const imageCount = 2;

      // Mock project details
      (prismaMock.project as any).findUnique.mockResolvedValue({
        id: projectId,
        userId,
        title: 'Test Project',
      });

      const mockStats = {
        projectId,
        totalImages: 10 - imageCount,
        segmentedImages: 5,
        pendingImages: 2,
        failedImages: 1,
        segmentationProgress: 62.5,
        lastImageUpload: new Date(),
        lastSegmentation: new Date(),
        totalStorageBytes: 1024000,
        lastUpdate: new Date(),
      };

      jest.spyOn(projectStatsService, 'getProjectStats').mockResolvedValue(mockStats);
      jest.spyOn(projectStatsService, 'emitProjectStatsUpdate').mockResolvedValue();
      jest.spyOn(projectStatsService, 'emitSharedProjectUpdate').mockResolvedValue();

      await projectStatsService.handleImageDeletion(projectId, userId, imageCount);

      expect(projectStatsService.emitProjectStatsUpdate).toHaveBeenCalledWith(projectId, userId);
      expect(projectStatsService.emitSharedProjectUpdate).toHaveBeenCalledWith(
        projectId,
        userId,
        'image_delete'
      );
    });
  });

  describe('handleSegmentationCompletion', () => {
    it('should handle segmentation completion and emit events', async () => {
      const projectId = 'test-project-id';
      const userId = 'test-user-id';
      const imageId = 'test-image-id';

      // Mock image and project details
      (prismaMock.image as any).findUnique.mockResolvedValue({
        id: imageId,
        projectId,
        project: { userId },
      });

      const mockStats = {
        projectId,
        totalImages: 10,
        segmentedImages: 6,
        pendingImages: 2,
        failedImages: 2,
        segmentationProgress: 60,
        lastImageUpload: new Date(),
        lastSegmentation: new Date(),
        totalStorageBytes: 1024000,
        lastUpdate: new Date(),
      };

      jest.spyOn(projectStatsService, 'getProjectStats').mockResolvedValue(mockStats);
      jest.spyOn(projectStatsService, 'emitProjectStatsUpdate').mockResolvedValue();
      jest.spyOn(projectStatsService, 'emitSharedProjectUpdate').mockResolvedValue();

      await projectStatsService.handleSegmentationCompletion(imageId);

      expect(projectStatsService.emitProjectStatsUpdate).toHaveBeenCalledWith(projectId, userId);
      expect(projectStatsService.emitSharedProjectUpdate).toHaveBeenCalledWith(
        projectId,
        userId,
        'segmentation_complete'
      );
    });
  });
});