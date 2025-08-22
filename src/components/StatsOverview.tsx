import { logger } from '@/lib/logger';
import React, { useState, useEffect } from 'react';

// Constants
const MAX_PAGES = 40;
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Microscope, Image, FileUp, HardDrive } from 'lucide-react';
import apiClient from '@/lib/api';
import { useAuth, useLanguage } from '@/contexts/exports';
import { getErrorMessage } from '@/types';

interface StatCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  trend?: {
    value: string;
    isPositive: boolean;
  };
}

const StatCard = ({
  title,
  value,
  description,
  icon,
  trend,
}: StatCardProps) => (
  <Card className="transition-all duration-300 hover:shadow-md dark:bg-gray-800 dark:border-gray-700">
    <CardHeader className="flex flex-row items-center justify-between pb-2">
      <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">
        {title}
      </CardTitle>
      <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400">
        {icon}
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold dark:text-white">{value}</div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        {description}
      </p>
      {trend && (
        <div
          className={`text-xs mt-2 flex items-center ${trend.isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
        >
          <span>{trend.value}</span>
          <svg
            className={`h-3 w-3 ml-1 ${!trend.isPositive ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 10l7-7m0 0l7 7m-7-7v18"
            />
          </svg>
        </div>
      )}
    </CardContent>
  </Card>
);

const StatsOverview = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [projectCount, setProjectCount] = useState(0);
  const [imageCount, setImageCount] = useState(0);
  const [completedImageCount, setCompletedImageCount] = useState(0);
  const [todayUploadCount, setTodayUploadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [storageUsed, setStorageUsed] = useState('0 MB');
  const [storageGrowth, setStorageGrowth] = useState('0 MB');

  useEffect(() => {
    const abortController = new AbortController();
    const signal = abortController.signal;

    const fetchStats = async () => {
      if (!user) return;

      try {
        // Get total projects count
        const projectsResponse = await apiClient.getProjects({ signal });
        if (signal.aborted) return;

        const projectsCount = projectsResponse.total || 0;

        // Get statistics for all projects
        let totalImages = 0;
        let completedImages = 0;
        let todayImages = 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Ensure projects array exists before mapping
        const projects = projectsResponse.projects || [];

        // Fetch all project images in parallel
        const imagePromises = projects.map(async project => {
          try {
            // Fetch all images for each project by making multiple requests if needed
            let allImages: any[] = [];
            let page = 1;
            let hasMore = true;
            const limit = 50; // Maximum allowed by backend

            while (hasMore && !signal.aborted) {
              const imagesResponse = await apiClient.getProjectImages(
                project.id,
                {
                  limit,
                  page,
                },
                { signal }
              );

              if (signal.aborted) break;

              allImages = [...allImages, ...(imagesResponse?.images || [])];

              // Check if we've fetched all images
              hasMore = imagesResponse.total
                ? page * limit < imagesResponse.total
                : (imagesResponse?.images?.length ?? 0) === limit;
              page++;

              // Safety limit to prevent infinite loops
              if (page > MAX_PAGES) break;
            }

            return {
              projectId: project.id,
              images: allImages,
              success: true,
            };
          } catch (error) {
            logger.error(
              `Error fetching images for project ${project.id}:`,
              error
            );
            return {
              projectId: project.id,
              images: [],
              success: false,
            };
          }
        });

        const imageResults = await Promise.all(imagePromises);

        // Aggregate results
        for (const result of imageResults) {
          if (result.success && result.images && Array.isArray(result.images)) {
            totalImages += result.images.length;
            completedImages += result.images.filter(img => {
              // Handle both field names from backend
              const status = img.segmentationStatus || img.segmentation_status;
              return status === 'completed' || status === 'segmented';
            }).length;
            todayImages += result.images.filter(img => {
              // Handle both field names for created date
              const createdAt = img.createdAt || img.created_at;
              return new Date(createdAt) >= today;
            }).length;
          }
        }

        setProjectCount(projectsCount);
        setImageCount(totalImages);
        setCompletedImageCount(completedImages);
        setTodayUploadCount(todayImages);

        // Fetch storage stats
        try {
          if (signal.aborted) return;

          const storageStats = await apiClient.getUserStorageStats({ signal });

          if (signal.aborted) return;

          // Format storage used based on size
          let formattedStorage = '0 MB';
          if (storageStats.totalStorageGB >= 1) {
            formattedStorage = `${storageStats.totalStorageGB} GB`;
          } else {
            formattedStorage = `${storageStats.totalStorageMB} MB`;
          }
          setStorageUsed(formattedStorage);

          // Calculate growth (placeholder for now - could be enhanced with historical data)
          if (storageStats.totalImages > 0) {
            const avgSize = storageStats.averageImageSizeMB;
            setStorageGrowth(`~${avgSize} MB per image`);
          }
        } catch (error) {
          logger.error('Error fetching storage stats:', error);
          // Keep default values on error
        }
      } catch (error: unknown) {
        logger.error('Error fetching stats:', error);
        const errorMessage = getErrorMessage(error) || 'Failed to fetch stats';
        logger.error('Stats error:', errorMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();

    // Cleanup function to abort requests when component unmounts
    return () => {
      abortController.abort();
    };
  }, [user]);

  const stats = [
    {
      title: t('dashboard.stats.totalProjects'),
      value: loading ? '...' : String(projectCount),
      description: t('dashboard.stats.totalProjectsDesc'),
      icon: <Microscope size={16} />,
    },
    {
      title: t('dashboard.stats.processedImages'),
      value: loading ? '...' : String(completedImageCount),
      description: t('dashboard.stats.processedImagesDesc'),
      icon: <Image size={16} />,
    },
    {
      title: t('dashboard.stats.uploadedToday'),
      value: loading ? '...' : String(todayUploadCount),
      description: t('dashboard.stats.uploadedTodayDesc'),
      icon: <FileUp size={16} />,
    },
    {
      title: t('dashboard.stats.storageUsed'),
      value: loading ? '...' : storageUsed,
      description:
        storageGrowth !== '0 MB'
          ? storageGrowth
          : t('dashboard.stats.totalSpaceUsed'),
      icon: <HardDrive size={16} />,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, index) => (
        <StatCard key={index} {...stat} />
      ))}
    </div>
  );
};

export default StatsOverview;
