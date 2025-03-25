
import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface NewProjectCardProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const NewProjectCard = ({ isOpen, onOpenChange }: NewProjectCardProps) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const { user } = useAuth();

  // Určení, zda je dialog otevřený pomocí interního nebo externího stavu
  const isDialogOpen = isOpen !== undefined ? isOpen : open;
  
  // Funkce pro nastavení stavu dialogu, která respektuje externí i interní stav
  const setDialogOpen = (newOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(newOpen);
    }
    setOpen(newOpen);
  };

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
      
      setDialogOpen(false);
      setProjectName("");
      setProjectDescription("");
      
      // Trigger refresh
      const event = new CustomEvent('project-created', { detail: { projectId: data.id } });
      window.dispatchEvent(event);
    } catch (error: any) {
      console.error("Error creating project:", error);
      toast.error("Failed to create project: " + error.message);
    } finally {
      setIsCreating(false);
    }
  };

  // V případě, že používáme komponentu jako kartu
  if (onOpenChange === undefined) {
    return (
      <>
        <div 
          className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden h-full hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => setDialogOpen(true)}
        >
          <div className="p-6 flex flex-col items-center justify-center h-full min-h-[200px]">
            <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mb-4">
              <Plus className="h-8 w-8 text-blue-500 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-medium text-center mb-1">{t('projects.createProject')}</h3>
            <p className="text-gray-500 dark:text-gray-400 text-center text-sm mb-4">
              {t('projects.createProjectDesc')}
            </p>
          </div>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
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
      </>
    );
  }

  // V případě, že používáme pouze dialog
  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
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

export default NewProjectCard;
