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
import { createExportFilename } from '@/lib/filenameUtils';

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
  cancelledAt?: string;
}

export const useAdvancedExport = (projectId: string, projectName?: string) => {
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
  const [_createdBlobUrls, setCreatedBlobUrls] = useState<string[]>([]);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(
    null
  );
  const [wsConnected, setWsConnected] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

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
      _createdBlobUrls.forEach(url => {
        window.URL.revokeObjectURL(url);
      });
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [_createdBlobUrls, pollingInterval]);

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
      // ✅ FIX: Enhanced race condition protection
      if (data.jobId !== currentJob.id) {
        logger.debug('Export completion for different job ignored', {
          receivedJobId: data.jobId,
          currentJobId: currentJob.id,
        });
        return;
      }

      // ✅ CRITICAL: Multiple layers of cancellation checking
      if (currentJob.status === 'cancelled') {
        logger.info(
          'Export completion ignored - export was cancelled (status check)',
          {
            jobId: data.jobId,
          }
        );
        return;
      }

      // ✅ CRITICAL FIX: Additional check for persistent cancellation state
      const persistedState = ExportStateManager.getExportState(projectId);
      if (!persistedState || persistedState.status === 'cancelled') {
        logger.info(
          'Export completion ignored - detected cancellation in persistence',
          {
            jobId: data.jobId,
            persistedStatus: persistedState?.status
          }
        );
        return;
      }

      // ✅ CRITICAL FIX: Use synchronous state check with ref to prevent race conditions
      // Create a synchronous cancellation check that happens atomically
      let shouldProceed = true;

      setCompletedJobId(prevCompletedId => {
        // If completedJobId is already null (from cancellation), don't proceed
        if (prevCompletedId === null && currentJob.status === 'cancelled') {
          shouldProceed = false;
          logger.info(
            'Export completion blocked - detected recent cancellation',
            { jobId: data.jobId }
          );
          return null;
        }

        // Check current job status synchronously
        setCurrentJob(prev => {
          if (!prev || prev.status === 'cancelled') {
            shouldProceed = false;
            logger.info('Export completion blocked - job is cancelled', {
              jobId: data.jobId,
            });
            return prev;
          }
          // Only update to completed if not cancelled
          return { ...prev, status: 'completed' };
        });

        // Only set completedJobId if we should proceed
        return shouldProceed ? data.jobId : null;
      });

      // Only update UI states if we should proceed
      if (shouldProceed) {
        setExportStatus('Export completed! Starting download...');
        setIsExporting(false);
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

    // ✅ NEW: Handle export cancellation events
    const handleCancelled = (data: {
      jobId: string;
      previousStatus: string;
      cancelledAt: string;
    }) => {
      logger.info('[Export] Job cancelled', data);

      if (currentJob?.id === data.jobId) {
        // ✅ CRITICAL: Clear completedJobId FIRST to prevent race conditions
        setCompletedJobId(null);
        setIsDownloading(false);
        setIsExporting(false);

        // ✅ Update job status to cancelled AFTER clearing download triggers
        setCurrentJob(prev =>
          prev
            ? { ...prev, status: 'cancelled', cancelledAt: data.cancelledAt }
            : null
        );

        // ✅ Clear persisted state immediately
        ExportStateManager.clearExportState(projectId);

        // ✅ Show user feedback
        setExportStatus('Export was cancelled successfully');

        // Clear status after a few seconds
        setTimeout(() => {
          setExportStatus('');
        }, 3000);

        logger.info(
          '[Export] Successfully handled cancellation with race condition protection',
          {
            jobId: data.jobId,
            clearedStates: [
              'completedJobId',
              'isDownloading',
              'isExporting',
              'persistence',
            ],
          }
        );
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
              // Only process completion if not cancelled
              if (currentJob.status !== 'cancelled') {
                setCurrentJob(prev =>
                  prev ? { ...prev, status: 'completed' } : null
                );
                setExportStatus('Export completed! Starting download...');
                setIsExporting(false);
                setCompletedJobId(currentJob.id);
              }
              clearInterval(interval);
              setPollingInterval(null);
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
              // Clear state on failure or cancellation
              ExportStateManager.clearExportState(projectId);
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
        setPollingInterval(null);
      }
    };
  }, [currentJob, isExporting, wsConnected, pollingInterval, projectId]);

  // Auto-download when export completes
  useEffect(() => {
    // ✅ CRITICAL: Enhanced cancellation checks before auto-download
    if (!completedJobId || !currentJob) return;

    if (currentJob.status === 'cancelled') {
      logger.info('[Export] Auto-download skipped - job was cancelled', {
        jobId: completedJobId,
      });
      return;
    }

    // ✅ Double-check job status before triggering download
    if (currentJob.status !== 'completed') {
      logger.info('[Export] Auto-download skipped - job not completed', {
        jobId: completedJobId,
        status: currentJob.status,
      });
      return;
    }

    const autoDownload = async () => {
      try {
        // ✅ CRITICAL: Final validation before actual download
        if (!currentJob || currentJob.status === 'cancelled') {
          logger.info('[Export] Auto-download cancelled during delay check', {
            jobId: completedJobId,
            currentStatus: currentJob?.status,
          });
          return;
        }

        if (currentJob.status !== 'completed') {
          logger.info('[Export] Auto-download aborted - status changed', {
            jobId: completedJobId,
            currentStatus: currentJob.status,
          });
          return;
        }

        // Set downloading state
        setIsDownloading(true);

        // Check if browser supports large file downloads - warn but don't block
        if (!canDownloadLargeFiles()) {
          logger.warn('Browser may have issues with large file downloads');
          // Continue with download attempt instead of returning
        }

        const response = await apiClient.get(
          `/projects/${projectId}/export/${completedJobId}/download`,
          {
            responseType: 'blob',
            // Add timeout for large files (5 minutes)
            timeout: 300000,
          }
        );

        // Use centralized download utility with project name
        const filename = projectName
          ? createExportFilename(projectName)
          : `export_${completedJobId}_${new Date().toISOString().slice(0, 10)}.zip`;
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
      } catch (error) {
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

    if (completedJobId && currentJob?.status === 'cancelled') {
      // Clear completedJobId if export was cancelled to prevent future auto-downloads
      logger.info('Clearing completedJobId for cancelled export');
      setCompletedJobId(null);
    }
  }, [completedJobId, projectId, currentJob?.status, currentJob?.id]); // ✅ FIX: Track status changes specifically

  const updateExportOptions = useCallback((updates: Partial<ExportOptions>) => {
    setExportOptions(prev => ({ ...prev, ...updates }));
  }, []);

  const startExport = useCallback(async () => {
    try {
      // Clear any previous completed job when starting new export
      setCompletedJobId(null);
      setIsExporting(true);
      setExportProgress(0);
      setExportStatus('Starting export...');

      const response = await apiClient.post(`/projects/${projectId}/export`, {
        options: exportOptions,
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
  }, [projectId, exportOptions]);

  const triggerDownload = useCallback(async () => {
    if (!completedJobId) {
      logger.warn('No completed export job ID available');
      return;
    }

    // ✅ CRITICAL: Check cancellation status before manual download
    if (currentJob?.status === 'cancelled') {
      logger.info('[Export] Manual download blocked - job was cancelled', {
        jobId: completedJobId,
      });
      setExportStatus('Export was cancelled and is no longer available');
      setCompletedJobId(null);
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

      const response = await apiClient.get(
        `/projects/${projectId}/export/${completedJobId}/download`,
        {
          responseType: 'blob',
          // Add timeout for large files (5 minutes)
          timeout: 300000,
        }
      );

      // Use centralized download utility with project name
      const filename = projectName
        ? createExportFilename(projectName)
        : `export_${completedJobId}_${new Date().toISOString().slice(0, 10)}.zip`;
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
    } catch (error) {
      logger.error('Failed to download export', { error, completedJobId });
      setExportStatus('Failed to download export. Please try again.');
      setIsDownloading(false);

      // Don't clear completedJobId on error so user can retry
    }
  }, [projectId, completedJobId, isDownloading]);

  const cancelExport = useCallback(async () => {
    if (!currentJob) return;

    try {
      await apiClient.post(
        `/projects/${projectId}/export/${currentJob.id}/cancel`
      );

      // ✅ FIX: Atomic state update to prevent race conditions
      const jobId = currentJob.id;

      // Clear ALL related states immediately in correct order
      setCompletedJobId(null); // ✅ CRITICAL: Clear this FIRST to prevent auto-download
      setIsDownloading(false); // Clear downloading state
      setIsExporting(false);
      setCurrentJob(prev =>
        prev
          ? {
              ...prev,
              status: 'cancelled',
              cancelledAt: new Date().toISOString(),
            }
          : null
      );
      setExportStatus('Export cancelled');

      // Clear persistence immediately to prevent cross-tab sync issues
      ExportStateManager.clearExportState(projectId);

      logger.info('Export cancelled - all states cleared atomically', {
        jobId,
        clearedStates: [
          'completedJobId',
          'isDownloading',
          'isExporting',
          'currentJob',
          'persistence',
        ],
      });
    } catch (error) {
      logger.error('Failed to cancel export', error);
    }
  }, [projectId, currentJob]);

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
