import { prisma } from '../db';
import { CreateProjectData, UpdateProjectData, ProjectQueryParams } from '../types/validation';
import { calculatePagination } from '../utils/response';
import { logger } from '../utils/logger';

/**
 * Service for managing projects
 */
export class ProjectService {
  /**
   * Create a new project for a user
   */
  static async createProject(userId: string, data: CreateProjectData) {
    try {
      const project = await prisma.project.create({
        data: {
          title: data.title,
          description: data.description,
          userId: userId
        },
        include: {
          user: {
            select: {
              id: true,
              email: true
            }
          },
          _count: {
            select: {
              images: true
            }
          }
        }
      });

      logger.info(`Project created: ${project.id}`, 'ProjectService', { userId, projectId: project.id });
      
      return project;
    } catch (error) {
      logger.error('Failed to create project:', error as Error, 'ProjectService', { userId, data });
      throw error;
    }
  }

  /**
   * Get projects for a user with pagination and search
   */
  static async getUserProjects(userId: string, options: ProjectQueryParams) {
    try {
      const { page, limit, search, sortBy, sortOrder } = options;
      
      // Build where clause
      const where: any = {
        userId: userId
      };

      if (search) {
        where.OR = [
          {
            title: {
              contains: search,
              mode: 'insensitive'
            }
          },
          {
            description: {
              contains: search,
              mode: 'insensitive'
            }
          }
        ];
      }

      // Build order clause
      const orderBy: any = {};
      orderBy[sortBy] = sortOrder;

      // Calculate pagination
      const total = await prisma.project.count({ where });
      const pagination = calculatePagination(page, limit, total);

      // Get projects with image count and latest image for thumbnail
      const projects = await prisma.project.findMany({
        where,
        orderBy,
        skip: pagination.offset,
        take: limit,
        include: {
          _count: {
            select: {
              images: true
            }
          },
          images: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              name: true,
              thumbnailPath: true,
              originalPath: true,
              segmentationStatus: true
            }
          }
        }
      });

      logger.info(`Retrieved ${projects.length} projects for user`, 'ProjectService', { 
        userId, 
        total, 
        page, 
        limit 
      });

      return {
        projects,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total: pagination.total,
          totalPages: pagination.totalPages
        }
      };
    } catch (error) {
      logger.error('Failed to get user projects:', error as Error, 'ProjectService', { userId, options });
      throw error;
    }
  }

  /**
   * Get a specific project by ID (with ownership check)
   */
  static async getProjectById(projectId: string, userId: string) {
    try {
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          userId: userId
        },
        include: {
          user: {
            select: {
              id: true,
              email: true
            }
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
              mimeType: true
            }
          },
          _count: {
            select: {
              images: true
            }
          }
        }
      });

      if (!project) {
        return null;
      }

      logger.info(`Retrieved project: ${project.id}`, 'ProjectService', { projectId, userId });
      
      return project;
    } catch (error) {
      logger.error('Failed to get project by ID:', error as Error, 'ProjectService', { projectId, userId });
      throw error;
    }
  }

  /**
   * Update a project (with ownership check)
   */
  static async updateProject(projectId: string, userId: string, data: UpdateProjectData) {
    try {
      // First check if project exists and belongs to user
      const existingProject = await prisma.project.findFirst({
        where: {
          id: projectId,
          userId: userId
        }
      });

      if (!existingProject) {
        return null;
      }

      // Update the project
      const updatedProject = await prisma.project.update({
        where: {
          id: projectId
        },
        data: {
          title: data.title,
          description: data.description,
          updatedAt: new Date()
        },
        include: {
          user: {
            select: {
              id: true,
              email: true
            }
          },
          _count: {
            select: {
              images: true
            }
          }
        }
      });

      logger.info(`Project updated: ${projectId}`, 'ProjectService', { projectId, userId, data });
      
      return updatedProject;
    } catch (error) {
      logger.error('Failed to update project:', error as Error, 'ProjectService', { projectId, userId, data });
      throw error;
    }
  }

  /**
   * Delete a project (with ownership check)
   */
  static async deleteProject(projectId: string, userId: string) {
    try {
      // First check if project exists and belongs to user
      const existingProject = await prisma.project.findFirst({
        where: {
          id: projectId,
          userId: userId
        },
        include: {
          _count: {
            select: {
              images: true
            }
          }
        }
      });

      if (!existingProject) {
        return null;
      }

      // Delete the project (cascade will handle images and segmentations)
      await prisma.project.delete({
        where: {
          id: projectId
        }
      });

      logger.info(`Project deleted: ${projectId}`, 'ProjectService', { 
        projectId, 
        userId, 
        imagesCount: existingProject._count.images 
      });
      
      return existingProject;
    } catch (error) {
      logger.error('Failed to delete project:', error as Error, 'ProjectService', { projectId, userId });
      throw error;
    }
  }

  /**
   * Get project statistics
   */
  static async getProjectStats(projectId: string, userId: string) {
    try {
      // First check if project exists and belongs to user
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          userId: userId
        }
      });

      if (!project) {
        return null;
      }

      // Get image statistics
      const imageStats = await prisma.image.groupBy({
        by: ['segmentationStatus'],
        where: {
          projectId: projectId
        },
        _count: {
          id: true
        }
      });

      // Get total image count and file sizes
      const totalImages = await prisma.image.count({
        where: {
          projectId: projectId
        }
      });

      const totalFileSize = await prisma.image.aggregate({
        where: {
          projectId: projectId
        },
        _sum: {
          fileSize: true
        }
      });

      // Get segmentation count
      const totalSegmentations = await prisma.segmentation.count({
        where: {
          image: {
            projectId: projectId
          }
        }
      });

      // Transform image stats to a more usable format
      const segmentationStatusCounts: Record<string, number> = {};
      imageStats.forEach(stat => {
        segmentationStatusCounts[stat.segmentationStatus] = stat._count.id;
      });

      // Calculate completion percentage
      const completedCount = segmentationStatusCounts.completed || 0;
      const completionPercentage = totalImages > 0 ? Math.round((completedCount / totalImages) * 100) : 0;

      const stats = {
        project: {
          id: project.id,
          title: project.title,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt
        },
        images: {
          total: totalImages,
          byStatus: {
            pending: segmentationStatusCounts.pending || 0,
            processing: segmentationStatusCounts.processing || 0,
            completed: segmentationStatusCounts.completed || 0,
            failed: segmentationStatusCounts.failed || 0
          },
          totalFileSize: totalFileSize._sum.fileSize || 0
        },
        segmentations: {
          total: totalSegmentations
        },
        progress: {
          completionPercentage,
          completedImages: completedCount,
          remainingImages: totalImages - completedCount
        }
      };

      logger.info(`Retrieved project stats: ${projectId}`, 'ProjectService', { projectId, userId, stats });
      
      return stats;
    } catch (error) {
      logger.error('Failed to get project stats:', error as Error, 'ProjectService', { projectId, userId });
      throw error;
    }
  }

  /**
   * Check if user owns a project
   */
  static async checkProjectOwnership(projectId: string, userId: string) {
    try {
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          userId: userId
        },
        select: {
          id: true
        }
      });

      return !!project;
    } catch (error) {
      logger.error('Failed to check project ownership:', error as Error, 'ProjectService', { projectId, userId });
      throw error;
    }
  }
}