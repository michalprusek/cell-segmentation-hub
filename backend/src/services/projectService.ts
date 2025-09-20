import { prisma } from '../db';
import { CreateProjectData, UpdateProjectData, ProjectQueryParams } from '../types/validation';
import { calculatePagination } from '../utils/response';
import { logger } from '../utils/logger';
import * as SharingService from './sharingService';
import { cacheService, CacheService } from './cacheService';
import type { Project, Prisma, User } from '@prisma/client';

// Extended project type with metadata
export interface ProjectWithMeta extends Project {
  isOwned: boolean;
  isShared: boolean;
  owner: Pick<User, 'id' | 'email'>;
}

/**
 * Service for managing projects
 */
  /**
   * Create a new project for a user
   */
export async function createProject(userId: string, data: CreateProjectData): Promise<Project> {
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
   * Get projects for a user with pagination and search (owned AND shared projects)
   */
export async function getUserProjects(userId: string, options: ProjectQueryParams): Promise<{ projects: ProjectWithMeta[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    try {
      const { page, limit, search, sortBy, sortOrder } = options;

      // Create cache key for this specific query
      const cacheKey = `projects:user:${userId}:page:${page}:limit:${limit}:search:${search || 'none'}:sort:${sortBy}:${sortOrder}`;

      // Try to get from cache first (short TTL due to real-time updates)
      const cached = await cacheService.get(cacheKey, { ttl: CacheService.TTL_PRESETS.SHORT });
      if (cached) {
        logger.debug('Returning cached project list', 'ProjectService', { userId, cacheKey });
        return cached;
      }
      
      // Get user for context
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new Error('User not found');
      }

      // Build where clause for owned projects AND shared projects
      const where: Prisma.ProjectWhereInput = {
        OR: [
          { userId: userId }, // Owned projects
          { 
            shares: { // Shared projects
              some: {
                sharedWithId: userId,
                status: 'accepted'
              }
            }
          }
        ]
      };

      if (search) {
        const searchCondition = {
          OR: [
            { title: { contains: search } },
            { description: { contains: search } }
          ]
        };
        where.AND = [searchCondition];
      }

      // Build order clause with type safety
      const allowedSortFields = ['createdAt', 'updatedAt', 'title'] as const;
      type AllowedSortField = typeof allowedSortFields[number];
      
      const orderBy: Prisma.ProjectOrderByWithRelationInput = {};
      if (allowedSortFields.includes(sortBy as AllowedSortField)) {
        orderBy[sortBy as keyof Prisma.ProjectOrderByWithRelationInput] = sortOrder as Prisma.SortOrder;
      } else {
        // Default to createdAt if invalid field provided
        orderBy.createdAt = sortOrder as Prisma.SortOrder;
      }

      // Calculate pagination
      const total = await prisma.project.count({ where });
      const pagination = calculatePagination(page, limit, total);

      // Get projects with optimized data selection to reduce N+1 queries
      const projects = await prisma.project.findMany({
        where,
        orderBy,
        skip: pagination.offset,
        take: limit,
        select: {
          id: true,
          title: true,
          description: true,
          userId: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              images: {
                where: {}
              }
            }
          },
          user: {
            select: {
              id: true,
              email: true
            }
          }
        }
      });

      // Get latest image for each project in a separate optimized query
      const projectIds = projects.map(p => p.id);
      const latestImages = await prisma.image.findMany({
        where: {
          projectId: { in: projectIds }
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['projectId'],
        select: {
          id: true,
          name: true,
          thumbnailPath: true,
          originalPath: true,
          segmentationStatus: true,
          projectId: true
        }
      });

      // Get share info for each project in one query
      const shareInfo = await prisma.projectShare.findMany({
        where: {
          projectId: { in: projectIds },
          sharedWithId: userId,
          status: 'accepted'
        },
        select: {
          id: true,
          status: true,
          projectId: true
        }
      });

      // Add metadata to each project with optimized data merging
      const projectsWithMeta = projects.map(project => {
        const latestImage = latestImages.find(img => img.projectId === project.id);
        const shares = shareInfo.filter(share => share.projectId === project.id);

        return {
          ...project,
          images: latestImage ? [latestImage] : [],
          shares,
          isOwned: project.userId === userId,
          isShared: project.userId !== userId && shares.length > 0,
          owner: project.user
        };
      });

      logger.info(`Retrieved ${projectsWithMeta.length} projects for user`, 'ProjectService', { 
        userId, 
        total, 
        page, 
        limit 
      });

      const result = {
        projects: projectsWithMeta as ProjectWithMeta[],
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total: pagination.total,
          totalPages: pagination.totalPages
        }
      };

      // Cache the result for future requests
      await cacheService.set(cacheKey, result, { ttl: CacheService.TTL_PRESETS.SHORT });

      return result;
    } catch (error) {
      logger.error('Failed to get user projects:', error as Error, 'ProjectService', { userId, options });
      throw error;
    }
  }

  /**
   * Get a specific project by ID (with ownership and share access check)
   */
export async function getProjectById(projectId: string, userId: string): Promise<(Project & { _count: { images: number } }) | null> {
    try {
      // Check if user has access to this project (owner or shared)
      const accessCheck = await SharingService.hasProjectAccess(projectId, userId);
      if (!accessCheck.hasAccess) {
        return null;
      }

      const project = await prisma.project.findUnique({
        where: {
          id: projectId
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
   * Update a project (with ownership check - only owners can update)
   */
export async function updateProject(projectId: string, userId: string, data: UpdateProjectData): Promise<Project | null> {
    try {
      // First check if project exists and user owns it (NOT just shared access)
      const existingProject = await prisma.project.findFirst({
        where: {
          id: projectId,
          userId: userId  // Only actual owner can update
        }
      });

      if (!existingProject) {
        return null; // Project not found or user is not the owner
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
   * Delete a project (with ownership check - only owners can delete)
   */
export async function deleteProject(projectId: string, userId: string): Promise<(Project & { _count: { images: number } }) | null> {
    try {
      // First check if project exists and user owns it (NOT just shared access)
      const existingProject = await prisma.project.findFirst({
        where: {
          id: projectId,
          userId: userId  // Only actual owner can delete
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
   * Get project statistics (allows both owners and shared users)
   */
export async function getProjectStats(projectId: string, userId: string): Promise<{
  project: {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
  };
  images: {
    total: number;
    byStatus: {
      pending: number;
      processing: number;
      completed: number;
      failed: number;
    };
    totalFileSize: number;
  };
  segmentations: {
    total: number;
  };
  progress: {
    completionPercentage: number;
    completedImages: number;
    remainingImages: number;
  };
} | null> {
    try {
      // Check if user has access to this project (owner or shared)
      const accessCheck = await SharingService.hasProjectAccess(projectId, userId);
      if (!accessCheck.hasAccess) {
        return null;
      }

      // Get the project
      const project = await prisma.project.findUnique({
        where: { id: projectId }
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
export async function checkProjectOwnership(projectId: string, userId: string): Promise<boolean> {
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

  /**
   * Check if user can modify a project (only owners can modify)
   */
export async function canModifyProject(projectId: string, userId: string): Promise<boolean> {
    try {
      // Only project owners can modify projects
      return await checkProjectOwnership(projectId, userId);
    } catch (error) {
      logger.error('Failed to check project modification permissions:', error as Error, 'ProjectService', { projectId, userId });
      return false;
    }
  }