import { useState, useEffect, useRef } from 'react';
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import apiClient from "@/lib/api";
import type { SegmentationData } from "@/types";
import type { ProjectImage } from "@/types";
import { getErrorMessage } from "@/types";

// Utility function to enrich images with segmentation results
const enrichImagesWithSegmentation = async (images: ProjectImage[]): Promise<ProjectImage[]> => {
  // Filter images that have completed segmentation
  const completedImages = images.filter(img => {
    const status = img.segmentationStatus;
    return status === 'completed' || status === 'segmented';
  });

  console.log(`📊 Enriching images with segmentation data: ${images.length} total images, ${completedImages.length} completed`);
  console.log('Image statuses:', images.map(img => ({ id: img.id.slice(0, 8), status: img.segmentationStatus })));

  if (completedImages.length === 0) {
    console.log('ℹ️ No completed images found for segmentation enrichment');
    return images;
  }

  try {
    // Fetch segmentation results for completed images in parallel
    console.log(`🔄 Fetching segmentation data for ${completedImages.length} images...`);
    const segmentationPromises = completedImages.map(async (img, index) => {
      try {
        console.log(`📥 Fetching segmentation for image ${index + 1}/${completedImages.length} (ID: ${img.id.slice(0, 8)}...)`);
        const segmentationData = await apiClient.getSegmentationResults(img.id);
        
        console.log(`✅ Successfully fetched segmentation for ${img.id.slice(0, 8)}: ${segmentationData.polygons?.length || 0} polygons, ${segmentationData.imageWidth}x${segmentationData.imageHeight}`, {
          segmentationData
        });
        
        return {
          imageId: img.id,
          result: {
            polygons: segmentationData.polygons || [],
            imageWidth: segmentationData.imageWidth,
            imageHeight: segmentationData.imageHeight,
            modelUsed: segmentationData.modelUsed,
            confidence: segmentationData.confidence,
            processingTime: segmentationData.processingTime
          }
        };
      } catch (error) {
        console.error(`❌ Failed to fetch segmentation results for image ${img.id.slice(0, 8)}:`, error);
        return null;
      }
    });

    const segmentationResults = await Promise.all(segmentationPromises);

    // Create a map of imageId to segmentation results
    const segmentationMap = new Map();
    let successfulEnrichments = 0;
    segmentationResults.forEach(result => {
      if (result) {
        segmentationMap.set(result.imageId, result.result);
        successfulEnrichments++;
      }
    });

    console.log(`📈 Successfully enriched ${successfulEnrichments} out of ${completedImages.length} images with segmentation data`);

    // Enrich images with segmentation results
    const enrichedImages = images.map(img => {
      const segmentationResult = segmentationMap.get(img.id);
      if (segmentationResult) {
        console.log(`🎯 Image ${img.id.slice(0, 8)} enriched with ${segmentationResult.polygons?.length || 0} polygons`);
      }
      return {
        ...img,
        segmentationResult: segmentationResult || img.segmentationResult
      };
    });

    return enrichedImages;

  } catch (error) {
    console.error("Error enriching images with segmentation results:", error);
    // Return original images if enrichment fails
    return images;
  }
};

export const useProjectData = (projectId: string | undefined, userId: string | undefined) => {
  const navigate = useNavigate();
  const [projectTitle, setProjectTitle] = useState<string>("");
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  
  // Track pending requests to prevent duplicates
  const pendingRequestsRef = useRef<Set<string>>(new Set());
  
  useEffect(() => {
    const fetchData = async () => {
      if (!projectId || !userId) {
        setLoading(false);
        return;
      }

      try {
        // First check if project exists
        const project = await apiClient.getProject(projectId);

        if (!project) {
          toast.error("Project not found");
          navigate("/dashboard");
          return;
        }

        setProjectTitle(project.name);

        // Then fetch the images
        const imagesResponse = await apiClient.getProjectImages(projectId);
        const imagesData = imagesResponse.images;

        const formattedImages: ProjectImage[] = (imagesData || []).map(img => {
          // Normalize segmentation status from different backend field names
          let segmentationStatus = img.segmentationStatus || img.segmentation_status;
          
          // Normalize status values to consistent format
          if (segmentationStatus === 'segmented') {
            segmentationStatus = 'completed';
          }

          return {
            id: img.id,
            name: img.name,
            url: img.url || img.image_url, // Use url field that's already mapped in api.ts
            thumbnail_url: img.thumbnail_url,
            createdAt: new Date(img.created_at || img.createdAt),
            updatedAt: new Date(img.updated_at || img.updatedAt),
            segmentationStatus: segmentationStatus,
            // Will be populated by enriching with segmentation results
            segmentationResult: undefined
          };
        });

        // Enrich images with segmentation results for completed images
        const enrichedImages = await enrichImagesWithSegmentation(formattedImages);

        setImages(enrichedImages);
      } catch (error: unknown) {
        console.error("Error fetching project:", error);
        
        if (error && typeof error === 'object' && 'response' in error && (error as { response?: { status?: number } }).response?.status === 404) {
          toast.error("Project not found");
          navigate("/dashboard");
        } else {
          const errorMessage = getErrorMessage(error);
          toast.error(errorMessage || "Failed to load project data");
        }
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [projectId, navigate, userId]);

  const updateImages = (newImages: ProjectImage[] | ((prev: ProjectImage[]) => ProjectImage[])): void => {
    setImages(newImages);
  };

  // Function to refresh segmentation data for a specific image with deduplication
  const refreshImageSegmentation = async (imageId: string) => {
    // Check if request is already in progress
    if (pendingRequestsRef.current.has(imageId)) {
      console.log(`⏭️ Skipping duplicate request for image ${imageId.slice(0, 8)} - already in progress`);
      return;
    }

    try {
      // Mark request as pending
      pendingRequestsRef.current.add(imageId);
      console.log(`🔄 Refreshing segmentation data for image ${imageId.slice(0, 8)}...`);
      
      const segmentationData = await apiClient.getSegmentationResults(imageId);
      
      console.log(`✅ Successfully refreshed segmentation for ${imageId.slice(0, 8)}: ${segmentationData.polygons?.length || 0} polygons, ${segmentationData.imageWidth}x${segmentationData.imageHeight}`);
      
      setImages(prevImages => prevImages.map(img => {
        if (img.id === imageId) {
          return {
            ...img,
            segmentationResult: {
              polygons: segmentationData.polygons || [],
              imageWidth: segmentationData.imageWidth,
              imageHeight: segmentationData.imageHeight,
              modelUsed: segmentationData.modelUsed,
              confidence: segmentationData.confidence,
              processingTime: segmentationData.processingTime
            }
          };
        }
        return img;
      }));
    } catch (error) {
      console.error(`❌ Failed to refresh segmentation data for image ${imageId.slice(0, 8)}:`, error);
    } finally {
      // Remove from pending requests
      pendingRequestsRef.current.delete(imageId);
    }
  };

  return {
    projectTitle,
    images,
    loading,
    updateImages,
    refreshImageSegmentation
  };
};