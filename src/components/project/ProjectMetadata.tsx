import React from 'react';
import { Calendar, Image } from 'lucide-react';

interface ProjectMetadataProps {
  date: string;
  imageCount: number;
}

const ProjectMetadata = ({ date, imageCount }: ProjectMetadataProps) => {
  return (
    <div className="flex items-center text-sm text-gray-500 space-x-4">
      <div className="flex items-center">
        <Calendar className="h-3.5 w-3.5 mr-1.5" />
        <span>{date}</span>
      </div>
      <div className="flex items-center">
        <Image className="h-3.5 w-3.5 mr-1.5" />
        <span>{imageCount} images</span>
      </div>
    </div>
  );
};

export default ProjectMetadata;
