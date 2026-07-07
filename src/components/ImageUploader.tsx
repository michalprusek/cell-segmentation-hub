import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/useLanguage';
import { useUpload } from '@/contexts/useUpload';
import DropZone from '@/components/upload/DropZone';
import UploaderOptions from '@/components/upload/UploaderOptions';
import { Checkbox } from '@/components/ui/checkbox';
import { apiClient } from '@/lib/api';
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

  // Channel registration is a microtubule-only feature, so we need the
  // project's type to decide whether to offer it. Fetched reactively by
  // projectId (works both on a project page and after picking a project in
  // the dashboard dropdown); cached briefly to avoid a refetch per drop.
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => apiClient.getProject(projectId as string),
    enabled: !!projectId,
    staleTime: 60_000,
  });
  const isMicrotubuleProject = project?.type === 'microtubules';

  // Opt-in (default off): the user is prompted per the requirement rather than
  // silently registering every upload.
  const [registerChannels, setRegisterChannels] = useState(false);

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
      // registerChannels only takes effect for MT projects (and the backend
      // re-gates by project type), so a stale toggle can't leak to others.
      startUpload(
        projectId,
        acceptedFiles,
        undefined,
        onUploadComplete,
        isMicrotubuleProject && registerChannels
      );
    },
    [
      projectId,
      t,
      startUpload,
      onUploadComplete,
      isMicrotubuleProject,
      registerChannels,
    ]
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

      {isMicrotubuleProject && (
        <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 cursor-pointer">
          <Checkbox
            checked={registerChannels}
            onCheckedChange={v => setRegisterChannels(v === true)}
            disabled={isUploading}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {t('images.registerChannels.label')}
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {t('images.registerChannels.help')}
            </span>
          </span>
        </label>
      )}

      <DropZone disabled={!projectId || isUploading} onDrop={onDrop} />

      {isUploading && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-xs text-blue-700 dark:text-blue-300">
            <strong>{t('images.uploadProgress')}:</strong>{' '}
            {t('images.upload.inProgress') ||
              'Upload in progress. You can navigate away — check progress in the bottom-right corner.'}
          </p>
        </div>
      )}
    </div>
  );
};

export default ImageUploader;
