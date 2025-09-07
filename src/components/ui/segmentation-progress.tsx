import { useEffect, useState } from 'react';
import { Progress } from './progress';
import { AnimatedLoader, StepLoader } from './animated-loader';
import { cn } from '@/lib/utils';
import { CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react';

interface SegmentationProgressProps {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  queuePosition?: number;
  totalInQueue?: number;
  modelName?: string;
  estimatedTime?: number;
  error?: string;
  className?: string;
}

export function SegmentationProgress({
  status,
  progress = 0,
  queuePosition,
  totalInQueue,
  modelName,
  estimatedTime,
  error,
  className,
}: SegmentationProgressProps) {
  const [animatedProgress, setAnimatedProgress] = useState(0);

  useEffect(() => {
    // Animate progress changes
    const timer = setTimeout(() => {
      setAnimatedProgress(progress);
    }, 100);
    return () => clearTimeout(timer);
  }, [progress]);

  const getStatusIcon = () => {
    switch (status) {
      case 'queued':
        return <Clock className="h-5 w-5 text-yellow-500" />;
      case 'processing':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case 'queued':
        return queuePosition && totalInQueue
          ? `Position ${queuePosition} of ${totalInQueue} in queue`
          : 'Waiting in queue...';
      case 'processing':
        return modelName
          ? `Processing with ${modelName}`
          : 'Processing segmentation...';
      case 'completed':
        return 'Segmentation completed successfully';
      case 'failed':
        return error || 'Segmentation failed';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'queued':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'processing':
        return 'text-blue-600 dark:text-blue-400';
      case 'completed':
        return 'text-green-600 dark:text-green-400';
      case 'failed':
        return 'text-red-600 dark:text-red-400';
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-3">
        {getStatusIcon()}
        <div className="flex-1">
          <p className={cn('font-medium', getStatusColor())}>
            {getStatusMessage()}
          </p>
          {estimatedTime && status === 'processing' && (
            <p className="text-sm text-muted-foreground">
              Estimated time remaining:{' '}
              {Math.ceil(estimatedTime * (1 - animatedProgress / 100))}s
            </p>
          )}
        </div>
      </div>

      {(status === 'processing' ||
        (status === 'queued' && queuePosition === 1)) && (
        <Progress
          value={animatedProgress}
          className="h-2 animate-in fade-in duration-500"
        />
      )}

      {status === 'queued' && queuePosition && queuePosition > 1 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>Estimated wait: {Math.ceil((queuePosition - 1) * 30)}s</span>
        </div>
      )}
    </div>
  );
}

interface BatchSegmentationProgressProps {
  items: Array<{
    id: string;
    name: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress?: number;
  }>;
  overallProgress: number;
  className?: string;
}

export function BatchSegmentationProgress({
  items,
  overallProgress,
  className,
}: BatchSegmentationProgressProps) {
  const completedCount = items.filter(
    item => item.status === 'completed'
  ).length;
  const failedCount = items.filter(item => item.status === 'failed').length;
  const processingItem = items.find(item => item.status === 'processing');

  return (
    <div className={cn('space-y-4', className)}>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            Overall Progress: {completedCount} of {items.length} completed
          </span>
          <span className="text-sm text-muted-foreground">
            {Math.round(overallProgress)}%
          </span>
        </div>
        <Progress value={overallProgress} className="h-3" />
      </div>

      {failedCount > 0 && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4" />
          <span>
            {failedCount} item{failedCount > 1 ? 's' : ''} failed
          </span>
        </div>
      )}

      {processingItem && (
        <div className="p-3 rounded-lg bg-muted/50 space-y-2 animate-in fade-in duration-500">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium">
              Processing: {processingItem.name}
            </span>
          </div>
          {processingItem.progress !== undefined && (
            <Progress value={processingItem.progress} className="h-1" />
          )}
        </div>
      )}

      <div className="max-h-48 overflow-y-auto space-y-1">
        {items.map((item, index) => (
          <div
            key={item.id}
            className={cn(
              'flex items-center gap-2 text-sm p-2 rounded transition-colors',
              item.status === 'processing' && 'bg-blue-50 dark:bg-blue-950',
              item.status === 'completed' && 'bg-green-50 dark:bg-green-950',
              item.status === 'failed' && 'bg-red-50 dark:bg-red-950',
              'animate-in fade-in duration-500'
            )}
            style={{ animationDelay: `${index * 30}ms` }}
          >
            {item.status === 'pending' && (
              <div className="h-3 w-3 rounded-full border-2 border-muted-foreground" />
            )}
            {item.status === 'processing' && (
              <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
            )}
            {item.status === 'completed' && (
              <CheckCircle className="h-3 w-3 text-green-500" />
            )}
            {item.status === 'failed' && (
              <AlertCircle className="h-3 w-3 text-red-500" />
            )}
            <span
              className={cn(
                'truncate',
                item.status === 'processing' && 'font-medium'
              )}
            >
              {item.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
