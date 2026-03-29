import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Create a comprehensive prisma mock first
type MockPrismaClient = {
  project: {
    create: ReturnType<typeof jest.fn>;
    findMany: ReturnType<typeof jest.fn>;
    findUnique: ReturnType<typeof jest.fn>;
    findFirst: ReturnType<typeof jest.fn>;
    update: ReturnType<typeof jest.fn>;
    delete: ReturnType<typeof jest.fn>;
    count: ReturnType<typeof jest.fn>;
  };
  user: {
    findUnique: ReturnType<typeof jest.fn>;
  };
  image: {
    count: ReturnType<typeof jest.fn>;
    findMany: ReturnType<typeof jest.fn>;
    groupBy: ReturnType<typeof jest.fn>;
    aggregate: ReturnType<typeof jest.fn>;
  };
  segmentation: {
    count: ReturnType<typeof jest.fn>;
  };
};

const prismaMock: MockPrismaClient = {
  project: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  image: {
    count: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
  },
  segmentation: {
    count: jest.fn(),
  },
};

// Mock dependencies
jest.mock('../../db', () => ({
  prisma: prismaMock,
}));
jest.mock('../../utils/logger');
jest.mock('../sharingService', () => ({
  hasProjectAccess: jest.fn(),
}));

import * as projectService from '../projectService';
import * as SharingService from '../sharingService';

const mockHasProjectAccess = SharingService.hasProjectAccess as jest.MockedFunction<typeof SharingService.hasProjectAccess>;

