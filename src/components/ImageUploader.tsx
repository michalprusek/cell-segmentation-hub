import React, { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/useLanguage';
import DropZone from '@/components/upload/DropZone';
import FileList, { FileWithPreview } from '@/components/upload/FileList';
import UploaderOptions from '@/components/upload/UploaderOptions';
import { logger } from '@/lib/logger';

interface ImageUploaderProps {
  onUploadComplete?: () => void;
}

const ImageUploader = ({ onUploadComplete }: ImageUploaderProps) => {
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const { t } = useLanguage();
  const currentProjectId = params.id;

  useEffect(() => {
    if (currentProjectId) {
      logger.debug(
        '📍 ImageUploader: Setting project ID from URL:',
        currentProjectId
      );
      setProjectId(currentProjectId);
    }
  }, [currentProjectId]);

  const handleUpload = useCallback(
    async (filesToUpload: FileWithPreview[], selectedProjectId: string) => {
      if (!selectedProjectId || filesToUpload.length === 0) {
        return;
      }

      setIsUploading(true);
      setUploadProgress(0);

      try {
        // Create a unique identifier for each file to track them
        const fileIdentifiers = filesToUpload.map(f => `${f.name}_${f.size}`);

        // Mark all files as uploading
        setFiles(prev =>
          prev.map(f => {
            const fileId = `${f.name}_${f.size}`;
            if (fileIdentifiers.includes(fileId)) {
              return { ...f, status: 'uploading' as const, uploadProgress: 0 };
            }
            return f;
          })
        );

        // Upload with progress tracking
        const uploadedImages = await apiClient.uploadImages(
          selectedProjectId,
          filesToUpload,
          progressPercent => {
            // Update overall progress
            setUploadProgress(progressPercent);

            // Update individual file progress
            setFiles(prev =>
              prev.map(f => {
                const fileId = `${f.name}_${f.size}`;
                if (fileIdentifiers.includes(fileId)) {
                  return { ...f, uploadProgress: progressPercent };
                }
                return f;
              })
            );
          }
        );

        logger.debug('Upload successful:', uploadedImages);

        // Mark all uploaded files as complete
        setFiles(prev =>
          prev.map(f => {
            const fileId = `${f.name}_${f.size}`;
            if (fileIdentifiers.includes(fileId)) {
              return {
                ...f,
                status: 'complete' as const,
                uploadProgress: 100,
              };
            }
            return f;
          })
        );

        setUploadProgress(100);

        // Show success message
        toast.success(
          `${t('images.imagesUploaded')}: ${uploadedImages.length}`
        );

        // If we have a callback, call it (used when embedded in ProjectDetail)
        if (onUploadComplete) {
          logger.debug(
            '✅ Upload complete - calling onUploadComplete callback'
          );
          await onUploadComplete();
          logger.debug('✅ onUploadComplete callback finished');
        } else {
          // Otherwise navigate (used when on standalone upload page)
          logger.debug(
            '⚠️ No onUploadComplete callback - navigating to project page'
          );
          await new Promise(resolve => setTimeout(resolve, 100));
          logger.debug(`Navigating to project: /project/${selectedProjectId}`);
          navigate(`/project/${selectedProjectId}`, { replace: true });
        }
      } catch (error) {
        logger.error('Upload error:', error);

        // Mark all files as error
        const fileIdentifiers = filesToUpload.map(f => `${f.name}_${f.size}`);
        setFiles(prev =>
          prev.map(f => {
            const fileId = `${f.name}_${f.size}`;
            if (fileIdentifiers.includes(fileId)) {
              return { ...f, status: 'error' as const, uploadProgress: 0 };
            }
            return f;
          })
        );

        setUploadProgress(0);
        toast.error(`${t('images.imagesFailed')}: ${filesToUpload.length}`);
      } finally {
        setIsUploading(false);
      }
    },
    [navigate, t, onUploadComplete]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (!projectId) {
        toast.error(t('images.selectProjectFirst'));
        return;
      }

      const newFiles = acceptedFiles.map(file =>
        Object.assign(file, {
          preview: URL.createObjectURL(file),
          uploadProgress: 0,
          status: 'pending' as const,
        })
      );

      setFiles(prev => [...prev, ...newFiles]);

      if (projectId) {
        handleUpload(newFiles, projectId);
      }
    },
    [handleUpload, projectId, t]
  );

  const removeFile = (file: FileWithPreview) => {
    URL.revokeObjectURL(file.preview || '');
    setFiles(files.filter(f => f !== file));

    const completedFiles = files.filter(f => f.status === 'complete').length;
    const newProgress =
      files.length > 1
        ? Math.round((completedFiles / (files.length - 1)) * 100)
        : 0;
    setUploadProgress(newProgress);
  };

  const handleProjectChange = (value: string) => {
    setProjectId(value);
  };

  useEffect(() => {
    return () => {
      files.forEach(file => URL.revokeObjectURL(file.preview || ''));
    };
  }, [files]);

  return (
    <div className="space-y-6">
      <UploaderOptions
        showProjectSelector={!currentProjectId}
        projectId={projectId}
        onProjectChange={handleProjectChange}
      />

      <DropZone
        disabled={!projectId}
        onDrop={onDrop}
        isDragActive={isDragActive}
      />

      <FileList
        files={files}
        uploadProgress={uploadProgress}
        onRemoveFile={removeFile}
      />
    </div>
  );
};

export default ImageUploader;
