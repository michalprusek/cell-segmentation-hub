import apiClient from "@/lib/api";
import type { SegmentationData } from "@/types";
import { toast } from "sonner";
import { getErrorMessage } from "@/types";

interface ProcessImageParams {
  imageId: string;
  imageUrl: string;
  onComplete?: (result: SegmentationData) => void;
}

export const updateImageProcessingStatus = async ({ 
  imageId, 
  imageUrl, 
  onComplete 
}: ProcessImageParams) => {
  try {
    // Request segmentation through the API
    await apiClient.requestSegmentation(imageId);
    
    toast.success("Segmentation request submitted");
    
    // Poll for completion (in a real app, you might use WebSockets or Server-Sent Events)
    const pollForCompletion = async () => {
      try {
        const results = await apiClient.getSegmentationResults(imageId);
        
        // Validate that results is an array before accessing
        if (!Array.isArray(results) || results.length === 0) {
          // No results yet, continue polling
          setTimeout(pollForCompletion, 2000); // Poll every 2 seconds
          return;
        }
        
        const latestResult = results[0]; // Now safe to access after validation
        
        if (latestResult?.status === 'completed') {
          toast.success("Image segmentation completed");
          
          // Call the onComplete callback with the result if provided
          if (onComplete && latestResult) {
            // Convert API result to expected format
            const segmentationData: SegmentationData = {
              polygons: latestResult.polygons || [],
              // Add other expected properties as needed
            };
            onComplete(segmentationData);
          }
          return;
        } else if (latestResult?.status === 'failed') {
          toast.error("Segmentation failed");
          return;
        }
        
        // If still processing, poll again after a delay
        if (latestResult.status === 'processing' || latestResult.status === 'pending') {
          setTimeout(pollForCompletion, 2000); // Poll every 2 seconds
        }
      } catch (error) {
        console.error("Error polling segmentation status:", error);
        toast.error("Failed to check segmentation status");
      }
    };
    
    // Start polling
    setTimeout(pollForCompletion, 1000); // Initial delay of 1 second
    
  } catch (error: unknown) {
    console.error("Error requesting segmentation:", error);
    const errorMessage = getErrorMessage(error) || "Failed to process image";
    toast.error("Failed to process image: " + errorMessage);
  }
};