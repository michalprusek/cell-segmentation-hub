
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectData } from '@/hooks/useProjectData';
import ProjectHeader from '@/components/project/ProjectHeader';
import ExportOptionsCard from './components/ExportOptionsCard';
import ImageSelectionCard from './components/ImageSelectionCard';
import { useExportFunctions } from './hooks/useExportFunctions';

const ProjectExport = () => {
  const { id: projectId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const { projectTitle, images, loading } = useProjectData(projectId, user?.id);
  
  const { 
    selectedImages, 
    includeMetadata, 
    includeObjectMetrics, 
    includeSegmentation,
    isExporting,
    handleSelectAll,
    handleSelectImage,
    getSelectedCount,
    handleExport,
    handleExportMetricsAsXlsx,
    setIncludeMetadata,
    setIncludeObjectMetrics,
    setIncludeSegmentation
  } = useExportFunctions(images, projectTitle);
  
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <ProjectHeader
        projectTitle={projectTitle}
        imagesCount={images.length}
        loading={loading}
      />
      
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <Button
            variant="outline"
            size="sm"
            className="flex items-center"
            onClick={() => navigate(`/project/${projectId}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Zpět na projekt
          </Button>
          
          <Button
            disabled={getSelectedCount() === 0 || isExporting}
            onClick={handleExport}
            className="flex items-center"
          >
            {isExporting ? (
              <span className="mr-2 h-4 w-4 animate-spin">⏳</span>
            ) : (
              <span className="mr-2 h-4 w-4">📥</span>
            )}
            Exportovat {getSelectedCount()} obrázků
          </Button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ExportOptionsCard 
            includeMetadata={includeMetadata}
            setIncludeMetadata={setIncludeMetadata}
            includeSegmentation={includeSegmentation}
            setIncludeSegmentation={setIncludeSegmentation}
            includeObjectMetrics={includeObjectMetrics}
            setIncludeObjectMetrics={setIncludeObjectMetrics}
            handleExportMetricsAsXlsx={handleExportMetricsAsXlsx}
            getSelectedCount={getSelectedCount}
            isExporting={isExporting}
          />
          
          <ImageSelectionCard 
            images={images}
            loading={loading}
            selectedImages={selectedImages}
            handleSelectAll={handleSelectAll}
            handleSelectImage={handleSelectImage}
          />
        </div>
      </div>
    </div>
  );
};

export default ProjectExport;
