import { useState, useCallback, useRef, useEffect } from 'react';
import { logger } from '@/lib/logger';
import { useWebSocket } from '@/contexts/useWebSocket';

export type OperationType = 'upload' | 'segmentation' | 'export';

export interface OperationState {
  id: string;
  type: OperationType;
  status:
    | 'pending'
    | 'active'
    | 'cancelling'
    | 'cancelled'
    | 'completed'
    | 'failed';
  progress: number;
  message?: string;
  startTime: Date;
  endTime?: Date;
}

export interface OperationManager {
  activeOperations: Map<string, OperationState>;
  startOperation: (id: string, type: OperationType) => void;
  updateOperationProgress: (
    id: string,
    progress: number,
    message?: string
  ) => void;
  cancelOperation: (id: string) => Promise<void>;
  completeOperation: (id: string, success: boolean, message?: string) => void;
  isOperationActive: (type: OperationType) => boolean;
  getActiveOperation: (type: OperationType) => OperationState | null;
  getOperationProgress: (id: string) => number;
  isOperationCancelling: (id: string) => boolean;
  clearCompletedOperations: () => void;
}

/**
 * Universal operation manager for tracking upload, segmentation, and export operations
 * Provides consistent state management across all operation types
 */
export function useOperationManager(): OperationManager {
  const [activeOperations, setActiveOperations] = useState<
    Map<string, OperationState>
  >(new Map());
  const operationsRef = useRef<Map<string, OperationState>>(new Map());
  const { socket } = useWebSocket();

  // Sync ref with state
  useEffect(() => {
    operationsRef.current = new Map(activeOperations);
  }, [activeOperations]);

  // Listen for universal cancel events from WebSocket
  useEffect(() => {
    if (!socket) return;

    const handleOperationCancelled = (data: {
      operationId: string;
      operationType: OperationType;
      message?: string;
    }) => {
      logger.info('Operation cancelled via WebSocket', data);
      completeOperation(
        data.operationId,
        false,
        data.message || 'Operation cancelled'
      );
    };

    const handleOperationProgress = (data: {
      operationId: string;
      progress: number;
      message?: string;
    }) => {
      updateOperationProgress(data.operationId, data.progress, data.message);
    };

    socket.on('operation:cancelled', handleOperationCancelled);
    socket.on('operation:progress', handleOperationProgress);

    return () => {
      socket.off('operation:cancelled', handleOperationCancelled);
      socket.off('operation:progress', handleOperationProgress);
    };
  }, [socket, completeOperation, updateOperationProgress]);

  const startOperation = useCallback((id: string, type: OperationType) => {
    const operation: OperationState = {
      id,
      type,
      status: 'active',
      progress: 0,
      startTime: new Date(),
    };

    setActiveOperations(prev => {
      const newMap = new Map(prev);
      newMap.set(id, operation);
      return newMap;
    });

    logger.info(`Started ${type} operation`, { id, type });
  }, []);

  const updateOperationProgress = useCallback(
    (id: string, progress: number, message?: string) => {
      setActiveOperations(prev => {
        const newMap = new Map(prev);
        const operation = newMap.get(id);
        if (operation) {
          newMap.set(id, {
            ...operation,
            progress: Math.max(0, Math.min(100, progress)),
            message,
          });
        }
        return newMap;
      });
    },
    []
  );

  const cancelOperation = useCallback(
    async (id: string): Promise<void> => {
      const operation = operationsRef.current.get(id);
      if (!operation || operation.status !== 'active') {
        logger.warn('Cannot cancel operation - not active', {
          id,
          status: operation?.status,
        });
        return;
      }

      // Set cancelling status
      setActiveOperations(prev => {
        const newMap = new Map(prev);
        const op = newMap.get(id);
        if (op) {
          newMap.set(id, { ...op, status: 'cancelling' });
        }
        return newMap;
      });

      try {
        // Emit cancel event via WebSocket
        if (socket) {
          socket.emit('operation:cancel', {
            operationId: id,
            operationType: operation.type,
          });
        }

        logger.info(`Cancelling ${operation.type} operation`, { id });
      } catch (error) {
        logger.error('Failed to cancel operation', error);
        // Reset status if cancel failed
        setActiveOperations(prev => {
          const newMap = new Map(prev);
          const op = newMap.get(id);
          if (op) {
            newMap.set(id, { ...op, status: 'active' });
          }
          return newMap;
        });
        throw error;
      }
    },
    [socket]
  );

  const completeOperation = useCallback(
    (id: string, success: boolean, message?: string) => {
      setActiveOperations(prev => {
        const newMap = new Map(prev);
        const operation = newMap.get(id);
        if (operation) {
          newMap.set(id, {
            ...operation,
            status: success ? 'completed' : 'failed',
            progress: success ? 100 : operation.progress,
            message,
            endTime: new Date(),
          });
        }
        return newMap;
      });

      logger.info(`Operation ${success ? 'completed' : 'failed'}`, {
        id,
        success,
        message,
      });
    },
    []
  );

  const isOperationActive = useCallback((type: OperationType): boolean => {
    return Array.from(operationsRef.current.values()).some(
      op =>
        op.type === type &&
        (op.status === 'active' || op.status === 'cancelling')
    );
  }, []);

  const getActiveOperation = useCallback(
    (type: OperationType): OperationState | null => {
      return (
        Array.from(operationsRef.current.values()).find(
          op =>
            op.type === type &&
            (op.status === 'active' || op.status === 'cancelling')
        ) || null
      );
    },
    []
  );

  const getOperationProgress = useCallback((id: string): number => {
    return operationsRef.current.get(id)?.progress || 0;
  }, []);

  const isOperationCancelling = useCallback((id: string): boolean => {
    return operationsRef.current.get(id)?.status === 'cancelling';
  }, []);

  const clearCompletedOperations = useCallback(() => {
    setActiveOperations(prev => {
      const newMap = new Map();
      prev.forEach((operation, id) => {
        if (
          operation.status === 'active' ||
          operation.status === 'cancelling'
        ) {
          newMap.set(id, operation);
        }
      });
      return newMap;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel all active operations on unmount
      operationsRef.current.forEach((operation, id) => {
        if (operation.status === 'active') {
          logger.info('Cleaning up active operation on unmount', {
            id,
            type: operation.type,
          });
        }
      });
    };
  }, []);

  return {
    activeOperations,
    startOperation,
    updateOperationProgress,
    cancelOperation,
    completeOperation,
    isOperationActive,
    getActiveOperation,
    getOperationProgress,
    isOperationCancelling,
    clearCompletedOperations,
  };
}

export default useOperationManager;
