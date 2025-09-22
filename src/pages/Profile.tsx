import React, { useEffect, useState } from 'react';
import DashboardHeader from '@/components/DashboardHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Clock, Edit, Mail, MapPin, Loader2, Camera } from 'lucide-react';
import { useAuth, useLanguage } from '@/contexts/exports';
// Note: Profile functionality now handled by AuthContext and Settings page
import AvatarUploadButton from '@/components/profile/AvatarUploadButton';
import AvatarCropDialog from '@/components/profile/AvatarCropDialog';
import { apiClient, Project, ProjectImage } from '@/lib/api';
import { logger } from '@/lib/logger';
import { createImagePreviewUrl } from '@/lib/tiffConverter';

interface ProfileData {
  name: string;
  title: string;
  organization: string;
  bio: string;
  email: string;
  location: string;
  joined: string;
  projects: number;
  analyses: number;
  avatar: string;
}

interface ActivityItem {
  action: string;
  date: string;
  daysAgo: number;
}

const Profile = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { t } = useLanguage();
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectCount, setProjectCount] = useState(0);
  const [imageCount, setImageCount] = useState(0);
  const [completedImageCount, setCompletedImageCount] = useState(0);
  const [storageUsed, setStorageUsed] = useState(0);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [projectCountError, setProjectCountError] = useState<string | null>(
    null
  );
  const [imageCountError, setImageCountError] = useState<string | null>(null);
  const [completedCountError, setCompletedCountError] = useState<string | null>(
    null
  );
  const [recentActivityError, setRecentActivityError] = useState<string | null>(
    null
  );
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(
    null
  );
  const [avatarImageSrc, setAvatarImageSrc] = useState<string>('');
  const [showCropDialog, setShowCropDialog] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;

      try {
        // Get project count
        let projectCount = 0;
        let projectError = null;
        try {
          const projectsResponse = await apiClient.getProjects({ limit: 1 });
          projectCount = projectsResponse.total || 0;
        } catch (error) {
          logger.error('Error fetching project count:', error);
          projectError = 'Failed to load project count';
          setProjectCountError(projectError);
        }

        // Get recent projects for activity
        let recentProjects: Project[] = [];
        let recentProjectsError = null;
        try {
          const recentProjectsResponse = await apiClient.getProjects({
            limit: 5,
          });
          recentProjects = recentProjectsResponse.projects || [];
        } catch (error) {
          logger.error('Error fetching recent projects:', error);
          recentProjectsError = 'Failed to load recent projects';
          setRecentActivityError(recentProjectsError);
        }

        // Get image counts by aggregating from all projects
        let imageCount = 0;
        let completedCount = 0;
        let imageError = null;
        let completedError = null;
        try {
          // Fetch projects with pagination to avoid memory issues
          const pageSize = 20; // Reasonable page size
          let currentPage = 1;
          let hasMoreProjects = true;

          while (hasMoreProjects) {
            const allProjectsResponse = await apiClient.getProjects({
              limit: pageSize,
              page: currentPage,
            });
            const projects = allProjectsResponse.projects || [];

            if (projects.length === 0) {
              hasMoreProjects = false;
              break;
            }

            // For each project, just get the image count from pagination metadata
            for (const project of projects) {
              try {
                // Fetch with limit: 1 to get just the count from pagination
                const imagesResponse = await apiClient.getProjectImages(
                  project.id,
                  { limit: 1 }
                );
                // Use total from pagination instead of fetching all images
                const totalImages = imagesResponse.total || 0;
                imageCount += totalImages;

                // For completed count, we need to fetch with a filter if API supports it
                // Otherwise fetch a small batch to estimate
                if (totalImages > 0) {
                  const sampleResponse = await apiClient.getProjectImages(
                    project.id,
                    { limit: Math.min(50, totalImages) }
                  );
                  const sampleImages = sampleResponse.images || [];
                  const completedInSample = sampleImages.filter(
                    img => img.segmentation_status === 'completed'
                  ).length;
                  // Estimate based on sample
                  const completionRate =
                    sampleImages.length > 0
                      ? completedInSample / sampleImages.length
                      : 0;
                  completedCount += Math.round(totalImages * completionRate);
                }
              } catch (error) {
                logger.warn(
                  `Error fetching images for project ${project.id}:`,
                  error
                );
              }
            }

            // Check if there are more pages
            if (projects.length < pageSize) {
              hasMoreProjects = false;
            } else {
              currentPage++;
            }
          }
        } catch (error) {
          logger.error('Error fetching image counts:', error);
          imageError = 'Failed to load image count';
          completedError = 'Failed to load completed count';
          setImageCountError(imageError);
          setCompletedCountError(completedError);
        }

        // Get recent images for activity (from recent projects)
        let recentImages: ProjectImage[] = [];
        let recentImagesError = null;
        try {
          for (const project of recentProjects.slice(0, 3)) {
            // Limit to recent 3 projects
            try {
              const imagesResponse = await apiClient.getProjectImages(
                project.id,
                { limit: 5 }
              );
              recentImages.push(...(imagesResponse.images || []));
            } catch (error) {
              logger.warn(
                `Error fetching recent images for project ${project.id}:`,
                error
              );
            }
          }
          // Sort by creation date and take most recent
          recentImages.sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime()
          );
          recentImages = recentImages.slice(0, 10); // Keep only 10 most recent
        } catch (error) {
          logger.error('Error fetching recent images:', error);
          recentImagesError = 'Failed to load recent images';
          setRecentActivityError(recentImagesError);
        }

        // Combined recent activity
        const activity: ActivityItem[] = [];

        if (recentProjects) {
          recentProjects.forEach(project => {
            const createdDate = new Date(project.created_at);
            const now = new Date();
            const diffDays = Math.floor(
              (now.getTime() - createdDate.getTime()) / (1000 * 3600 * 24)
            );

            activity.push({
              action: `${t('profile.createdProject')} '${project.title}'`,
              date: createdDate.toISOString(),
              daysAgo: diffDays,
            });
          });
        }

        if (recentImages) {
          recentImages.forEach(image => {
            const createdDate = new Date(image.created_at);
            const now = new Date();
            const diffDays = Math.floor(
              (now.getTime() - createdDate.getTime()) / (1000 * 3600 * 24)
            );

            if (image.segmentation_status === 'completed') {
              activity.push({
                action: `${t('profile.completedSegmentation')} '${image.name}'`,
                date: createdDate.toISOString(),
                daysAgo: diffDays,
              });
            } else {
              activity.push({
                action: `${t('profile.uploadedImage')} '${image.name}'`,
                date: createdDate.toISOString(),
                daysAgo: diffDays,
              });
            }
          });
        }

        // Sort activity by date
        activity.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );

        // Limit to 4 most recent activities
        setRecentActivity(activity.slice(0, 4));

        // Format joined date
        const joinedDate = user.created_at
          ? new Date(user.created_at)
          : new Date();

        const month = joinedDate.toLocaleString('default', { month: 'long' });
        const year = joinedDate.getFullYear();

        // Update state with fetched data
        setProjectCount(projectCount);
        setImageCount(imageCount);
        setCompletedImageCount(completedCount);
        setStorageUsed(Math.round(imageCount * 2.5 * 10) / 10); // Estimate storage based on number of images

        setProfileData({
          name: profile?.username || user.email?.split('@')[0] || 'User',
          title: profile?.title || 'Researcher',
          organization: profile?.organization || 'Research Institute',
          bio: profile?.bio || 'No bio provided',
          email: user.email || '',
          location: profile?.location || 'Not specified',
          joined: `${month} ${year}`,
          projects: projectCount,
          analyses: imageCount,
          avatar: profile?.avatarUrl || '/placeholder.svg',
        });
      } catch (error) {
        logger.error('Error fetching profile data:', error);
        toast.error(t('toast.profile.loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, profile, t]);

  // Clean up object URLs on unmount or when avatar image changes
  useEffect(() => {
    const currentUrl = avatarImageSrc;
    return () => {
      if (currentUrl && currentUrl.startsWith('blob:')) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [avatarImageSrc]);

  const handleAvatarFileSelect = async (file: File) => {
    // Validate file type
    const allowedTypes = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/bmp',
      'image/tiff',
      'image/tif',
    ];
    if (!allowedTypes.includes(file.type)) {
      toast.error(t('profile.avatar.invalidFileType'));
      logger.error('Invalid avatar file type:', file.type);
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      toast.error(t('profile.avatar.fileTooLarge'));
      logger.error('Avatar file too large:', file.size);
      return;
    }

    setSelectedAvatarFile(file);

    // Revoke previous URL if exists
    if (avatarImageSrc && avatarImageSrc.startsWith('blob:')) {
      URL.revokeObjectURL(avatarImageSrc);
    }

    // Convert TIFF or other formats to displayable format
    let imageUrl: string | null = null;
    try {
      imageUrl = await createImagePreviewUrl(file);
      setAvatarImageSrc(imageUrl);
      setShowCropDialog(true);
    } catch (error) {
      // Clean up URL if error occurred after creation
      if (imageUrl && imageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imageUrl);
      }
      logger.error('Failed to create image preview:', error);
      toast({
        title: t('common.error'),
        description: t(
          'profile.avatar.previewError',
          'Failed to preview image'
        ),
        variant: 'destructive',
      });
    }
  };

  const validateAvatarFile = (
    fileOrBlob: File | Blob
  ): { valid: boolean; reason?: string } => {
    const allowedTypes = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/bmp',
      'image/tiff',
      'image/tif',
    ];

    // Check type - for blobs without type, accept them (cropped images)
    if (fileOrBlob.type && !allowedTypes.includes(fileOrBlob.type)) {
      return { valid: false, reason: 'invalidFileType' };
    }

    // Check size
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (fileOrBlob.size > maxSize) {
      return { valid: false, reason: 'fileTooLarge' };
    }

    return { valid: true };
  };

  const handleCropComplete = async (croppedImageBlob: Blob) => {
    if (!selectedAvatarFile) return;

    // Validate cropped blob
    const validation = validateAvatarFile(croppedImageBlob);
    if (!validation.valid) {
      toast.error(t(`profile.avatar.${validation.reason}`));
      logger.error(`Avatar validation failed: ${validation.reason}`, {
        originalType: selectedAvatarFile.type,
        blobType: croppedImageBlob.type,
        size: croppedImageBlob.size,
      });
      return;
    }

    // Additional validation before upload
    const allowedTypes = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/bmp',
      'image/tiff',
      'image/tif',
    ];
    if (!allowedTypes.includes(croppedImageBlob.type)) {
      toast.error(t('profile.avatar.invalidFileType'));
      logger.error('Invalid cropped image type:', croppedImageBlob.type);
      return;
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (croppedImageBlob.size > maxSize) {
      toast.error(t('profile.avatar.fileTooLarge'));
      logger.error('Cropped image too large:', croppedImageBlob.size);
      return;
    }

    setIsUploadingAvatar(true);
    try {
      // Convert blob to file
      const croppedFile = new File(
        [croppedImageBlob],
        selectedAvatarFile.name,
        {
          type: croppedImageBlob.type,
        }
      );

      // Upload to server
      const result = await apiClient.uploadAvatar(croppedFile);

      // Update profile data locally
      if (profileData) {
        setProfileData({
          ...profileData,
          avatar: result.avatarUrl,
        });
      }

      // Refresh global profile state
      await refreshProfile();

      toast.success(t('profile.avatar.uploadSuccess'));
    } catch (error) {
      logger.error('Avatar upload error:', error);
      toast.error(t('profile.avatar.uploadError'));
    } finally {
      setIsUploadingAvatar(false);
      setShowCropDialog(false);
      setSelectedAvatarFile(null);
      // Clean up object URL
      if (avatarImageSrc) {
        URL.revokeObjectURL(avatarImageSrc);
        setAvatarImageSrc('');
      }
    }
  };

  const handleCropCancel = () => {
    setShowCropDialog(false);
    setSelectedAvatarFile(null);
    if (avatarImageSrc) {
      URL.revokeObjectURL(avatarImageSrc);
      setAvatarImageSrc('');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8">
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <DashboardHeader />

      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-start mb-8">
          <h1 className="text-2xl font-bold dark:text-white">
            {t('profile.title')}
          </h1>
          <div className="flex space-x-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="dark:border-gray-700 dark:text-gray-300"
            >
              <Link to="/settings">
                <Edit className="h-4 w-4 mr-2" />
                {t('profile.editProfile')}
              </Link>
            </Button>
          </div>
        </div>

        {profileData && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Profile Sidebar */}
            <div className="space-y-6">
              <Card className="dark:bg-gray-800 dark:border-gray-700">
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center text-center">
                    <div className="relative mb-4">
                      <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-blue-100 dark:border-blue-900 bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                        {profile?.avatarUrl || profileData.avatar ? (
                          <img
                            src={profile?.avatarUrl || profileData.avatar}
                            alt={profileData.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Camera className="w-8 h-8 text-gray-400" />
                        )}
                      </div>
                      <div className="absolute -bottom-2 right-0">
                        <AvatarUploadButton
                          onFileSelect={handleAvatarFileSelect}
                          disabled={isUploadingAvatar}
                          className="rounded-full p-2 bg-white dark:bg-gray-800 shadow-md border border-gray-200 dark:border-gray-600"
                        />
                      </div>
                    </div>
                    <h2 className="text-xl font-semibold dark:text-white">
                      {profileData.name}
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400">
                      {profileData.title}
                    </p>
                    <p className="text-sm text-gray-400 mt-1">
                      {profileData.organization}
                    </p>

                    <div className="mt-4 w-full grid grid-cols-2 gap-2 text-center">
                      <div className="border border-gray-100 dark:border-gray-700 rounded-md p-2">
                        <p className="text-lg font-semibold dark:text-white">
                          {projectCountError ? '—' : profileData.projects}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {t('profile.projects')}
                        </p>
                        {projectCountError && (
                          <p
                            className="text-xs text-red-500 mt-1"
                            title={projectCountError}
                          >
                            Error
                          </p>
                        )}
                      </div>
                      <div className="border border-gray-100 dark:border-gray-700 rounded-md p-2">
                        <p className="text-lg font-semibold dark:text-white">
                          {imageCountError ? '—' : profileData.analyses}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {t('profile.analyses')}
                        </p>
                        {imageCountError && (
                          <p
                            className="text-xs text-red-500 mt-1"
                            title={imageCountError}
                          >
                            Error
                          </p>
                        )}
                      </div>
                    </div>

                    <Separator className="my-4 dark:bg-gray-700" />

                    <div className="w-full space-y-3">
                      <div className="flex items-center text-sm dark:text-gray-300">
                        <Mail className="h-4 w-4 mr-2 text-gray-400" />
                        <span>{profileData.email}</span>
                      </div>
                      <div className="flex items-center text-sm dark:text-gray-300">
                        <MapPin className="h-4 w-4 mr-2 text-gray-400" />
                        <span>{profileData.location}</span>
                      </div>
                      <div className="flex items-center text-sm dark:text-gray-300">
                        <Clock className="h-4 w-4 mr-2 text-gray-400" />
                        <span>
                          {t('profile.joined')} {profileData.joined}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              <Card className="dark:bg-gray-800 dark:border-gray-700">
                <CardContent className="pt-6">
                  <h2 className="text-lg font-semibold mb-4 dark:text-white">
                    {t('profile.about')}
                  </h2>
                  <p className="text-gray-700 dark:text-gray-300">
                    {profileData.bio}
                  </p>

                  <Separator className="my-6 dark:bg-gray-700" />

                  <h2 className="text-lg font-semibold mb-4 dark:text-white">
                    {t('profile.recentActivity')}
                  </h2>
                  <div className="space-y-4">
                    {recentActivityError ? (
                      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                        <p className="text-red-600 dark:text-red-400 text-sm">
                          {recentActivityError}
                        </p>
                      </div>
                    ) : recentActivity.length === 0 ? (
                      <p className="text-gray-500 dark:text-gray-400">
                        {t('profile.noRecentActivity')}
                      </p>
                    ) : (
                      recentActivity.map((activity, i) => (
                        <div key={i} className="flex">
                          <div className="w-12 flex-shrink-0 flex flex-col items-center">
                            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                            <div className="w-0.5 h-full bg-gray-200 dark:bg-gray-700 mt-1"></div>
                          </div>
                          <div className="flex-1 -mt-0.5">
                            <p className="text-gray-700 dark:text-gray-300">
                              {activity.action}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {activity.daysAgo === 0
                                ? t('profile.today')
                                : activity.daysAgo === 1
                                  ? t('profile.yesterday')
                                  : `${activity.daysAgo} ${t('profile.daysAgo')}`}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="dark:bg-gray-800 dark:border-gray-700">
                <CardContent className="pt-6">
                  <h2 className="text-lg font-semibold mb-4 dark:text-white">
                    {t('profile.statistics')}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                        {t('profile.totalImagesProcessed')}
                      </h3>
                      <div className="text-3xl font-bold dark:text-white">
                        {completedCountError ? '—' : completedImageCount}
                      </div>
                      {!completedCountError && completedImageCount > 0 && (
                        <p className="text-xs text-green-600 mt-1">
                          {Math.round(
                            (completedImageCount / Math.max(imageCount, 1)) *
                              100
                          )}
                          % {t('profile.completionRate')}
                        </p>
                      )}
                      {completedCountError && (
                        <p
                          className="text-xs text-red-500 mt-1"
                          title={completedCountError}
                        >
                          Error loading data
                        </p>
                      )}
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                        {t('profile.averageProcessingTime')}
                      </h3>
                      <div className="text-3xl font-bold dark:text-white">
                        3.2s
                      </div>
                      <p className="text-xs text-green-600 mt-1">
                        -8% {t('profile.fromLastMonth')}
                      </p>
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                        {t('profile.storageUsed')}
                      </h3>
                      <div className="text-3xl font-bold dark:text-white">
                        {imageCountError ? '—' : `${storageUsed} MB`}
                      </div>
                      {!imageCountError && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {t('profile.of')} 1 GB ({Math.round(storageUsed / 10)}
                          %)
                        </p>
                      )}
                      {imageCountError && (
                        <p
                          className="text-xs text-red-500 mt-1"
                          title={imageCountError}
                        >
                          Error loading data
                        </p>
                      )}
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                        {t('profile.apiRequests')}
                      </h3>
                      <div className="text-3xl font-bold dark:text-white">
                        {imageCountError || projectCountError
                          ? '—'
                          : (imageCount + projectCount) * 4}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t('profile.thisMonth')}
                      </p>
                      {(imageCountError || projectCountError) && (
                        <p className="text-xs text-red-500 mt-1">
                          Error loading data
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      {/* Avatar Crop Dialog */}
      <AvatarCropDialog
        open={showCropDialog}
        onClose={handleCropCancel}
        imageSrc={avatarImageSrc}
        onCropComplete={handleCropComplete}
      />
    </div>
  );
};

export default Profile;
