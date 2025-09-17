/**
 * Export State Manager - Persistent storage for export operations
 * Handles saving/loading export state to/from localStorage with auto-expiration
 * Follows SSOT principles and patterns from useSegmentationReload
 */

import { logger } from '@/lib/logger';

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
  private static readonly EXPIRATION_TIME = 2 * 60 * 60 * 1000; // 2 hours
  private static readonly CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes
  private static cleanupTimer: NodeJS.Timeout | null = null;

  /**
   * Initialize the manager - starts periodic cleanup
   */
  static initialize(): void {
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
   * Save export state to localStorage
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
    } catch (error) {
      logger.warn('Failed to save export state:', error);
    }
  }

  /**
   * Get export state from localStorage
   * Returns null if not found or expired
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
      localStorage.removeItem(this.getStorageKey(projectId));
      logger.debug('Export state cleared', { projectId });
    } catch (error) {
      logger.warn('Failed to clear export state:', error);
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
   * Clean up all expired export states
   */
  static cleanupExpiredStates(): void {
    try {
      const keys = Object.keys(localStorage);
      let cleanedCount = 0;

      for (const key of keys) {
        if (key.startsWith(this.STORAGE_PREFIX)) {
          const stored = localStorage.getItem(key);
          if (stored) {
            try {
              const { timestamp } = JSON.parse(stored) as StoredExportState;
              if (Date.now() - timestamp > this.EXPIRATION_TIME) {
                localStorage.removeItem(key);
                cleanedCount++;
              }
            } catch {
              // Invalid data, remove it
              localStorage.removeItem(key);
              cleanedCount++;
            }
          }
        }
      }

      if (cleanedCount > 0) {
        logger.debug(`Cleaned up ${cleanedCount} expired export states`);
      }
    } catch (error) {
      logger.warn('Failed to cleanup expired states:', error);
    }
  }

  /**
   * Start periodic cleanup of expired states
   */
  private static startPeriodicCleanup(): void {
    // Clear any existing timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Start new cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredStates();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Subscribe to storage changes for cross-tab synchronization
   * Returns unsubscribe function
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
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

export default ExportStateManager;
