import { prisma } from '../db';
import { logger } from '../utils/logger';
import * as _fs from 'fs/promises';
import * as _path from 'path';

export interface UserStats {
  totalProjects: number;
  totalImages: number;
  totalSegmentations: number;
  storageUsed: string;
  storageUsedBytes: number;
  imagesUploadedToday: number;
  processedImages: number;
}

export interface UserProfile {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  isEmailVerified: boolean;
  language: string;
  theme: string;
  avatarUrl?: string | null;
  createdAt: string;
  lastLoginAt?: string;
  settings: {
    notifications: {
      email: boolean;
      push: boolean;
      segmentationComplete: boolean;
      projectShared: boolean;
    };
  };
  stats: UserStats;
}

export interface StorageStats {
  totalUsed: string;
  totalUsedBytes: number;
  breakdown: {
    images: string;
    thumbnails: string;
    exports: string;
  };
  quota: string;
  quotaBytes: number;
  usagePercentage: number;
}

/**
 * Get user profile with real database data
 */
export async function getUserProfile(
  userId: string
): Promise<UserProfile | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        _count: {
          select: {
            projects: true,
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    // Get user statistics
    const stats = await getUserStats(userId);

    const profile: UserProfile = {
      id: user.id,
      email: user.email,
      firstName: user.profile?.title?.split(' ')[0],
      lastName: user.profile?.title?.split(' ').slice(1).join(' '),
      isEmailVerified: user.emailVerified,
      language: user.profile?.preferredLang || 'cs',
      theme: user.profile?.preferredTheme || 'light',
      avatarUrl: user.profile?.avatarUrl || null,  // Include avatar URL from profile
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: undefined, // TODO: Track last login in sessions
      settings: {
        notifications: {
          email: user.profile?.emailNotifications || true,
          push: false,
          segmentationComplete: true,
          projectShared: true,
        },
      },
      stats,
    };

    return profile;
  } catch (error) {
    logger.error('Failed to get user profile:', error as Error, 'UserService', {
      userId,
    });
    throw error;
  }
}

/**
 * Get comprehensive user statistics from database
 */
