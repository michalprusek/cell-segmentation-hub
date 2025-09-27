import { useCallback, useRef } from 'react';
import { logger } from '@/lib/logger';

interface ExportState {
  projectId: string;
  jobId: string;
  status: string;
  startedAt: number;
  progress: number;
  exportStatus: string;
}

export function useMultiProjectExportState() {
  const states = useRef<Map<string, ExportState>>(new Map());

  const getExportState = useCallback((projectId: string): ExportState | null => {
    try {
      const key = `exportState_${projectId}`;
      const saved = localStorage.getItem(key);
      if (saved) {
        const state = JSON.parse(saved);
        states.current.set(projectId, state);
        return state;
      }
    } catch (error) {
      logger.error('Failed to load export state', error);
    }
    return null;
  }, []);

  const updateExportState = useCallback(
    (projectId: string, updates: Partial<ExportState>) => {
      try {
        const key = `exportState_${projectId}`;
        const current = states.current.get(projectId) || { projectId };
        const updated = { ...current, ...updates };

        states.current.set(projectId, updated);
        localStorage.setItem(key, JSON.stringify(updated));
      } catch (error) {
        logger.error('Failed to save export state', error);
      }
    },
    []
  );

  const clearExportState = useCallback((projectId: string) => {
    try {
      const key = `exportState_${projectId}`;
      states.current.delete(projectId);
      localStorage.removeItem(key);
    } catch (error) {
      logger.error('Failed to clear export state', error);
    }
  }, []);

  const getAllActiveStates = useCallback((): Map<string, ExportState> => {
    const activeStates = new Map<string, ExportState>();

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('exportState_')) {
          const projectId = key.replace('exportState_', '');
          const state = getExportState(projectId);
          if (state && (state.status === 'exporting' || state.status === 'processing')) {
            activeStates.set(projectId, state);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to get all active states', error);
    }

    return activeStates;
  }, [getExportState]);

  return {
    getExportState,
    updateExportState,
    clearExportState,
    getAllActiveStates,
  };
}