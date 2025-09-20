import React, { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useLanguage } from '@/contexts/useLanguage';
import { UniversalCancelButton } from '@/components/ui/universal-cancel-button';
import { FileWithPreview } from '@/lib/fileUtils';
import UploadFileCard from './UploadFileCard';

interface UploadFileGridProps {
  files: FileWithPreview[];
  uploadProgress: number;
  isUploading?: boolean;
  isCancelling?: boolean;
  onRemoveFile: (file: FileWithPreview) => void;
  onCancelUpload?: () => void;
  onStartUpload?: () => void;
}

const UploadFileGrid: React.FC<UploadFileGridProps> = ({
  files,
  uploadProgress,
  isUploading = false,
  isCancelling = false,
  onRemoveFile,
  onCancelUpload,
  onStartUpload,
}) => {
  const { t } = useLanguage();

  if (files.length === 0) return null;

  // Memoize status counts for performance
  const statusCounts = useMemo(() => {
    return files.reduce(
      (acc, file) => {
        const status = file.status || 'pending';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [files]);

  return (
    <div className="space-y-4 bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
      {/* Header with overall progress */}
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

      {/* Overall progress bar */}
      <Progress value={uploadProgress} className="h-2" />

      {/* Status summary */}
      {isUploading && (
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          {statusCounts.complete > 0 && (
            <span className="text-green-600">
              ✓ {statusCounts.complete} completed
            </span>
          )}
          {statusCounts.uploading > 0 && (
            <span className="text-blue-600">
              ↑ {statusCounts.uploading} uploading
            </span>
          )}
          {statusCounts.pending > 0 && (
            <span className="text-yellow-600">
              ⏳ {statusCounts.pending} pending
            </span>
          )}
          {statusCounts.error > 0 && (
            <span className="text-red-600">✗ {statusCounts.error} failed</span>
          )}
        </div>
      )}

      {/* Files header */}
      <div className="flex items-center justify-between pt-2">
        <h3 className="text-sm font-medium dark:text-white">
          Files ({files.length})
        </h3>
        {!isUploading && files.length > 10 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {Math.ceil(files.length / 10)} rows
          </span>
        )}
      </div>

      {/* Responsive grid layout - approximately 10 cards per row */}
      <div
        className="grid gap-3 justify-items-start"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          justifyContent: 'center',
        }}
      >
        {files.map((file, index) => (
          <UploadFileCard
            key={`${file.name}-${file.size}-${index}`}
            file={file}
            onRemove={onRemoveFile}
          />
        ))}
      </div>

      {/* Upload tips for large batches */}
      {files.length > 50 && !isUploading && (
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-xs text-blue-700 dark:text-blue-300">
            💡 <strong>Large batch detected:</strong> Files will be uploaded in
            chunks for optimal performance. You can continue working while the
            upload runs in the background.
          </p>
        </div>
      )}
    </div>
  );
};

export default UploadFileGrid;
