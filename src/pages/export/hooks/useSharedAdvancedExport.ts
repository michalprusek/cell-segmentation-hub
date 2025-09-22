import { useState, useEffect, useCallback } from 'react';
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

export const useSharedAdvancedExport = (projectId: string) => {
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
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(
    null
  );
  const [wsConnected, setWsConnected] = useState(false);
  const [currentProjectName, setCurrentProjectName] = useState<
    string | undefined
  >();

  const { socket } = useWebSocket();

  // Initialize AbortController for cancellable downloads
  const { getSignal, abort, abortAll, resetController, isAborted } = useAbortController('export');

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

  // Check resumed export status from server - defined early to avoid dependency issues
  const checkResumedExportStatus = useCallback(
    async (jobId: string) => {
      try {
        const response = await apiClient.get(
          `/projects/${projectId}/export/${jobId}/status`
        );
        const status = response.data;

        if (status.status === 'completed') {
          updateState({
            currentJob: currentJob
              ? { ...currentJob, status: 'completed' }
              : null,
            exportStatus: 'Export completed! Starting download...',
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

  // Initialize from persisted state on mount
  useEffect(() => {
    if (!projectId) return;

    const persistedState = ExportStateManager.getExportState(projectId);
    if (persistedState) {
      logger.info('Restoring export state from localStorage', persistedState);

      const restoredJob = {
        id: persistedState.jobId,
        status:
          persistedState.status === 'downloading' ? 'completed' : 'processing',
        progress: persistedState.progress,
      };

      updateState({
        currentJob: restoredJob,
      });

      if (
        persistedState.status === 'exporting' ||
        persistedState.status === 'processing'
      ) {
        updateState({
          isExporting: true,
          exportProgress: persistedState.progress,
          exportStatus:
            persistedState.exportStatus ||
            `Processing... ${Math.round(persistedState.progress)}%`,
        });

        // Check current status from server
        checkResumedExportStatus(persistedState.jobId);
      } else if (persistedState.status === 'downloading') {
        updateState({
          isDownloading: true,
          completedJobId: persistedState.jobId,
          exportStatus: 'Download ready',
        });
      }
    }
  }, [projectId, checkResumedExportStatus, updateState]);

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
                exportStatus: 'Export completed! Starting download...',
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

  // Auto-download when export completes
  useEffect(() => {
    // Only auto-download if not cancelled and job is complete
    if (completedJobId && currentJob?.status !== 'cancelled') {
      const autoDownload = async () => {
        try {
          // Check if export was cancelled before starting download
          if (currentJob?.status === 'cancelled') {
            logger.info('Auto-download skipped - export was cancelled');
            return;
          }

          // Set downloading state
          updateState({ isDownloading: true });

          // Check if browser supports large file downloads - warn but don't block
          if (!canDownloadLargeFiles()) {
            logger.warn('Browser may have issues with large file downloads');
            // Continue with download attempt instead of returning
          }

          const signal = getSignal('download');
          logger.info('📥 Starting auto-download with signal aborted:', signal.aborted);

          const response = await apiClient.get(
            `/projects/${projectId}/export/${completedJobId}/download`,
            {
              responseType: 'blob',
              // Add timeout for large files (5 minutes)
              timeout: 300000,
              // Add AbortController signal for cancellation support
              signal: signal,
            }
          );

          logger.info('✅ Download request completed');

          // Double-check cancellation after network request
          if (currentJob?.status === 'cancelled') {
            logger.info('Download cancelled after request completion');
            return;
          }

          // Use centralized download utility with project name
          const timestamp = new Date().toISOString().slice(0, 10);
          const filename = currentProjectName
            ? `${sanitizeFilename(currentProjectName)}_${timestamp}.zip`
            : `export_${completedJobId}_${timestamp}.zip`;
          await downloadFromResponse(response, filename);

          // Show downloading status briefly, then auto-dismiss after a reasonable time
          updateState({
            exportStatus:
              'Download initiated. The file should appear in your downloads folder.',
          });

          // Auto-dismiss after 5 seconds (reasonable time for download to start)
          setTimeout(() => {
            updateState({
              isDownloading: false,
              completedJobId: null,
              exportStatus: '',
            });
            logger.info('Export auto-dismissed after download');
          }, 5000);

          logger.info('Export auto-downloaded', { jobId: completedJobId });
        } catch (error: any) {
          // Handle abort errors gracefully
          if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
            logger.info('Download cancelled by user');
            updateState({
              exportStatus: 'Download cancelled',
              isDownloading: false,
              completedJobId: null,
            });
            return;
          }

          logger.error('Failed to auto-download export', error);
          updateState({
            exportStatus:
              "Export completed! Click below to download if it didn't start automatically.",
            isDownloading: false,
          });
          // Keep completedJobId available for manual download
        }
      };

      // Small delay to ensure the export file is fully ready
      setTimeout(autoDownload, 1000);
    }
  }, [completedJobId, projectId, updateState, currentJob, getSignal]);

  const updateExportOptions = useCallback((updates: Partial<ExportOptions>) => {
    setExportOptions(prev => ({ ...prev, ...updates }));
  }, []);

  const startExport = useCallback(
    async (projectName?: string) => {
      try {
        // Reset abort controllers for fresh start
        resetController('download');
        resetController('api');

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
    [projectId, exportOptions, updateState, resetController]
  );

  const triggerDownload = useCallback(async () => {
    if (!completedJobId) {
      logger.warn('No completed export job ID available');
      return;
    }

    // If already downloading, clicking again dismisses everything
    if (isDownloading) {
      updateState({
        isDownloading: false,
        completedJobId: null,
        exportStatus: '',
      });
      logger.info('Export dismissed by user during download');
      return;
    }

    try {
      updateState({
        isDownloading: true,
        exportStatus: 'Starting download...',
      });

      // Check if browser supports large file downloads - warn but don't block
      if (!canDownloadLargeFiles()) {
        logger.warn('Browser may have issues with large file downloads');
        // Continue with download attempt
      }

      const signal = getSignal('download');
      logger.info('📥 Starting manual download with signal aborted:', signal.aborted);

      const response = await apiClient.get(
        `/projects/${projectId}/export/${completedJobId}/download`,
        {
          responseType: 'blob',
          // Add timeout for large files (5 minutes)
          timeout: 300000,
          // Add AbortController signal for cancellation support
          signal: signal,
        }
      );

      logger.info('✅ Manual download request completed');

      // Use centralized download utility with project name
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = currentProjectName
        ? `${sanitizeFilename(currentProjectName)}_${timestamp}.zip`
        : `export_${completedJobId}_${timestamp}.zip`;
      await downloadFromResponse(response, filename);

      // Show downloading status briefly, then auto-dismiss
      updateState({
        exportStatus:
          'Download initiated. The file should appear in your downloads folder.',
      });

      // Auto-dismiss after 5 seconds
      setTimeout(() => {
        updateState({
          isDownloading: false,
          completedJobId: null,
          exportStatus: '',
        });
        logger.info('Export auto-dismissed after manual download');
      }, 5000);

      logger.info('Export manually downloaded', { jobId: completedJobId });
    } catch (error: any) {
      // Handle abort errors gracefully
      if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
        logger.info('Manual download cancelled by user');
        updateState({
          exportStatus: 'Download cancelled',
          isDownloading: false,
          completedJobId: null,
        });
        return;
      }

      logger.error('Failed to download export', { error, completedJobId });
      updateState({
        exportStatus: 'Failed to download export. Please try again.',
        isDownloading: false,
      });

      // Don't clear completedJobId on error so user can retry
    }
  }, [projectId, completedJobId, isDownloading, updateState, getSignal]);

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
  }, [projectId, currentJob, updateState, socket, abort, getSignal]);

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

  // Function to dismiss/clear completed export
  const dismissExport = useCallback(() => {
    updateState({
      completedJobId: null,
      exportStatus: '',
      isDownloading: false,
    });
    logger.info('Export dismissed by user');
  }, [updateState]);

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
