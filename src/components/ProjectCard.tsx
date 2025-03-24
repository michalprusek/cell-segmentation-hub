
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, MoreVertical, Calendar, Trash, Copy, Share, Image } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ProjectCardProps {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  date: string;
  imageCount: number;
  onClick?: () => void;
}

const ProjectCard = ({
  id,
  title,
  description,
  thumbnail,
  date,
  imageCount,
  onClick
}: ProjectCardProps) => {
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
      
      // Refresh page to update projects list
      setTimeout(() => {
        window.location.reload();
      }, 1000);
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
      
      toast.success("Project duplicated successfully");
      
      // Navigate to the new project
      setTimeout(() => {
        navigate(`/project/${newProject.id}`);
      }, 1000);
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

  return (
    <Card className="overflow-hidden transition-all duration-300 hover:shadow-md">
      <CardHeader className="p-0">
        <div className="relative aspect-video overflow-hidden">
          <img
            src={firstImageUrl || thumbnail || "/placeholder.svg"}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
          />
          <div className="absolute top-4 right-4 z-10">
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
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-lg">{title}</h3>
        </div>
        <p className="text-sm text-gray-500 line-clamp-2 mb-3">{description}</p>
        <div className="flex items-center text-sm text-gray-500 space-x-4">
          <div className="flex items-center">
            <Calendar className="h-3.5 w-3.5 mr-1.5" />
            <span>{date}</span>
          </div>
          <div className="flex items-center">
            <Image className="h-3.5 w-3.5 mr-1.5" />
            <span>{imageCount} images</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0 flex justify-end">
        <Button variant="outline" size="sm" onClick={onClick}>
          Open Project
        </Button>
      </CardFooter>
    </Card>
  );
};

export default ProjectCard;
