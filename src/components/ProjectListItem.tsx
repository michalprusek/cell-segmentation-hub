
import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MoreVertical, Calendar, Trash, Copy, Share, Image, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ProjectListItemProps {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  date: string;
  imageCount: number;
  onClick?: () => void;
}

const ProjectListItem = ({
  id,
  title,
  description,
  thumbnail,
  date,
  imageCount,
  onClick
}: ProjectListItemProps) => {
  const navigate = useNavigate();
  const [firstImageUrl, setFirstImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchFirstImage = async () => {
      if (imageCount > 0) {
        try {
          const { data, error } = await supabase
            .from("images")
            .select("image_url")
            .eq("project_id", id)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (error) throw error;
          if (data) {
            setFirstImageUrl(data.image_url);
          }
        } catch (error) {
          console.error("Error fetching project thumbnail:", error);
        }
      }
    };

    fetchFirstImage();
  }, [id, imageCount]);

  const handleDeleteProject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    setLoading(true);
    
    try {
      // Delete project from database
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", id);
        
      if (error) throw error;
      
      toast.success("Project deleted successfully");
      
      // Refresh projects list instead of page reload
      const event = new CustomEvent('project-deleted', { detail: { projectId: id } });
      window.dispatchEvent(event);
    } catch (error) {
      console.error("Error deleting project:", error);
      toast.error("Failed to delete project");
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicateProject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    setLoading(true);
    
    try {
      // Get project details
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single();
        
      if (projectError) throw projectError;
      
      // Create new project with same details
      const { data: newProject, error: createError } = await supabase
        .from("projects")
        .insert([
          {
            title: `${projectData.title} (Copy)`,
            description: projectData.description,
            user_id: projectData.user_id
          }
        ])
        .select()
        .single();
        
      if (createError) throw createError;
      
      // Get all images from old project
      const { data: images, error: imagesError } = await supabase
        .from("images")
        .select("*")
        .eq("project_id", id);
        
      if (imagesError) throw imagesError;
      
      // Copy images to new project
      if (images && images.length > 0) {
        const newImages = images.map(image => ({
          project_id: newProject.id,
          name: image.name,
          image_url: image.image_url,
          thumbnail_url: image.thumbnail_url,
          user_id: projectData.user_id,
          segmentation_status: image.segmentation_status,
          segmentation_result: image.segmentation_result
        }));
        
        const { error: insertError } = await supabase
          .from("images")
          .insert(newImages);
          
        if (insertError) throw insertError;
      }
      
      toast.success("Project duplicated successfully");
      
      // Refresh projects list instead of redirecting
      const event = new CustomEvent('project-created', { detail: { projectId: newProject.id } });
      window.dispatchEvent(event);
    } catch (error) {
      console.error("Error duplicating project:", error);
      toast.error("Failed to duplicate project");
    } finally {
      setLoading(false);
    }
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    // Copy the project URL to clipboard
    const projectUrl = `${window.location.origin}/project/${id}`;
    navigator.clipboard.writeText(projectUrl);
    
    toast.success("Project URL copied to clipboard");
  };

  const handleCardClick = () => {
    if (onClick) {
      onClick();
    }
  };

  return (
    <Card 
      className="overflow-hidden transition-all duration-300 hover:shadow-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
      onClick={handleCardClick}
    >
      <div className="flex items-center p-4">
        <div className="flex-shrink-0 w-16 h-16 mr-4 overflow-hidden rounded-md">
          <img
            src={firstImageUrl || thumbnail || "/placeholder.svg"}
            alt={title}
            className="w-full h-full object-cover"
          />
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-medium truncate dark:text-white">{title}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1 mt-1">{description}</p>
          <div className="flex items-center mt-1">
            <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mr-3">
              <Calendar className="h-3.5 w-3.5 mr-1.5" />
              <span>{date}</span>
            </div>
            <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
              <Image className="h-3.5 w-3.5 mr-1.5" />
              <span>{imageCount} images</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center ml-4 space-x-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handleDuplicateProject}>
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleShare}>
                <Share className="h-4 w-4 mr-2" />
                Share
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-red-600"
                onClick={handleDeleteProject}
              >
                <Trash className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default ProjectListItem;
