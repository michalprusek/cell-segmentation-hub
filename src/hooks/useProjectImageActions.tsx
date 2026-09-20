import { useRef, useEffect, startTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '@/lib/api';
import { toast } from 'sonner';
import { type ProjectImage } from '@/types';
import { getLocalizedErrorMessage } from '@/lib/errorUtils';
import { useLanguage } from '@/contexts/useLanguage';
import { logger } from '@/lib/logger';

interface UseProjectImageActionsProps {
  projectId?: string;
  onImagesChange: (images: ProjectImage[]) => void;
  images: ProjectImage[];
}

export const useProjectImageActions = ({
  projectId,
  onImagesChange,
  images,
}: UseProjectImageActionsProps) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  // Ref rather than the prop directly: `handleDeleteImage` is called from an
  // event handler and would otherwise close over a stale `images`.
  const imagesRef = useRef<ProjectImage[]>(images);

  // Keep refs in sync with state
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // Delete an image - removed confirmation dialog
  const handleDeleteImage = async (imageId: string) => {
    if (!projectId) return;

    try {
      await apiClient.deleteImage(projectId, imageId);

      // Update the UI by filtering out the deleted image - use current ref
      const updatedImages = imagesRef.current.filter(img => img.id !== imageId);
      onImagesChange(updatedImages);

      // Emit event to notify Dashboard about image deletion with updated count and thumbnail
      const newThumbnail =
        updatedImages[0]?.thumbnailUrl ||
        updatedImages[0]?.displayUrl ||
        '/placeholder.svg';

      const event = new CustomEvent('project-image-deleted', {
        detail: {
          projectId,
          imageId,
          remainingCount: updatedImages.length,
          newThumbnail: newThumbnail,
        },
      });
      window.dispatchEvent(event);

      toast.success(t('imageDeleted'));
    } catch (error: unknown) {
      logger.error('Error deleting image:', error);
      const errorMessage = getLocalizedErrorMessage(
        error,
        t,
        'errors.operations.deleteImage'
      );
      toast.error(errorMessage);
    }
  };

  const handleOpenSegmentationEditor = async (imageId: string) => {
    if (!projectId) return;

    const image = imagesRef.current.find(img => img.id === imageId);
    if (!image) return;

    // Always navigate directly to segmentation editor
    // Segmentation should only be triggered by "Segment All" button
    // Use startTransition to ensure proper React 18 concurrent rendering
    // This fixes navigation freezing after segmentation
    startTransition(() => {
      navigate(`/segmentation/${projectId}/${imageId}`);
    });
  };

  return {
    handleDeleteImage,
    handleOpenSegmentationEditor,
  };
};
