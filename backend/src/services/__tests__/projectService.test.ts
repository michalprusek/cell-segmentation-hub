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

import * as projectService from '../projectService';

describe('ProjectService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

      const mockProjects = [
        {
          id: 'project-id',
          title: 'Test Project',
          description: 'Test Description',
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
        },
      ];

      const totalCount = 1;

      prismaMock.project.count.mockResolvedValueOnce(totalCount);
      prismaMock.project.findMany.mockResolvedValueOnce(mockProjects);

      const result = await projectService.getUserProjects(userId, options);

      expect(result).toEqual({
        projects: mockProjects,
        pagination: {
          page: options.page,
          limit: options.limit,
          total: totalCount,
          totalPages: 1,
        },
      });

      expect(prismaMock.project.count).toHaveBeenCalledWith({
        where: { userId },
      });

      expect(prismaMock.project.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        skip: 0,
        take: 10,
        include: {
          _count: {
            select: {
              images: true,
            },
          },
          images: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              name: true,
              thumbnailPath: true,
              originalPath: true,
              segmentationStatus: true,
            },
          },
        },
      });
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

      prismaMock.project.count.mockResolvedValueOnce(0);
      prismaMock.project.findMany.mockResolvedValueOnce([]);

      await projectService.getUserProjects(userId, options);

      expect(prismaMock.project.count).toHaveBeenCalledWith({
        where: {
          userId,
          OR: [
            { title: { contains: 'test', mode: 'insensitive' } },
            { description: { contains: 'test', mode: 'insensitive' } },
          ],
        },
      });
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

      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);

      const result = await projectService.getProjectById(projectId, userId);

      expect(result).toEqual(mockProject);
      expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: projectId,
          userId: userId,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
          images: {
            select: {
              id: true,
              name: true,
              segmentationStatus: true,
              createdAt: true,
              fileSize: true,
              width: true,
              height: true,
              mimeType: true,
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

    it('should return null if project not found', async () => {
      const projectId = 'nonexistent-project';
      const userId = 'user-id';

      prismaMock.project.findFirst.mockResolvedValueOnce(null);

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

      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
      prismaMock.image.groupBy.mockResolvedValueOnce(imageStats);
      prismaMock.image.count.mockResolvedValueOnce(totalImages);
      prismaMock.image.aggregate.mockResolvedValueOnce(totalFileSize);
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

      expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: projectId,
          userId: userId,
        },
      });
    });

    it('should return null if project not found', async () => {
      const projectId = 'nonexistent-project';
      const userId = 'user-id';

      prismaMock.project.findFirst.mockResolvedValueOnce(null);

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
