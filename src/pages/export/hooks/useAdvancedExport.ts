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

export const useAdvancedExport = (projectId: string) => {
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

  const [currentJob, setCurrentJob] = useState<ExportJob | null>(null);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [completedJobId, setCompletedJobId] = useState<string | null>(null);
  const [createdBlobUrls, setCreatedBlobUrls] = useState<string[]>([]);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(
    null
  );
  const [wsConnected, setWsConnected] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Initialize AbortController for cancellable downloads
  const { getSignal, abort, resetController, isAborted } = useAbortController('export');
  const [currentProjectName, setCurrentProjectName] = useState<
    string | undefined
  >();

  const { socket } = useWebSocket();

  // Check resumed export status from server - defined early to avoid dependency issues
  const checkResumedExportStatus = useCallback(
    async (jobId: string) => {
      try {
        const response = await apiClient.get(
          `/projects/${projectId}/export/${jobId}/status`
        );
        const status = response.data;

        if (status.status === 'completed') {
          setCurrentJob(prev =>
            prev ? { ...prev, status: 'completed' } : null
          );
          setExportStatus('Export completed! Starting download...');
          setIsExporting(false);
          setCompletedJobId(jobId);
        } else if (
          status.status === 'failed' ||
          status.status === 'cancelled'
        ) {
          setCurrentJob(prev =>
            prev
              ? { ...prev, status: status.status, message: status.message }
              : null
          );
          setExportStatus(
            `Export ${status.status}: ${status.message || 'Unknown error'}`
          );
          setIsExporting(false);
          ExportStateManager.clearExportState(projectId);
        } else {
          // Still processing, continue monitoring
          setExportProgress(status.progress || 0);
          setExportStatus(`Processing... ${Math.round(status.progress || 0)}%`);
          // Re-establish monitoring - WebSocket will auto-reconnect
          setCurrentJob({
            id: jobId,
            status: 'processing',
            progress: status.progress || 0,
          });
        }
      } catch (error) {
        logger.error('Failed to check resumed export status:', error);
        setIsExporting(false);
        ExportStateManager.clearExportState(projectId);
        setExportStatus('Failed to resume export monitoring');
      }
    },
    [projectId]
  );

  // Initialize from persisted state on mount
  useEffect(() => {
    if (!projectId) return;

    const persistedState = ExportStateManager.getExportState(projectId);
    if (persistedState) {
      logger.info('Restoring export state from localStorage', persistedState);

      setCurrentJob({
        id: persistedState.jobId,
        status:
          persistedState.status === 'downloading' ? 'completed' : 'processing',
        progress: persistedState.progress,
      });

      if (
        persistedState.status === 'exporting' ||
        persistedState.status === 'processing'
      ) {
        setIsExporting(true);
        setExportProgress(persistedState.progress);
        setExportStatus(
          persistedState.exportStatus ||
            `Processing... ${Math.round(persistedState.progress)}%`
        );

        // Check current status from server
        checkResumedExportStatus(persistedState.jobId);
      } else if (persistedState.status === 'downloading') {
        setIsDownloading(true);
        setCompletedJobId(persistedState.jobId);
        setExportStatus('Download ready');
      }
    }
  }, [projectId, checkResumedExportStatus]);

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

    const handleProgress = (data: { jobId: string; progress: number }) => {
      if (data.jobId === currentJob.id) {
        setExportProgress(data.progress);
        setExportStatus(`Processing... ${Math.round(data.progress)}%`);
      }
    };

    const handleCompleted = (data: { jobId: string }) => {
      if (data.jobId === currentJob.id) {
        setCurrentJob(prev => (prev ? { ...prev, status: 'completed' } : null));
        setExportStatus('Export completed! Starting download...');
        setIsExporting(false);
        setCompletedJobId(data.jobId);
      }
    };

    const handleFailed = (data: { jobId: string; error: string }) => {
      if (data.jobId === currentJob.id) {
        setCurrentJob(prev =>
          prev ? { ...prev, status: 'failed', message: data.error } : null
        );
        setExportStatus(`Export failed: ${data.error}`);
        setIsExporting(false);
        // Clear persisted state on failure
        ExportStateManager.clearExportState(projectId);
      }
    };

    socket.on('export:progress', handleProgress);
    socket.on('export:completed', handleCompleted);
    socket.on('export:failed', handleFailed);

    return () => {
      socket.off('export:progress', handleProgress);
      socket.off('export:completed', handleCompleted);
      socket.off('export:failed', handleFailed);
    };
  }, [socket, currentJob, projectId]);

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
            setExportProgress(status.progress);
            setExportStatus(`Processing... ${Math.round(status.progress)}%`);

            if (status.status === 'completed') {
              setCurrentJob(prev =>
                prev ? { ...prev, status: 'completed' } : null
              );
              setExportStatus('Export completed! Starting download...');
              setIsExporting(false);
              setCompletedJobId(currentJob.id);
              clearInterval(interval);
              setPollingInterval(null);
            } else if (status.status === 'failed') {
              setCurrentJob(prev =>
                prev
                  ? { ...prev, status: 'failed', message: status.message }
                  : null
              );
              setExportStatus(
                `Export failed: ${status.message || 'Unknown error'}`
              );
              setIsExporting(false);
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
  }, [currentJob, isExporting, wsConnected, pollingInterval, projectId]);

  // Auto-download when export completes
  useEffect(() => {
    if (completedJobId) {
      const autoDownload = async () => {
        try {
          // Set downloading state
          setIsDownloading(true);

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

          // Use centralized download utility with project name
          const timestamp = new Date().toISOString().slice(0, 10);
          const filename = currentProjectName
            ? `${sanitizeFilename(currentProjectName)}_${timestamp}.zip`
            : `export_${completedJobId}_${timestamp}.zip`;
          await downloadFromResponse(response, filename);

          // Show downloading status briefly, then auto-dismiss after a reasonable time
          setExportStatus(
            'Download initiated. The file should appear in your downloads folder.'
          );

          // Auto-dismiss after 5 seconds (reasonable time for download to start)
          setTimeout(() => {
            setIsDownloading(false);
            setCompletedJobId(null);
            setExportStatus('');
            logger.info('Export auto-dismissed after download');
          }, 5000);

          logger.info('Export auto-downloaded', { jobId: completedJobId });
        } catch (error: any) {
          // Handle abort errors gracefully
          if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
            logger.info('Download cancelled by user');
            setExportStatus('Download cancelled');
            setIsDownloading(false);
            setCompletedJobId(null);
            return;
          }

          logger.error('Failed to auto-download export', error);
          setExportStatus(
            "Export completed! Click below to download if it didn't start automatically."
          );
          setIsDownloading(false);
          // Keep completedJobId available for manual download
        }
      };

      // Small delay to ensure the export file is fully ready
      setTimeout(autoDownload, 1000);
    }
  }, [completedJobId, projectId, currentProjectName, getSignal]);

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
        setCompletedJobId(null);
        setIsExporting(true);
        setExportProgress(0);
        setExportStatus('Preparing export...');

        // Store project name for download filename
        setCurrentProjectName(projectName);

        const response = await apiClient.post(`/projects/${projectId}/export`, {
          options: exportOptions,
          projectName: projectName,
        });

        const jobId = response.data.jobId;
        setCurrentJob({
          id: jobId,
          status: 'pending',
          progress: 0,
        });

        logger.info('Export job started', { jobId, projectId });
        return jobId;
      } catch (error) {
        logger.error('Failed to start export', error);
        setIsExporting(false);
        setExportStatus('Failed to start export');
        throw error;
      }
    },
    [projectId, exportOptions, resetController]
  );

  const triggerDownload = useCallback(async () => {
    if (!completedJobId) {
      logger.warn('No completed export job ID available');
      return;
    }

    // If already downloading, clicking again dismisses everything
    if (isDownloading) {
      setIsDownloading(false);
      setCompletedJobId(null);
      setExportStatus('');
      logger.info('Export dismissed by user during download');
      return;
    }

    try {
      setIsDownloading(true);
      setExportStatus('Starting download...');

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
      setExportStatus(
        'Download initiated. The file should appear in your downloads folder.'
      );

      // Auto-dismiss after 5 seconds
      setTimeout(() => {
        setIsDownloading(false);
        setCompletedJobId(null);
        setExportStatus('');
        logger.info('Export auto-dismissed after manual download');
      }, 5000);

      logger.info('Export manually downloaded', { jobId: completedJobId });
    } catch (error: any) {
      // Handle abort errors gracefully
      if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
        logger.info('Manual download cancelled by user');
        setExportStatus('Download cancelled');
        setIsDownloading(false);
        setCompletedJobId(null);
        return;
      }

      logger.error('Failed to download export', { error, completedJobId });
      setExportStatus('Failed to download export. Please try again.');
      setIsDownloading(false);

      // Don't clear completedJobId on error so user can retry
    }
  }, [projectId, completedJobId, isDownloading, getSignal]);

  const cancelExport = useCallback(async () => {
    logger.info('🔴 cancelExport called', {
      currentJob,
      isExporting,
      isDownloading,
      projectId
    });

    if (!currentJob) {
      logger.warn('⚠️ Cannot cancel - no currentJob found');
      // Still abort any in-progress downloads even if no job
      abort('download');
      abort('api');
      setIsDownloading(false);
      setIsExporting(false);
      return;
    }

    // CRITICAL: Abort any in-progress downloads immediately
    logger.info('🔴 Calling abort for download and api with job', currentJob);
    abort('download');
    abort('api');

    // Verify the signal is actually aborted (use isAborted to avoid creating new controller)
    const downloadAborted = isAborted('download');
    const apiAborted = isAborted('api');
    logger.info('🔍 Download signal aborted state:', downloadAborted);
    logger.info('🔍 API signal aborted state:', apiAborted);

    // Set cancelling state immediately for instant feedback
    setIsDownloading(false);

    try {
      await apiClient.post(
        `/projects/${projectId}/export/${currentJob.id}/cancel`
      );
      setCurrentJob(prev => (prev ? { ...prev, status: 'cancelled' } : null));
      setIsExporting(false);
      setExportStatus('Export cancelled');
      logger.info('Export cancelled', { jobId: currentJob.id });
    } catch (error) {
      logger.error('Failed to cancel export', error);
    }
  }, [projectId, currentJob, abort, isAborted, isExporting, isDownloading]);

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
    setCompletedJobId(null);
    setExportStatus('');
    setIsDownloading(false);
    logger.info('Export dismissed by user');
  }, []);

  // Fixed downloadExport issue - using triggerDownload
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
