import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ImagePlus, FileX, CheckCircle, X, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { UniversalCancelButton } from '@/components/ui/universal-cancel-button';
import { FileWithPreview, getFileSize } from '@/lib/fileUtils';

interface FileListProps {
  files: FileWithPreview[];
  uploadProgress: number;
  isUploading?: boolean;
  isCancelling?: boolean;
  onRemoveFile: (file: FileWithPreview) => void;
  onCancelUpload?: () => void;
  onStartUpload?: () => void;
}

const FileList = ({
  files,
  uploadProgress,
  isUploading = false,
  isCancelling = false,
  onRemoveFile,
  onCancelUpload,
  onStartUpload,
}: FileListProps) => {
  const { t } = useLanguage();

  if (files.length === 0) return null;

  // Use shared file size utility
  // Removed duplicate formatFileSize function - now using getFileSize from shared utils

  return (
    <div className="space-y-4 bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isUploading && (
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          )}
          <h3 className="text-sm font-medium dark:text-white">
            {isUploading
              ? t('images.uploadProgress')
              : t('images.readyToUpload')}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {isUploading ? `${uploadProgress}%` : `${files.length} files`}
          </span>
          {files.length > 0 && onStartUpload && onCancelUpload && (
            <UniversalCancelButton
              operationType="upload"
              isOperationActive={isUploading}
              isCancelling={isCancelling}
              onCancel={onCancelUpload}
              onPrimaryAction={onStartUpload}
              primaryText={t('common.upload')}
              size="sm"
            />
          )}
        </div>
      </div>

      <Progress value={uploadProgress} className="h-2" />

      <div className="space-y-4 mt-6">
        <h3 className="text-sm font-medium dark:text-white">
          Files ({files.length})
        </h3>

        <div className="space-y-2">
          {files.map((file, index) => (
            <Card
              key={index}
              className="p-3 dark:bg-gray-800 dark:border-gray-700"
            >
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
                  <p className="text-sm font-medium truncate dark:text-white">
                    {file.name}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {getFileSize(file)}
                    </p>
                    {file.status === 'uploading' &&
                      file.uploadProgress !== undefined && (
                        <p className="text-xs text-blue-500 font-medium">
                          {file.uploadProgress}%
                        </p>
                      )}
                  </div>
                  {file.status === 'uploading' && (
                    <Progress
                      value={file.uploadProgress || 0}
                      className="h-1 mt-1"
                    />
                  )}
                </div>

                <div className="flex-shrink-0 flex items-center">
                  {file.status === 'pending' && (
                    <span className="text-sm text-yellow-500">
                      {t('images.pending')}
                    </span>
                  )}
                  {file.status === 'uploading' && (
                    <span className="text-sm text-blue-500">
                      {t('images.uploading')}
                    </span>
                  )}
                  {file.status === 'complete' && (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  )}
                  {file.status === 'error' && (
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
