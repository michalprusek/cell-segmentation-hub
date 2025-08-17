import React from 'react';
import { motion } from 'framer-motion';
import { Clock, Play, BarChart3, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { QueueStats } from '@/hooks/useSegmentationQueue';
import { useLanguage } from '@/contexts/LanguageContext';

interface QueueStatsPanelProps {
  stats: QueueStats | null;
  isConnected: boolean;
  onSegmentAll: () => void;
  onOpenSettings?: () => void;
  className?: string;
  batchSubmitted?: boolean;
  imagesToSegmentCount?: number;
}

export const QueueStatsPanel = ({
  stats,
  isConnected,
  onSegmentAll,
  onOpenSettings,
  className,
  batchSubmitted = false,
  imagesToSegmentCount = 0,
}: QueueStatsPanelProps) => {
  const { t } = useLanguage();
  const hasQueuedItems = stats && stats.queued > 0;
  const isProcessing = stats && stats.processing > 0;
  const totalItems = stats ? stats.total : 0;

  // Calculate progress percentage (completed / total)
  const progressPercentage =
    stats && stats.total > 0
      ? Math.round(((stats.total - stats.queued) / stats.total) * 100)
      : 0;

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
                  !isConnected || imagesToSegmentCount === 0 || batchSubmitted
                }
                className={cn(
                  'gap-2 transition-all bg-blue-600 hover:bg-blue-700 text-white',
                  (!isConnected ||
                    imagesToSegmentCount === 0 ||
                    batchSubmitted) &&
                    'bg-gray-400 hover:bg-gray-400 text-gray-700 cursor-not-allowed'
                )}
              >
                <Play className="h-4 w-4" />
                {batchSubmitted
                  ? t('queue.addingToQueue')
                  : t('queue.segmentAll')}
              </Button>
            </div>
          </div>

          {/* Progress bar */}
          {stats && stats.total > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                <span>{t('queue.totalProgress')}</span>
                <span>{progressPercentage}%</span>
              </div>
              <Progress value={progressPercentage} className="h-2" />
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-500 mt-1">
                <span>0</span>
                <span>
                  {stats.total} {t('queue.images')}
                </span>
              </div>
            </div>
          )}

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
