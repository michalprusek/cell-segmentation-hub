import { useState, useRef, useEffect, startTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '@/lib/api';
import { toast } from 'sonner';
import { updateImageProcessingStatus } from '@/lib/imageProcessingService';
import { type ProjectImage, type SegmentationData } from '@/types';
import type { ModelType } from '@/lib/models/modelRegistry';
import { getLocalizedErrorMessage } from '@/lib/errorUtils';
import { useLanguage } from '@/contexts/useLanguage';
import { useModel } from '@/contexts/useModel';
import { logger } from '@/lib/logger';

interface UseProjectImageActionsProps {
  projectId?: string;
  onImagesChange: (images: ProjectImage[]) => void;
  images: ProjectImage[];
  /** The project's resolved segmentation model and its calibrated threshold,
   *  from `useProjectModel` in the caller. Passed in rather than read from a
   *  context because the model is a property of the project now, and the
   *  caller already holds it — which also makes this hook a pure function of
   *  its inputs. `undefined` only while the project type is still loading. */
  selectedModel: ModelType | undefined;
  confidenceThreshold: number | undefined;
}

export const useProjectImageActions = ({
  projectId,
  onImagesChange,
  images,
  selectedModel,
  confidenceThreshold,
}: UseProjectImageActionsProps) => {
  const navigate = useNavigate();
  const [processingImages, setProcessingImages] = useState<string[]>([]);
  const { t } = useLanguage();
  // Only hole detection is still a per-user global; the model and its
  // threshold arrive from the project.
  const { detectHoles } = useModel();

  // Create refs to avoid stale closure issues
  const imagesRef = useRef<ProjectImage[]>(images);
  const processingImagesRef = useRef<Set<string>>(new Set());

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

  // Process an image segmentation and return a Promise that resolves when completed
  const handleProcessImage = async (imageId: string): Promise<boolean> => {
    // No compatibility pre-flight any more: `selectedModel` is resolved FROM
    // this project's type, so it cannot disagree with it. The only reachable
    // absence is "the project has not loaded yet", which is a race, not a
    // misconfiguration — hence a plain guard rather than the blocking modal
    // this used to open.
    if (!selectedModel || confidenceThreshold === undefined) {
      return false;
    }

    // Use ref-based synchronous check to prevent race conditions
    if (processingImagesRef.current.has(imageId)) {
      toast.info(t('imageAlreadyProcessing'));
      return false;
    }

    const image = imagesRef.current.find(img => img.id === imageId);
    if (!image) return false;

    // Add to in-flight set synchronously
    processingImagesRef.current.add(imageId);
    setProcessingImages(prev => [...prev, imageId]);

    return new Promise(resolve => {
      // Update local state to show processing immediately - use current ref
      const updatedImages = imagesRef.current.map(img =>
        img.id === imageId
          ? { ...img, segmentationStatus: 'processing' as const }
          : img
      );
      onImagesChange(updatedImages);

      // Process the image
      updateImageProcessingStatus({
        projectId: projectId!,
        imageId: imageId,
        imageUrl: image.url,
        model: selectedModel,
        threshold: confidenceThreshold,
        detectHoles: detectHoles,
        onComplete: (result: SegmentationData) => {
          // Update the local state with the result - use current ref
          const updatedImages = imagesRef.current.map(img =>
            img.id === imageId
              ? {
                  ...img,
                  segmentationStatus: 'completed' as const,
                  segmentationResult: result,
                  updatedAt: new Date(),
                }
              : img
          );
          onImagesChange(updatedImages);

          // Remove from in-flight tracking
          processingImagesRef.current.delete(imageId);
          setProcessingImages(prev => prev.filter(id => id !== imageId));
          resolve(true);
        },
      }).catch((error: unknown) => {
        logger.error('Error processing image:', error);
        const errorMessage = getLocalizedErrorMessage(
          error,
          t,
          'errors.operations.processImage'
        );
        toast.error(errorMessage);

        // Remove from in-flight tracking
        processingImagesRef.current.delete(imageId);
        setProcessingImages(prev => prev.filter(id => id !== imageId));
        resolve(false);
      });
    });
  };

  // Open the segmentation editor for an image
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
    handleProcessImage,
    handleOpenSegmentationEditor,
    processingImages,
  };
};
