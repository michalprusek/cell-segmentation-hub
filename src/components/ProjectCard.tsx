import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
// useNavigate unused - available for future use
import ProjectThumbnail from '@/components/project/ProjectThumbnail';
import ProjectActions from '@/components/project/ProjectActions';
import ProjectMetadata from '@/components/project/ProjectMetadata';
import { Badge } from '@/components/ui/badge';
import { Share2, Users, User, Activity } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { useAuth } from '@/contexts/useAuth';
import { useProjectCardUpdates } from '@/hooks/useProjectCardUpdates';
import { formatDistanceToNow } from 'date-fns';

interface ProjectCardProps {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  date: string;
  imageCount: number;
  segmentedCount?: number;
  lastUpdated?: string;
  onClick?: () => void;
  isShared?: boolean;
  sharedBy?: { email: string };
  owner?: { email: string; name?: string };
  shareId?: string;
  onProjectUpdate?: (projectId: string, action: string) => void;
}

const ProjectCard = React.memo(
  ({
    id,
    title,
    description,
    thumbnail,
    date,
    imageCount,
    segmentedCount = 0,
    lastUpdated,
    onClick,
    isShared = false,
    sharedBy: _sharedBy,
    owner,
    shareId,
    onProjectUpdate,
  }: ProjectCardProps) => {
    const { t } = useLanguage();
    const { user: _user } = useAuth();
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    // Get real-time project stats updates
    const {
      stats,
      lastUpdate,
      error: wsError,
    } = useProjectCardUpdates({
      projectId: id,
      isShared,
      ownerId: owner?.email ? owner.email : undefined,
    });

    // Calculate display values - use real-time stats when available, fallback to props
    const displayValues = useMemo(() => {
      const currentImageCount = stats?.imageCount ?? imageCount;
      const currentSegmentedCount = stats?.segmentedCount ?? segmentedCount;
      const currentLastUpdated =
        stats?.lastUpdated ?? (lastUpdated ? new Date(lastUpdated) : null);

      // Calculate segmentation progress
      const segmentationProgress =
        currentImageCount > 0
          ? Math.round((currentSegmentedCount / currentImageCount) * 100)
          : 0;

      // Format last updated time
      const formattedLastUpdate = currentLastUpdated
        ? formatDistanceToNow(currentLastUpdated, { addSuffix: true })
        : date;

      return {
        imageCount: currentImageCount,
        segmentedCount: currentSegmentedCount,
        segmentationProgress,
        lastUpdated: formattedLastUpdate,
        hasRecentUpdate:
          lastUpdate && Date.now() - lastUpdate.getTime() < 60000, // Updated in last minute
      };
    }, [stats, imageCount, segmentedCount, lastUpdated, lastUpdate, date]);

    const handleCardClick = (e: React.MouseEvent) => {
      // Don't navigate if any dialog is open
      if (isDialogOpen) {
        return;
      }

      // Check if click originated from an interactive element
      const target = e.target as HTMLElement;
      const isInteractive = target.closest(
        'button, [role="button"], [role="dialog"]'
      );

      if (!isInteractive && onClick) {
        onClick();
      }
    };

    const handleAccessError = (projectId: string, _error: unknown) => {
      onProjectUpdate?.(projectId, 'access-denied');
    };

    return (
      <Card
        className="overflow-hidden transition-all duration-300 hover:shadow-md cursor-pointer relative"
        onClick={handleCardClick}
      >
        {isShared && (
          <div className="absolute top-2 left-2 z-20">
            <Badge
              variant="secondary"
              className="bg-blue-100 text-blue-700 border-blue-200"
            >
              <Users className="h-3 w-3 mr-1" />
              {t('sharing.shared')}
            </Badge>
          </div>
        )}
        <CardHeader className="p-0">
          <div className="relative aspect-video overflow-hidden">
            <ProjectThumbnail
              projectId={id}
              fallbackSrc={thumbnail}
              imageCount={imageCount}
              onAccessError={handleAccessError}
            />
            <div className="absolute top-4 right-4 z-10">
              <ProjectActions
                projectId={id}
                projectTitle={title}
                onDialogStateChange={setIsDialogOpen}
                isShared={isShared}
                shareId={shareId}
                onProjectUpdate={onProjectUpdate}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-medium text-lg truncate pr-2" title={title}>
              {title}
            </h3>
            {isShared && (
              <Share2 className="h-4 w-4 text-blue-500 flex-shrink-0" />
            )}
          </div>

          {/* Owner information */}
          <div className="flex items-center gap-1 mb-2">
            <User className="h-3 w-3 text-gray-400" />
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {owner?.email || 'Unknown'}
            </p>
          </div>

          <p className="text-sm text-gray-500 line-clamp-2 mb-3">
            {description}
          </p>

          {/* Enhanced metadata with real-time stats */}
          <div className="space-y-2">
            <ProjectMetadata
              date={displayValues.lastUpdated}
              imageCount={displayValues.imageCount}
            />

            {/* Segmentation progress bar and stats */}
            {displayValues.segmentedCount > 0 && (
              <div className="flex items-center justify-between text-xs text-gray-500">
                <div className="flex items-center space-x-1">
                  <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 transition-all duration-300"
                      style={{
                        width: `${displayValues.segmentationProgress}%`,
                      }}
                    />
                  </div>
                  <span>
                    {displayValues.segmentedCount}/{displayValues.imageCount}{' '}
                    {t('common.segmented').toLowerCase()}
                  </span>
                </div>
                <span className="font-medium">
                  {displayValues.segmentationProgress}%
                </span>
              </div>
            )}

            {/* Real-time update indicator */}
            {displayValues.hasRecentUpdate && (
              <div className="flex items-center text-xs text-green-600 dark:text-green-400">
                <Activity className="h-3 w-3 mr-1 animate-pulse" />
                <span>Recently updated</span>
              </div>
            )}

            {/* WebSocket error indicator */}
            {wsError && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                Real-time updates unavailable
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }
);

// Memoize to prevent unnecessary re-renders in grid layouts
ProjectCard.displayName = 'ProjectCard';

export default ProjectCard;
