
import React, { useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from '@/contexts/LanguageContext';
import ProjectHeader from "@/components/project/ProjectHeader";
import ProjectToolbar from "@/components/project/ProjectToolbar";
import EmptyState from "@/components/project/EmptyState";
import ProjectImages from "@/components/project/ProjectImages";
import ProjectUploaderSection from "@/components/project/ProjectUploaderSection";
import { useProjectData } from "@/hooks/useProjectData";
import { useImageFilter } from "@/hooks/useImageFilter";
import { useProjectImageActions } from "@/components/project/ProjectImageActions";

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [showUploader, setShowUploader] = useState<boolean>(false);

  // Fetch project data
  const { projectTitle, images, loading, updateImages } = useProjectData(id, user?.id);
  
  // Filtering and sorting
  const { 
    filteredImages, 
    searchTerm, 
    sortField, 
    sortDirection, 
    handleSearch, 
    handleSort 
  } = useImageFilter(images);
  
  // Image operations
  const { handleDeleteImage, handleOpenSegmentationEditor } = useProjectImageActions({
    projectId: id,
    onImagesChange: updateImages,
    images
  });

  const toggleUploader = () => {
    setShowUploader(!showUploader);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <ProjectHeader 
        projectTitle={projectTitle} 
        imagesCount={filteredImages.length}
        loading={loading}
      />
      
      <div className="container mx-auto px-4 py-8">
        {showUploader ? (
          <ProjectUploaderSection onCancel={toggleUploader} />
        ) : (
          <ProjectToolbar 
            searchTerm={searchTerm}
            onSearchChange={handleSearch}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            onToggleUploader={toggleUploader}
          />
        )}
        
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
          </div>
        ) : filteredImages.length === 0 && !showUploader ? (
          <EmptyState 
            hasSearchTerm={!!searchTerm}
            onUpload={toggleUploader}
          />
        ) : !showUploader && (
          <ProjectImages 
            images={filteredImages}
            onDelete={handleDeleteImage}
            onOpen={handleOpenSegmentationEditor}
          />
        )}
      </div>
    </div>
  );
};

export default ProjectDetail;
