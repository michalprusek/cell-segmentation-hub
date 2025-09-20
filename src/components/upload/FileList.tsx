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
import { isTiffFile, createImagePreviewUrl } from '@/lib/tiffConverter';

export interface FileWithPreview extends File {
  preview?: string;
  uploadProgress?: number;
  status?: 'pending' | 'uploading' | 'complete' | 'error';
  id?: string;
  originalSize?: number; // Backup for file size in case native property is lost
  tiffDataUrl?: string; // Converted TIFF data URL
}

interface FileListProps {
  files: FileWithPreview[];
  uploadProgress: number;
  isUploading?: boolean;
  onRemoveFile: (file: FileWithPreview) => void;
  onCancelUpload?: () => void;
}

// Component for handling TIFF image preview
const ImagePreview = React.memo(({ file }: { file: FileWithPreview }) => {
  const [tiffDataUrl, setTiffDataUrl] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    const convertTiff = async () => {
      // Check if it's a TIFF file and we don't have a regular preview
      if ((!file.preview || file.preview.length === 0) && isTiffFile(file)) {
        setIsLoading(true);
        try {
          const convertedUrl = await createImagePreviewUrl(file);
          setTiffDataUrl(convertedUrl);
        } catch (error) {
          console.warn('Failed to convert TIFF:', error);
        } finally {
          setIsLoading(false);
        }
      }
    };

    convertTiff();

    // Cleanup function to revoke blob URLs when component unmounts or file changes
    return () => {
      if (tiffDataUrl && tiffDataUrl.startsWith('blob:')) {
        URL.revokeObjectURL(tiffDataUrl);
      }
    };
  }, [file, tiffDataUrl]);

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
      </div>
    );
  }

  const imageSrc = file.tiffDataUrl || tiffDataUrl || file.preview;

  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={file.name}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center">
      <ImagePlus className="w-6 h-6 text-gray-400" />
    </div>
  );
});

ImagePreview.displayName = 'ImagePreview';

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
    // Quaternary: Try to re-read size using Object.getOwnPropertyDescriptor
    else if (file instanceof File) {
      try {
        const sizeDescriptor = Object.getOwnPropertyDescriptor(file, 'size');
        if (sizeDescriptor && typeof sizeDescriptor.value === 'number') {
          sizeInBytes = sizeDescriptor.value;
        }
      } catch (_error) {
        // Silently continue to next fallback
      }
    }
    // Final fallback: Try accessing via prototype chain
    else if (file && typeof file === 'object') {
      try {
        const prototypeSize = Object.getPrototypeOf(file)?.size;
        if (typeof prototypeSize === 'number' && !isNaN(prototypeSize)) {
          sizeInBytes = prototypeSize;
        }
      } catch (_error) {
        // Silently continue
      }
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

        {/* Compact Grid Layout - 10 cards per row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-1">
          {files.map((file, index) => {
            const statusInfo = getStatusInfo(file.status);
            const StatusIcon = statusInfo.icon;

            return (
              <Card
                key={`${file.name}_${file.size}_${index}`}
                className="relative group overflow-hidden border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all duration-200 w-24 h-auto"
              >
                {/* Remove button - positioned absolutely */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-1 right-1 z-10 h-4 w-4 p-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => onRemoveFile(file)}
                >
                  <X className="h-2 w-2" />
                </Button>

                {/* Thumbnail */}
                <div className="aspect-[4/3] bg-gray-100 dark:bg-gray-700 relative overflow-hidden">
                  <ImagePreview file={file} />

                  {/* Progress overlay for uploading files */}
                  {file.status === 'uploading' && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="text-center">
                        <Loader2 className="h-4 w-4 animate-spin text-white mx-auto mb-0.5" />
                        <div className="text-[10px] text-white font-medium">
                          {file.uploadProgress || 0}%
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Status indicator overlay */}
                  {file.status && file.status !== 'uploading' && (
                    <div className="absolute top-1 left-1">
                      <div
                        className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium border ${statusInfo.className}`}
                      >
                        <StatusIcon
                          className={`w-2 h-2 ${statusInfo.iconClassName}`}
                        />
                        <span className="hidden sm:inline">
                          {statusInfo.text}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* File info */}
                <div className="p-2 space-y-1">
                  <div className="space-y-0.5">
                    <p
                      className="text-xs font-medium truncate dark:text-white leading-tight"
                      title={file.name}
                    >
                      {file.name}
                    </p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                      {formatFileSize(file)}
                    </p>
                  </div>

                  {/* Progress bar for uploading files */}
                  {file.status === 'uploading' && (
                    <div className="space-y-0.5">
                      <Progress
                        value={file.uploadProgress || 0}
                        className="h-1"
                      />
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-blue-600 dark:text-blue-400 font-medium truncate">
                          {statusInfo.text}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400 ml-1">
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
