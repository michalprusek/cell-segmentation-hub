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
      // Keep the aborted controller in the map (don't delete) so isAborted(key)
      // can still report the aborted state. getController/getSignal will create
      // a FRESH controller on the next request for this key (it only reuses a
      // non-aborted one), so a new operation still gets a usable signal.
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
      // Delegate to getController which returns the existing non-aborted controller
      // or creates a fresh one when the existing controller is aborted. This ensures
      // that callers (e.g. getAllSignals after abortAllOperations) always receive
      // a usable signal for new operations rather than a stale aborted one.
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

  /**
   * Check if all of the specified keys are in an aborted state.
   * Returns false if none of the keys have a controller yet (nothing has started).
   * This is exported so useCoordinatedAbortController can use it with key-awareness.
   */
  const areKeysAllAborted = useCallback((keys: string[]) => {
    const hasAnyController = keys.some(key => controllersRef.current.has(key));
    if (!hasAnyController) return false;
    return keys.every(key => {
      const controller = controllersRef.current.get(key);
      return controller ? controller.signal.aborted : false;
    });
  }, []);

  return {
    getController,
    getSignal,
    abort,
    abortAll,
    isAborted,
    resetController,
    areKeysAllAborted,
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
  const {
    getController,
    getSignal,
    abort,
    abortAll,
    isAborted,
    areKeysAllAborted,
  } = useAbortController(debugKey);

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
   * Check if all operations are aborted.
   * Returns false when no controllers have been created yet (nothing has started).
   */
  const areAllAborted = useCallback(() => {
    return areKeysAllAborted(operationKeys);
  }, [areKeysAllAborted, operationKeys]);

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
