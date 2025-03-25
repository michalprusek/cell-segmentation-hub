
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { segmentImage, SegmentationResult } from '@/lib/segmentation';
import type { ProjectImage } from '@/types';

/**
 * Základní hook pro segmentační editor - práce s daty
 */
export const useSegmentationCore = (
  projectId: string | undefined,
  imageId: string | undefined,
  userId: string | undefined
) => {
  const params = useParams<{ projectId: string; imageId: string }>();
  const navigate = useNavigate();
  
  // Pokud není poskytnut projectId/imageId, zkusíme je získat z URL
  const finalProjectId = projectId || params.projectId;
  const finalImageId = imageId || params.imageId;
  
  // Stav pro segmentační editor
  const [projectTitle, setProjectTitle] = useState<string>('');
  const [imageName, setImageName] = useState<string>('');
  const [imageSrc, setImageSrc] = useState<string>('');
  const [segmentation, setSegmentation] = useState<SegmentationResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [projectImages, setProjectImages] = useState<ProjectImage[]>([]);
  
  // Reference na kontejner canvasu
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  
  // Fetch project data
  useEffect(() => {
    const fetchProjectData = async () => {
      if (!finalProjectId) return;
      
      try {
        const { data: project, error } = await supabase
          .from('projects')
          .select('*')
          .eq('id', finalProjectId)
          .single();
          
        if (error) throw error;
        
        setProjectTitle(project.title);
      } catch (error) {
        console.error('Error fetching project:', error);
        toast.error('Nepodařilo se načíst data projektu');
      }
    };
    
    fetchProjectData();
  }, [finalProjectId]);
  
  // Fetch all images in the project
  useEffect(() => {
    const fetchProjectImages = async () => {
      if (!finalProjectId) return;
      
      try {
        const { data, error } = await supabase
          .from('images')
          .select('*')
          .eq('project_id', finalProjectId)
          .order('created_at', { ascending: false });
          
        if (error) throw error;
        
        // Transformace dat na správnou strukturu ProjectImage
        const formattedImages: ProjectImage[] = (data || []).map(img => ({
          id: img.id,
          name: img.name,
          url: img.image_url,
          thumbnail_url: img.thumbnail_url,
          createdAt: new Date(img.created_at),
          updatedAt: new Date(img.updated_at),
          segmentationStatus: img.segmentation_status as 'pending' | 'processing' | 'completed' | 'failed',
          segmentationResult: img.segmentation_result ? JSON.parse(JSON.stringify(img.segmentation_result)) : undefined,
          project_id: img.project_id
        }));
        
        setProjectImages(formattedImages);
      } catch (error) {
        console.error('Error fetching project images:', error);
      }
    };
    
    fetchProjectImages();
  }, [finalProjectId]);
  
  // Fetch image and segmentation data
  useEffect(() => {
    const fetchData = async () => {
      if (!finalProjectId || !finalImageId) {
        setLoading(false);
        return;
      }
      
      setLoading(true);
      
      try {
        // Fetch image data
        const { data: imageData, error: imageError } = await supabase
          .from('images')
          .select('*')
          .eq('id', finalImageId)
          .eq('project_id', finalProjectId)
          .single();
          
        if (imageError) throw imageError;
        
        if (!imageData) {
          toast.error('Obrázek nenalezen');
          navigate(`/project/${finalProjectId}`);
          return;
        }
        
        setImageName(imageData.name);
        setImageSrc(imageData.image_url);
        
        // Check for existing segmentation
        if (imageData.segmentation_status === 'completed' && imageData.segmentation_result) {
          // Deep clone with safe primitive conversion
          const segDataStr = JSON.stringify(imageData.segmentation_result);
          const segResult = JSON.parse(segDataStr) as SegmentationResult;
          
          // Ensure all polygons have the required type field
          segResult.polygons = segResult.polygons.map(polygon => ({
            ...polygon,
            type: polygon.type || 'external' // Default to external
          }));
          
          segResult.imageSrc = imageData.image_url;
          setSegmentation(segResult);
        } else if (imageData.segmentation_status === 'pending') {
          // Generate segmentation if needed
          const segResult = await segmentImage(imageData.image_url);
          
          // Convert to string for database storage
          const segResultStr = JSON.stringify(segResult);
          
          // Update database with segmentation result
          const { error: updateError } = await supabase
            .from('images')
            .update({
              segmentation_status: 'completed',
              segmentation_result: JSON.parse(segResultStr),
              updated_at: new Date().toISOString()
            })
            .eq('id', finalImageId);
            
          if (updateError) {
            console.error('Error updating segmentation:', updateError);
          }
          
          segResult.imageSrc = imageData.image_url;
          setSegmentation(segResult);
        } else if (imageData.segmentation_status === 'failed') {
          toast.error('Segmentace selhala');
        }
      } catch (error) {
        console.error('Error loading segmentation data:', error);
        toast.error('Nepodařilo se načíst data segmentace');
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [finalProjectId, finalImageId, navigate]);
  
  // Save segmentation
  const handleSave = useCallback(async () => {
    if (!finalImageId || !segmentation) return;
    
    setSaving(true);
    
    try {
      // Check if polygons have types assigned
      const updatedPolygons = segmentation.polygons.map(polygon => ({
        ...polygon,
        type: polygon.type || 'external', // Default to external
        class: polygon.class || 'spheroid'
      }));
      
      const updatedSegmentation = {
        ...segmentation,
        polygons: updatedPolygons
      };
      
      // Konvertujeme na JSON pro uložení do databáze
      const segmentationJson = JSON.stringify(updatedSegmentation);
      
      const { error } = await supabase
        .from('images')
        .update({
          segmentation_result: JSON.parse(segmentationJson),
          updated_at: new Date().toISOString()
        })
        .eq('id', finalImageId);
        
      if (error) throw error;
      
      toast.success('Segmentace uložena');
    } catch (error) {
      console.error('Error saving segmentation:', error);
      toast.error('Nepodařilo se uložit segmentaci');
    } finally {
      setSaving(false);
    }
  }, [finalImageId, segmentation]);
  
  // Navigate to another image
  const navigateToImage = useCallback((direction: 'next' | 'prev' | number) => {
    if (!finalProjectId || projectImages.length === 0) return;
    
    const currentIndex = projectImages.findIndex(img => img.id === finalImageId);
    
    if (currentIndex === -1) return;
    
    let newIndex;
    
    if (typeof direction === 'number') {
      newIndex = direction;
    } else {
      newIndex = direction === 'next' 
        ? (currentIndex + 1) % projectImages.length
        : (currentIndex - 1 + projectImages.length) % projectImages.length;
    }
    
    const newImageId = projectImages[newIndex].id;
    navigate(`/segmentation/${finalProjectId}/${newImageId}`);
  }, [finalProjectId, finalImageId, projectImages, navigate]);
  
  return {
    projectTitle,
    imageName,
    imageSrc,
    segmentation,
    setSegmentation,
    loading,
    saving,
    canvasContainerRef,
    handleSave,
    projectImages,
    navigateToImage
  };
};
