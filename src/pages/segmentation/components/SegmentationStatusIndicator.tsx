import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SegmentationUpdate } from '@/hooks/useSegmentationQueue';

interface SegmentationStatusIndicatorProps {
  imageId: string;
  segmentationStatus?: string;
  lastUpdate?: SegmentationUpdate | null;
  queuePosition?: number;
  className?: string;
}

const getStatusInfo = (status: string, t: (key: string) => string) => {
  switch (status) {
    case 'processing':
      return {
        label: t('status.processing'),
        icon: Loader2,
        className:
          'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
        animate: true,
      };
    case 'queued':
      return {
        label: t('status.queued'),
        icon: Clock,
        className:
          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
        animate: false,
      };
    case 'completed':
    case 'segmented':
      return {
        label: t('status.segmented'),
        icon: CheckCircle,
        className:
          'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
        animate: false,
      };
    case 'failed':
      return {
        label: t('status.failed'),
        icon: XCircle,
        className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
        animate: false,
      };
    case 'no_segmentation':
      return {
        label: t('status.noPolygons'),
        icon: AlertTriangle,
        className:
          'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
        animate: false,
      };
    default:
      return null;
  }
};

export const SegmentationStatusIndicator: React.FC<SegmentationStatusIndicatorProps> =
  React.memo(
    ({ imageId, segmentationStatus, lastUpdate, queuePosition, className }) => {
      const { t } = useLanguage();

      // Memoize status calculation for performance
      const currentStatus = useMemo(() => {
        // If we have a recent update for this specific image, use its status
        if (lastUpdate && lastUpdate.imageId === imageId) {
          return lastUpdate.status;
        }
        return segmentationStatus;
      }, [lastUpdate, imageId, segmentationStatus]);

      // Memoize visibility check
      const shouldShow = useMemo(() => {
        return !!(
          currentStatus &&
          ['processing', 'queued', 'failed', 'no_segmentation'].includes(
            currentStatus
          )
        );
      }, [currentStatus]);

      // Memoize status info to prevent unnecessary recalculations
      const statusInfo = useMemo(() => {
        return currentStatus ? getStatusInfo(currentStatus, t) : null;
      }, [currentStatus, t]);

      if (!shouldShow || !statusInfo) {
        return null;
      }

      const StatusIcon = statusInfo.icon;

      return (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className={cn('flex items-center space-x-2', className)}
        >
          <Badge
            className={cn(
              'flex items-center gap-2 text-xs font-medium',
              statusInfo.className
            )}
          >
            <StatusIcon
              className={cn('h-3 w-3', statusInfo.animate && 'animate-spin')}
            />
            <span>{statusInfo.label}</span>
            {queuePosition !== undefined &&
              queuePosition > 0 &&
              currentStatus === 'queued' && (
                <span className="text-xs opacity-75">(#{queuePosition})</span>
              )}
          </Badge>

          {/* Additional processing details */}
          {currentStatus === 'processing' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-gray-600 dark:text-gray-400"
            >
              {t('segmentationEditor.segmenting')}
            </motion.div>
          )}
          {currentStatus === 'queued' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-gray-600 dark:text-gray-400"
            >
              {t('segmentationEditor.waitingInQueue')}
            </motion.div>
          )}
        </motion.div>
      );
    }
  );

// Display name for debugging
SegmentationStatusIndicator.displayName = 'SegmentationStatusIndicator';

export default SegmentationStatusIndicator;
