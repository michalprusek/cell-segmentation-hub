
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StatsOverview from "@/components/StatsOverview";
import ProjectCard from "@/components/ProjectCard";
import ImageUploader from "@/components/ImageUploader";
import { toast } from "sonner";
import { 
  PlusCircle, 
  Grid, 
  List, 
  Search, 
  SlidersHorizontal,
  ArrowRight,
  Bell,
  User
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-blue-500 flex items-center justify-center">
                <span className="text-white font-bold text-sm">S</span>
              </div>
              <span className="font-semibold text-base">Spheroid</span>
            </Link>
            
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="rounded-full relative">
                <Bell size={20} />
                <span className="absolute top-1 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
              </Button>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <User size={20} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>Profile</DropdownMenuItem>
                  <DropdownMenuItem>Settings</DropdownMenuItem>
                  <DropdownMenuItem>Help & Support</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>Log out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>
      
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
          </div>
          
          <TabsContent value="projects" className="mt-0">
            {viewMode === "grid" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    title={project.title}
                    description={project.description}
                    thumbnail={project.thumbnail}
                    date={project.date}
                    imageCount={project.imageCount}
                    onClick={() => handleOpenProject(project.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="divide-y divide-gray-200">
                  {projects.map((project) => (
                    <div key={project.id} className="flex items-center p-4 hover:bg-gray-50">
                      <div className="flex-shrink-0 w-16 h-16 mr-4 overflow-hidden rounded-md">
                        <img
                          src={project.thumbnail}
                          alt={project.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-medium truncate">{project.title}</h3>
                        <p className="text-sm text-gray-500 truncate">{project.description}</p>
                        <div className="flex items-center mt-1 text-xs text-gray-500">
                          <span>{project.date}</span>
                          <span className="mx-2">•</span>
                          <span>{project.imageCount} images</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-4 flex-shrink-0"
                        onClick={() => handleOpenProject(project.id)}
                      >
                        <ArrowRight size={16} />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
