
import React from "react";
import ProjectCard from "@/components/ProjectCard";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";

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
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
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
