import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '@/lib/api';
import { useWebSocket } from '@/contexts/useWebSocket';
import { logger } from '@/lib/logger';
import { EXPORT_DEFAULTS } from '@/lib/export-config';
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

/**
 * Trigger a native browser download by creating a hidden anchor and
 * clicking it. The browser streams the response straight to disk —
 * no Blob, no axios timeout, and (crucially) the download cannot
 * trigger the auth interceptor's force-logout logic.
 */
const triggerNativeDownload = (url: string, filename: string): void => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  // Defer removal so Safari has time to register the click.
  setTimeout(() => {
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
  }, 100);
};

/**
 * Run the full native-download flow for an export job: request a signed
 * token from the backend, then trigger a native browser download with the
 * token in the query string. Throws on token-issue failure so callers can
 * surface a "try again" message.
 */
const runNativeExportDownload = async (
  projectId: string,
  jobId: string,
  filename: string
): Promise<void> => {
  const { token } = await apiClient.getExportDownloadToken(projectId, jobId);
  const url = apiClient.buildExportDownloadUrl(
    projectId,
    jobId,
    token,
    filename
  );
  triggerNativeDownload(url, filename);
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

  const [createdBlobUrls, _setCreatedBlobUrls] = useState<string[]>([]);
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
  const {
    getSignal,
    abort,
    abortAll: _abortAll,
    resetController,
    isAborted,
  } = useAbortController('export');

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
    //
    // The download is triggered by the browser itself via a native <a>
    // click — we only need to fetch a short-lived signed download token
    // first. This avoids the 5-minute axios timeout and the in-memory
    // Blob blowup that used to fail for very large exports.
    const performAutoDownload = async () => {
      try {
        if (currentJob?.status === 'cancelled') {
          logger.info('Auto-download cancelled - job cancelled');
          downloadInProgress.current = false;
          return;
        }

        updateState({ isDownloading: true });

        logger.info('📥 Starting native auto-download for job:', currentJobId);

        const filename = currentProjectNameSnapshot
          ? `${sanitizeFilename(currentProjectNameSnapshot)}.zip`
          : `export_${currentJobId}.zip`;

        await runNativeExportDownload(projectId, currentJobId, filename);

        logger.info('Export auto-download dispatched to browser', {
          jobId: currentJobId,
          filename,
        });

        downloadInProgress.current = false;
        updateState({
          completedJobId: null,
          isDownloading: false,
          exportStatus: 'Download started. Check your downloads folder.',
        });

        ExportStateManager.clearExportState(projectId);
      } catch (error: any) {
        downloadInProgress.current = false;

        logger.error('Auto-download failed:', error);
        // IMPORTANT: do NOT remove currentJobId from the downloaded set
        // here. This catch runs inside the auto-download useEffect, which
        // depends on `isDownloading`. Resetting isDownloading below causes
        // the effect to re-fire; if we also cleared the downloaded set,
        // the `persistedDownloaded.has(completedJobId)` guard would pass
        // and performAutoDownload would run again — and again, and again,
        // creating an infinite retry loop (observed in prod 2026-04-08
        // when tokens expired mid-session). The manual triggerDownload
        // path already explicitly clears the set at its start, so the
        // user can still retry by clicking the button.
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
        exportStatus: 'Starting download...',
      });

      logger.info(
        '📥 Starting native manual download for job:',
        completedJobId
      );

      // Retry only the (small, fast) token-issue request — not the
      // download itself, which the browser handles natively. The retry
      // covers transient 502/503/504s on the token endpoint.
      const filename = currentProjectName
        ? `${sanitizeFilename(currentProjectName)}.zip`
        : `export_${completedJobId}.zip`;

      const downloadResult = await retryWithBackoff(
        async () => {
          await runNativeExportDownload(projectId, completedJobId, filename);
        },
        {
          ...RETRY_CONFIGS.api,
          maxAttempts: 3,
          shouldRetry: (err, attempt) => {
            const error = err as any;
            const status = error?.response?.status;
            const retryableStatuses = [502, 503, 504];
            const isRetryable = retryableStatuses.includes(status);
            logger.debug(
              `Download token attempt ${attempt}: status=${status}, retryable=${isRetryable}`
            );
            return isRetryable && attempt < 3;
          },
          onRetry: (err, attempt, nextDelay) => {
            const error = err as any;
            const status = error?.response?.status || 'unknown';
            updateState({
              exportStatus: `Server busy (${status}), retrying in ${Math.round(nextDelay / 1000)}s... (${attempt}/3)`,
              isDownloading: true,
            });
            logger.warn(
              `🔄 Download retry ${attempt}/3 for status ${status}, waiting ${Math.round(nextDelay)}ms`
            );
          },
        }
      );

      if (!downloadResult.success) {
        throw downloadResult.error;
      }

      logger.info('Export manual download dispatched to browser', {
        jobId: completedJobId,
        filename,
      });

      // SUCCESS: Clear flags
      downloadInProgress.current = false;
      updateState({
        exportStatus: 'Download started. Check your downloads folder.',
        isDownloading: false,
      });

      ExportStateManager.clearExportState(projectId);
    } catch (error: any) {
      // ERROR HANDLING: Reset flags
      downloadInProgress.current = false;

      logger.error('Manual download failed:', error);
      // IMPORTANT: do NOT remove completedJobId from the downloaded set
      // here. The auto-download useEffect depends on `isDownloading` and
      // would re-fire as soon as we reset it below; if the downloaded
      // set were also cleared, the effect's `persistedDownloaded.has(...)`
      // guard would pass and auto-download would immediately retry,
      // hitting the same failure and looping forever (observed in prod
      // 2026-04-08). The next time the user clicks the download button,
      // triggerDownload's own "allow retry" block at the top of this
      // callback explicitly clears the set.
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
