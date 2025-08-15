import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PlusCircle } from "lucide-react";
import apiClient from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { getErrorMessage } from "@/types";

interface NewProjectProps {
  onProjectCreated?: (projectId: string) => void;
}

const NewProject = ({ onProjectCreated }: NewProjectProps) => {
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [open, setOpen] = useState(false);
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
      
      setOpen(false);
      setProjectName("");
      setProjectDescription("");
      
      // Notify parent component about creation but don't redirect
      if (onProjectCreated && projectData) {
        onProjectCreated(projectData.id);
      }
      
      // Also dispatch global event for dashboard refresh
      const event = new CustomEvent('project-created', { detail: { projectId: projectData.id } });
      window.dispatchEvent(event);
    } catch (error: unknown) {
      console.error("Error creating project:", error);
      const errorMessage = getErrorMessage(error) || "Failed to create project";
      toast.error("Failed to create project: " + errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-md">
          <PlusCircle size={18} className="mr-2" />
          New Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
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
      </DialogContent>
    </Dialog>
  );
};

export default NewProject;