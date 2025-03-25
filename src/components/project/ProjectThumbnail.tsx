
import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ProjectThumbnailProps {
  projectId: string;
  fallbackSrc: string;
  imageCount: number;
}

const ProjectThumbnail = ({ projectId, fallbackSrc, imageCount }: ProjectThumbnailProps) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchFirstImage = async () => {
      if (imageCount > 0) {
        try {
          const { data, error } = await supabase
            .from("images")
            .select("image_url")
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (error) throw error;
          if (data) {
            setImageUrl(data.image_url);
          }
        } catch (error) {
          console.error("Error fetching project thumbnail:", error);
        }
      }
    };

    fetchFirstImage();
  }, [projectId, imageCount]);

  return (
    <img
      src={imageUrl || fallbackSrc || "/placeholder.svg"}
      alt="Project thumbnail"
      className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
    />
  );
};

export default ProjectThumbnail;
