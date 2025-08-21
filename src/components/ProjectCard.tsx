import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import ProjectThumbnail from '@/components/project/ProjectThumbnail';
import ProjectActions from '@/components/project/ProjectActions';
import ProjectMetadata from '@/components/project/ProjectMetadata';
import { Badge } from '@/components/ui/badge';
import { Share2, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface ProjectCardProps {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  date: string;
  imageCount: number;
  onClick?: () => void;
  isShared?: boolean;
  sharedBy?: { email: string };
}

const ProjectCard = ({
  id,
  title,
  description,
  thumbnail,
  date,
  imageCount,
  onClick,
  isShared = false,
  sharedBy,
}: ProjectCardProps) => {
  const { t } = useLanguage();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

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
          />
          <div className="absolute top-4 right-4 z-10">
            <ProjectActions
              projectId={id}
              projectTitle={title}
              onDialogStateChange={setIsDialogOpen}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-lg truncate pr-2" title={title}>
            {title}
          </h3>
        </div>
        {isShared && sharedBy && (
          <p className="text-xs text-blue-600 mb-2">
            {t('sharing.sharedBy', { email: sharedBy.email })}
          </p>
        )}
        <p className="text-sm text-gray-500 line-clamp-2 mb-3">{description}</p>
        <ProjectMetadata date={date} imageCount={imageCount} />
      </CardContent>
    </Card>
  );
};

export default ProjectCard;
