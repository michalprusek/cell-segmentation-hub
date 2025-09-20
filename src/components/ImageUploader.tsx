import React, { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/useLanguage';
import { useWebSocket } from '@/contexts/useWebSocket';
import DropZone from '@/components/upload/DropZone';
import FileList, { FileWithPreview } from '@/components/upload/FileList';
import UploaderOptions from '@/components/upload/UploaderOptions';
import { logger } from '@/lib/logger';
import { ChunkProgress, DEFAULT_CHUNKING_CONFIG } from '@/lib/uploadUtils';

interface ImageUploaderProps {
  onUploadComplete?: () => void;
}

const ImageUploader = ({ onUploadComplete }: ImageUploaderProps) => {
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragActive, _setIsDragActive] = useState(false);
  const [_chunkProgress, setChunkProgress] = useState<ChunkProgress | null>(
    null
  );
  const [_currentOperation, setCurrentOperation] = useState<string>('');
  const [uploadCancelled, setUploadCancelled] = useState(false);
  const { user: _user } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const { t } = useLanguage();
  const { socket } = useWebSocket();
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

      // Update individual file progress
      setFiles(prev =>
        prev.map(f => {
          if (f.name === data.filename && f.size === data.fileSize) {
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

      setIsUploading(true);
      setUploadProgress(0);
      setUploadCancelled(false); // Reset cancellation state

      try {
        // Early cancellation check
        if (uploadCancelled) {
          logger.info('Upload cancelled before start');
          return;
        }
        // Create a unique identifier for each file to track them
        const fileIdentifiers = filesToUpload.map(f => `${f.name}_${f.size}`);

        // Mark all files as uploading - preserve all File properties
        setFiles(prev =>
          prev.map(f => {
            const fileId = `${f.name}_${f.size}`;
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

        // Smart chunking decision: consider both file count AND payload size
        const totalPayloadSize = filesToUpload.reduce(
          (sum, file) => sum + file.size,
          0
        );
        const maxPayloadSize = 40 * 1024 * 1024; // 40MB safety limit (below 50MB Express limit)
        const shouldUseChunking =
          filesToUpload.length > DEFAULT_CHUNKING_CONFIG.chunkSize ||
          totalPayloadSize > maxPayloadSize;

        if (shouldUseChunking) {
          setCurrentOperation(
            `Preparing to upload ${filesToUpload.length} files in chunks...`
          );
          logger.info(`Using chunked upload for ${filesToUpload.length} files`);

          const result = await apiClient.uploadImagesChunked(
            selectedProjectId,
            filesToUpload,
            progressPercent => {
              // For smooth updates, only update if the new progress is higher
              setUploadProgress(prev => Math.max(prev, progressPercent));
            },
            chunkProgressData => {
              setChunkProgress(chunkProgressData);
              setCurrentOperation(chunkProgressData.currentOperation);

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
                  const fileId = `${f.name}_${f.size}`;
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
          logger.info(
            `Using regular upload for ${filesToUpload.length} files (${(totalPayloadSize / (1024 * 1024)).toFixed(1)}MB payload)`
          );

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
                  const fileId = `${f.name}_${f.size}`;
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

        // Mark all files as error
        const fileIdentifiers = filesToUpload.map(f => `${f.name}_${f.size}`);
        setFiles(prev =>
          prev.map(f => {
            const fileId = `${f.name}_${f.size}`;
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
        toast.error(`${t('images.imagesFailed')}: ${filesToUpload.length}`);
      } finally {
        setIsUploading(false);
      }
    },
    [navigate, t, onUploadComplete, uploadCancelled]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (!projectId) {
        toast.error(t('images.selectProjectFirst'));
        return;
      }

      // Enhanced file processing that preserves native File properties
      const newFiles = acceptedFiles.map(file => {
        // Use direct property assignment to preserve native File object binding
        // This prevents "TypeError: Illegal invocation" by maintaining proper context
        const enhancedFile = file as FileWithPreview;

        // Add custom properties directly to the native File object
        enhancedFile.preview = URL.createObjectURL(file);
        enhancedFile.uploadProgress = 0;
        enhancedFile.status = 'pending' as const;
        enhancedFile.originalSize = file.size; // Backup size property

        return enhancedFile;
      });

      setFiles(prev => [...prev, ...newFiles]);

      if (projectId) {
        handleUpload(newFiles, projectId);
      }
    },
    [handleUpload, projectId, t]
  );

  const removeFile = useCallback((file: FileWithPreview) => {
    URL.revokeObjectURL(file.preview || '');

    setFiles(prev => {
      const filteredFiles = prev.filter(f => f !== file);

      // Calculate progress using the current state, not stale closure
      const completedFiles = filteredFiles.filter(
        f => f.status === 'complete'
      ).length;
      const newProgress =
        filteredFiles.length > 0
          ? Math.round((completedFiles / filteredFiles.length) * 100)
          : 0;

      // Update progress after state calculation
      setUploadProgress(newProgress);

      return filteredFiles;
    });
  }, []);

  const handleCancelUpload = useCallback(async () => {
    setUploadCancelled(true);
    setIsUploading(false);
    setUploadProgress(0);
    setCurrentOperation('Cancelling upload and cleaning up...');

    try {
      // Find files that were successfully uploaded (status: complete)
      const completedFiles = files.filter(file => file.status === 'complete');

      if (completedFiles.length > 0 && projectId) {
        logger.info(
          `Cleaning up ${completedFiles.length} uploaded images from cancelled batch`
        );

        // Get image IDs for cleanup - we'll need to fetch them from the project
        // Since we don't store image IDs in the file objects, we'll use the batch deletion API
        // by project ID and file names/sizes to identify the images to delete
        try {
          // For now, just log what we would delete - the actual cleanup would require
          // either storing image IDs during upload or implementing a cleanup endpoint
          // that can delete by filename/size combinations
          logger.warn(
            'Upload cancelled - manual cleanup may be required for:',
            {
              projectId,
              uploadedFiles: completedFiles.map(f => ({
                name: f.name,
                size: f.size || f.originalSize,
              })),
            }
          );

          toast.warning(
            t('images.uploadCancelledWithCleanup') ||
              `Upload cancelled. ${completedFiles.length} uploaded files may need manual cleanup.`
          );
        } catch (cleanupError) {
          logger.error('Failed to cleanup uploaded files:', cleanupError);
          toast.error(
            t('images.uploadCancelledCleanupFailed') ||
              'Upload cancelled but failed to clean up uploaded files'
          );
        }
      } else {
        toast.info(t('images.uploadCancelled') || 'Upload cancelled');
      }
    } catch (error) {
      logger.error('Error during upload cancellation:', error);
      toast.error('Error cancelling upload');
    }

    // Reset all files to pending state
    setFiles(prev =>
      prev.map(file => ({
        ...file,
        status: 'pending' as const,
        uploadProgress: 0,
      }))
    );

    setCurrentOperation('');
    logger.info('Upload cancelled by user');
  }, [t, files, projectId]);

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
        isUploading={isUploading}
        onRemoveFile={removeFile}
        onCancelUpload={handleCancelUpload}
      />
    </div>
  );
};

export default ImageUploader;
