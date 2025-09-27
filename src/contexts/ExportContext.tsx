import React, { createContext, useContext, useEffect } from 'react';
import { useMultiProjectExportState } from '@/hooks/usePersistedExportState';
import ExportStateManager from '@/lib/exportStateManager';
import { logger } from '@/lib/logger';

interface ExportState {
  projectId: string | null;
  isExporting: boolean;
  isDownloading: boolean;
  exportProgress: number;
  exportStatus: string;
  completedJobId: string | null;
  currentJob: any | null;
  isCancelling?: boolean;
}

interface ExportContextType {
  exportStates: Record<string, ExportState>;
  updateExportState: (projectId: string, updates: Partial<ExportState>) => void;
  clearExportState: (projectId: string) => void;
  getExportState: (projectId: string) => ExportState | null;
  hasActiveExport: (projectId: string) => boolean;
}

const ExportContext = createContext<ExportContextType | null>(null);

export const ExportProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    getExportState: getPersistedState,
    updateExportState: updatePersistedState,
    clearExportState: clearPersistedState,
    getAllActiveStates,
  } = useMultiProjectExportState();

  // Initialize ExportStateManager
  useEffect(() => {
    ExportStateManager.initialize();
    logger.debug('ExportContext: ExportStateManager initialized');

    return () => {
      ExportStateManager.cleanup();
    };
  }, []);

  // Get all current export states (always fresh from localStorage)
  const exportStates = getAllActiveStates();

  const updateExportState = (
    projectId: string,
    updates: Partial<ExportState>
  ) => {
    updatePersistedState(projectId, updates);
  };

  const clearExportState = (projectId: string) => {
    clearPersistedState(projectId);
  };

  const getExportState = (projectId: string): ExportState | null => {
    return getPersistedState(projectId);
  };

  const hasActiveExport = (projectId: string): boolean => {
    const state = getExportState(projectId);
    return !!(
      state?.isExporting ||
      state?.isDownloading ||
      state?.completedJobId ||
      state?.isCancelling
    );
  };

  return (
    <ExportContext.Provider
      value={{
        exportStates,
        updateExportState,
        clearExportState,
        getExportState,
        hasActiveExport,
      }}
    >
      {children}
    </ExportContext.Provider>
  );
};

export const useExportContext = () => {
  const context = useContext(ExportContext);
  if (!context) {
    throw new Error('useExportContext must be used within an ExportProvider');
  }
  return context;
};
