import { useState, useEffect } from 'react';
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { SegmentationData } from "@/types";
import type { ProjectImage } from "@/types";

export const useProjectData = (projectId: string | undefined, userId: string | undefined) => {
  const navigate = useNavigate();
  const [projectTitle, setProjectTitle] = useState<string>("");
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  
  useEffect(() => {
    const fetchData = async () => {
      if (!projectId || !userId) {
        setLoading(false);
        return;
      }

      try {
        // First check if project exists
        const { data: project, error: projectError } = await supabase
          .from("projects")
          .select("*")
          .eq("id", projectId)
          .eq("user_id", userId)
          .single();

        if (projectError) {
          console.error("Project fetch error:", projectError);
          if (projectError.code === 'PGRST116') {
            toast.error("Project not found");
            navigate("/dashboard");
          } else {
            throw projectError;
          }
          return;
        }

        if (!project) {
          toast.error("Project not found");
          navigate("/dashboard");
          return;
        }

        setProjectTitle(project.title);

        // Then fetch the images
        const { data: imagesData, error: imagesError } = await supabase
          .from("images")
          .select("*")
          .eq("project_id", projectId)
          .order("updated_at", { ascending: false });

        if (imagesError) {
          throw imagesError;
        }

        const formattedImages: ProjectImage[] = (imagesData || []).map(img => ({
          id: img.id,
          name: img.name,
          url: img.image_url || '/placeholder.svg',
          createdAt: new Date(img.created_at),
          updatedAt: new Date(img.updated_at),
          segmentationStatus: img.segmentation_status as 'pending' | 'processing' | 'completed' | 'failed',
          segmentationResult: img.segmentation_result as unknown as SegmentationData
        }));

        setImages(formattedImages);
      } catch (error) {
        console.error("Error fetching project:", error);
        toast.error("Failed to load project data");
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [projectId, navigate, userId]);

  const updateImages = (newImages: ProjectImage[]) => {
    setImages(newImages);
  };

  return {
    projectTitle,
    images,
    loading,
    updateImages
  };
};
