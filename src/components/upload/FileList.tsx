
import React from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ImagePlus, FileX, CheckCircle, X } from "lucide-react";
import { useLanguage } from '@/contexts/LanguageContext';

export interface FileWithPreview extends File {
  preview?: string;
  uploadProgress?: number;
  status?: "pending" | "uploading" | "complete" | "error";
  id?: string;
}

interface FileListProps {
  files: FileWithPreview[];
  uploadProgress: number;
  onRemoveFile: (file: FileWithPreview) => void;
}

const FileList = ({ files, uploadProgress, onRemoveFile }: FileListProps) => {
  const { t } = useLanguage();
  
  if (files.length === 0) return null;

  // Helper function to format file size
  const formatFileSize = (sizeInBytes: number): string => {
    if (sizeInBytes === 0) return '0 KB';
    
    if (isNaN(sizeInBytes)) return 'Unknown size';
    
    if (sizeInBytes < 1024) {
      return `${sizeInBytes} B`;
    } else if (sizeInBytes < 1024 * 1024) {
      return `${(sizeInBytes / 1024).toFixed(0)} KB`;
    } else {
      return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  };

  return (
    <div className="space-y-4 bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium dark:text-white">{t('images.uploadProgress')}</h3>
        <span className="text-sm text-gray-500 dark:text-gray-400">{uploadProgress}%</span>
      </div>
      
      <Progress value={uploadProgress} className="h-2" />
      
      <div className="space-y-4 mt-6">
        <h3 className="text-sm font-medium dark:text-white">Files ({files.length})</h3>
        
        <div className="space-y-2">
          {files.map((file, index) => (
            <Card key={index} className="p-3 dark:bg-gray-800 dark:border-gray-700">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 flex-shrink-0 rounded overflow-hidden bg-gray-100 dark:bg-gray-700">
                  {file.preview ? (
                    <img
                      src={file.preview}
                      alt={file.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImagePlus className="w-full h-full p-2 text-gray-400" />
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate dark:text-white">{file.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                
                <div className="flex-shrink-0 flex items-center">
                  {file.status === "pending" && (
                    <span className="text-sm text-yellow-500">{t('dashboard.pending')}</span>
                  )}
                  {file.status === "uploading" && (
                    <span className="text-sm text-blue-500">{t('dashboard.processing')}</span>
                  )}
                  {file.status === "complete" && (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  )}
                  {file.status === "error" && (
                    <FileX className="h-5 w-5 text-red-500" />
                  )}
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-2"
                    onClick={() => onRemoveFile(file)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FileList;
