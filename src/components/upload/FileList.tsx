import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  ImagePlus,
  FileX,
  CheckCircle,
  X,
  Loader2,
  Upload,
  Clock,
  StopCircle,
} from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';

export interface FileWithPreview extends File {
  preview?: string;
  uploadProgress?: number;
  status?: 'pending' | 'uploading' | 'complete' | 'error';
  id?: string;
  originalSize?: number; // Backup for file size in case native property is lost
}

interface FileListProps {
  files: FileWithPreview[];
  uploadProgress: number;
  isUploading?: boolean;
  onRemoveFile: (file: FileWithPreview) => void;
  onCancelUpload?: () => void;
}

const FileList = ({
  files,
  uploadProgress,
  isUploading = false,
  onRemoveFile,
  onCancelUpload,
}: FileListProps) => {
  const { t } = useLanguage();

  if (files.length === 0) return null;

  // Helper function to format file size - enhanced to preserve File properties
  const formatFileSize = (file: FileWithPreview): string => {
    // Enhanced size detection with fallback chain
    let sizeInBytes: number | undefined;

    // Primary: Check if size property exists and is valid
    if (typeof file.size === 'number' && !isNaN(file.size) && file.size >= 0) {
      sizeInBytes = file.size;
    }
    // Secondary: Check File prototype for size property
    else if (
      file instanceof File &&
      'size' in file &&
      typeof file.size === 'number'
    ) {
      sizeInBytes = file.size;
    }
    // Tertiary: Check if stored in custom property during file processing
    else if ('originalSize' in file && typeof file.originalSize === 'number') {
      sizeInBytes = file.originalSize as number;
    }

    // If no valid size found, return unknown
    if (sizeInBytes === undefined || isNaN(sizeInBytes)) {
      return t('images.unknownSize') || 'Unknown size';
    }

    if (sizeInBytes === 0) return '0 KB';

    if (sizeInBytes < 1024) {
      return `${sizeInBytes} B`;
    } else if (sizeInBytes < 1024 * 1024) {
      return `${(sizeInBytes / 1024).toFixed(0)} KB`;
    } else {
      return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  };

  // Helper function to get status display info
  const getStatusInfo = (status?: string) => {
    switch (status) {
      case 'pending':
        return {
          icon: Clock,
          text: t('images.pending') || 'Pending',
          className: 'text-yellow-600 bg-yellow-50 border-yellow-200',
          iconClassName: 'text-yellow-600',
        };
      case 'uploading':
        return {
          icon: Upload,
          text: t('images.uploading') || 'Uploading',
          className: 'text-blue-600 bg-blue-50 border-blue-200',
          iconClassName: 'text-blue-600',
        };
      case 'complete':
        return {
          icon: CheckCircle,
          text: t('images.completed') || 'Complete',
          className: 'text-green-600 bg-green-50 border-green-200',
          iconClassName: 'text-green-600',
        };
      case 'error':
        return {
          icon: FileX,
          text: t('images.failed') || 'Failed',
          className: 'text-red-600 bg-red-50 border-red-200',
          iconClassName: 'text-red-600',
        };
      default:
        return {
          icon: Clock,
          text: t('images.pending') || 'Pending',
          className: 'text-gray-600 bg-gray-50 border-gray-200',
          iconClassName: 'text-gray-600',
        };
    }
  };

  return (
    <div className="space-y-4 bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isUploading && (
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          )}
          <h3 className="text-sm font-medium dark:text-white">
            {t('images.uploadProgress')}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          {isUploading && onCancelUpload && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCancelUpload}
              className="h-7 px-2 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/20"
            >
              <StopCircle className="h-3 w-3 mr-1" />
              {t('common.cancel')}
            </Button>
          )}
          <span className="text-sm text-gray-500 dark:text-gray-400 min-w-[3ch]">
            {uploadProgress}%
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Progress value={uploadProgress} className="h-2 flex-1" />
      </div>

      <div className="space-y-4 mt-6">
        <h3 className="text-sm font-medium dark:text-white">
          Files ({files.length})
        </h3>

        {/* Compact Grid Layout - 5 cards per row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {files.map((file, index) => {
            const statusInfo = getStatusInfo(file.status);
            const StatusIcon = statusInfo.icon;

            return (
              <Card
                key={`${file.name}_${file.size}_${index}`}
                className="relative group overflow-hidden border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all duration-200"
              >
                {/* Remove button - positioned absolutely */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2 z-10 h-6 w-6 p-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => onRemoveFile(file)}
                >
                  <X className="h-3 w-3" />
                </Button>

                {/* Thumbnail */}
                <div className="aspect-square bg-gray-100 dark:bg-gray-700 relative overflow-hidden">
                  {file.preview ? (
                    <img
                      src={file.preview}
                      alt={file.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImagePlus className="w-12 h-12 text-gray-400" />
                    </div>
                  )}

                  {/* Progress overlay for uploading files */}
                  {file.status === 'uploading' && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="text-center">
                        <Loader2 className="h-6 w-6 animate-spin text-white mx-auto mb-1" />
                        <div className="text-xs text-white font-medium">
                          {file.uploadProgress || 0}%
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Status indicator overlay */}
                  {file.status && file.status !== 'uploading' && (
                    <div className="absolute top-2 left-2">
                      <div
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${statusInfo.className}`}
                      >
                        <StatusIcon
                          className={`w-3 h-3 ${statusInfo.iconClassName}`}
                        />
                        <span>{statusInfo.text}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* File info */}
                <div className="p-3 space-y-2">
                  <div className="space-y-1">
                    <p
                      className="text-sm font-medium truncate dark:text-white"
                      title={file.name}
                    >
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatFileSize(file)}
                    </p>
                  </div>

                  {/* Progress bar for uploading files */}
                  {file.status === 'uploading' && (
                    <div className="space-y-1">
                      <Progress
                        value={file.uploadProgress || 0}
                        className="h-1.5"
                      />
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-blue-600 dark:text-blue-400 font-medium">
                          {statusInfo.text}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400">
                          {file.uploadProgress || 0}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FileList;
