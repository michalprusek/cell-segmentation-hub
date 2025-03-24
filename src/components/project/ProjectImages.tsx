
import React from 'react';
import ImageCard from './ImageCard';
import type { SegmentationResult } from "@/lib/segmentation";

interface ProjectImage {
  id: string;
  name: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
  segmentationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  segmentationResult?: SegmentationResult;
}

interface ProjectImagesProps {
  images: ProjectImage[];
  onDelete: (id: string) => void;
  onOpen: (image: ProjectImage) => void;
}

const ProjectImages = ({ images, onDelete, onOpen }: ProjectImagesProps) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {images.map((image) => (
        <ImageCard 
          key={image.id}
          id={image.id}
          name={image.name}
          url={image.url}
          updatedAt={image.updatedAt}
          segmentationStatus={image.segmentationStatus}
          segmentationResult={image.segmentationResult}
          onDelete={onDelete}
          onClick={() => onOpen(image)}
        />
      ))}
    </div>
  );
};

export default ProjectImages;
