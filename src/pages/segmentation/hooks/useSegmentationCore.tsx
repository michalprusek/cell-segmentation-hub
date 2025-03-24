
import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { segmentImage, SegmentationResult } from '@/lib/segmentation';

/**
 * Hook pro správu základních dat segmentačního editoru
 */
export const useSegmentationCore = (
  projectId: string | undefined,
  imageId: string | undefined,
  userId: string | undefined
) => {
  const [projectTitle, setProjectTitle] = useState('');
  const [imageName, setImageName] = useState('');
  const [imageSrc, setImageSrc] = useState('/placeholder.svg');
  const [loading, setLoading] = useState(true);
  const [segmentation, setSegmentation] = useState<SegmentationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    console.log("SegmentationEditor mounted with params:", { projectId, imageId, userId });
    
    if (!projectId || !imageId) {
      toast.error("Missing project or image ID");
      return;
    }
    
    const fetchData = async () => {
      try {
        setLoading(true);
        
        const { data: projectData, error: projectError } = await supabase
          .from("projects")
          .select("*")
          .eq("id", projectId)
          .maybeSingle();
        
        if (projectError) {
          throw new Error(`Error fetching project: ${projectError.message}`);
        }
        
        if (!projectData) {
          toast.error("Project not found");
          return;
        }
        
        setProjectTitle(projectData.title);
        
        const { data: imageData, error: imageError } = await supabase
          .from("images")
          .select("*")
          .eq("id", imageId)
          .eq("project_id", projectId)
          .maybeSingle();
        
        if (imageError) {
          throw new Error(`Error fetching image: ${imageError.message}`);
        }
        
        if (!imageData) {
          toast.error("Image not found");
          return;
        }
        
        setImageName(imageData.name || `Image_${imageId}`);
        setImageSrc(imageData.image_url || '/placeholder.svg');
        
        let result: SegmentationResult;
        
        if (imageData.segmentation_status === 'completed' && imageData.segmentation_result) {
          result = imageData.segmentation_result as unknown as SegmentationResult;
        } else {
          result = await segmentImage(imageData.image_url || '/placeholder.svg');
          
          await supabase
            .from("images")
            .update({
              segmentation_status: 'completed',
              segmentation_result: result as unknown as any,
              updated_at: new Date().toISOString()
            })
            .eq("id", imageId);
        }
        
        setSegmentation(result);
      } catch (error) {
        console.error("Error in SegmentationEditor:", error);
        toast.error("Failed to load segmentation data");
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [projectId, imageId, userId]);

  const handleSave = async () => {
    if (!segmentation || !imageId) return;
    
    setSaving(true);
    
    try {
      const { error } = await supabase
        .from("images")
        .update({
          segmentation_status: 'completed',
          segmentation_result: segmentation as unknown as any,
          updated_at: new Date().toISOString()
        })
        .eq("id", imageId);
      
      if (error) throw new Error(error.message);
      
      toast.success("Segmentation saved successfully");
    } catch (error: any) {
      console.error("Error saving segmentation:", error);
      toast.error(`Failed to save segmentation: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };
  
  const navigateToImage = (direction: 'prev' | 'next') => {
    if (!imageId || !projectId) return;
    
    const currentId = imageId;
    
    const newId = direction === 'prev' 
      ? `${parseInt(currentId) - 1}` 
      : `${parseInt(currentId) + 1}`;
    
    window.location.href = `/segmentation/${projectId}/${newId}`;
  };

  return {
    projectTitle,
    imageName,
    imageSrc,
    loading,
    saving,
    segmentation,
    setSegmentation,
    canvasContainerRef,
    handleSave,
    navigateToImage
  };
};
