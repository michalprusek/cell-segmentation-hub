import { useState, useEffect, useCallback } from 'react';
import apiClient from '@/lib/api';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { logger } from '@/lib/logger';
import { EXPORT_DEFAULTS } from '@/lib/export-config';

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

  const { socket } = useWebSocket();

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
  }, [socket, currentJob]);

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
        setPollingInterval(null);
      }
    };
  }, [currentJob, isExporting, wsConnected, pollingInterval, projectId]);

  // Auto-download when export completes
  useEffect(() => {
    if (completedJobId) {
      const autoDownload = async () => {
        try {
          const response = await apiClient.get(
            `/projects/${projectId}/export/${completedJobId}/download`,
            { responseType: 'blob' }
          );

          // Create download link
          const url = window.URL.createObjectURL(new Blob([response.data]));

          // Track the URL for cleanup
          setCreatedBlobUrls(prev => [...prev, url]);

          const link = document.createElement('a');
          link.href = url;
          link.setAttribute(
            'download',
            `export_${new Date().toISOString().slice(0, 10)}.zip`
          );
          document.body.appendChild(link);
          link.click();

          // Cleanup immediately after download
          setTimeout(() => {
            link.remove();
            window.URL.revokeObjectURL(url);
            setCreatedBlobUrls(prev => prev.filter(u => u !== url));
          }, 100);

          // Clear the completed job after download
          setCompletedJobId(null);
          setExportStatus('Export downloaded successfully');

          logger.info('Export auto-downloaded', { jobId: completedJobId });
        } catch (error) {
          logger.error('Failed to auto-download export', error);
          setExportStatus(
            'Export completed, but auto-download failed. Please try manual download.'
          );
        }
      };

      // Small delay to ensure the export file is fully ready
      setTimeout(autoDownload, 1000);
    }
  }, [completedJobId, projectId]);

  const updateExportOptions = useCallback((updates: Partial<ExportOptions>) => {
    setExportOptions(prev => ({ ...prev, ...updates }));
  }, []);

  const startExport = useCallback(async () => {
    try {
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
    if (!completedJobId) return;

    try {
      const response = await apiClient.get(
        `/projects/${projectId}/export/${completedJobId}/download`,
        { responseType: 'blob' }
      );

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));

      // Track the URL for cleanup
      setCreatedBlobUrls(prev => [...prev, url]);

      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `export_${new Date().toISOString().slice(0, 10)}.zip`
      );
      document.body.appendChild(link);
      link.click();

      // Cleanup immediately after download
      setTimeout(() => {
        link.remove();
        window.URL.revokeObjectURL(url);
        setCreatedBlobUrls(prev => prev.filter(u => u !== url));
      }, 100);

      // Clear the completed job after download
      setCompletedJobId(null);
      setExportStatus('Export downloaded successfully');

      logger.info('Export downloaded', { jobId: completedJobId });
    } catch (error) {
      logger.error('Failed to download export', error);
      setExportStatus('Failed to download export');
    }
  }, [projectId, completedJobId]);

  const cancelExport = useCallback(async () => {
    if (!currentJob) return;

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

  // Fixed downloadExport issue - using triggerDownload
  return {
    exportOptions,
    updateExportOptions,
    startExport,
    triggerDownload,
    cancelExport,
    getExportStatus,
    getExportHistory,
    exportProgress,
    exportStatus,
    isExporting,
    currentJob,
    completedJobId,
    wsConnected,
  };
};