export async function getUserStats(userId: string): Promise<UserStats> {
  try {
    // Get project count (owned projects only)
    const totalProjects = await prisma.project.count({
      where: { userId },
    });

    // Get total images across all user projects
    const totalImages = await prisma.image.count({
      where: {
        project: {
          userId,
        },
      },
    });

    // Get total segmentations for user's images
    const totalSegmentations = await prisma.segmentation.count({
      where: {
        image: {
          project: {
            userId,
          },
        },
      },
    });

    // Get processed images (completed segmentations)
    const processedImages = await prisma.image.count({
      where: {
        project: {
          userId,
        },
        segmentationStatus: 'completed',
      },
    });

    // Get images uploaded today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const imagesUploadedToday = await prisma.image.count({
      where: {
        project: {
          userId,
        },
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    // Calculate storage usage
    const storageStats = await calculateUserStorage(userId);

    return {
      totalProjects,
      totalImages,
      totalSegmentations,
      storageUsed: storageStats.totalUsed,
      storageUsedBytes: storageStats.totalUsedBytes,
      imagesUploadedToday,
      processedImages,
    };
  } catch (error) {
    logger.error('Failed to get user stats:', error as Error, 'UserService', {
      userId,
    });
    throw error;
  }
}

/**
 * Calculate user storage usage from database and file system
 */
export async function calculateUserStorage(
  userId: string
): Promise<StorageStats> {
  try {
    // Get file sizes from database
    const imagesSizeResult = await prisma.image.aggregate({
      where: {
        project: {
          userId,
        },
      },
      _sum: {
        fileSize: true,
      },
    });

    const totalImageBytes = imagesSizeResult._sum.fileSize || 0;

    // Estimate thumbnail sizes (typically 10-20% of original)
    const estimatedThumbnailBytes = Math.floor(totalImageBytes * 0.15);

    // Estimate export sizes (TODO: track exports in database)
    const estimatedExportBytes = Math.floor(totalImageBytes * 0.05);

    const totalUsedBytes =
      totalImageBytes + estimatedThumbnailBytes + estimatedExportBytes;

    // Convert to human readable format
    const formatBytes = (bytes: number): string => {
      if (bytes === 0) {
        return '0 B';
      }
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const quota = 1024 * 1024 * 1024; // 1GB default quota
    const usagePercentage =
      totalUsedBytes > 0
        ? Math.round((totalUsedBytes / quota) * 100 * 100) / 100
        : 0;

    return {
      totalUsed: formatBytes(totalUsedBytes),
      totalUsedBytes,
      breakdown: {
        images: formatBytes(totalImageBytes),
        thumbnails: formatBytes(estimatedThumbnailBytes),
        exports: formatBytes(estimatedExportBytes),
      },
      quota: formatBytes(quota),
      quotaBytes: quota,
      usagePercentage,
    };
  } catch (error) {
    logger.error(
      'Failed to calculate user storage:',
      error as Error,
      'UserService',
      { userId }
    );
    throw error;
  }
}

/**
 * Get user activity log
 */
export async function getUserActivity(
  userId: string,
  limit = 10,
  offset = 0
): Promise<{
  items: unknown[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}> {
  try {
    // For now, we'll construct activity from database events
    // TODO: Implement proper activity logging

    const recentProjects = await prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: {
        id: true,
        title: true,
        createdAt: true,
      },
    });

    const recentImages = await prisma.image.findMany({
      where: {
        project: {
          userId,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        project: {
          select: {
            title: true,
          },
        },
      },
    });

    const recentSegmentations = await prisma.segmentation.findMany({
      where: {
        image: {
          project: {
            userId,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        image: {
          select: {
            name: true,
          },
        },
      },
    });

    // Construct activity items
    const activities: Array<{
      id: string;
      type: string;
      description: string;
      timestamp: string;
    }> = [];

    recentProjects.forEach((project, _index) => {
      activities.push({
        id: `project_${project.id}`,
        type: 'project_created',
        description: `Created project "${project.title}"`,
        timestamp: project.createdAt.toISOString(),
      });
    });

    recentImages.forEach((image, _index) => {
      activities.push({
        id: `image_${image.id}`,
        type: 'image_uploaded',
        description: `Uploaded image "${image.name}" to project "${image.project.title}"`,
        timestamp: image.createdAt.toISOString(),
      });
    });

    recentSegmentations.forEach((segmentation, _index) => {
      activities.push({
        id: `segmentation_${segmentation.id}`,
        type: 'segmentation_completed',
        description: `Completed segmentation for "${segmentation.image.name}" using ${segmentation.model} model`,
        timestamp: segmentation.createdAt.toISOString(),
      });
    });

    // Sort by timestamp and apply pagination
    activities.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const paginatedActivities = activities.slice(offset, offset + limit);

    return {
      items: paginatedActivities,
      pagination: {
        total: activities.length,
        limit,
        offset,
        hasMore: offset + limit < activities.length,
      },
    };
  } catch (error) {
    logger.error(
      'Failed to get user activity:',
      error as Error,
      'UserService',
      { userId }
    );
    throw error;
  }
}

/**
 * Update user profile
 */
export async function updateUserProfile(
  userId: string,
  updates: Record<string, unknown>
): Promise<{ success: boolean }> {
  try {
    // Update user table if email is being changed
    if (updates.email) {
      await prisma.user.update({
        where: { id: userId },
        data: { email: updates.email },
      });
    }

    // Update or create profile
    const profileData: Record<string, unknown> = {};

    if (updates.firstName || updates.lastName) {
      profileData.title =
        `${updates.firstName || ''} ${updates.lastName || ''}`.trim();
    }

    if (updates.language) {
      profileData.preferredLang = updates.language;
    }

    if (updates.theme) {
      profileData.preferredTheme = updates.theme;
    }

    if (updates.notifications && typeof updates.notifications === 'object') {
      const notifications = updates.notifications as Record<string, unknown>;
      if (notifications.email !== undefined) {
        profileData.emailNotifications = notifications.email;
      }
    }

    if (Object.keys(profileData).length > 0) {
      await prisma.profile.upsert({
        where: { userId },
        update: profileData,
        create: {
          userId,
          ...profileData,
        },
      });
    }

    logger.info('User profile updated:', 'UserService', { userId, updates });
    return { success: true };
  } catch (error) {
    logger.error(
      'Failed to update user profile:',
      error as Error,
      'UserService',
      { userId, updates }
    );
    throw error;
  }
}
