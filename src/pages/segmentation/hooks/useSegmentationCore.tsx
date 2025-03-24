
import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { segmentImage, SegmentationResult } from '@/lib/segmentation';
import { useNavigate } from 'react-router-dom';

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
  const [projectImages, setProjectImages] = useState<{id: string, name: string}[]>([]);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    console.log("SegmentationEditor mounted with params:", { projectId, imageId, userId });
    
    if (!projectId || !imageId) {
      toast.error("Missing project or image ID");
      return;
    }
    
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Načtení projektu
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
        
        // Načtení všech obrázků projektu pro navigaci
        const { data: allImages, error: allImagesError } = await supabase
          .from("images")
          .select("id, name")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true });
        
        if (allImagesError) {
          console.error("Error fetching project images:", allImagesError);
        } else if (allImages) {
          setProjectImages(allImages);
        }
        
        // Načtení aktuálního obrázku
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
        
        // Načtení nebo vytvoření segmentace
        if (imageData.segmentation_status === 'completed' && imageData.segmentation_result) {
          // Použití existujícího výsledku
          result = imageData.segmentation_result as unknown as SegmentationResult;
          
          // Ujistíme se, že máme správnou cestu k obrázku
          result.imageSrc = imageData.image_url;
          
          setSegmentation(result);
        } else {
          // Pokud segmentace neexistuje nebo není dokončená, vytvoříme novou
          try {
            result = await segmentImage(imageData.image_url || '/placeholder.svg');
            
            // Uložení nové segmentace do databáze
            await supabase
              .from("images")
              .update({
                segmentation_status: 'completed',
                segmentation_result: result as unknown as any,
                updated_at: new Date().toISOString()
              })
              .eq("id", imageId);
              
            setSegmentation(result);
          } catch (segmentError) {
            console.error("Error creating segmentation:", segmentError);
            toast.error("Failed to create segmentation");
          }
        }
      } catch (error: any) {
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
  
  // Funkce pro navigaci mezi obrázky
  const navigateToImage = (direction: 'prev' | 'next') => {
    if (!imageId || !projectId || projectImages.length === 0) return;
    
    // Najít index aktuálního obrázku
    const currentIndex = projectImages.findIndex(img => img.id === imageId);
    if (currentIndex === -1) return;
    
    let newIndex;
    if (direction === 'prev') {
      newIndex = currentIndex > 0 ? currentIndex - 1 : projectImages.length - 1;
    } else {
      newIndex = (currentIndex + 1) % projectImages.length;
    }
    
    // Navigace na nový obrázek
    const newImageId = projectImages[newIndex].id;
    navigate(`/segmentation/${projectId}/${newImageId}`);
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
    navigateToImage,
    projectImages
  };
};
