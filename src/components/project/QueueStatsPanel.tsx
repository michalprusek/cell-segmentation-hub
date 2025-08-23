import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Clock, Play, BarChart3, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { QueueStats } from '@/hooks/useSegmentationQueue';
import { useLanguage } from '@/contexts/useLanguage';
import { ProjectImage } from '@/types';

interface QueueStatsPanelProps {
  stats: QueueStats | null;
  isConnected: boolean;
  onSegmentAll: () => void;
  onOpenSettings?: () => void;
  className?: string;
  batchSubmitted?: boolean;
  imagesToSegmentCount?: number;
  selectedImageIds?: Set<string>;
  images?: ProjectImage[];
}

export const QueueStatsPanel = ({
  stats,
  isConnected,
  onSegmentAll,
  onOpenSettings,
  className,
  batchSubmitted = false,
  imagesToSegmentCount = 0,
  selectedImageIds = new Set(),
  images = [],
}: QueueStatsPanelProps) => {
  const { t } = useLanguage();
  const hasQueuedItems = stats && stats.queued > 0;
  const isProcessing = stats && stats.processing > 0;

  // Calculate counts for button label
  const { selectedWithSegmentationCount, totalToProcess, buttonLabel } =
    useMemo(() => {
      // Count selected images that have segmentation
      const selectedWithSegmentation = images.filter(
        img =>
          selectedImageIds.has(img.id) &&
          (img.segmentationStatus === 'completed' ||
            img.segmentationStatus === 'segmented')
      ).length;

      // Total images to process
      const total = imagesToSegmentCount + selectedWithSegmentation;

      // Determine button label
      let label = t('queue.segmentAll');
      if (total > 0) {
        if (selectedWithSegmentation > 0 && imagesToSegmentCount > 0) {
          // Both new and re-segmentation
          label = t('queue.segmentMixed', {
            new: imagesToSegmentCount,
            resegment: selectedWithSegmentation,
            total: total,
          });
        } else if (selectedWithSegmentation > 0) {
          // Only re-segmentation
          label = t('queue.resegmentSelected', {
            count: selectedWithSegmentation,
          });
        } else {
          // Only new segmentation
          label = t('queue.segmentAllWithCount', {
            count: imagesToSegmentCount,
          });
        }
      }

      return {
        selectedWithSegmentationCount: selectedWithSegmentation,
        totalToProcess: total,
        buttonLabel: label,
      };
    }, [selectedImageIds, images, imagesToSegmentCount, t]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn('mb-6', className)}
    >
      <Card className="border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/50 dark:to-indigo-950/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            {/* Left section - Queue stats */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  {t('queue.title')}
                </h3>
              </div>

              {/* Connection status */}
              <Badge
                variant={isConnected ? 'default' : 'destructive'}
                className={cn(
                  'text-xs',
                  isConnected
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
                )}
              >
                {isConnected ? t('queue.connected') : t('queue.disconnected')}
              </Badge>

              {/* Queue stats */}
              {stats ? (
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4 text-yellow-600" />
                    <span className="font-medium">{stats.queued}</span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {t('queue.waiting')}
                    </span>
                  </div>

                  {isProcessing && (
                    <div className="flex items-center gap-1">
                      <Play className="h-4 w-4 text-blue-600 animate-pulse" />
                      <span className="font-medium">{stats.processing}</span>
                      <span className="text-gray-600 dark:text-gray-400">
                        {t('queue.processing')}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {t('queue.loadingStats')}
                </span>
              )}
            </div>

            {/* Right section - Actions */}
            <div className="flex items-center gap-2">
              {onOpenSettings && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onOpenSettings}
                  className="gap-2"
                >
                  <Settings className="h-4 w-4" />
                  {t('common.settings')}
                </Button>
              )}

              <Button
                onClick={onSegmentAll}
                disabled={
                  !isConnected || totalToProcess === 0 || batchSubmitted
                }
                className={cn(
                  'gap-2 transition-all bg-blue-600 hover:bg-blue-700 text-white',
                  (!isConnected || totalToProcess === 0 || batchSubmitted) &&
                    'bg-gray-400 hover:bg-gray-400 text-gray-700 cursor-not-allowed'
                )}
                title={
                  selectedWithSegmentationCount > 0
                    ? t('queue.segmentTooltip', {
                        new: imagesToSegmentCount,
                        resegment: selectedWithSegmentationCount,
                      })
                    : undefined
                }
              >
                <Play className="h-4 w-4" />
                {batchSubmitted ? t('queue.addingToQueue') : buttonLabel}
              </Button>
            </div>
          </div>

          {/* Status messages */}
          {!isConnected && (
            <div className="mt-3 p-2 bg-yellow-50 dark:bg-yellow-950/50 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-800 dark:text-yellow-200">
              {t('queue.connectingMessage')}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
};
