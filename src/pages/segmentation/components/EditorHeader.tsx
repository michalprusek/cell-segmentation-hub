
import React from 'react';
import { Button } from "@/components/ui/button";
import { 
  ChevronLeft, 
  ChevronRight, 
  Save, 
  Loader2 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EditorHeaderProps {
  projectId: string;
  projectTitle: string;
  imageName: string;
  saving: boolean;
  loading: boolean;
  onNavigate: (direction: 'prev' | 'next') => void;
  onSave: () => Promise<void>;
}

const EditorHeader = ({
  projectId,
  projectTitle,
  imageName,
  saving,
  loading,
  onNavigate,
  onSave
}: EditorHeaderProps) => {
  const navigate = useNavigate();

  return (
    <div className="bg-slate-800 border-b border-slate-700 p-4">
      <div className="container mx-auto flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => navigate(`/project/${projectId}`)}
            className="text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Project
          </Button>
          <div>
            <h1 className="text-lg font-medium">{projectTitle}</h1>
            <p className="text-sm text-slate-400">{imageName}</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => onNavigate('prev')}
                  className="text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Previous Image</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => onNavigate('next')}
                  className="text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Next Image</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  onClick={onSave}
                  disabled={saving || loading}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save Changes</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
};

export default EditorHeader;
