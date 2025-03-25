
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";

interface ProjectDialogFormProps {
  onSuccess?: (projectId: string) => void;
  onClose: () => void;
}

const ProjectDialogForm = ({ onSuccess, onClose }: ProjectDialogFormProps) => {
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

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create New Project</DialogTitle>
        <DialogDescription>
          Add a new project to organize your spheroid images and analyses.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleCreateProject}>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="projectName" className="text-right">
              Project Name
            </Label>
            <Input
              id="projectName"
              placeholder="e.g., HeLa Cell Spheroids"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="projectDescription" className="text-right">
              Description (Optional)
            </Label>
            <Input
              id="projectDescription"
              placeholder="e.g., Analysis of tumor spheroids for drug resistance studies"
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={isCreating}>
            {isCreating ? "Creating..." : "Create Project"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};

export default ProjectDialogForm;
