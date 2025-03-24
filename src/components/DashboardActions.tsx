
import React from "react";
import { Button } from "@/components/ui/button";
import { Grid, List, Search, SlidersHorizontal } from "lucide-react";

interface DashboardActionsProps {
  viewMode: "grid" | "list";
  setViewMode: (mode: "grid" | "list") => void;
}

const DashboardActions = ({ viewMode, setViewMode }: DashboardActionsProps) => {
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
        <input
          type="text"
          placeholder="Search projects..."
          className="pl-9 pr-4 py-2 rounded-md border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      
      <Button variant="ghost" size="icon" className="rounded-md" onClick={() => setViewMode("grid")}>
        <Grid size={18} className={viewMode === "grid" ? "text-blue-600" : "text-gray-400"} />
      </Button>
      
      <Button variant="ghost" size="icon" className="rounded-md" onClick={() => setViewMode("list")}>
        <List size={18} className={viewMode === "list" ? "text-blue-600" : "text-gray-400"} />
      </Button>
      
      <Button variant="ghost" size="icon" className="rounded-md">
        <SlidersHorizontal size={18} />
      </Button>
    </div>
  );
};

export default DashboardActions;
