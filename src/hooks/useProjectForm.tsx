
import { useState } from 'react';
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface UseProjectFormProps {
  onSuccess?: (projectId: string) => void;
  onClose: () => void;
}

export const useProjectForm = ({ onSuccess, onClose }: UseProjectFormProps) => {
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const { user } = useAuth();

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!projectName.trim()) {
      toast.error("Please enter a project name");
      return;
    }

    if (!user) {
      toast.error("You must be logged in to create a project");
      return;
    }
    
    setIsCreating(true);
    
    try {
      const { data, error } = await supabase
        .from("projects")
        .insert([
          {
            title: projectName,
            description: projectDescription || "No description provided",
            user_id: user.id
          }
        ])
        .select()
        .single();

      if (error) {
        throw error;
      }
      
      toast.success("Project created successfully", {
        description: `"${projectName}" is ready for images`
      });
      
      onClose();
      setProjectName("");
      setProjectDescription("");
      
      // Trigger refresh or callback
      if (onSuccess && data) {
        onSuccess(data.id);
      } else {
        // Trigger refresh
        const event = new CustomEvent('project-created', { detail: { projectId: data.id } });
        window.dispatchEvent(event);
      }
    } catch (error: any) {
      console.error("Error creating project:", error);
      toast.error("Failed to create project: " + error.message);
    } finally {
      setIsCreating(false);
    }
  };

  return {
    projectName,
    setProjectName,
    projectDescription,
    setProjectDescription,
    isCreating,
    handleCreateProject
  };
};
