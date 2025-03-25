
import React from 'react';
import ImageCard from './ImageCard';
import ImageListItem from './ImageListItem';
import type { SegmentationResult } from "@/lib/segmentation";
import { motion } from "framer-motion";

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
  viewMode?: "grid" | "list";
}

const ProjectImages = ({ images, onDelete, onOpen, viewMode = "grid" }: ProjectImagesProps) => {
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05
      }
    }
  };

  // Add debug logging
  console.log("ProjectImages rendering with", images.length, "images in", viewMode, "mode");

  if (viewMode === "list") {
    return (
      <motion.div 
        className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {images.map((image) => (
            <ImageListItem
              key={image.id}
              id={image.id}
              name={image.name}
              url={image.url}
              updatedAt={image.updatedAt}
              segmentationStatus={image.segmentationStatus}
              segmentationResult={image.segmentationResult}
              onDelete={onDelete}
              onClick={() => {
                console.log("ImageListItem clicked, opening image:", image.id);
                onOpen(image);
              }}
            />
          ))}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      variants={container}
      initial="hidden"
      animate="show"
    >
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
          onClick={() => {
            console.log("ImageCard clicked, opening image:", image.id);
            onOpen(image);
          }}
        />
      ))}
    </motion.div>
  );
};

export default ProjectImages;
