/* eslint-disable react-refresh/only-export-components -- context co-locates hook with provider */
import React, {
  createContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { useWebSocket } from '@/contexts/useWebSocket';
import { logger } from '@/lib/logger';
import { ChunkProgress, DEFAULT_CHUNKING_CONFIG } from '@/lib/uploadUtils';

export interface UploadSession {
  id: string;
  projectId: string;
  projectName?: string;
  status: 'uploading' | 'completed' | 'failed' | 'cancelled';
  totalFiles: number;
  successCount: number;
  failedCount: number;
  overallProgress: number; // 0-100
  chunkProgress: ChunkProgress | null;
  currentOperation: string;
  startedAt: number;
  error?: string;
}

interface UploadContextType {
  sessions: Record<string, UploadSession>;
  activeSession: UploadSession | null;
  isUploading: boolean;
  startUpload: (
    projectId: string,
    files: File[],
    projectName?: string,
    onComplete?: () => void
  ) => string;
  cancelUpload: (sessionId?: string) => void;
  clearSession: (sessionId: string) => void;
}

export const UploadContext = createContext<UploadContextType | null>(null);

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [sessions, setSessions] = useState<Record<string, UploadSession>>({});
  const { socket } = useWebSocket();

  // AbortController in a ref — NOT using useAbortController hook to avoid
  // auto-abort on unmount. The context provider lives at the app root and
  // never unmounts during navigation, but this makes it explicit.
  const abortControllerRef = useRef<AbortController | null>(null);

  // Completion callback stored in ref so it doesn't trigger re-renders
  const onCompleteRef = useRef<(() => void) | null>(null);

  // Track active session ID
  const activeSessionIdRef = useRef<string | null>(null);

  // Derive active session from state — memoized to avoid
  // Object.values().find() on every render
  const activeSession = useMemo(
    () => Object.values(sessions).find(s => s.status === 'uploading') ?? null,
    [sessions]
  );
  const isUploading = activeSession !== null;

  // Warn user when closing tab during upload
  useEffect(() => {
    if (!isUploading) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isUploading]);

  // WebSocket listeners for upload progress
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
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;

      setSessions(prev => {
        const session = prev[sessionId];
        if (!session || session.status !== 'uploading') return prev;

        const newProgress = data.percentComplete;
        const shouldUpdate =
          newProgress === 100 ||
          newProgress === 0 ||
          Math.abs(newProgress - session.overallProgress) >= 1;

        if (!shouldUpdate) return prev;

        let currentOperation = session.currentOperation;
        if (data.currentFileStatus === 'uploading') {
          currentOperation = `Uploading ${data.filename} (${data.filesCompleted + 1}/${data.filesTotal})`;
        } else if (data.currentFileStatus === 'processing') {
          currentOperation = `Processing ${data.filename} (${data.filesCompleted + 1}/${data.filesTotal})`;
        }

        const successCount =
          data.currentFileStatus === 'completed'
            ? data.filesCompleted
            : session.successCount;

        return {
          ...prev,
          [sessionId]: {
            ...session,
            overallProgress: Math.max(session.overallProgress, newProgress),
            currentOperation,
            successCount,
          },
        };
      });
    };

    const handleUploadCompleted = (data: {
      summary: {
        totalFiles: number;
        successCount: number;
        failedCount: number;
      };
    }) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;

      logger.info('Upload batch completed via WebSocket:', data.summary);

      setSessions(prev => {
        const session = prev[sessionId];
        // Don't update already-completed/failed/cancelled sessions
        if (!session || session.status !== 'uploading') return prev;
        return {
          ...prev,
          [sessionId]: {
            ...session,
            successCount: data.summary.successCount,
            failedCount: data.summary.failedCount,
            currentOperation: `Upload completed: ${data.summary.successCount} successful, ${data.summary.failedCount} failed`,
          },
        };
      });
    };

    socket.on('uploadProgress', handleUploadProgress);
    socket.on('uploadCompleted', handleUploadCompleted);

    return () => {
      socket.off('uploadProgress', handleUploadProgress);
      socket.off('uploadCompleted', handleUploadCompleted);
    };
  }, [socket, isUploading]);

  const startUpload = useCallback(
    (
      projectId: string,
      files: File[],
      projectName?: string,
      onComplete?: () => void
    ): string => {
      const sessionId = `upload_${Date.now()}`;

      // Check for duplicate uploads using functional state update to read
      // the latest state — avoids stale closure issues since sessions is
      // NOT in the dependency array.
      let duplicateId: string | null = null;
      setSessions(prev => {
        const existingSession = Object.values(prev).find(
          s => s.projectId === projectId && s.status === 'uploading'
        );
        if (existingSession) {
          duplicateId = existingSession.id;
          return prev; // No state change
        }

        // Create session inline within the updater
        return {
          ...prev,
          [sessionId]: {
            id: sessionId,
            projectId,
            projectName,
            status: 'uploading' as const,
            totalFiles: files.length,
            successCount: 0,
            failedCount: 0,
            overallProgress: 0,
            chunkProgress: null,
            currentOperation: `Preparing to upload ${files.length} files...`,
            startedAt: Date.now(),
          },
        };
      });

      if (duplicateId) {
        toast.warning('An upload is already in progress for this project');
        return duplicateId;
      }

      // Create new AbortController
      abortControllerRef.current = new AbortController();
      onCompleteRef.current = onComplete ?? null;
      activeSessionIdRef.current = sessionId;

      // Run the actual upload asynchronously
      const doUpload = async () => {
        try {
          const signal = abortControllerRef.current?.signal;

          if (files.length > DEFAULT_CHUNKING_CONFIG.chunkSize) {
            // Chunked upload for large batches
            logger.info(
              `[UploadContext] Starting chunked upload of ${files.length} files`
            );

            const result = await apiClient.uploadImagesChunked(
              projectId,
              files,
              progressPercent => {
                setSessions(prev => {
                  const s = prev[sessionId];
                  if (!s || s.status !== 'uploading') return prev;
                  return {
                    ...prev,
                    [sessionId]: {
                      ...s,
                      overallProgress: Math.max(
                        s.overallProgress,
                        progressPercent
                      ),
                    },
                  };
                });
              },
              chunkProgressData => {
                setSessions(prev => {
                  const s = prev[sessionId];
                  if (!s || s.status !== 'uploading') return prev;
                  return {
                    ...prev,
                    [sessionId]: {
                      ...s,
                      chunkProgress: chunkProgressData,
                      currentOperation: chunkProgressData.currentOperation,
                      overallProgress: Math.max(
                        s.overallProgress,
                        chunkProgressData.overallProgress
                      ),
                    },
                  };
                });
              },
              signal
            );

            const uploadedCount = result.success.flat().length;
            const failedFileCount = result.failed.reduce(
              (sum, f) => sum + f.files.length,
              0
            );

            setSessions(prev => ({
              ...prev,
              [sessionId]: {
                ...prev[sessionId],
                status:
                  failedFileCount > 0 && uploadedCount === 0
                    ? 'failed'
                    : 'completed',
                overallProgress: 100,
                successCount: uploadedCount,
                failedCount: failedFileCount,
                chunkProgress: null,
                currentOperation:
                  failedFileCount > 0
                    ? `${uploadedCount} uploaded, ${failedFileCount} failed`
                    : `${uploadedCount} files uploaded successfully`,
              },
            }));

            if (failedFileCount > 0 && uploadedCount > 0) {
              toast.warning(
                `${uploadedCount} files uploaded, ${failedFileCount} failed`
              );
            } else if (failedFileCount === 0) {
              toast.success(`${uploadedCount} files uploaded successfully`);
            } else {
              toast.error(`Upload failed: ${failedFileCount} files`);
            }
          } else {
            // Regular upload for small batches
            logger.info(
              `[UploadContext] Starting regular upload of ${files.length} files`
            );

            setSessions(prev => ({
              ...prev,
              [sessionId]: {
                ...prev[sessionId],
                currentOperation: `Uploading ${files.length} files...`,
              },
            }));

            const uploadedImages = await apiClient.uploadImages(
              projectId,
              files,
              progressPercent => {
                setSessions(prev => {
                  const s = prev[sessionId];
                  if (!s || s.status !== 'uploading') return prev;
                  return {
                    ...prev,
                    [sessionId]: {
                      ...s,
                      overallProgress: progressPercent,
                    },
                  };
                });
              }
            );

            setSessions(prev => ({
              ...prev,
              [sessionId]: {
                ...prev[sessionId],
                status: 'completed',
                overallProgress: 100,
                successCount: uploadedImages.length,
                currentOperation: `${uploadedImages.length} files uploaded successfully`,
              },
            }));

            toast.success(
              `${uploadedImages.length} files uploaded successfully`
            );
          }

          // Fire completion callback
          if (onCompleteRef.current) {
            onCompleteRef.current();
          }
        } catch (error: any) {
          const wasCancelled =
            error?.name === 'AbortError' ||
            error?.message?.toLowerCase().includes('abort') ||
            error?.message?.toLowerCase().includes('cancelled') ||
            error?.code === 'ERR_CANCELED';

          if (wasCancelled) {
            setSessions(prev => ({
              ...prev,
              [sessionId]: {
                ...prev[sessionId],
                status: 'cancelled',
                currentOperation: 'Upload cancelled',
                chunkProgress: null,
              },
            }));
            toast.info('Upload cancelled');
          } else {
            logger.error('[UploadContext] Upload error:', error);
            setSessions(prev => ({
              ...prev,
              [sessionId]: {
                ...prev[sessionId],
                status: 'failed',
                error: error?.message || 'Upload failed',
                currentOperation: 'Upload failed',
                chunkProgress: null,
              },
            }));
            toast.error(`Upload failed: ${error?.message || 'Unknown error'}`);
          }
        } finally {
          // Release file references for GC and clear active session ref
          abortControllerRef.current = null;
          onCompleteRef.current = null;
          activeSessionIdRef.current = null;
        }
      };

      // Start asynchronously — don't await, let the upload run in background
      doUpload();

      return sessionId;
    },
    [] // No dependencies — uses functional setSessions to read latest state
  );

  const cancelUpload = useCallback(
    (sessionId?: string) => {
      const targetId = sessionId ?? activeSessionIdRef.current;
      if (!targetId) return;

      logger.info(`[UploadContext] Cancelling upload: ${targetId}`);

      // Abort the network request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Emit cancel event via WebSocket — read latest session from state
      setSessions(prev => {
        const session = prev[targetId];
        if (socket && session) {
          socket.emit('upload:cancel', {
            projectId: session.projectId,
            timestamp: Date.now(),
          });
        }
        return prev; // No state change
      });
    },
    [socket]
  );

  const clearSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    if (activeSessionIdRef.current === sessionId) {
      activeSessionIdRef.current = null;
    }
  }, []);

  // Memoize the context value to prevent unnecessary re-renders of all
  // consumers when parent re-renders but upload state hasn't changed.
  const contextValue = useMemo(
    () => ({
      sessions,
      activeSession,
      isUploading,
      startUpload,
      cancelUpload,
      clearSession,
    }),
    [
      sessions,
      activeSession,
      isUploading,
      startUpload,
      cancelUpload,
      clearSession,
    ]
  );

  return (
    <UploadContext.Provider value={contextValue}>
      {children}
    </UploadContext.Provider>
  );
};
