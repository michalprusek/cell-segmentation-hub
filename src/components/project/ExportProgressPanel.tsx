import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Download,
  FileArchive,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/useLanguage';
import { UniversalCancelButton } from '@/components/ui/universal-cancel-button';
import { logger } from '@/lib/logger';

export interface ExportProgressPanelProps {
  isExporting: boolean;
  isDownloading: boolean;
  exportProgress: number;
  exportStatus: string;
  completedJobId: string | null;
  onCancelExport: () => void;
  onTriggerDownload: () => void;
  onDismissExport: () => void;
  className?: string;
  wsConnected?: boolean;
}

export const ExportProgressPanel = ({
  isExporting,
  isDownloading,
  exportProgress,
  exportStatus,
  completedJobId,
  onCancelExport,
  onTriggerDownload,
  onDismissExport,
  className,
  wsConnected = true,
}: ExportProgressPanelProps) => {
  const { t } = useLanguage();

  // Local state for immediate cancel feedback
  const [isCancelling, setIsCancelling] = useState(false);

  // Enhanced cancel handler with immediate feedback
  const handleCancelExport = useCallback(async () => {
    if (isCancelling) return; // Prevent multiple rapid clicks

    setIsCancelling(true);
    try {
      await onCancelExport();
    } finally {
      // Reset cancelling state after a brief delay
      setTimeout(() => setIsCancelling(false), 1000);
    }
  }, [onCancelExport, isCancelling]);

  // Debug visibility conditions
  React.useEffect(() => {
    logger.debug('📊 ExportProgressPanel visibility check:', {
      isExporting,
      isDownloading,
      completedJobId,
      isCancelling,
      shouldShow:
        isExporting || isDownloading || !!completedJobId || isCancelling,
      exportProgress,
      exportStatus,
    });
  }, [
    isExporting,
    isDownloading,
    completedJobId,
    isCancelling,
    exportProgress,
    exportStatus,
  ]);

  // Show panel if any export operation is active OR if we're in cancelling state
  if (!isExporting && !isDownloading && !completedJobId && !isCancelling) {
    logger.debug(
      '❌ ExportProgressPanel: Hidden - no active export operations'
    );
    return null;
  }

  logger.debug(
    '✅ ExportProgressPanel: Visible - active export operation detected'
  );

  // Determine the current export phase
  const getExportPhase = () => {
    if (isCancelling) return 'cancelling';
    if (isDownloading) return 'downloading';
    if (completedJobId) return 'completed';
    if (isExporting) return 'processing';
    return 'idle';
  };

  const phase = getExportPhase();

  // Get appropriate icon for current phase
  const getPhaseIcon = () => {
    switch (phase) {
      case 'processing':
        return (
          <FileArchive className="h-5 w-5 text-indigo-600 dark:text-indigo-400 animate-pulse" />
        );
      case 'completed':
        return (
          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
        );
      case 'downloading':
        return (
          <Download className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-bounce" />
        );
      case 'cancelling':
        return (
          <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 animate-pulse" />
        );
      default:
        return (
          <FileArchive className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        );
    }
  };

  // Get appropriate badge for current phase
  const getPhaseBadge = () => {
    switch (phase) {
      case 'processing':
        return (
          <Badge className="text-xs bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100">
            {t('export.processingExport')}
          </Badge>
        );
      case 'completed':
        return (
          <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
            {t('export.completed')}
          </Badge>
        );
      case 'downloading':
        return (
          <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">
            {t('export.downloading')}
          </Badge>
        );
      case 'cancelling':
        return (
          <Badge className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100">
            {t('export.cancelling')}
          </Badge>
        );
      default:
        return null;
    }
  };

  // Get progress percentage for display - use actual server progress
  const getProgressPercentage = () => {
    if (phase === 'completed') return 100;
    if (phase === 'cancelling') return exportProgress; // Keep current progress during cancellation

    // Use the actual progress from the server directly
    // Server handles the export phases internally and provides accurate progress
    return Math.round(Math.max(0, Math.min(100, exportProgress)));
  };

  // Get export status text with immediate feedback for cancelling
  const getExportStatusText = () => {
    if (phase === 'cancelling') return t('export.cancelling');
    return exportStatus || t('export.processingExport');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className={cn('mb-6', className)}
    >
      <Card className="border-gray-200 dark:border-gray-700 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/50 dark:to-indigo-950/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            {/* Left section - Export status */}
            <div className="flex items-center gap-4 flex-1">
              <div className="flex items-center gap-2">
                {getPhaseIcon()}
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  {t('export.title')}
                </h3>
              </div>

              {/* Phase badge */}
              {getPhaseBadge()}

              {/* Progress section */}
              <div className="flex-1 max-w-md">
                {(isExporting || isDownloading || isCancelling) && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">
                        {getExportStatusText()}
                      </span>
                      <span className="font-medium text-indigo-600 dark:text-indigo-400">
                        {getProgressPercentage()}%
                      </span>
                    </div>
                    <Progress
                      value={getProgressPercentage()}
                      className="h-2 bg-gray-200 dark:bg-gray-700"
                    />
                  </div>
                )}

                {completedJobId && !isDownloading && (
                  <div className="text-sm text-green-600 dark:text-green-400 font-medium">
                    {exportStatus || t('export.readyToDownload')}
                  </div>
                )}
              </div>

              {/* Connection status for WebSocket */}
              {!wsConnected && isExporting && (
                <div className="flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <Badge variant="secondary" className="text-xs">
                    {t('export.fallbackMode')}
                  </Badge>
                </div>
              )}
            </div>

            {/* Right section - Actions */}
            <div className="flex items-center gap-2">
              {/* Download button for completed exports */}
              {completedJobId && !isExporting && (
                <Button
                  onClick={onTriggerDownload}
                  disabled={isDownloading}
                  className={cn(
                    'gap-2 transition-all',
                    isDownloading
                      ? 'bg-blue-600 hover:bg-blue-700 text-white animate-pulse'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  )}
                  size="sm"
                >
                  <Download className="h-4 w-4" />
                  {isDownloading
                    ? t('export.downloading')
                    : t('export.download')}
                </Button>
              )}

              {/* Dismiss button for completed exports */}
              {completedJobId && !isExporting && !isDownloading && (
                <Button
                  onClick={onDismissExport}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  {t('common.dismiss')}
                </Button>
              )}

              {/* Universal cancel button for active operations */}
              {(isExporting || isDownloading || isCancelling) && (
                <UniversalCancelButton
                  operationType="export"
                  isOperationActive={isExporting || isDownloading}
                  isCancelling={isCancelling}
                  onCancel={handleCancelExport}
                  onPrimaryAction={() => {}} // No primary action for export panel
                  primaryText=""
                  disabled={isCancelling}
                  showPrimaryButton={false} // Only show cancel button
                  cancelText={
                    isCancelling ? t('export.cancelling') : t('export.cancel')
                  }
                  className="min-w-[100px]"
                />
              )}
            </div>
          </div>

          {/* Status messages */}
          {!wsConnected && isExporting && (
            <div className="mt-3 p-2 bg-yellow-50 dark:bg-yellow-950/50 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-800 dark:text-yellow-200">
              {t('export.fallbackMessage')}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
};
