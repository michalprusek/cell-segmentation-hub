
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { updateImageProcessingStatus } from '@/components/project/ProjectImageProcessor';
import type { SegmentationResult } from '@/lib/segmentation';

interface ProjectImage {
  id: string;
  name: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
  segmentationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  segmentationResult?: SegmentationResult;
}

interface UseProjectImageActionsProps {
  projectId?: string;
  onImagesChange: (images: ProjectImage[]) => void;
  images: ProjectImage[];
}

export const useProjectImageActions = ({ 
  projectId, 
  onImagesChange,
  images
}: UseProjectImageActionsProps) => {
  const navigate = useNavigate();
  const [processingImages, setProcessingImages] = useState<string[]>([]);

  // Delete an image
  const handleDeleteImage = async (imageId: string) => {
    if (!projectId) return;
    
    if (confirm('Are you sure you want to delete this image?')) {
      try {
        const { error } = await supabase
          .from("images")
          .delete()
          .eq("id", imageId);

        if (error) throw error;
        
        // Update the UI by filtering out the deleted image
        const updatedImages = images.filter(img => img.id !== imageId);
        onImagesChange(updatedImages);
        
        toast.success("Image deleted successfully");
      } catch (error) {
        console.error("Error deleting image:", error);
        toast.error("Failed to delete image");
      }
    }
  };
  
  // Process an image segmentation
  const handleProcessImage = async (image: ProjectImage) => {
    if (processingImages.includes(image.id)) {
      toast.info("Image is already being processed");
      return;
    }
    
    setProcessingImages(prev => [...prev, image.id]);
    
    try {
      // Update local state to show processing immediately
      const updatedImages = images.map(img => 
        img.id === image.id 
          ? {...img, segmentationStatus: 'processing' as const } 
          : img
      );
      onImagesChange(updatedImages);
      
      // Process the image
      await updateImageProcessingStatus({
        imageId: image.id,
        imageUrl: image.url,
        onComplete: (result) => {
          // Update the local state with the result
          const updatedImages = images.map(img => 
            img.id === image.id 
              ? { 
                  ...img, 
                  segmentationStatus: 'completed' as const, 
                  segmentationResult: result,
                  updatedAt: new Date()
                } 
              : img
          );
          onImagesChange(updatedImages);
        }
      });
    } catch (error) {
      console.error("Error processing image:", error);
      toast.error("Failed to process image");
    } finally {
      setProcessingImages(prev => prev.filter(id => id !== image.id));
    }
  };
  
  // Open the segmentation editor for an image
  const handleOpenSegmentationEditor = (image: ProjectImage) => {
    console.log("Opening segmentation editor for image:", image.id);
    if (!projectId) return;
    
    if (image.segmentationStatus === 'pending') {
      // Auto-segment if not yet segmented
      handleProcessImage(image);
      
      toast.success("Image segmentation started. You will be redirected when complete.");
      
      // After a small delay, redirect to segmentation editor
      // In a real app, you'd wait for the segmentation to finish
      setTimeout(() => {
        navigate(`/segmentation/${projectId}/${image.id}`);
      }, 1000);
    } else {
      // Navigate directly if already segmented or processing
      navigate(`/segmentation/${projectId}/${image.id}`);
    }
  };
  
  return {
    handleDeleteImage,
    handleProcessImage,
    handleOpenSegmentationEditor,
    processingImages
  };
};
