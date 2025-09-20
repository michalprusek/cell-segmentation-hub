import { logger } from '@/lib/logger';
import React, { useState, useEffect } from 'react';

// Constants
const MAX_PAGES = 40;
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Microscope,
  Image,
  FileUp,
  HardDrive,
  Activity,
  Wifi,
  WifiOff,
} from 'lucide-react';
import apiClient from '@/lib/api';
import { useAuth, useLanguage } from '@/contexts/exports';
import { getErrorMessage } from '@/types';
import { useDashboardMetrics } from '@/hooks/useDashboardMetrics';

interface StatCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  isRealTime?: boolean;
  hasRecentUpdate?: boolean;
  isLoading?: boolean;
}

const StatCard = ({
  title,
  value,
  description,
  icon,
  trend,
  isRealTime = false,
  hasRecentUpdate = false,
  isLoading = false,
}: StatCardProps) => (
  <Card
    className={`transition-all duration-300 hover:shadow-md dark:bg-gray-800 dark:border-gray-700 ${hasRecentUpdate ? 'ring-2 ring-green-200 dark:ring-green-800' : ''}`}
  >
    <CardHeader className="flex flex-row items-center justify-between pb-2">
      <div className="flex items-center space-x-2">
        <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {title}
        </CardTitle>
        {isRealTime && (
          <div className="flex items-center space-x-1">
            {hasRecentUpdate ? (
              <Wifi className="h-3 w-3 text-green-500 animate-pulse" />
            ) : (
              <Wifi className="h-3 w-3 text-gray-400" />
            )}
          </div>
        )}
      </div>
      <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400">
        {icon}
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold dark:text-white">
        {isLoading ? (
          <div className="h-8 w-16 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
        ) : (
          value
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        {description}
      </p>
      <div className="flex items-center justify-between mt-2">
        {trend && (
          <div
            className={`text-xs flex items-center ${trend.isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
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
        {hasRecentUpdate && (
          <div className="text-xs text-green-600 dark:text-green-400 flex items-center">
            <Activity className="h-3 w-3 mr-1" />
            <span>Live</span>
          </div>
        )}
      </div>
    </CardContent>
  </Card>
);

const StatsOverview = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [projectCount, setProjectCount] = useState(0);
  const [_imageCount, _setImageCount] = useState(0);
  const [completedImageCount, setCompletedImageCount] = useState(0);
  const [todayUploadCount, setTodayUploadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [storageUsed, setStorageUsed] = useState('0 MB');
  const [storageGrowth, setStorageGrowth] = useState('0 MB');

  // Get real-time dashboard metrics
  const {
    metrics: realTimeMetrics,
    formattedMetrics,
    lastUpdate,
    isLoading: metricsLoading,
    error: metricsError,
    refreshMetrics,
  } = useDashboardMetrics({
    enableNotifications: true,
    notificationThreshold: 1,
  });

  // Check if we have recent real-time updates
  const hasRecentUpdate =
    lastUpdate && Date.now() - lastUpdate.getTime() < 60000; // Within last minute

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
        _setImageCount(totalImages);
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

  // Calculate display values - use real-time metrics when available, fallback to local state
  const displayValues = {
    totalProjects: realTimeMetrics?.totalProjects ?? projectCount,
    processedImages: realTimeMetrics?.totalSegmented ?? completedImageCount,
    uploadedToday:
      realTimeMetrics?.recentActivity.imagesUploadedToday ?? todayUploadCount,
    storageUsed: formattedMetrics?.storageFormatted.totalSize ?? storageUsed,
    storageGrowth:
      formattedMetrics?.storageFormatted.averageImageSize ?? storageGrowth,
    segmentationEfficiency: formattedMetrics?.storageFormatted.efficiency ?? 0,
    queueLength: realTimeMetrics?.systemStats.queueLength ?? 0,
  };

  const stats = [
    {
      title: t('dashboard.stats.totalProjects'),
      value:
        loading && !realTimeMetrics
          ? '...'
          : String(displayValues.totalProjects),
      description: t('dashboard.stats.totalProjectsDesc'),
      icon: <Microscope size={16} />,
      isRealTime: !!realTimeMetrics,
      hasRecentUpdate: hasRecentUpdate,
      isLoading: metricsLoading,
    },
    {
      title: t('dashboard.stats.processedImages'),
      value:
        loading && !realTimeMetrics
          ? '...'
          : String(displayValues.processedImages),
      description: t('dashboard.stats.processedImagesDesc'),
      icon: <Image size={16} />,
      isRealTime: !!realTimeMetrics,
      hasRecentUpdate: hasRecentUpdate,
      isLoading: metricsLoading,
      trend:
        displayValues.segmentationEfficiency > 0
          ? {
              value: `${displayValues.segmentationEfficiency}% efficiency`,
              isPositive: displayValues.segmentationEfficiency > 50,
            }
          : undefined,
    },
    {
      title: t('dashboard.stats.uploadedToday'),
      value:
        loading && !realTimeMetrics
          ? '...'
          : String(displayValues.uploadedToday),
      description: t('dashboard.stats.uploadedTodayDesc'),
      icon: <FileUp size={16} />,
      isRealTime: !!realTimeMetrics,
      hasRecentUpdate: hasRecentUpdate,
      isLoading: metricsLoading,
      trend:
        displayValues.queueLength > 0
          ? {
              value: `${displayValues.queueLength} in queue`,
              isPositive: false,
            }
          : undefined,
    },
    {
      title: t('dashboard.stats.storageUsed'),
      value: loading && !realTimeMetrics ? '...' : displayValues.storageUsed,
      description:
        displayValues.storageGrowth !== '0 MB'
          ? `Avg: ${displayValues.storageGrowth}`
          : t('dashboard.stats.totalSpaceUsed'),
      icon: <HardDrive size={16} />,
      isRealTime: !!realTimeMetrics,
      hasRecentUpdate: hasRecentUpdate,
      isLoading: metricsLoading,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Real-time status indicator */}
      {metricsError && (
        <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
          <div className="flex items-center space-x-2">
            <WifiOff className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-amber-800 dark:text-amber-200">
              Real-time updates unavailable - showing cached data
            </span>
          </div>
          <button
            onClick={refreshMetrics}
            className="text-sm text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <StatCard key={index} {...stat} />
        ))}
      </div>

      {/* Real-time info footer */}
      {realTimeMetrics && lastUpdate && (
        <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Last updated: {lastUpdate.toLocaleTimeString()} • Real-time data
          enabled
        </div>
      )}
    </div>
  );
};

export default StatsOverview;
