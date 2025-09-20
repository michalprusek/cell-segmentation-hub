import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/useLanguage';
import { useWebSocket } from '@/contexts/useWebSocket';
import DropZone from '@/components/upload/DropZone';
import UploadFileGrid from '@/components/upload/UploadFileGrid';
import UploaderOptions from '@/components/upload/UploaderOptions';
import { logger } from '@/lib/logger';
import { ChunkProgress, DEFAULT_CHUNKING_CONFIG } from '@/lib/uploadUtils';
import { useAbortController } from '@/hooks/shared/useAbortController';
import { useOperationManager } from '@/hooks/shared/useOperationManager';
import { UniversalCancelButton as _UniversalCancelButton } from '@/components/ui/universal-cancel-button';
import {
  FileWithPreview,
  createFileWithPreview,
  getFileIdentifier,
  filesMatch,
} from '@/lib/fileUtils';

interface ImageUploaderProps {
  onUploadComplete?: () => void;
}

const ImageUploader = ({ onUploadComplete }: ImageUploaderProps) => {
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDragActive, _setIsDragActive] = useState(false);
  const [_chunkProgress, setChunkProgress] = useState<ChunkProgress | null>(
    null
  );
  const [_currentOperation, setCurrentOperation] = useState<string>('');
  const { user: _user } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const { t } = useLanguage();
  const { socket } = useWebSocket();
  const { getSignal, abort } = useAbortController('upload');
  const operationManager = useOperationManager();
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

  // Listen for WebSocket upload progress events
  useEffect(() => {
    if (!socket || !isUploading) return;

    const handleUploadProgress = (data: {
      filename: string;
      fileSize: number;
      progress: number;
      currentFileStatus: 'uploading' | 'processing' | 'completed' | 'failed';
      filesCompleted: number;
      filesTotal: number;
      percentComplete: number;
    }) => {
      logger.debug('Received upload progress event:', data);

      // Update individual file progress using improved file matching
      setFiles(prev =>
        prev.map(f => {
          if (
            filesMatch(f, { filename: data.filename, fileSize: data.fileSize })
          ) {
            return {
              ...f,
              uploadProgress: data.progress,
              status:
                data.currentFileStatus === 'completed'
                  ? 'complete'
                  : data.currentFileStatus === 'failed'
                    ? 'error'
                    : 'uploading',
            };
          }
          return f;
        })
      );

      // Update overall progress - only if it's higher to prevent jumps
      setUploadProgress(prev => Math.max(prev, data.percentComplete));

      // Update operation message
      if (data.currentFileStatus === 'uploading') {
        setCurrentOperation(
          `Uploading ${data.filename} (${data.filesCompleted + 1}/${data.filesTotal})`
        );
      } else if (data.currentFileStatus === 'processing') {
        setCurrentOperation(
          `Processing ${data.filename} (${data.filesCompleted + 1}/${data.filesTotal})`
        );
      }
    };

    const handleUploadCompleted = (data: {
      summary: {
        totalFiles: number;
        successCount: number;
        failedCount: number;
      };
    }) => {
      logger.info('Upload batch completed:', data.summary);
      setCurrentOperation(
        `Upload completed: ${data.summary.successCount} successful, ${data.summary.failedCount} failed`
      );
    };

    // Listen for upload progress events
    socket.on('uploadProgress', handleUploadProgress);
    socket.on('uploadCompleted', handleUploadCompleted);

    return () => {
      socket.off('uploadProgress', handleUploadProgress);
      socket.off('uploadCompleted', handleUploadCompleted);
    };
  }, [socket, isUploading]);

  const handleUpload = useCallback(
    async (filesToUpload: FileWithPreview[], selectedProjectId: string) => {
      if (!selectedProjectId || filesToUpload.length === 0) {
        return;
      }

      const uploadId = `upload_${Date.now()}`;
      setIsUploading(true);
      setUploadProgress(0);
      setIsCancelling(false);

      // Start operation tracking
      operationManager.startOperation(uploadId, 'upload');

      try {
        // Create a unique identifier for each file to track them
        const fileIdentifiers = filesToUpload.map(f => getFileIdentifier(f));

        // Mark all files as uploading - preserve all File properties
        setFiles(prev =>
          prev.map(f => {
            const fileId = getFileIdentifier(f);
            if (fileIdentifiers.includes(fileId)) {
              return {
                ...f,
                status: 'uploading' as const,
                uploadProgress: 0,
              };
            }
            return f;
          })
        );

        let uploadedImages: Array<Record<string, unknown>> = [];

        // Use chunked upload for large batches, regular upload for small ones
        if (filesToUpload.length > DEFAULT_CHUNKING_CONFIG.chunkSize) {
          setCurrentOperation(
            `Preparing to upload ${filesToUpload.length} files in chunks...`
          );
          logger.info(`Using chunked upload for ${filesToUpload.length} files`);

          const result = await apiClient.uploadImagesChunked(
            selectedProjectId,
            filesToUpload,
            getSignal(), // Add abort signal
            progressPercent => {
              // For smooth updates, only update if the new progress is higher
              setUploadProgress(prev => Math.max(prev, progressPercent));
              // Update operation manager
              operationManager.updateOperationProgress(
                uploadId,
                progressPercent
              );
            },
            chunkProgressData => {
              setChunkProgress(chunkProgressData);
              setCurrentOperation(chunkProgressData.currentOperation);
              // Update operation manager with chunk progress
              operationManager.updateOperationProgress(
                uploadId,
                chunkProgressData.overallProgress,
                chunkProgressData.currentOperation
              );

              // Also update the overall progress from chunk data for smoother updates
              setUploadProgress(prev =>
                Math.max(prev, chunkProgressData.overallProgress)
              );

              // Update individual file progress based on chunk progress
              // Calculate which files are in the current chunk
              const chunkSize = DEFAULT_CHUNKING_CONFIG.chunkSize;
              const currentChunkStartIndex =
                chunkProgressData.chunkIndex * chunkSize;
              const currentChunkEndIndex = Math.min(
                currentChunkStartIndex + chunkSize,
                filesToUpload.length
              );

              setFiles(prev =>
                prev.map((f, fileIndex) => {
                  const fileId = getFileIdentifier(f);
                  if (fileIdentifiers.includes(fileId)) {
                    // Calculate individual file progress
                    if (fileIndex < currentChunkStartIndex) {
                      // Files in completed chunks
                      return {
                        ...f,
                        uploadProgress: 100,
                        status: 'complete' as const,
                      };
                    } else if (
                      fileIndex >= currentChunkStartIndex &&
                      fileIndex < currentChunkEndIndex
                    ) {
                      // Files in current chunk
                      return {
                        ...f,
                        uploadProgress: Math.floor(
                          chunkProgressData.chunkProgress
                        ),
                        status: 'uploading' as const,
                      };
                    } else {
                      // Files in pending chunks
                      return {
                        ...f,
                        uploadProgress: 0,
                        status: 'uploading' as const,
                      };
                    }
                  }
                  return f;
                })
              );
            }
          );

          // Flatten successful uploads from chunks
          uploadedImages = result.success.flat();

          // Handle any failed chunks
          if (result.failed.length > 0) {
            const failedFileCount = result.failed.reduce(
              (sum, failure) => sum + failure.files.length,
              0
            );
            logger.warn(
              `${result.failed.length} chunks failed, affecting ${failedFileCount} files`
            );

            // Show warning for failed uploads
            toast.warning(
              `${uploadedImages.length} files uploaded successfully, ${failedFileCount} failed`
            );
          }
        } else {
          setCurrentOperation(`Uploading ${filesToUpload.length} files...`);
          logger.info(`Using regular upload for ${filesToUpload.length} files`);

          // Use regular upload for small batches
          uploadedImages = await apiClient.uploadImages(
            selectedProjectId,
            filesToUpload,
            progressPercent => {
              // Update overall progress
              setUploadProgress(progressPercent);

              // Update individual file progress
              setFiles(prev =>
                prev.map(f => {
                  const fileId = getFileIdentifier(f);
                  if (fileIdentifiers.includes(fileId)) {
                    return {
                      ...f,
                      uploadProgress: progressPercent,
                    };
                  }
                  return f;
                })
              );
            }
          );
        }

        logger.debug('Upload successful:', uploadedImages);

        // Mark all uploaded files as complete
        setFiles(prev =>
          prev.map(f => {
            const fileId = getFileIdentifier(f);
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
        setCurrentOperation('Upload completed successfully!');
        setChunkProgress(null);

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

        // Check if it was cancelled
        const wasCancelled =
          error?.name === 'AbortError' || error?.message?.includes('abort');
        if (wasCancelled) {
          operationManager.completeOperation(
            uploadId,
            false,
            t('toast.upload.uploadCancelled')
          );
          toast.info(t('toast.upload.uploadCancelled'));
        } else {
          operationManager.completeOperation(uploadId, false, 'Upload failed');
        }

        // Mark all files as error
        const fileIdentifiers = filesToUpload.map(f => getFileIdentifier(f));
        setFiles(prev =>
          prev.map(f => {
            const fileId = getFileIdentifier(f);
            if (fileIdentifiers.includes(fileId)) {
              return {
                ...f,
                status: 'error' as const,
                uploadProgress: 0,
              };
            }
            return f;
          })
        );

        setUploadProgress(0);
        setCurrentOperation('');
        setChunkProgress(null);
        // Only show error toast if not cancelled (reusing existing wasCancelled variable)
        if (!wasCancelled) {
          toast.error(`${t('images.imagesFailed')}: ${filesToUpload.length}`);
        }
      } finally {
        setIsUploading(false);
        setIsCancelling(false);
      }
    },
    [navigate, t, onUploadComplete, operationManager, getSignal]
  );

  // Cancel upload function
  const handleCancelUpload = useCallback(async () => {
    if (!isUploading) return;

    setIsCancelling(true);
    try {
      // Abort the current upload
      abort();

      // Emit cancel event via WebSocket if available
      if (socket && projectId) {
        socket.emit('upload:cancel', {
          projectId,
          timestamp: Date.now(),
        });
      }

      logger.info('Upload cancelled by user');
    } catch (error) {
      logger.error('Failed to cancel upload:', error);
      setIsCancelling(false);
    }
  }, [isUploading, abort, socket, projectId]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (!projectId) {
        toast.error(t('images.selectProjectFirst'));
        return;
      }

      // Create FileWithPreview objects safely without mutation
      const newFiles = acceptedFiles.map(file => createFileWithPreview(file));

      setFiles(prev => [...prev, ...newFiles]);

      if (projectId) {
        handleUpload(newFiles, projectId);
      }
    },
    [handleUpload, projectId, t]
  );

  const removeFile = useCallback((file: FileWithPreview) => {
    URL.revokeObjectURL(file.preview || '');
    setFiles(prevFiles => {
      const newFiles = prevFiles.filter(f => f !== file);

      // Recalculate progress based on remaining files
      const completedFiles = newFiles.filter(
        f => f.status === 'complete'
      ).length;
      const newProgress =
        newFiles.length > 0
          ? Math.round((completedFiles / newFiles.length) * 100)
          : 0;
      setUploadProgress(newProgress);

      return newFiles;
    });
  }, []);

  const handleProjectChange = useCallback((value: string) => {
    setProjectId(value);
  }, []);

  // Memoize files to upload to avoid recalculation on every render
  const filesToUpload = useMemo(() => {
    return files.filter(f => f.status !== 'complete');
  }, [files]);

  // Memoized start upload handler
  const handleStartUpload = useCallback(() => {
    if (filesToUpload.length > 0 && projectId) {
      handleUpload(filesToUpload, projectId);
    }
  }, [filesToUpload, projectId, handleUpload]);

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

      <UploadFileGrid
        files={files}
        uploadProgress={uploadProgress}
        isUploading={isUploading}
        isCancelling={isCancelling}
        onRemoveFile={removeFile}
        onCancelUpload={handleCancelUpload}
        onStartUpload={handleStartUpload}
      />
    </div>
  );
};

export default ImageUploader;
