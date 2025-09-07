import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Share2, User } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { useAuth } from '@/contexts/useAuth';
import ProjectThumbnail from '@/components/project/ProjectThumbnail';
import ProjectActions from '@/components/project/ProjectActions';
import ProjectMetadata from '@/components/project/ProjectMetadata';

interface ProjectListItemProps {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  date: string;
  imageCount: number;
  onClick?: () => void;
  isShared?: boolean;
  sharedBy?: { email: string };
  owner?: { email: string; name?: string };
  shareId?: string;
}

const ProjectListItem = React.memo(
  ({
    id,
    title,
    description,
    thumbnail,
    date,
    imageCount,
    onClick,
    isShared = false,
    sharedBy,
    owner,
    shareId,
  }: ProjectListItemProps) => {
    const { t } = useLanguage();
    const { user } = useAuth();
    const handleCardClick = () => {
      if (onClick) {
        onClick();
      }
    };

    return (
      <Card
        className="overflow-hidden transition-all duration-300 hover:shadow-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 w-full"
        onClick={handleCardClick}
      >
        <div className="flex items-center p-4">
          <div className="flex-shrink-0 w-16 h-16 mr-4 overflow-hidden rounded-md">
            <ProjectThumbnail
              projectId={id}
              fallbackSrc={thumbnail}
              imageCount={imageCount}
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-medium truncate dark:text-white">
                {title}
              </h3>
              {isShared && (
                <Share2 className="h-4 w-4 text-blue-500 flex-shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-1 mt-1">
              <User className="h-3 w-3 text-gray-400" />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {owner?.email || 'Unknown'}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1 mt-1">
              {description}
            </p>
            <div className="flex items-center mt-1">
              <ProjectMetadata date={date} imageCount={imageCount} />
            </div>
          </div>

          <div className="flex items-center ml-4 space-x-2">
            <ProjectActions
              projectId={id}
              isShared={isShared}
              shareId={shareId}
            />
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    );
  }
);

// Memoize to prevent unnecessary re-renders in lists
ProjectListItem.displayName = 'ProjectListItem';

export default ProjectListItem;
