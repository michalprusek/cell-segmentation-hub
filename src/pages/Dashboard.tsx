
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlusCircle } from "lucide-react";
import { toast } from "sonner";

import DashboardHeader from "@/components/DashboardHeader";
import DashboardActions from "@/components/DashboardActions";
import StatsOverview from "@/components/StatsOverview";
import ProjectsList from "@/components/ProjectsList";
import ImageUploader from "@/components/ImageUploader";

// Sample project data
const projects = [
  {
    id: 1,
    title: "HeLa Cell Spheroids",
    description: "Analysis of tumor spheroids generated from HeLa cell lines for drug resistance studies",
    thumbnail: "/placeholder.svg",
    date: "Updated 2 days ago",
    imageCount: 24
  },
  {
    id: 2,
    title: "MCF-7 Breast Cancer",
    description: "Comparison of spheroid formation in varying ECM conditions",
    thumbnail: "/placeholder.svg",
    date: "Updated 5 days ago",
    imageCount: 18
  },
  {
    id: 3,
    title: "Neural Organoids",
    description: "Development tracking of cerebral organoids from stem cells",
    thumbnail: "/placeholder.svg",
    date: "Updated 1 week ago",
    imageCount: 42
  },
  {
    id: 4,
    title: "Pancreatic Islets",
    description: "Morphological analysis of islet spheroids for transplantation",
    thumbnail: "/placeholder.svg",
    date: "Updated 2 weeks ago",
    imageCount: 31
  },
  {
    id: 5,
    title: "Liver Microtissues",
    description: "Toxicity screening using 3D liver microtissues",
    thumbnail: "/placeholder.svg",
    date: "Updated 3 weeks ago",
    imageCount: 56
  },
  {
    id: 6,
    title: "Embryoid Bodies",
    description: "Differentiation patterns in embryonic stem cell aggregates",
    thumbnail: "/placeholder.svg",
    date: "Updated 1 month ago",
    imageCount: 37
  }
];

const Dashboard = () => {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  
  const handleCreateProject = () => {
    toast.success("New project created", {
      description: "Your project is ready for images"
    });
  };
  
  const handleOpenProject = (id: number) => {
    toast.info(`Opening project #${id}`, {
      description: "Loading project data..."
    });
  };
  
  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardHeader />
      
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
            <p className="text-gray-500">Manage your research projects and analyses</p>
          </div>
          <div className="mt-4 md:mt-0">
            <Button 
              onClick={handleCreateProject}
              className="rounded-md"
            >
              <PlusCircle size={18} className="mr-2" />
              New Project
            </Button>
          </div>
        </div>
        
        <div className="mb-8 animate-fade-in">
          <StatsOverview />
        </div>
        
        <Tabs defaultValue="projects" className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6">
            <TabsList className="mb-4 sm:mb-0">
              <TabsTrigger value="projects">Projects</TabsTrigger>
              <TabsTrigger value="upload">Upload Images</TabsTrigger>
              <TabsTrigger value="recent">Recent Analyses</TabsTrigger>
            </TabsList>
            
            <DashboardActions viewMode={viewMode} setViewMode={setViewMode} />
          </div>
          
          <TabsContent value="projects" className="mt-0">
            <ProjectsList 
              projects={projects} 
              viewMode={viewMode} 
              onOpenProject={handleOpenProject} 
            />
          </TabsContent>
          
          <TabsContent value="upload" className="mt-0">
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <ImageUploader />
            </div>
          </TabsContent>
          
          <TabsContent value="recent" className="mt-0">
            <div className="bg-white p-6 rounded-lg border border-gray-200 text-center py-12">
              <div className="max-w-md mx-auto">
                <h3 className="text-lg font-medium mb-2">No Recent Analyses</h3>
                <p className="text-gray-500 mb-6">
                  Your recently processed images and analyses will appear here.
                </p>
                <Button>Upload Images to Analyze</Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Dashboard;
