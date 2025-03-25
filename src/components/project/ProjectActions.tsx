import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { MoreVertical, Trash, Copy, Share } from "lucide-react";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ProjectActionsProps {
  projectId: string;
}

const ProjectActions = ({ projectId }: ProjectActionsProps) => {
  const [loading, setLoading] = useState(false);

  const handleDeleteProject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    setLoading(true);
    
    try {
      // Delete project from database
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", projectId);
        
      if (error) throw error;
      
      toast.success("Project deleted successfully");
      
      // Refresh projects list instead of page reload
      const event = new CustomEvent('project-deleted', { detail: { projectId } });
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
        .eq("id", projectId)
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
        .eq("project_id", projectId);
        
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
    const projectUrl = `${window.location.origin}/project/${projectId}`;
    navigator.clipboard.writeText(projectUrl);
    
    toast.success("Project URL copied to clipboard");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon" className="h-8 w-8 bg-white/80 backdrop-blur-sm rounded-full shadow-sm hover:bg-white">
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
  );
};

export default ProjectActions;
