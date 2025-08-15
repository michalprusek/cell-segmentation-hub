
import React, { useState, useEffect } from "react";
import apiClient from "@/lib/api";
import { getErrorMessage } from "@/types";

interface ProjectThumbnailProps {
  projectId: string;
  fallbackSrc: string;
  imageCount: number;
}

const ProjectThumbnail = ({ projectId, fallbackSrc, imageCount }: ProjectThumbnailProps) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchFirstImage = async () => {
      if (imageCount > 0) {
        try {
          const response = await apiClient.getProjectImages(projectId, { limit: 1 });
          
          // Validate response structure
          if (response && Array.isArray(response.images) && response.images.length > 0) {
            const data = response.images[0];
            // Use thumbnail if available, otherwise use full image
            setImageUrl(data.thumbnail_url || data.image_url);
          } else {
            // Clear imageUrl when no images are returned
            setImageUrl(null);
          }
        } catch (error: unknown) {
          const errorMessage = getErrorMessage(error) || "Failed to fetch thumbnail";
          console.error("Error fetching project thumbnail:", errorMessage, error);
          // Clear stale imageUrl on fetch error
          setImageUrl(null);
        }
      }
    };

    fetchFirstImage();
  }, [projectId, imageCount]);

  return (
    <img
      src={imageUrl || fallbackSrc || "/placeholder.svg"}
      alt="Project thumbnail"
      className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
    />
  );
};

export default ProjectThumbnail;
