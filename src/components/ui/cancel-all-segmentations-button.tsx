import React, { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { Button } from './button';
import { useLanguage } from '@/contexts/useLanguage';
import { apiClient } from '@/lib/api';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';
import { cn } from '@/lib/utils';

interface CancelAllSegmentationsButtonProps {
  processingCount: number;
  queuedCount: number;
  className?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
  variant?:
    | 'default'
    | 'destructive'
    | 'outline'
    | 'secondary'
    | 'ghost'
    | 'link';
  showIcon?: boolean;
  showCount?: boolean;
}

export const CancelAllSegmentationsButton: React.FC<
  CancelAllSegmentationsButtonProps
> = ({
  processingCount,
  queuedCount,
  className,
  size = 'sm',
  variant = 'ghost',
  showIcon = true,
  showCount = true,
}) => {
  const { t } = useLanguage();
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const totalCount = processingCount + queuedCount;
  const isDisabled = totalCount === 0 || isCancelling;

  const handleCancelAll = async () => {
    setIsCancelling(true);
    setIsDialogOpen(false);

    const loadingToastId = toast.loading(
      t('queue.cancellingAllSegmentations', 'Cancelling all segmentations...')
    );

    try {
      logger.info('📍 Initiating cancel all segmentations', 'CancelAllButton', {
        processingCount,
        queuedCount,
        totalCount,
      });

      const result = await apiClient.cancelAllUserSegmentations();

      toast.dismiss(loadingToastId);

      if (result.success) {
        // Show success with details
        toast.success(
          t(
            'queue.allSegmentationsCancelled',
            `Successfully cancelled ${result.cancelledCount} segmentation(s)`
          ),
          {
            description:
              result.affectedProjects.length > 0
                ? t(
                    'queue.affectedProjects',
                    `Affected ${result.affectedProjects.length} project(s)`
                  )
                : undefined,
            duration: 5000,
          }
        );

        logger.info(
          '✅ All segmentations cancelled successfully',
          'CancelAllButton',
          {
            cancelledCount: result.cancelledCount,
            affectedProjects: result.affectedProjects.length,
            affectedBatches: result.affectedBatches.length,
          }
        );
      } else {
        toast.error(
          t('queue.cancelAllFailed', 'Failed to cancel segmentations')
        );
      }
    } catch (error: any) {
      toast.dismiss(loadingToastId);

      logger.error(
        '❌ Failed to cancel all segmentations',
        'CancelAllButton',
        error
      );

      const errorMessage =
        error.response?.data?.message || error.message || 'Unknown error';
      toast.error(t('queue.cancelAllError', 'Error cancelling segmentations'), {
        description: errorMessage,
        duration: 5000,
      });
    } finally {
      setIsCancelling(false);
    }
  };

  // Don't render if there are no tasks to cancel
  if (totalCount === 0) {
    return null;
  }

  return (
    <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={isDisabled}
          className={cn(
            'gap-2 transition-all',
            totalCount > 0 &&
              'text-orange-600 hover:text-orange-700 hover:bg-orange-50',
            isCancelling && 'opacity-50 cursor-not-allowed',
            className
          )}
          title={t(
            'queue.cancelAllTooltip',
            `Cancel all ${totalCount} segmentation task(s)`
          )}
        >
          {showIcon && (
            <X className={cn('h-4 w-4', isCancelling && 'animate-spin')} />
          )}
          {showCount && (
            <span className="font-medium">
              {t('queue.cancelAll', 'Cancel All')} ({totalCount})
            </span>
          )}
          {!showCount && (
            <span className="font-medium">
              {t('queue.cancelAll', 'Cancel All')}
            </span>
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-500" />
            {t('queue.confirmCancelAll', 'Cancel All Segmentations?')}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              {t(
                'queue.confirmCancelAllDescription',
                `You are about to cancel ${totalCount} segmentation task(s) across all your projects.`
              )}
            </p>
            <div className="bg-orange-50 p-3 rounded-md text-sm">
              <p className="font-medium text-orange-800">
                {processingCount > 0 && (
                  <>
                    •{' '}
                    {t(
                      'queue.processingTasks',
                      `${processingCount} task(s) currently processing`
                    )}
                  </>
                )}
              </p>
              {queuedCount > 0 && (
                <p className="font-medium text-orange-800">
                  • {t('queue.queuedTasks', `${queuedCount} task(s) queued`)}
                </p>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {t(
                'queue.cancelAllWarning',
                'This action cannot be undone. Cancelled tasks will need to be resubmitted.'
              )}
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCancelling}>
            {t('common.cancel', 'Cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleCancelAll}
            disabled={isCancelling}
            className="bg-orange-600 hover:bg-orange-700"
          >
            {isCancelling
              ? t('queue.cancelling', 'Cancelling...')
              : t(
                  'queue.confirmCancelAllButton',
                  `Yes, Cancel ${totalCount} Task(s)`
                )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
