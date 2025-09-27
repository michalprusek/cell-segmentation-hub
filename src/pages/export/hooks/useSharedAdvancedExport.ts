import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '@/lib/api';
import { useWebSocket } from '@/contexts/useWebSocket';
import { logger } from '@/lib/logger';
import { EXPORT_DEFAULTS } from '@/lib/export-config';
import {
  downloadFromResponse,
  canDownloadLargeFiles,
} from '@/lib/downloadUtils';
import ExportStateManager from '@/lib/exportStateManager';
import { useExportContext } from '@/contexts/ExportContext';
import { useAbortController } from '@/hooks/shared/useAbortController';
import { retryWithBackoff, RETRY_CONFIGS } from '@/lib/retryUtils';

// Sanitize filename to remove/replace invalid characters
const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid filename characters
    .replace(/[\s]+/g, '_') // Replace spaces with underscores
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
    .substring(0, 100); // Limit length to prevent issues
};

export interface ExportOptions {
  includeOriginalImages?: boolean;
  includeVisualizations?: boolean;
  visualizationOptions?: {
    showNumbers?: boolean;
    polygonColors?: {
      external?: string;
      internal?: string;
    };
    strokeWidth?: number;
    fontSize?: number;
    transparency?: number;
  };
  annotationFormats?: ('coco' | 'yolo' | 'json')[];
  metricsFormats?: ('excel' | 'csv' | 'json')[];
  includeDocumentation?: boolean;
  selectedImageIds?: string[];
  pixelToMicrometerScale?: number;
}

interface ExportJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message?: string;
  filePath?: string;
}

