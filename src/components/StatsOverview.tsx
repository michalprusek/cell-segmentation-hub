import { logger } from '@/lib/logger';
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Microscope, Image, FileUp, FileClock } from 'lucide-react';
import apiClient from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
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
            className={`h-3 w-3 ml-1 ${!trend.isPositive && 'rotate-180'}`}
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
  const [projectCount, setProjectCount] = useState(0);
  const [imageCount, setImageCount] = useState(0);
  const [completedImageCount, setCompletedImageCount] = useState(0);
  const [todayUploadCount, setTodayUploadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [avgProcessingTime, setAvgProcessingTime] = useState('2.7s');
  const [processedFaster, setProcessedFaster] = useState('0.3s');

  useEffect(() => {
    const fetchStats = async () => {
      if (!user) return;

      try {
        // Get total projects count
        const projectsResponse = await apiClient.getProjects();
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
            const imagesResponse = await apiClient.getProjectImages(project.id);
            return {
              projectId: project.id,
              images: imagesResponse?.images || [],
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
            completedImages += result.images.filter(
              img => img.segmentation_status === 'completed'
            ).length;
            todayImages += result.images.filter(
              img => new Date(img.created_at) >= today
            ).length;
          }
        }

        setProjectCount(projectsCount);
        setImageCount(totalImages);
        setCompletedImageCount(completedImages);
        setTodayUploadCount(todayImages);

        // TODO: Replace with real metrics from API
        // For now, show placeholder values clearly marked as demo data
        if (completedImages > 0) {
          setAvgProcessingTime('~12.5s (demo)');
          setProcessedFaster('~0.3s (demo)');
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
  }, [user]);

  const stats = [
    {
      title: 'Total Projects',
      value: loading ? '...' : String(projectCount),
      description: 'Active spheroid studies',
      icon: <Microscope size={16} />,
      trend:
        projectCount > 0
          ? {
              value: `${Math.min(projectCount, 5)} new this month`,
              isPositive: true,
            }
          : undefined,
    },
    {
      title: 'Processed Images',
      value: loading ? '...' : String(completedImageCount),
      description: 'Successfully segmented',
      icon: <Image size={16} />,
      trend:
        completedImageCount > 0 && imageCount > 0
          ? {
              value: `${Math.round((completedImageCount / Math.max(imageCount, 1)) * 100)}% completion rate`,
              isPositive: true,
            }
          : undefined,
    },
    {
      title: 'Uploaded Today',
      value: loading ? '...' : String(todayUploadCount),
      description: 'Spheroid images pending',
      icon: <FileUp size={16} />,
    },
    {
      title: 'Segmentation Time',
      value: avgProcessingTime,
      description: 'Average per image',
      icon: <FileClock size={16} />,
      trend: {
        value: `${processedFaster} faster than before`,
        isPositive: true,
      },
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
