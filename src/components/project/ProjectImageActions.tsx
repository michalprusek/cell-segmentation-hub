
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { updateImageProcessingStatus } from '@/components/project/ProjectImageProcessor';
import type { ProjectImage, SegmentationData } from '@/types';

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
  const handleProcessImage = async (imageId: string) => {
    if (processingImages.includes(imageId)) {
      toast.info("Image is already being processed");
      return;
    }
    
    const image = images.find(img => img.id === imageId);
    if (!image) return;
    
    setProcessingImages(prev => [...prev, imageId]);
    
    try {
      // Update local state to show processing immediately
      const updatedImages = images.map(img => 
        img.id === imageId 
          ? {...img, segmentationStatus: 'processing' as const } 
          : img
      );
      onImagesChange(updatedImages);
      
      // Process the image
      await updateImageProcessingStatus({
        imageId: imageId,
        imageUrl: image.url,
        onComplete: (result: SegmentationData) => {
          // Update the local state with the result
          const updatedImages = images.map(img => 
            img.id === imageId 
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
      setProcessingImages(prev => prev.filter(id => id !== imageId));
    }
  };
  
  // Open the segmentation editor for an image
  const handleOpenSegmentationEditor = (imageId: string) => {
    if (!projectId) return;
    
    const image = images.find(img => img.id === imageId);
    if (!image) return;
    
    if (image.segmentationStatus === 'pending') {
      // Auto-segment if not yet segmented
      handleProcessImage(imageId);
      
      toast.success("Image segmentation started. You will be redirected when complete.");
      
      // After a small delay, redirect to segmentation editor
      // In a real app, you'd wait for the segmentation to finish
      setTimeout(() => {
        navigate(`/segmentation/${projectId}/${imageId}`);
      }, 1000);
    } else {
      // Navigate directly if already segmented or processing
      navigate(`/segmentation/${projectId}/${imageId}`);
    }
  };
  
  return {
    handleDeleteImage,
    handleProcessImage,
    handleOpenSegmentationEditor,
    processingImages
  };
};
