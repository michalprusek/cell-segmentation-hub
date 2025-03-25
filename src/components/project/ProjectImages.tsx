
import React from 'react';
import { motion } from 'framer-motion';
import { ImageCard } from './ImageCard';
import { ImageListItem } from './ImageListItem';
import { ProjectImage } from '@/types';

interface ProjectImagesProps {
  images: ProjectImage[];
  onDelete: (imageId: string) => void;
  onOpen: (imageId: string) => void;
  viewMode: 'grid' | 'list';
}

const ProjectImages = ({
  images,
  onDelete,
  onOpen,
  viewMode,
}: ProjectImagesProps) => {
  if (viewMode === 'grid') {
    return (
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
        {images.map((image) => (
          <ImageCard
            key={image.id}
            image={image}
            onDelete={onDelete}
            onOpen={onOpen}
          />
        ))}
      </motion.div>
    );
  }

  return (
    <motion.div
      className="space-y-2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {images.map((image) => (
        <ImageListItem
          key={image.id}
          image={image}
          onDelete={onDelete}
          onOpen={onOpen}
        />
      ))}
    </motion.div>
  );
};

export default ProjectImages;