export const useSharedAdvancedExport = (
  projectId: string,
  projectName?: string
) => {
  const { updateExportState, getExportState } = useExportContext();

  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    includeOriginalImages: EXPORT_DEFAULTS.OPTIONS.INCLUDE_ORIGINAL_IMAGES,
    includeVisualizations: EXPORT_DEFAULTS.OPTIONS.INCLUDE_VISUALIZATIONS,
    visualizationOptions: {
      showNumbers: EXPORT_DEFAULTS.VISUALIZATION.SHOW_NUMBERS,
      polygonColors: {
        external: EXPORT_DEFAULTS.COLORS.EXTERNAL_POLYGON,
        internal: EXPORT_DEFAULTS.COLORS.INTERNAL_POLYGON,
      },
      strokeWidth: EXPORT_DEFAULTS.VISUALIZATION.STROKE_WIDTH,
      fontSize: EXPORT_DEFAULTS.VISUALIZATION.FONT_SIZE,
      transparency: EXPORT_DEFAULTS.VISUALIZATION.TRANSPARENCY,
    },
    annotationFormats: [...EXPORT_DEFAULTS.FORMATS.ANNOTATION],
    metricsFormats: [...EXPORT_DEFAULTS.FORMATS.METRICS],
    includeDocumentation: EXPORT_DEFAULTS.OPTIONS.INCLUDE_DOCUMENTATION,
  });

  const [createdBlobUrls, setCreatedBlobUrls] = useState<string[]>([]);
  const downloadedJobIds = useRef<Set<string>>(new Set());
  const downloadInProgress = useRef<boolean>(false);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(
    null
  );
  const [wsConnected, setWsConnected] = useState(false);
  const [currentProjectName, setCurrentProjectName] = useState<
    string | undefined
  >(projectName);

  const { socket } = useWebSocket();

  // Initialize AbortController for cancellable downloads
  const { getSignal, abort, abortAll, resetController, isAborted } =
    useAbortController('export');

  // Get current export state from context
  const exportState = getExportState(projectId);
  const isExporting = exportState?.isExporting || false;
  const isDownloading = exportState?.isDownloading || false;
  const exportProgress = exportState?.exportProgress || 0;
  const exportStatus = exportState?.exportStatus || '';
  const completedJobId = exportState?.completedJobId || null;
  const currentJob = exportState?.currentJob || null;

  // Update context when local state changes
  const updateState = useCallback(
    (updates: any) => {
      updateExportState(projectId, updates);
    },
    [projectId, updateExportState]
  );

  // Helper to get/set persistent download tracking
  const getDownloadedJobs = useCallback((): Set<string> => {
    const stored = localStorage.getItem(`exportDownloaded_${projectId}`);
    if (stored) {
      try {
        return new Set(JSON.parse(stored));
      } catch {
        return new Set();
      }
    }
    return new Set();
  }, [projectId]);

  const markJobAsDownloaded = useCallback(
    (jobId: string) => {
      const downloaded = getDownloadedJobs();
      downloaded.add(jobId);
      localStorage.setItem(
        `exportDownloaded_${projectId}`,
        JSON.stringify(Array.from(downloaded))
      );
      downloadedJobIds.current.add(jobId);
    },
    [projectId, getDownloadedJobs]
  );

  const clearDownloadedJobs = useCallback(() => {
    localStorage.removeItem(`exportDownloaded_${projectId}`);
    downloadedJobIds.current.clear();
  }, [projectId]);

  // Check resumed export status from server - defined early to avoid dependency issues
  const checkResumedExportStatus = useCallback(
    async (jobId: string) => {
      try {
        // Use deduplication to prevent multiple simultaneous requests for same job
        const response = await ExportStateManager.deduplicateRequest(
          jobId,
          () => apiClient.get(`/projects/${projectId}/export/${jobId}/status`)
        );
        const status = response.data;

        if (status.status === 'completed') {
          updateState({
            currentJob: currentJob
              ? { ...currentJob, status: 'completed' }
              : null,
            exportStatus: 'Export completed!',
            isExporting: false,
            completedJobId: jobId,
          });
        } else if (
          status.status === 'failed' ||
          status.status === 'cancelled'
        ) {
          updateState({
            currentJob: currentJob
              ? {
                  ...currentJob,
                  status: status.status,
                  message: status.message,
                }
              : null,
            exportStatus: `Export ${status.status}: ${status.message || 'Unknown error'}`,
            isExporting: false,
          });
          ExportStateManager.clearExportState(projectId);
        } else {
          // Still processing, continue monitoring
          updateState({
            exportProgress: status.progress || 0,
            exportStatus: `Processing... ${Math.round(status.progress || 0)}%`,
            currentJob: {
              id: jobId,
              status: 'processing',
              progress: status.progress || 0,
            },
          });
        }
      } catch (error) {
        logger.error('Failed to check resumed export status:', error);
        updateState({
          isExporting: false,
          exportStatus: 'Failed to resume export monitoring',
        });
        ExportStateManager.clearExportState(projectId);
      }
    },
    [projectId, updateState, currentJob]
  );

  // Update project name when it changes
  useEffect(() => {
    if (projectName && projectName !== currentProjectName) {
      setCurrentProjectName(projectName);
      logger.debug('Updated project name:', projectName);
    }
  }, [projectName, currentProjectName]);

  // Initialize from persisted state on mount
  useEffect(() => {
    if (!projectId) return;

    // Prevent multiple restorations
    let hasRestored = false;

    const restore = () => {
      if (hasRestored) return;
      hasRestored = true;

      // Load downloaded jobs from localStorage
      const persistedDownloaded = getDownloadedJobs();
      downloadedJobIds.current = persistedDownloaded;

      // Reset in-progress flag but keep downloaded jobs tracking
      downloadInProgress.current = false;
      logger.debug('Initialized download tracking from localStorage', {
        downloadedJobs: Array.from(persistedDownloaded),
      });

      const persistedState = ExportStateManager.getExportState(projectId);
      if (persistedState) {
        logger.info('Restoring export state from localStorage', persistedState);

        // Clear stale downloading states - they should not persist across page reloads
        // If the state was "downloading", it means the download was interrupted
        // and we should treat the export as completed but not downloaded
        if (persistedState.status === 'downloading') {
          logger.debug(
            'Clearing stale downloading state, treating as completed'
          );

          const restoredJob = {
            id: persistedState.jobId,
            status: 'completed' as const,
            progress: 100,
          };

          updateState({
            currentJob: restoredJob,
            completedJobId: persistedState.jobId,
            isDownloading: false, // Important: don't restore downloading state
            isExporting: false,
            exportProgress: 100,
            exportStatus: 'Export completed - ready to download',
          });

          // Clear the stale state from localStorage
          ExportStateManager.clearExportState(projectId);
        } else if (
          persistedState.status === 'exporting' ||
          persistedState.status === 'processing'
        ) {
          const restoredJob = {
            id: persistedState.jobId,
            status: 'processing' as const,
            progress: persistedState.progress,
          };

          updateState({
            currentJob: restoredJob,
            isExporting: true,
            exportProgress: persistedState.progress,
            exportStatus:
              persistedState.exportStatus ||
              `Processing... ${Math.round(persistedState.progress)}%`,
          });

          // Check current status from server
          checkResumedExportStatus(persistedState.jobId);
        } else if (persistedState.status === 'completed') {
          // Check if this job was already downloaded
          const wasDownloaded = persistedDownloaded.has(persistedState.jobId);

          if (!wasDownloaded) {
            // Restore completed state properly
            const restoredJob = {
              id: persistedState.jobId,
              status: 'completed' as const,
              progress: 100,
            };

            updateState({
              currentJob: restoredJob,
              completedJobId: persistedState.jobId,
              isDownloading: false,
              isExporting: false,
              exportProgress: 100,
              exportStatus: 'Export completed - ready to download',
            });
          } else {
            // Job was already downloaded, clear the state
            logger.info('Export job was already downloaded, clearing state');
            ExportStateManager.clearExportState(projectId);
          }
        }
      }
    };

    // Call restore function once
    restore();
  }, [projectId, checkResumedExportStatus, updateState, getDownloadedJobs]);

  // Persist state changes to localStorage
  useEffect(() => {
    if (!projectId) return;

    if (isExporting && currentJob) {
      // Use throttled save for frequent progress updates
      ExportStateManager.saveExportStateThrottled(projectId, {
        projectId,
        jobId: currentJob.id,
        status: 'exporting',
        startedAt: Date.now(),
        progress: exportProgress,
        exportStatus: exportStatus,
      });
    } else if (isDownloading && completedJobId) {
      // Use immediate save for download state (less frequent)
      ExportStateManager.saveExportState(projectId, {
        projectId,
        jobId: completedJobId,
        status: 'downloading',
        startedAt: Date.now(),
        progress: 100,
        exportStatus: 'Download ready',
      });
    } else if (!isExporting && !isDownloading) {
      // Clear state when neither exporting nor downloading
      ExportStateManager.clearExportState(projectId);
    }
  }, [
    isExporting,
    isDownloading,
    currentJob,
    completedJobId,
    exportProgress,
    exportStatus,
    projectId,
  ]);

  // Cleanup blob URLs and polling interval on unmount
  useEffect(() => {
    return () => {
      createdBlobUrls.forEach(url => {
        window.URL.revokeObjectURL(url);
      });
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [createdBlobUrls, pollingInterval]);

  // Monitor WebSocket connection
  useEffect(() => {
    if (socket) {
      const handleConnect = () => setWsConnected(true);
      const handleDisconnect = () => setWsConnected(false);

      setWsConnected(socket.connected);
      socket.on('connect', handleConnect);
      socket.on('disconnect', handleDisconnect);

      return () => {
        socket.off('connect', handleConnect);
        socket.off('disconnect', handleDisconnect);
      };
    }
  }, [socket]);

  // Listen for WebSocket updates
  useEffect(() => {
    if (!socket || !currentJob) return;

    const handleProgress = (data: {
      jobId: string;
      progress: number;
      phase?: 'processing' | 'downloading';
      stage?: string;
      message?: string;
      stageProgress?: { current: number; total: number; currentItem?: string };
    }) => {
      if (data.jobId === currentJob.id) {
        // Use server-provided message or construct one from stage progress
        let statusMessage = data.message;
        if (!statusMessage && data.stageProgress) {
          const { current, total, currentItem } = data.stageProgress;
          statusMessage = `Processing ${current} of ${total}${currentItem ? `: ${currentItem}` : ''}... ${Math.round(data.progress)}%`;
        } else if (!statusMessage) {
          statusMessage = `${data.phase === 'downloading' ? 'Downloading' : 'Processing'}... ${Math.round(data.progress)}%`;
        }

        updateState({
          exportProgress: data.progress,
          exportStatus: statusMessage,
          // Update downloading state based on phase
          isDownloading: data.phase === 'downloading',
        });
      }
    };

    const handleCompleted = (data: { jobId: string }) => {
      if (data.jobId === currentJob.id) {
        updateState({
          currentJob: currentJob
            ? { ...currentJob, status: 'completed' }
            : null,
          exportStatus: 'Export completed! Starting download...',
          isExporting: false,
          completedJobId: data.jobId,
        });
      }
    };

    const handleFailed = (data: { jobId: string; error: string }) => {
      if (data.jobId === currentJob.id) {
        updateState({
          currentJob: currentJob
            ? { ...currentJob, status: 'failed', message: data.error }
            : null,
          exportStatus: `Export failed: ${data.error}`,
          isExporting: false,
        });
        // Clear persisted state on failure
        ExportStateManager.clearExportState(projectId);
      }
    };

    // Listen for export cancellation acknowledgment
    const handleCancelled = (data: { jobId: string; message?: string }) => {
      if (data.jobId === currentJob.id) {
        updateState({
          currentJob: null,
          exportStatus: data.message || 'Export cancelled',
          isExporting: false,
          isCancelling: false,
          completedJobId: null,
        });
        // Clear persisted state on cancellation
        ExportStateManager.clearExportState(projectId);
      }
    };

    socket.on('export:progress', handleProgress);
    socket.on('export:completed', handleCompleted);
    socket.on('export:failed', handleFailed);
    socket.on('export:cancelled', handleCancelled);

    return () => {
      socket.off('export:progress', handleProgress);
      socket.off('export:completed', handleCompleted);
      socket.off('export:failed', handleFailed);
      socket.off('export:cancelled', handleCancelled);
    };
  }, [socket, currentJob, projectId, updateState]);

  // Fallback polling mechanism when WebSocket is not connected
  useEffect(() => {
    if (!currentJob || !isExporting) return;

    // Only start polling if WebSocket is not connected or after a timeout
    const startPolling = () => {
      if (pollingInterval) clearInterval(pollingInterval);

      const interval = setInterval(async () => {
        try {
          const response = await apiClient.get(
            `/projects/${projectId}/export/${currentJob.id}/status`
          );
          const status = response.data;
          if (status) {
            updateState({
              exportProgress: status.progress,
              exportStatus: `Processing... ${Math.round(status.progress)}%`,
            });

            if (status.status === 'completed') {
              updateState({
                currentJob: currentJob
                  ? { ...currentJob, status: 'completed' }
                  : null,
                exportStatus: 'Export completed!',
                isExporting: false,
                completedJobId: currentJob.id,
              });
              clearInterval(interval);
              setPollingInterval(null);
            } else if (status.status === 'failed') {
              updateState({
                currentJob: currentJob
                  ? { ...currentJob, status: 'failed', message: status.message }
                  : null,
                exportStatus: `Export failed: ${status.message || 'Unknown error'}`,
                isExporting: false,
              });
              clearInterval(interval);
              setPollingInterval(null);
            }
          }
        } catch (error) {
          logger.error('Failed to poll export status', error);
          // Continue polling unless we get consecutive errors
        }
      }, 2000); // Poll every 2 seconds

      setPollingInterval(interval);
    };

    // Start polling immediately if WebSocket is not connected
    if (!wsConnected) {
      startPolling();
    } else {
      // Start polling after 5 seconds as a backup even if WebSocket is connected
      const backupPollingTimeout = setTimeout(() => {
        if (isExporting && currentJob) {
          startPolling();
        }
      }, 5000);

      return () => clearTimeout(backupPollingTimeout);
    }

    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        // Don't set state during cleanup to prevent infinite loop
        // The state will be cleaned up when component unmounts
      }
    };
  }, [
    currentJob,
    isExporting,
    wsConnected,
    pollingInterval,
    projectId,
    updateState,
  ]);

  // Auto-download when export completes - FIXED VERSION with persistent tracking
  useEffect(() => {
    // EARLY VALIDATION: Exit immediately if basic requirements not met
    if (!completedJobId || !projectId) {
      return;
    }

    // Load persistent downloaded jobs
    const persistedDownloaded = getDownloadedJobs();

    // Debug logging for troubleshooting
    logger.debug('Auto-download useEffect triggered', {
      completedJobId,
      downloadInProgress: downloadInProgress.current,
      alreadyDownloaded: persistedDownloaded.has(completedJobId),
      currentJobStatus: currentJob?.status,
      isDownloading,
    });

    // COMPREHENSIVE RACE CONDITION PREVENTION: Check ALL blocking conditions
    if (
      currentJob?.status === 'cancelled' ||
      persistedDownloaded.has(completedJobId) ||
      downloadInProgress.current ||
      isDownloading
    ) {
      logger.debug('Auto-download blocked:', {
        cancelled: currentJob?.status === 'cancelled',
        alreadyDownloaded: persistedDownloaded.has(completedJobId),
        downloadInProgress: downloadInProgress.current,
        isDownloading,
      });
      return;
    }

    logger.info('Starting auto-download for jobId:', completedJobId);

    // IMMEDIATE SYNCHRONOUS RACE PREVENTION - MUST be first
    markJobAsDownloaded(completedJobId);
    downloadInProgress.current = true;

    // Store jobId in closure to prevent stale closure issues
    const currentJobId = completedJobId;
    const currentProjectNameSnapshot = currentProjectName;

    // ASYNC DOWNLOAD FUNCTION
    const performAutoDownload = async () => {
      try {
        // Final cancellation check with closure variable
        if (currentJob?.status === 'cancelled') {
          logger.info('Auto-download cancelled - job cancelled');
          downloadInProgress.current = false;
          return;
        }

        // Set downloading state
        updateState({ isDownloading: true });

        // Browser compatibility check (non-blocking)
        if (!canDownloadLargeFiles()) {
          logger.warn('Browser may have issues with large file downloads');
        }

        const signal = getSignal('download');
        logger.info(
          '📥 Starting auto-download with signal aborted:',
          signal.aborted
        );

        const response = await apiClient.get(
          `/projects/${projectId}/export/${currentJobId}/download`,
          {
            responseType: 'blob',
            timeout: 300000, // 5 minutes
            signal: signal,
          }
        );

        logger.info('✅ Auto-download request completed');

        // Final cancellation check after network request
        if (currentJob?.status === 'cancelled') {
          logger.info('Download cancelled after request completion');
          downloadInProgress.current = false;
          updateState({ isDownloading: false });
          return;
        }

        // Generate simple filename
        const filename = currentProjectNameSnapshot
          ? `${sanitizeFilename(currentProjectNameSnapshot)}.zip`
          : `export_${currentJobId}.zip`;

        await downloadFromResponse(response, filename);
        logger.info('Export auto-downloaded successfully', {
          jobId: currentJobId,
          filename,
        });

        // SUCCESS: Clear flags and state but keep in downloaded list
        downloadInProgress.current = false;
        updateState({
          completedJobId: null,
          isDownloading: false,
          exportStatus: 'Download completed successfully.',
        });

        // Clear localStorage export state but keep downloaded tracking
        ExportStateManager.clearExportState(projectId);

        // DO NOT AUTO-DISMISS - let user dismiss manually
      } catch (error: any) {
        // ERROR HANDLING: Reset flags and allow retry
        downloadInProgress.current = false;

        if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
          logger.info('Auto-download cancelled by user');
          updateState({
            exportStatus: 'Download cancelled',
            isDownloading: false,
            completedJobId: null,
          });
          ExportStateManager.clearExportState(projectId);
          return;
        }

        logger.error('Auto-download failed:', error);
        // Remove from downloaded set to allow manual retry
        const downloaded = getDownloadedJobs();
        downloaded.delete(currentJobId);
        localStorage.setItem(
          `exportDownloaded_${projectId}`,
          JSON.stringify(Array.from(downloaded))
        );
        downloadedJobIds.current.delete(currentJobId);

        updateState({
          exportStatus:
            "Export completed! Click below to download if it didn't start automatically.",
          isDownloading: false,
        });
        // Keep completedJobId for manual download
      }
    };

    // Small delay to ensure export file is ready
    const timeoutId = setTimeout(performAutoDownload, 1000);

    // Cleanup function to prevent orphaned timeouts
    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    completedJobId,
    projectId,
    updateState,
    currentJob,
    getSignal,
    currentProjectName,
    isDownloading,
    markJobAsDownloaded,
    getDownloadedJobs,
  ]);

  const updateExportOptions = useCallback((updates: Partial<ExportOptions>) => {
    setExportOptions(prev => ({ ...prev, ...updates }));
  }, []);

  const startExport = useCallback(
    async (projectName?: string) => {
      try {
        // Reset abort controllers for fresh start
        resetController('download');
        resetController('api');

        // Clear downloaded job tracking for new export
        clearDownloadedJobs();
        downloadInProgress.current = false;

        // Clear any previous completed job when starting new export
        updateState({
          completedJobId: null,
          isExporting: true,
          exportProgress: 0,
          exportStatus: 'Preparing export...',
        });

        // Store project name for download filename
        setCurrentProjectName(projectName);

        const response = await apiClient.post(`/projects/${projectId}/export`, {
          options: exportOptions,
          projectName: projectName,
        });

        const jobId = response.data.jobId;
        const newJob = {
          id: jobId,
          status: 'pending',
          progress: 0,
        };

        updateState({ currentJob: newJob });

        logger.info('Export job started', { jobId, projectId });
        return jobId;
      } catch (error) {
        logger.error('Failed to start export', error);
        updateState({
          isExporting: false,
          exportStatus: 'Failed to start export',
        });
        throw error;
      }
    },
    [
      projectId,
      exportOptions,
      updateState,
      resetController,
      clearDownloadedJobs,
    ]
  );

  const triggerDownload = useCallback(async () => {
    logger.info('🔄 triggerDownload called', {
      completedJobId,
      isDownloading,
      downloadInProgress: downloadInProgress.current,
      alreadyDownloaded: completedJobId
        ? getDownloadedJobs().has(completedJobId)
        : false,
      currentProjectName,
    });

    // VALIDATION: Check if download is possible
    if (!completedJobId) {
      logger.warn('No completed export job ID available for manual download');
      return;
    }

    // STUCK STATE DETECTION AND RECOVERY
    // If downloadInProgress is stuck but isDownloading is false, reset the flag
    if (downloadInProgress.current && !isDownloading) {
      logger.warn('Detected stuck downloadInProgress flag - resetting');
      downloadInProgress.current = false;
    }

    // RACE PREVENTION: Block only if actively downloading
    if (isDownloading) {
      logger.warn('Manual download blocked - download actively in progress:', {
        isDownloading,
        downloadInProgress: downloadInProgress.current,
      });
      return;
    }

    // Check if already downloaded (but always allow retry for manual downloads)
    const persistedDownloaded = getDownloadedJobs();
    if (persistedDownloaded.has(completedJobId)) {
      logger.info(
        'Manual download requested for already downloaded job - allowing retry'
      );
      // Remove from set to allow retry
      persistedDownloaded.delete(completedJobId);
      localStorage.setItem(
        `exportDownloaded_${projectId}`,
        JSON.stringify(Array.from(persistedDownloaded))
      );
      downloadedJobIds.current.delete(completedJobId);
    }

    // IMMEDIATE SYNCHRONOUS FLAGS
    markJobAsDownloaded(completedJobId);
    downloadInProgress.current = true;

    try {
      updateState({
        isDownloading: true,
        exportStatus: 'Starting manual download...',
      });

      // Browser compatibility check (non-blocking)
      if (!canDownloadLargeFiles()) {
        logger.warn('Browser may have issues with large file downloads');
      }

      const signal = getSignal('download');
      logger.info(
        '📥 Starting manual download with retry mechanism, signal aborted:',
        signal.aborted
      );

      // Enhanced download with retry mechanism for 503 errors
      const downloadWithRetry = async () => {
        return await retryWithBackoff(
          async () => {
            const response = await apiClient.get(
              `/projects/${projectId}/export/${completedJobId}/download`,
              {
                responseType: 'blob',
                timeout: 300000, // 5 minutes
                signal: signal,
              }
            );
            return response;
          },
          {
            ...RETRY_CONFIGS.api,
            maxAttempts: 3,
            shouldRetry: (err, attempt) => {
              const error = err as any;
              const status = error?.response?.status;
              // Retry on 502, 503, 504 (server errors)
              const retryableStatuses = [502, 503, 504];
              const isRetryable = retryableStatuses.includes(status);

              logger.debug(
                `Download attempt ${attempt}: status=${status}, retryable=${isRetryable}`
              );
              return isRetryable && attempt < 3;
            },
            onRetry: (err, attempt, nextDelay) => {
              const error = err as any;
              const status = error?.response?.status || 'unknown';

              // Update UI to show retry status
              updateState({
                exportStatus: `Download failed (${status}), retrying in ${Math.round(nextDelay / 1000)}s... (${attempt}/3)`,
                isDownloading: true,
              });

              logger.warn(
                `🔄 Download retry ${attempt}/3 for status ${status}, waiting ${Math.round(nextDelay)}ms`
              );
            },
          }
        );
      };

      const result = await downloadWithRetry();

      if (!result.success) {
        throw result.error;
      }

      const response = result.data;
      logger.info(
        '✅ Manual download request completed (possibly after retries)'
      );

      // Generate simple filename
      const filename = currentProjectName
        ? `${sanitizeFilename(currentProjectName)}.zip`
        : `export_${completedJobId}.zip`;

      await downloadFromResponse(response, filename);
      logger.info('Export manually downloaded successfully', {
        jobId: completedJobId,
        filename,
      });

      // SUCCESS: Clear flags
      downloadInProgress.current = false;
      updateState({
        exportStatus: 'Download completed successfully.',
        isDownloading: false,
      });

      // Clear localStorage
      ExportStateManager.clearExportState(projectId);

      // DO NOT AUTO-DISMISS - let user control when to dismiss
    } catch (error: any) {
      // ERROR HANDLING: Reset flags
      downloadInProgress.current = false;

      if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
        logger.info('Manual download cancelled by user');
        updateState({
          exportStatus: 'Download cancelled',
          isDownloading: false,
          completedJobId: null,
        });
        ExportStateManager.clearExportState(projectId);
        return;
      }

      logger.error('Manual download failed:', error);
      // Remove from downloaded set to allow retry
      const downloaded = getDownloadedJobs();
      downloaded.delete(completedJobId);
      localStorage.setItem(
        `exportDownloaded_${projectId}`,
        JSON.stringify(Array.from(downloaded))
      );
      downloadedJobIds.current.delete(completedJobId);

      updateState({
        exportStatus: 'Failed to download export. Please try again.',
        isDownloading: false,
      });
      // Keep completedJobId for retry
    }
  }, [
    projectId,
    completedJobId,
    isDownloading,
    updateState,
    getSignal,
    currentProjectName,
    markJobAsDownloaded,
    getDownloadedJobs,
  ]);

  const cancelExport = useCallback(async () => {
    if (!currentJob) return;

    // CRITICAL: Abort any in-progress downloads immediately
    // This must happen first to stop downloads instantly
    logger.info('🔴 Calling abort for download and api');
    abort('download');
    abort('api');

    // Verify the signal is actually aborted (use isAborted to avoid creating new controller)
    const downloadAborted = isAborted('download');
    const apiAborted = isAborted('api');
    logger.info('🔍 Download signal aborted state:', downloadAborted);
    logger.info('🔍 API signal aborted state:', apiAborted);

    // Set cancelling state immediately for instant feedback
    updateState({
      isCancelling: true,
      exportStatus: 'Cancelling...',
      // Clear download state immediately if downloading
      isDownloading: false,
    });

    try {
      // Send cancel request via HTTP API
      await apiClient.post(
        `/projects/${projectId}/export/${currentJob.id}/cancel`
      );

      // Also emit cancel event via WebSocket for immediate processing
      if (socket && socket.connected) {
        socket.emit('export:cancel', {
          jobId: currentJob.id,
          projectId,
        });
      }

      // Update the current job status locally for immediate effect
      updateState({
        currentJob: { ...currentJob, status: 'cancelled' },
      });

      // Don't clear state immediately - wait for WebSocket confirmation
      // The WebSocket 'export:cancelled' event handler will clean up the rest

      logger.info('Export cancellation requested', { jobId: currentJob.id });
    } catch (error) {
      logger.error('Failed to cancel export', error);
      updateState({
        isCancelling: false,
        exportStatus: 'Failed to cancel export',
      });
    }
  }, [projectId, currentJob, updateState, socket, abort, isAborted]);

  const getExportStatus = useCallback(
    async (jobId: string) => {
      try {
        const response = await apiClient.get(
          `/projects/${projectId}/export/${jobId}/status`
        );
        return response.data;
      } catch (error) {
        logger.error('Failed to get export status', error);
        return null;
      }
    },
    [projectId]
  );

  const getExportHistory = useCallback(async () => {
    try {
      const response = await apiClient.get(
        `/projects/${projectId}/export/history`
      );
      return response.data;
    } catch (error) {
      logger.error('Failed to get export history', error);
      return [];
    }
  }, [projectId]);

  // Function to dismiss/clear completed export - ENHANCED
  const dismissExport = useCallback(() => {
    logger.info('Export dismiss requested', {
      completedJobId,
      isDownloading,
      downloadInProgress: downloadInProgress.current,
    });

    // Clear all download tracking
    if (completedJobId) {
      // Keep the job in downloaded list so it won't auto-download again
      const downloaded = getDownloadedJobs();
      downloaded.add(completedJobId);
      localStorage.setItem(
        `exportDownloaded_${projectId}`,
        JSON.stringify(Array.from(downloaded))
      );
    }
    downloadInProgress.current = false;

    // Clear state completely
    updateState({
      completedJobId: null,
      exportStatus: '',
      isDownloading: false,
      currentJob: null,
    });

    // Clear localStorage to prevent state persistence
    ExportStateManager.clearExportState(projectId);

    logger.info('Export dismissed successfully');
  }, [
    updateState,
    projectId,
    completedJobId,
    isDownloading,
    getDownloadedJobs,
  ]);

  return {
    exportOptions,
    updateExportOptions,
    startExport,
    triggerDownload,
    cancelExport,
    getExportStatus,
    getExportHistory,
    dismissExport,
    exportProgress,
    exportStatus,
    isExporting,
    isDownloading,
    currentJob,
    completedJobId,
    wsConnected,
  };
};