describe('ProjectService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: grant access
    mockHasProjectAccess.mockResolvedValue({ hasAccess: true, isOwner: true });
  });

  describe('createProject', () => {
    it('should create a project successfully', async () => {
      const userId = 'user-id';
      const projectData = {
        title: 'Test Project',
        description: 'Test Description',
      };

      const createdProject = {
        id: 'project-id',
        title: projectData.title,
        description: projectData.description,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: userId,
          email: 'test@example.com',
        },
        _count: {
          images: 0,
        },
      };

      prismaMock.project.create.mockResolvedValueOnce(createdProject);

      const result = await projectService.createProject(userId, projectData);

      expect(result).toEqual(createdProject);
      expect(prismaMock.project.create).toHaveBeenCalledWith({
        data: {
          title: projectData.title,
          description: projectData.description,
          userId: userId,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
          _count: {
            select: {
              images: true,
            },
          },
        },
      });
    });

    it('should handle creation error', async () => {
      const userId = 'user-id';
      const projectData = {
        title: 'Test Project',
        description: 'Test Description',
      };

      const error = new Error('Database error');
      prismaMock.project.create.mockRejectedValueOnce(error);

      await expect(
        projectService.createProject(userId, projectData)
      ).rejects.toThrow('Database error');
    });
  });

  describe('getUserProjects', () => {
    it('should get user projects with pagination', async () => {
      const userId = 'user-id';
      const options = {
        page: 1,
        limit: 10,
        search: '',
        sortBy: 'updatedAt' as const,
        sortOrder: 'desc' as const,
      };

      const mockUser = { id: userId, email: 'test@example.com' };
      const mockProjects = [
        {
          id: 'project-id',
          title: 'Test Project',
          description: 'Test Description',
          userId,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { id: userId, email: 'test@example.com' },
          _count: { images: 5 },
          images: [],
          shares: [],
        },
      ];

      const totalCount = 1;

      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser as any);
      prismaMock.project.count.mockResolvedValueOnce(totalCount);
      prismaMock.project.findMany.mockResolvedValueOnce(mockProjects as any);
      prismaMock.image.groupBy.mockResolvedValueOnce([]);

      const result = await projectService.getUserProjects(userId, options);

      expect(result.pagination).toEqual({
        page: options.page,
        limit: options.limit,
        total: totalCount,
        totalPages: 1,
      });
      expect(result.projects).toHaveLength(1);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });
      expect(prismaMock.project.count).toHaveBeenCalled();
      expect(prismaMock.project.findMany).toHaveBeenCalled();
    });

    it('should filter projects by search term', async () => {
      const userId = 'user-id';
      const options = {
        page: 1,
        limit: 10,
        search: 'test',
        sortBy: 'title' as const,
        sortOrder: 'asc' as const,
      };

      const mockUser = { id: userId, email: 'test@example.com' };
      prismaMock.user.findUnique.mockResolvedValueOnce(mockUser as any);
      prismaMock.project.count.mockResolvedValueOnce(0);
      prismaMock.project.findMany.mockResolvedValueOnce([]);
      prismaMock.image.groupBy.mockResolvedValueOnce([]);

      await projectService.getUserProjects(userId, options);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });
      expect(prismaMock.project.count).toHaveBeenCalled();
    });
  });

  describe('getProjectById', () => {
    it('should get project by id successfully', async () => {
      const projectId = 'project-id';
      const userId = 'user-id';

      const mockProject = {
        id: projectId,
        title: 'Test Project',
        description: 'Test Description',
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: userId,
          email: 'test@example.com',
        },
        images: [],
        _count: {
          images: 0,
        },
      };

      mockHasProjectAccess.mockResolvedValueOnce({
        hasAccess: true,
        isOwner: true,
      });
      prismaMock.project.findUnique.mockResolvedValueOnce(mockProject as any);

      const result = await projectService.getProjectById(projectId, userId);

      expect(result).toEqual(mockProject);
      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: {
          id: projectId,
        },
        include: expect.objectContaining({
          images: expect.any(Object),
          _count: expect.any(Object),
        }),
      });
    });

    it('should return null if project not found', async () => {
      const projectId = 'nonexistent-project';
      const userId = 'user-id';

      mockHasProjectAccess.mockResolvedValueOnce({
        hasAccess: false,
        isOwner: false,
      });

      const result = await projectService.getProjectById(projectId, userId);

      expect(result).toBeNull();
    });
  });

  describe('updateProject', () => {
    it('should update project successfully', async () => {
      const projectId = 'project-id';
      const userId = 'user-id';
      const updateData = {
        title: 'Updated Title',
        description: 'Updated Description',
      };

      const updatedProject = {
        id: projectId,
        title: updateData.title,
        description: updateData.description,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: userId,
          email: 'test@example.com',
        },
        _count: {
          images: 5,
        },
      };

      const existingProject = { id: projectId, userId };
      prismaMock.project.findFirst.mockResolvedValueOnce(existingProject);
      prismaMock.project.update.mockResolvedValueOnce(updatedProject);

      const result = await projectService.updateProject(
        projectId,
        userId,
        updateData
      );

      expect(result).toEqual(updatedProject);
      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: {
          id: projectId,
        },
        data: {
          title: updateData.title,
          description: updateData.description,
          updatedAt: expect.any(Date),
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
          _count: {
            select: {
              images: true,
            },
          },
        },
      });
    });

    it('should handle update error when project not found', async () => {
      const projectId = 'nonexistent-project';
      const userId = 'user-id';
      const updateData = {
        title: 'Updated Title',
      };

      prismaMock.project.findFirst.mockResolvedValueOnce(null);

      const result = await projectService.updateProject(
        projectId,
        userId,
        updateData
      );

      expect(result).toBeNull();
    });
  });

  describe('deleteProject', () => {
    it('should delete project successfully', async () => {
      const projectId = 'project-id';
      const userId = 'user-id';

      const existingProject = {
        id: projectId,
        userId,
        _count: { images: 2 },
      };
      prismaMock.project.findFirst.mockResolvedValueOnce(existingProject);
      prismaMock.project.delete.mockResolvedValueOnce({ id: projectId });

      const result = await projectService.deleteProject(projectId, userId);

      expect(result).toEqual(existingProject);
      expect(prismaMock.project.delete).toHaveBeenCalledWith({
        where: {
          id: projectId,
        },
      });
    });

    it('should return null when project not found', async () => {
      const projectId = 'nonexistent-project';
      const userId = 'user-id';

      prismaMock.project.findFirst.mockResolvedValueOnce(null);

      const result = await projectService.deleteProject(projectId, userId);

      expect(result).toBeNull();
    });
  });

  describe('getProjectStats', () => {
    it('should get project statistics successfully', async () => {
      const projectId = 'project-id';
      const userId = 'user-id';

      const mockProject = {
        id: projectId,
        title: 'Test Project',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const imageStats = [
        { segmentationStatus: 'completed', _count: { id: 5 } },
        { segmentationStatus: 'pending', _count: { id: 3 } },
      ];

      const totalImages = 8;
      const totalFileSize = { _sum: { fileSize: 1000000 } };
      const totalSegmentations = 10;

      mockHasProjectAccess.mockResolvedValueOnce({
        hasAccess: true,
        isOwner: true,
      });
      prismaMock.project.findUnique.mockResolvedValueOnce(mockProject as any);
      prismaMock.image.groupBy.mockResolvedValueOnce(imageStats as any);
      prismaMock.image.count.mockResolvedValueOnce(totalImages);
      prismaMock.image.aggregate.mockResolvedValueOnce(totalFileSize as any);
      prismaMock.segmentation.count.mockResolvedValueOnce(totalSegmentations);

      const result = await projectService.getProjectStats(projectId, userId);

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(result?.project).toEqual({
        id: projectId,
        title: 'Test Project',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should return null if project not found', async () => {
      const projectId = 'nonexistent-project';
      const userId = 'user-id';

      mockHasProjectAccess.mockResolvedValueOnce({
        hasAccess: false,
        isOwner: false,
      });

      const result = await projectService.getProjectStats(projectId, userId);

      expect(result).toBeNull();
    });
  });

  describe('checkProjectOwnership', () => {
    it('should return true for project owner', async () => {
      const projectId = 'project-id';
      const userId = 'user-id';

      const mockProject = {
        id: projectId,
      };

      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);

      const result = await projectService.checkProjectOwnership(
        projectId,
        userId
      );

      expect(result).toBe(true);
      expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: projectId,
          userId: userId,
        },
        select: {
          id: true,
        },
      });
    });

    it('should return false for non-owner', async () => {
      const projectId = 'project-id';
      const userId = 'user-id';

      prismaMock.project.findFirst.mockResolvedValueOnce(null);

      const result = await projectService.checkProjectOwnership(
        projectId,
        userId
      );

      expect(result).toBe(false);
    });

    it('should return false if project not found', async () => {
      const projectId = 'nonexistent-project';
      const userId = 'user-id';

      prismaMock.project.findFirst.mockResolvedValueOnce(null);

      const result = await projectService.checkProjectOwnership(
        projectId,
        userId
      );

      expect(result).toBe(false);
    });
  });
});
