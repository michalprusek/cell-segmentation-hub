
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from "framer-motion";
import { Loader2, ChevronLeft, Save, Download } from 'lucide-react';
import { Button } from "@/components/ui/button";
import ProjectImageExport from './project/ProjectImageExport';
import { useSegmentationContext } from '../contexts/SegmentationContext';

interface EditorHeaderProps {
  projectId: string;
  projectTitle: string;
  imageName: string;
  saving: boolean;
  loading: boolean;
  currentImageIndex: number;
  totalImages: number;
  onNavigate: (direction: 'prev' | 'next') => void;
  onSave: () => Promise<void>;
}

const EditorHeader = ({
  projectId,
  projectTitle,
  imageName,
  saving,
  loading,
  currentImageIndex,
  totalImages,
  onNavigate,
  onSave
}: EditorHeaderProps) => {
  const navigate = useNavigate();
  const { segmentation } = useSegmentationContext();
  const [showExport, setShowExport] = useState(false);

  const handleBackClick = () => {
    navigate(`/project/${projectId}`);
  };
  
  return (
    <>
      <motion.header 
        className="w-full h-16 px-4 bg-white dark:bg-gray-800 shadow-sm flex items-center justify-between z-10"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center space-x-2">
          <Button 
            variant="ghost" 
            className="text-gray-600 dark:text-gray-300 flex items-center gap-1 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={handleBackClick}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Zpět</span>
          </Button>
          
          <div className="hidden md:block text-sm text-gray-500 dark:text-gray-400">|</div>
          
          <div className="flex flex-col md:flex-row md:items-center md:gap-2">
            <h1 className="text-base font-medium truncate max-w-[140px] sm:max-w-[200px] md:max-w-xs">
              {projectTitle}
            </h1>
            <span className="text-gray-500 dark:text-gray-400 text-xs md:text-sm">
              {imageName}
            </span>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <div className="text-sm text-gray-600 dark:text-gray-300 hidden md:flex items-center">
            <span>{currentImageIndex + 1}</span>
            <span className="mx-1">/</span>
            <span>{totalImages}</span>
          </div>
          
          <div className="hidden sm:flex items-center space-x-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => onNavigate('prev')} 
              disabled={currentImageIndex <= 0}
              className="h-9"
            >
              Předchozí
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => onNavigate('next')} 
              disabled={currentImageIndex >= totalImages - 1}
              className="h-9"
            >
              Další
            </Button>
          </div>
          
          <Button 
            variant="outline" 
            className="h-9 gap-1.5"
            onClick={() => setShowExport(true)}
          >
            <Download className="h-4 w-4" />
            <span>Export</span>
          </Button>
          
          <Button 
            onClick={onSave} 
            disabled={saving || loading}
            className="h-9 gap-1.5"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span>Uložit</span>
          </Button>
        </div>
      </motion.header>
      
      {showExport && (
        <ProjectImageExport 
          segmentation={segmentation} 
          onClose={() => setShowExport(false)} 
        />
      )}
    </>
  );
};

export default EditorHeader;
