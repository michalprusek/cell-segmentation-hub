import { useEffect, useState, useRef } from 'react';
import { useWebSocket } from '@/contexts/useWebSocket';
import { useLanguage } from '@/contexts/useLanguage';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

interface ParallelProcessingStatus {
  concurrentOperations: {
    active: number;
    max: number;
  };
  mlWorkers: {
    active: number;
    max: number;
  };
  batchProcessing: {
    currentBatchSize: number;
    modelOptimalSizes: {
      hrnet: number;
      cbam_resunet: number;
    };
  };
  timestamp: Date;
}

export const useParallelProcessingStatus = () => {
  const { socket } = useWebSocket();
  const { t } = useLanguage();
  const [status, setStatus] = useState<ParallelProcessingStatus | null>(null);
  const lastToastTime = useRef(0);

  useEffect(() => {
    if (!socket) return;

    const handleParallelProcessingStatus = (data: ParallelProcessingStatus) => {
      logger.debug('Received parallel processing status:', data);

      setStatus(data);

      // Show toast notification only if significant change in activity
      // and not too frequently (max once every 3 seconds)
      const now = Date.now();
      const shouldShowToast = now - lastToastTime.current > 3000;

      if (shouldShowToast) {
        const activeWorkers = data.mlWorkers.active;
        const maxWorkers = data.mlWorkers.max;
        const activeConcurrent = data.concurrentOperations.active;
        const maxConcurrent = data.concurrentOperations.max;

        // Show different messages based on activity level
        if (activeWorkers > 0 || activeConcurrent > 0) {
          // System is active
          if (
            activeWorkers === maxWorkers &&
            activeConcurrent === maxConcurrent
          ) {
            // System at full capacity
            toast.info(
              t('status.parallelProcessing', {
                active: activeWorkers,
                max: maxWorkers,
              }),
              {
                description: t('status.concurrentOps', {
                  active: activeConcurrent,
                  max: maxConcurrent,
                }),
                duration: 3000,
              }
            );
          } else {
            // System partially active
            toast(
              t('status.parallelProcessing', {
                active: activeWorkers,
                max: maxWorkers,
              }),
              {
                description: t('status.concurrentOps', {
                  active: activeConcurrent,
                  max: maxConcurrent,
                }),
                duration: 2000,
              }
            );
          }
        } else {
          // System idle
          toast(
            t('status.parallelProcessing', {
              active: 0,
              max: maxWorkers,
            }),
            {
              description: t('status.systemReady'),
              duration: 2000,
            }
          );
        }

        lastToastTime.current = now;
      }
    };

    // Listen for parallel processing status events
    socket.on('parallelProcessingStatus', handleParallelProcessingStatus);

    return () => {
      socket.off('parallelProcessingStatus', handleParallelProcessingStatus);
    };
  }, [socket, t]);

  return {
    status,
    isActive: status
      ? status.mlWorkers.active > 0 || status.concurrentOperations.active > 0
      : false,
    activeWorkers: status?.mlWorkers.active || 0,
    maxWorkers: status?.mlWorkers.max || 2,
    activeConcurrent: status?.concurrentOperations.active || 0,
    maxConcurrent: status?.concurrentOperations.max || 3,
    currentBatchSize: status?.batchProcessing.currentBatchSize || 0,
  };
};
