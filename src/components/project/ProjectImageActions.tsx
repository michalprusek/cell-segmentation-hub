
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useLanguage } from '@/contexts/LanguageContext';
import { updateImageProcessingStatus } from './ProjectImageProcessor';
import type { ProjectImage } from '@/hooks/useProjectData';

interface ProjectImageActionsProps {
  projectId: string | undefined;
  onImagesChange: (updatedImages: ProjectImage[]) => void;
  images: ProjectImage[];
}

export const useProjectImageActions = ({ projectId, onImagesChange, images }: ProjectImageActionsProps) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleDeleteImage = async (imageId: string) => {
    try {
      const { error } = await supabase
        .from("images")
        .delete()
        .eq("id", imageId);

      if (error) {
        throw error;
      }

      const updatedImages = images.filter(img => img.id !== imageId);
      onImagesChange(updatedImages);
      
      toast.success(t('common.success'), {
        description: t('common.delete') + " " + t('common.success')
      });
    } catch (error: any) {
      console.error("Error deleting image:", error);
      toast.error(t('common.error'), {
        description: t('common.delete') + " " + t('common.error') + ": " + error.message
      });
    }
  };

  const handleOpenSegmentationEditor = (image: ProjectImage) => {
    if (!projectId) {
      toast.error("Project ID is missing");
      return;
    }
    
    // Navigate to the segmentation editor with proper URL parameters
    navigate(`/segmentation/${projectId}/${image.id}`);
    
    // Only update status if pending or failed
    if (image.segmentationStatus === 'pending' || image.segmentationStatus === 'failed') {
      updateImageProcessingStatus({ 
        imageId: image.id, 
        imageUrl: image.url 
      });
      
      // Update local state to show processing
      const updatedImages = images.map(img => 
        img.id === image.id 
          ? { ...img, segmentationStatus: 'processing' as const, updatedAt: new Date() } 
          : img
      );
      
      onImagesChange(updatedImages);
    }
  };

  return {
    handleDeleteImage,
    handleOpenSegmentationEditor
  };
};
