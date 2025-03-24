
import React from "react";
import { useState, useEffect } from "react";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue, 
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

export interface Project {
  id: number;
  title: string;
}

interface ProjectSelectorProps {
  value: number | null;
  onChange: (value: number) => void;
}

const ProjectSelector = ({ value, onChange }: ProjectSelectorProps) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        // In a real app, this would fetch from Supabase
        // For now, we'll use the sample projects array from the Dashboard
        setProjects([
          { id: 1, title: "HeLa Cell Spheroids" },
          { id: 2, title: "MCF-7 Breast Cancer" },
          { id: 3, title: "Neural Organoids" },
          { id: 4, title: "Pancreatic Islets" },
          { id: 5, title: "Liver Microtissues" },
          { id: 6, title: "Embryoid Bodies" },
        ]);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching projects:", error);
        toast.error("Failed to load projects");
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Select Project</label>
      <Select 
        value={value?.toString() || ""} 
        onValueChange={(val) => onChange(parseInt(val))}
        disabled={loading}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id.toString()}>
              {project.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default ProjectSelector;
