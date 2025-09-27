/**
 * Export State Manager - Persistent storage for export operations
 * Handles saving/loading export state to/from localStorage with auto-expiration
 * Follows SSOT principles and patterns from useSegmentationReload
 */

import { logger } from '@/lib/logger';
import { STORAGE } from '@/lib/constants';

export interface PersistedExportState {
  projectId: string;
  jobId: string;
  status: 'exporting' | 'downloading' | 'processing';
  startedAt: number;
  progress: number;
  exportType?: string;
  fileName?: string;
  exportStatus?: string;
}

interface StoredExportState {
  timestamp: number;
  state: PersistedExportState;
}

class ExportStateManager {
  private static readonly STORAGE_PREFIX = 'export-state-';
  private static readonly EXPIRATION_TIME = STORAGE.EXPORT_STATE_EXPIRATION;
  private static readonly CLEANUP_INTERVAL = STORAGE.EXPORT_STATE_CLEANUP;
  private static cleanupTimer: NodeJS.Timeout | null = null;
  private static throttledSaves: Map<string, NodeJS.Timeout> = new Map();
  private static isInitialized = false;
  // Request deduplication cache: jobId -> Promise
  private static pendingRequests: Map<string, Promise<any>> = new Map();
  // Track last cleanup time to avoid excessive cleanup attempts
  private static lastCleanupTime = 0;
  private static readonly MIN_CLEANUP_INTERVAL = 60000; // 1 minute minimum between cleanups

  /**
   * Initialize the manager - starts periodic cleanup (singleton pattern)
   * Should be called once at application startup
   * @example
   * // In app initialization
   * ExportStateManager.initialize();
   */
  static initialize(): void {
    // Prevent multiple initializations
    if (this.isInitialized) {
      logger.debug('ExportStateManager already initialized, skipping');
      return;
    }

    this.isInitialized = true;
    this.startPeriodicCleanup();
    this.cleanupExpiredStates();
    logger.debug('ExportStateManager initialized');
  }

  /**
   * Get storage key for a project
   */
  private static getStorageKey(projectId: string): string {
    return `${this.STORAGE_PREFIX}${projectId}`;
  }

  /**
   * Save export state to localStorage with quota error handling
   * @param projectId - Unique identifier for the project
   * @param state - Export state object to persist
   * @throws Handles QuotaExceededError by cleaning up expired states and retrying
   * @example
   * ExportStateManager.saveExportState('project-123', {
   *   projectId: 'project-123',
   *   jobId: 'job-456',
   *   status: 'exporting',
   *   startedAt: Date.now(),
   *   progress: 0
   * });
   */
  static saveExportState(projectId: string, state: PersistedExportState): void {
    try {
      const stored: StoredExportState = {
        timestamp: Date.now(),
        state,
      };

      localStorage.setItem(
        this.getStorageKey(projectId),
        JSON.stringify(stored)
      );

      logger.debug('Export state saved', { projectId, status: state.status });
    } catch (error: any) {
      // Handle quota exceeded error with smart cleanup
      if (error.name === 'QuotaExceededError' || error.code === 22) {
        logger.warn('localStorage quota exceeded, attempting cleanup');
        // Only cleanup if we haven't done so recently
        const now = Date.now();
        if (now - this.lastCleanupTime > this.MIN_CLEANUP_INTERVAL) {
          this.cleanupExpiredStates();
          this.lastCleanupTime = now;
        }

        // Retry once after cleanup
        try {
          const stored: StoredExportState = {
            timestamp: Date.now(),
            state,
          };
          localStorage.setItem(
            this.getStorageKey(projectId),
            JSON.stringify(stored)
          );
          logger.debug('Export state saved after cleanup', { projectId });
        } catch (retryError) {
          logger.error(
            'Failed to save export state even after cleanup:',
            retryError
          );
        }
      } else {
        logger.warn('Failed to save export state:', error);
      }
    }
  }

