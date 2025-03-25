
import React, { useState, useEffect } from 'react';
import { Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import ProjectSelector from "@/components/ProjectSelector";
import { useLanguage } from '@/contexts/LanguageContext';

interface UploaderOptionsProps {
  showProjectSelector: boolean;
  projectId: string | null;
  autoSegment: boolean; 
  onProjectChange: (value: string) => void;
  onAutoSegmentChange: (checked: boolean) => void;
}

const UploaderOptions = ({ 
  showProjectSelector, 
  projectId, 
  autoSegment, 
  onProjectChange, 
  onAutoSegmentChange 
}: UploaderOptionsProps) => {
  const { t } = useLanguage();
  const [showInfoBar, setShowInfoBar] = useState(!projectId);
  
  // Skryje info bar když je vybrán projekt
  useEffect(() => {
    if (projectId) {
      setShowInfoBar(false);
    } else {
      setShowInfoBar(true);
    }
  }, [projectId]);

  return (
    <div className="space-y-4">
      {showProjectSelector && (
        <>
          {showInfoBar && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
              <div className="flex items-start">
                <Info className="h-5 w-5 text-blue-500 mr-3 mt-0.5" />
                <div>
                  <h3 className="text-sm font-medium text-blue-800 dark:text-blue-300">{t('projects.selectProject')}</h3>
                  <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                    {t('images.projectRequired')}
                  </p>
                </div>
              </div>
            </div>
          )}
          
          <div className="bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm">
            <h3 className="text-lg font-semibold mb-3 dark:text-white">{t('projects.projectSelection')}</h3>
            <ProjectSelector value={projectId} onChange={(value) => {
              onProjectChange(value);
            }} />
          </div>
        </>
      )}
      
      <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
        <Switch 
          id="auto-segment" 
          checked={autoSegment}
          onCheckedChange={onAutoSegmentChange}
        />
        <Label htmlFor="auto-segment" className="cursor-pointer">
          {t('images.autoSegment')}
        </Label>
      </div>
    </div>
  );
};

export default UploaderOptions;
