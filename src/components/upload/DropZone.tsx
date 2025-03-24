
import React from "react";
import { DropzoneOptions, useDropzone } from "react-dropzone";
import { Upload } from "lucide-react";
import { useLanguage } from '@/contexts/LanguageContext';

interface DropZoneProps {
  disabled: boolean;
  onDrop: (acceptedFiles: File[]) => void;
  isDragActive: boolean;
}

const DropZone: React.FC<DropZoneProps> = ({ disabled, onDrop, isDragActive }) => {
  const { t } = useLanguage();
  
  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': [],
      'image/png': [],
      'image/tiff': [],
      'image/bmp': []
    },
    maxSize: 10485760,
    disabled
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${
        isDragActive ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 hover:border-blue-400 dark:border-gray-700 dark:hover:border-blue-600"
      } ${disabled ? "opacity-70 pointer-events-none bg-gray-100 dark:bg-gray-800/50" : ""}`}
    >
      <input {...getInputProps()} disabled={disabled} />
      <div className="flex flex-col items-center space-y-3 text-center">
        <Upload className={`h-12 w-12 ${!disabled ? "text-gray-400 dark:text-gray-500" : "text-gray-300 dark:text-gray-700"}`} />
        <div>
          <p className={`text-base font-medium ${disabled ? "text-gray-400 dark:text-gray-600" : "dark:text-white"}`}>
            {isDragActive ? t('images.dropImagesHere') : !disabled ? t('images.dragDrop') : t('projects.createProject')}
          </p>
          <p className={`text-sm ${!disabled ? "text-gray-500 dark:text-gray-400" : "text-gray-400 dark:text-gray-600"} mt-1`}>
            {!disabled ? t('images.clickToSelect') : t('images.uploadingTo')}
          </p>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t('images.acceptedFormats')}
        </p>
      </div>
    </div>
  );
};

export default DropZone;
