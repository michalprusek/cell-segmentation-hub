
import React from "react";
import ProjectCard from "@/components/ProjectCard";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export interface Project {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  date: string;
  imageCount: number;
}

interface ProjectsListProps {
  projects: Project[];
  viewMode: "grid" | "list";
  onOpenProject: (id: string) => void;
  loading?: boolean;
}

const ProjectsList = ({ projects, viewMode, onOpenProject, loading }: ProjectsListProps) => {
  if (loading) {
    return (
      <div className="space-y-6">
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
                <Skeleton className="w-full h-40" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <div className="flex justify-between items-center mt-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-8 w-8 rounded-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="divide-y divide-gray-200">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center p-4">
                  <Skeleton className="flex-shrink-0 w-16 h-16 mr-4 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-8 w-8 rounded-full ml-4" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg border border-gray-200 text-center py-12">
        <div className="max-w-md mx-auto">
          <h3 className="text-lg font-medium mb-2">No Projects Found</h3>
          <p className="text-gray-500 mb-6">
            You haven't created any projects yet. Create your first project to get started.
          </p>
        </div>
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            id={project.id}
            title={project.title}
            description={project.description}
            thumbnail={project.thumbnail}
            date={project.date}
            imageCount={project.imageCount}
            onClick={() => onOpenProject(project.id)}
          />
        ))}
      </div>
    );
  }

  return (
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
            <Link to={`/project/${project.id}`} className="ml-4 flex-shrink-0">
              <Button variant="ghost" size="sm">
                <ArrowRight size={16} />
              </Button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProjectsList;
