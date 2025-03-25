
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
import { motion } from "framer-motion";
import ProjectViewOptions from "@/components/project/ProjectViewOptions";

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [showUploader, setShowUploader] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

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

  // Animation variants
  const pageVariants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.3 } },
    exit: { opacity: 0, transition: { duration: 0.2 } }
  };

  return (
    <motion.div 
      className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800"
      initial="initial"
      animate="animate"
      exit="exit"
      variants={pageVariants}
    >
      <ProjectHeader 
        projectTitle={projectTitle} 
        imagesCount={filteredImages.length}
        loading={loading}
      />
      
      <div className="container mx-auto px-4 py-8">
        {showUploader ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <ProjectUploaderSection onCancel={toggleUploader} />
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6 space-y-4 md:space-y-0">
              <div className="flex-1">
                <ProjectToolbar 
                  searchTerm={searchTerm}
                  onSearchChange={handleSearch}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  onToggleUploader={toggleUploader}
                />
              </div>
              <div className="flex justify-end items-center h-9 md:ml-2">
                <ProjectViewOptions viewMode={viewMode} setViewMode={setViewMode} />
              </div>
            </div>
          </motion.div>
        )}
        
        {loading ? (
          <motion.div 
            className="flex justify-center items-center h-64"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
          </motion.div>
        ) : filteredImages.length === 0 && !showUploader ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <EmptyState 
              hasSearchTerm={!!searchTerm}
              onUpload={toggleUploader}
            />
          </motion.div>
        ) : !showUploader && (
          <ProjectImages 
            images={filteredImages}
            onDelete={handleDeleteImage}
            onOpen={handleOpenSegmentationEditor}
            viewMode={viewMode}
          />
        )}
      </div>
    </motion.div>
  );
};

export default ProjectDetail;