  /**
   * Throttled save for frequent updates (e.g., progress updates)
   * Delays save by 500ms, replacing any pending save for the same project
   * @param projectId - Unique identifier for the project
   * @param state - Export state object to persist
   * @example
   * // Rapid progress updates won't overwhelm localStorage
   * for (let i = 0; i <= 100; i++) {
   *   ExportStateManager.saveExportStateThrottled('project-123', {
   *     ...state,
   *     progress: i
   *   });
   * }
   */
  static saveExportStateThrottled(
    projectId: string,
    state: PersistedExportState
  ): void {
    // Clear any pending save for this project
    const existingTimeout = this.throttledSaves.get(projectId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Schedule new save
    const timeout = setTimeout(() => {
      this.saveExportState(projectId, state);
      this.throttledSaves.delete(projectId);
    }, 500);

    this.throttledSaves.set(projectId, timeout);
  }

  /**
   * Get export state from localStorage
   * Returns null if not found or expired (older than 2 hours)
   * @param projectId - Unique identifier for the project
   * @returns Export state if valid, null otherwise
   * @example
   * const state = ExportStateManager.getExportState('project-123');
   * if (state && state.status === 'exporting') {
   *   logger.debug(`Export ${state.progress}% complete`);
   * }
   */
  static getExportState(projectId: string): PersistedExportState | null {
    try {
      const stored = localStorage.getItem(this.getStorageKey(projectId));
      if (!stored) return null;

      const { timestamp, state } = JSON.parse(stored) as StoredExportState;

      // Check if expired (2 hours)
      if (Date.now() - timestamp > this.EXPIRATION_TIME) {
        this.clearExportState(projectId);
        logger.debug('Export state expired and cleared', { projectId });
        return null;
      }

      // Update startedAt to be relative to original timestamp
      if (!state.startedAt) {
        state.startedAt = timestamp;
      }

      logger.debug('Export state loaded', { projectId, status: state.status });
      return state;
    } catch (error) {
      logger.warn('Failed to load export state:', error);
      return null;
    }
  }

  /**
   * Clear export state for a project
   */
  static clearExportState(projectId: string): void {
    try {
      // Clear any pending throttled saves
      const pendingSave = this.throttledSaves.get(projectId);
      if (pendingSave) {
        clearTimeout(pendingSave);
        this.throttledSaves.delete(projectId);
      }

      localStorage.removeItem(this.getStorageKey(projectId));
      logger.debug('Export state cleared', { projectId });
    } catch (error) {
      logger.warn('Failed to clear export state:', error);
    }
  }

  /**
   * Check if export state exists without loading it
   */
  static hasExportState(projectId: string): boolean {
    try {
      return localStorage.getItem(this.getStorageKey(projectId)) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Update only the progress of an existing export state
   */
  static updateExportProgress(
    projectId: string,
    progress: number,
    exportStatus?: string
  ): void {
    const existingState = this.getExportState(projectId);
    if (existingState) {
      existingState.progress = progress;
      if (exportStatus) {
        existingState.exportStatus = exportStatus;
      }
      this.saveExportState(projectId, existingState);
    }
  }

  /**
   * Clean up all expired export states with performance optimization
   * @returns Number of items cleaned
   */
  static cleanupExpiredStates(): number {
    try {
      const keys = Object.keys(localStorage);
      let cleanedCount = 0;
      const now = Date.now();
      const itemsToRemove: string[] = [];

      // Batch identify items to remove (faster than removing one by one)
      for (const key of keys) {
        if (key.startsWith(this.STORAGE_PREFIX)) {
          const stored = localStorage.getItem(key);
          if (stored) {
            try {
              const { timestamp } = JSON.parse(stored) as StoredExportState;
              if (now - timestamp > this.EXPIRATION_TIME) {
                itemsToRemove.push(key);
              }
            } catch {
              // Invalid data, remove it
              itemsToRemove.push(key);
            }
          }
        }
      }

      // Batch remove items
      for (const key of itemsToRemove) {
        localStorage.removeItem(key);
        cleanedCount++;
      }

      if (cleanedCount > 0) {
        logger.debug(`Cleaned up ${cleanedCount} expired export states`);
      }

      return cleanedCount;
    } catch (error) {
      logger.warn('Failed to cleanup expired states:', error);
      return 0;
    }
  }

  /**
   * Deduplicate API requests by jobId to prevent race conditions
   * Returns existing promise if request is already in progress
   * @param jobId - Unique identifier for the export job
   * @param requestFn - Function that returns a promise for the API request
   * @returns Promise that resolves to the request result
   * @example
   * // Multiple simultaneous calls will only trigger one API request
   * const result1 = ExportStateManager.deduplicateRequest('job-123', () => api.getExport('job-123'));
   * const result2 = ExportStateManager.deduplicateRequest('job-123', () => api.getExport('job-123'));
   * // result1 === result2 (same promise instance)
   */
  static deduplicateRequest<T>(
    jobId: string,
    requestFn: () => Promise<T>
  ): Promise<T> {
    // Check if request already in progress
    const existingRequest = this.pendingRequests.get(jobId);
    if (existingRequest) {
      logger.debug(
        `Request already in progress for job ${jobId}, returning existing promise`
      );
      return existingRequest;
    }

    // Create new request and cache it
    const requestPromise = requestFn().finally(() => {
      // Clean up after request completes
      this.pendingRequests.delete(jobId);
    });

    this.pendingRequests.set(jobId, requestPromise);
    return requestPromise;
  }

  /**
   * Clear all pending requests (useful for cleanup)
   */
  static clearPendingRequests(): void {
    this.pendingRequests.clear();
  }

  /**
   * Start periodic cleanup of expired states with smart scheduling
   * Reduces cleanup frequency when storage is healthy
   */
  private static startPeriodicCleanup(): void {
    // Clear any existing timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Smart cleanup: Check storage usage and adjust frequency
    const performSmartCleanup = () => {
      try {
        // Estimate localStorage usage (rough estimate)
        const storageSize = new Blob(Object.values(localStorage)).size;

        // If storage is getting full, cleanup more aggressively
        if (storageSize > STORAGE.LOCAL_STORAGE_WARNING) {
          const cleanedCount = this.cleanupExpiredStates();

          // If we cleaned items or storage is critical, check again sooner
          if (
            cleanedCount > 0 ||
            storageSize > STORAGE.LOCAL_STORAGE_CRITICAL
          ) {
            // Schedule next cleanup in 5 minutes
            this.cleanupTimer = setTimeout(performSmartCleanup, 5 * 60 * 1000);
          } else {
            // Normal interval
            this.cleanupTimer = setTimeout(
              performSmartCleanup,
              this.CLEANUP_INTERVAL
            );
          }
        } else {
          // Storage is healthy, use normal interval
          this.cleanupTimer = setTimeout(
            performSmartCleanup,
            this.CLEANUP_INTERVAL
          );
        }
      } catch (error) {
        logger.warn('Smart cleanup check failed:', error);
        // Fallback to normal interval
        this.cleanupTimer = setTimeout(
          performSmartCleanup,
          this.CLEANUP_INTERVAL
        );
      }
    };

    // Start the smart cleanup cycle
    this.cleanupTimer = setTimeout(performSmartCleanup, this.CLEANUP_INTERVAL);
  }

  /**
   * Subscribe to storage changes for cross-tab synchronization
   * Returns unsubscribe function
   * @param projectId - Project ID to monitor for changes
   * @param callback - Function called when state changes
   * @returns Unsubscribe function to stop listening
   * @example
   * const unsubscribe = ExportStateManager.subscribeToChanges(
   *   'project-123',
   *   (state) => {
   *     if (state?.status === 'completed') {
   *       logger.debug('Export completed in another tab');
   *     }
   *   }
   * );
   * // Later: unsubscribe();
   */
  static subscribeToChanges(
    projectId: string,
    callback: (state: PersistedExportState | null) => void
  ): () => void {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === this.getStorageKey(projectId)) {
        if (event.newValue) {
          try {
            const { state } = JSON.parse(event.newValue) as StoredExportState;
            callback(state);
          } catch {
            callback(null);
          }
        } else {
          callback(null);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }

  /**
   * Get all active export states (for debugging/monitoring)
   */
  static getAllActiveStates(): Record<string, PersistedExportState> {
    const states: Record<string, PersistedExportState> = {};

    try {
      const keys = Object.keys(localStorage);

      for (const key of keys) {
        if (key.startsWith(this.STORAGE_PREFIX)) {
          const projectId = key.replace(this.STORAGE_PREFIX, '');
          const state = this.getExportState(projectId);
          if (state) {
            states[projectId] = state;
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to get all active states:', error);
    }

    return states;
  }

  /**
   * Cleanup on app unmount
   */
  static cleanup(): void {
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Clear all pending throttled saves
    this.throttledSaves.forEach(timeout => clearTimeout(timeout));
    this.throttledSaves.clear();
  }
}

export default ExportStateManager;
