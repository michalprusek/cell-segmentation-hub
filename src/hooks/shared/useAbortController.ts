import { useRef, useCallback, useEffect } from 'react';
import { logger } from '@/lib/logger';

/**
 * Shared AbortController hook for managing request cancellation
 * Provides coordinated cancellation across multiple concurrent operations
 */
export function useAbortController(debugKey?: string) {
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const debugContext = debugKey || 'unknown';

  /**
   * Get or create an AbortController for a specific key
   * If a controller already exists and isn't aborted, returns the existing one
   * Otherwise creates a new controller
   */
  const getController = useCallback(
    (controllerKey: string = 'default') => {
      const existing = controllersRef.current.get(controllerKey);
      if (existing && !existing.signal.aborted) {
        logger.debug(
          `🔄 Reusing existing controller for ${debugContext}:${controllerKey}`
        );
        return existing;
      }

      const controller = new AbortController();
      controllersRef.current.set(controllerKey, controller);
      logger.debug(
        `✨ Created new controller for ${debugContext}:${controllerKey}`
      );
      return controller;
    },
    [debugContext]
  );

  /**
   * Abort all controllers and clear the map
   * Use this when completely resetting all operations
   */
  const abortAll = useCallback(() => {
    const count = controllersRef.current.size;
    if (count > 0) {
      logger.debug(`🛑 Aborting ${count} controllers for ${debugContext}`);
      controllersRef.current.forEach((controller, key) => {
        if (!controller.signal.aborted) {
          controller.abort();
          logger.debug(`  ↳ Aborted ${debugContext}:${key}`);
        }
      });
      controllersRef.current.clear();
    }
  }, [debugContext]);

  /**
   * Abort a specific controller by key
   * Use this when cancelling a specific operation
   * Note: Keeps the aborted controller in the map to prevent recreation
   */
  const abort = useCallback(
    (controllerKey: string = 'default') => {
      const controller = controllersRef.current.get(controllerKey);
      if (controller && !controller.signal.aborted) {
        controller.abort();
        logger.debug(
          `🛑 Aborted controller for ${debugContext}:${controllerKey}`
        );
      }
      // IMPORTANT: Don't delete the controller, keep it as aborted
      // This prevents getSignal from creating a new non-aborted controller
      // controllersRef.current.delete(controllerKey);
    },
    [debugContext]
  );

  /**
   * Check if a specific controller is aborted
   */
  const isAborted = useCallback((controllerKey: string = 'default') => {
    const controller = controllersRef.current.get(controllerKey);
    return !controller || controller.signal.aborted;
  }, []);

  /**
   * Reset a specific controller (remove it so a fresh one can be created)
   * Use this when starting a new operation after a previous cancellation
   */
  const resetController = useCallback(
    (controllerKey: string = 'default') => {
      controllersRef.current.delete(controllerKey);
      logger.debug(`🔄 Reset controller for ${debugContext}:${controllerKey}`);
    },
    [debugContext]
  );

  /**
   * Get the abort signal for a specific controller key
   * Creates a new controller if none exists
   * Returns aborted signal if controller was previously aborted
   */
  const getSignal = useCallback(
    (controllerKey: string = 'default') => {
      const existing = controllersRef.current.get(controllerKey);
      if (existing) {
        // Return existing signal even if aborted
        return existing.signal;
      }
      // Create new controller only if none exists
      return getController(controllerKey).signal;
    },
    [getController]
  );

  // Cleanup all controllers when component unmounts
  useEffect(() => {
    return () => {
      abortAll();
    };
  }, [abortAll]);

  return {
    getController,
    getSignal,
    abort,
    abortAll,
    isAborted,
    resetController,
  };
}

/**
 * Hook specifically for coordinating multiple related operations
 * that need to be cancelled together when switching context
 */
export function useCoordinatedAbortController(
  operationKeys: string[],
  debugKey?: string
) {
  const { getController, getSignal, abort, abortAll, isAborted } =
    useAbortController(debugKey);

  /**
   * Abort all specified operations at once
   * Use this when switching context (e.g., changing images)
   */
  const abortAllOperations = useCallback(() => {
    operationKeys.forEach(key => abort(key));
  }, [operationKeys, abort]);

  /**
   * Get signals for all operations
   */
  const getAllSignals = useCallback(() => {
    const signals: Record<string, AbortSignal> = {};
    operationKeys.forEach(key => {
      signals[key] = getSignal(key);
    });
    return signals;
  }, [operationKeys, getSignal]);

  /**
   * Check if all operations are aborted
   */
  const areAllAborted = useCallback(() => {
    return operationKeys.every(key => isAborted(key));
  }, [operationKeys, isAborted]);

  return {
    getController,
    getSignal,
    getAllSignals,
    abort,
    abortAll,
    abortAllOperations,
    isAborted,
    areAllAborted,
  };
}
