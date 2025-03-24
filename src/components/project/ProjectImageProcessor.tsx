
import { supabase } from "@/integrations/supabase/client";
import { segmentImage } from "@/lib/segmentation";
import type { SegmentationResult } from "@/lib/segmentation";
import { toast } from "sonner";

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
      toast.error("Failed to update image status");
      return;
    }
    
    // Process the image (in a real app, this would be a backend process)
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
        
        toast.success("Image segmentation completed");
      } catch (error) {
        console.error("Segmentation failed:", error);
        
        await supabase
          .from("images")
          .update({
            segmentation_status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq("id", imageId);
          
        toast.error("Segmentation failed");
      }
    }, 2000);
  } catch (error) {
    console.error("Error updating image status:", error);
    toast.error("Failed to process image");
  }
};
