import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/useLanguage';
import { useUpload } from '@/contexts/useUpload';
import DropZone from '@/components/upload/DropZone';
import UploaderOptions from '@/components/upload/UploaderOptions';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

  // For MT projects we ask the user — right after they drop files — whether to
  // register the channels, instead of a persistent checkbox. The dropped files
  // wait here until they answer. `null` = no pending prompt.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

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
      // MT projects: ask explicitly whether to register channels before the
      // upload starts (backend re-gates to MT + multi-channel anyway). Other
      // project types have no channel registration, so upload straight away.
      if (isMicrotubuleProject) {
        setPendingFiles(acceptedFiles);
        return;
      }
      startUpload(projectId, acceptedFiles, undefined, onUploadComplete, false);
    },
    [projectId, t, startUpload, onUploadComplete, isMicrotubuleProject]
  );

  // Answer to the register-channels prompt → kick off the upload with the
  // chosen flag and clear the pending files.
  const beginUpload = useCallback(
    (registerChannels: boolean) => {
      if (!projectId || !pendingFiles) return;
      startUpload(
        projectId,
        pendingFiles,
        undefined,
        onUploadComplete,
        registerChannels
      );
      setPendingFiles(null);
    },
    [projectId, pendingFiles, startUpload, onUploadComplete]
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

      <DropZone
        disabled={!projectId || isUploading || pendingFiles !== null}
        onDrop={onDrop}
      />

      {isUploading && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-xs text-blue-700 dark:text-blue-300">
            <strong>{t('images.uploadProgress')}:</strong>{' '}
            {t('images.upload.inProgress') ||
              'Upload in progress. You can navigate away — check progress in the bottom-right corner.'}
          </p>
        </div>
      )}

      {/* MT-only: after a drop, ask whether to register channels. */}
      <AlertDialog
        open={pendingFiles !== null}
        onOpenChange={open => {
          if (!open) setPendingFiles(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('images.registerChannels.promptTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('images.registerChannels.help')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel onClick={() => setPendingFiles(null)}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <Button variant="outline" onClick={() => beginUpload(false)}>
              {t('images.registerChannels.decline')}
            </Button>
            <AlertDialogAction onClick={() => beginUpload(true)}>
              {t('images.registerChannels.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ImageUploader;
