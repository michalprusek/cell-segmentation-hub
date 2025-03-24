
import { supabase } from "@/integrations/supabase/client";
import { segmentImage } from "@/lib/segmentation";
import type { SegmentationResult } from "@/lib/segmentation";

interface ProcessImageParams {
  imageId: string;
  imageUrl: string;
}

export const updateImageProcessingStatus = async ({ imageId, imageUrl }: ProcessImageParams) => {
  try {
    // First update the status to processing
    const { error: updateError } = await supabase
      .from("images")
      .update({ 
        segmentation_status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq("id", imageId);

    if (updateError) {
      console.error("Error updating status:", updateError);
      return;
    }
    
    // Simulate processing (in a real app, this would be a backend process)
    setTimeout(async () => {
      try {
        const result = await segmentImage(imageUrl);
        
        const { error: resultUpdateError } = await supabase
          .from("images")
          .update({
            segmentation_status: 'completed',
            segmentation_result: result as unknown as any,
            updated_at: new Date().toISOString()
          })
          .eq("id", imageId);

        if (resultUpdateError) {
          throw resultUpdateError;
        }
      } catch (error) {
        console.error("Segmentation failed:", error);
        
        await supabase
          .from("images")
          .update({
            segmentation_status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq("id", imageId);
      }
    }, 2000);
  } catch (error) {
    console.error("Error updating image status:", error);
  }
};
