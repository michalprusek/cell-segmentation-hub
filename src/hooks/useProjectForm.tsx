import { useState } from 'react';
import { toast } from "sonner";
import apiClient from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { getErrorMessage } from "@/types";

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
      const projectData = await apiClient.createProject({
        name: projectName,
        description: projectDescription || "No description provided"
      });
      
      // Validate response
      if (!projectData || !projectData.id) {
        console.error("Invalid project creation response:", projectData);
        toast.error("Failed to create project", {
          description: "Server response was invalid"
        });
        return;
      }
      
      toast.success("Project created successfully", {
        description: `"${projectName}" is ready for images`
      });
      
      onClose();
      setProjectName("");
      setProjectDescription("");
      
      // Trigger refresh or callback
      if (onSuccess && projectData.id) {
        onSuccess(projectData.id);
      } else if (projectData.id) {
        // Trigger refresh
        const event = new CustomEvent('project-created', { detail: { projectId: projectData.id } });
        window.dispatchEvent(event);
      }
    } catch (error: unknown) {
      console.error("Error creating project:", error);
      const errorMessage = getErrorMessage(error) || "Failed to create project";
      toast.error("Failed to create project: " + errorMessage);
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