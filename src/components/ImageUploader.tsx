import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/useLanguage';
import { useUpload } from '@/contexts/useUpload';
import DropZone from '@/components/upload/DropZone';
import UploaderOptions from '@/components/upload/UploaderOptions';
import { logger } from '@/lib/logger';

interface ImageUploaderProps {
  onUploadComplete?: () => void;
}

const ImageUploader = ({ onUploadComplete }: ImageUploaderProps) => {
  const [projectId, setProjectId] = useState<string | null>(null);
  const params = useParams();
  const { t } = useLanguage();
  const { startUpload, isUploading } = useUpload();
  const currentProjectId = params.id;

  useEffect(() => {
    if (currentProjectId) {
      logger.debug(
        'ImageUploader: Setting project ID from URL:',
        currentProjectId
      );
      setProjectId(currentProjectId);
    }
  }, [currentProjectId]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (!projectId) {
        toast.error(t('images.selectProjectFirst'));
        return;
      }

      // Pass raw File objects directly to context — no staging needed.
      // The FloatingUploadProgress component shows upload status globally.
      startUpload(projectId, acceptedFiles, undefined, onUploadComplete);
    },
    [projectId, t, startUpload, onUploadComplete]
  );

  const handleProjectChange = useCallback((value: string) => {
    setProjectId(value);
  }, []);

  return (
    <div className="space-y-6">
      <UploaderOptions
        showProjectSelector={!currentProjectId}
        projectId={projectId}
        onProjectChange={handleProjectChange}
      />

      <DropZone disabled={!projectId || isUploading} onDrop={onDrop} />

      {isUploading && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-xs text-blue-700 dark:text-blue-300">
            <strong>{t('images.uploadProgress')}:</strong>{' '}
            {t('images.uploadInProgress') ||
              'Upload in progress. You can navigate away — check progress in the bottom-right corner.'}
          </p>
        </div>
      )}
    </div>
  );
};

export default ImageUploader;
