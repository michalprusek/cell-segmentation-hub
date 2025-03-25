
import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import ProjectThumbnail from "@/components/project/ProjectThumbnail";
import ProjectActions from "@/components/project/ProjectActions";
import ProjectMetadata from "@/components/project/ProjectMetadata";

interface ProjectCardProps {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  date: string;
  imageCount: number;
  onClick?: () => void;
}

const ProjectCard = ({
  id,
  title,
  description,
  thumbnail,
  date,
  imageCount,
  onClick
}: ProjectCardProps) => {
  const handleCardClick = () => {
    if (onClick) {
      onClick();
    }
  };

  return (
    <Card 
      className="overflow-hidden transition-all duration-300 hover:shadow-md cursor-pointer"
      onClick={handleCardClick}
    >
      <CardHeader className="p-0">
        <div className="relative aspect-video overflow-hidden">
          <ProjectThumbnail
            projectId={id}
            fallbackSrc={thumbnail}
            imageCount={imageCount}
          />
          <div className="absolute top-4 right-4 z-10">
            <ProjectActions projectId={id} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-lg">{title}</h3>
        </div>
        <p className="text-sm text-gray-500 line-clamp-2 mb-3">{description}</p>
        <ProjectMetadata date={date} imageCount={imageCount} />
      </CardContent>
    </Card>
  );
};

export default ProjectCard;
