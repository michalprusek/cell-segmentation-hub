
import React from "react";
import { Grid2X2, List as ListIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface ProjectViewOptionsProps {
  viewMode: "grid" | "list";
  setViewMode: (mode: "grid" | "list") => void;
}

const ProjectViewOptions = ({ viewMode, setViewMode }: ProjectViewOptionsProps) => {
  return (
    <ToggleGroup 
      type="single" 
      value={viewMode} 
      onValueChange={(value) => {
        if (value) setViewMode(value as "grid" | "list");
      }}
    >
      <ToggleGroupItem value="grid" aria-label="Grid view">
        <Grid2X2 className="h-4 w-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="List view">
        <ListIcon className="h-4 w-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
};

export default ProjectViewOptions;
