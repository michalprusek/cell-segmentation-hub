import React, { createContext, useContext, useState, useCallback } from 'react';

interface ExportState {
  projectId: string | null;
  isExporting: boolean;
  isDownloading: boolean;
  exportProgress: number;
  exportStatus: string;
  completedJobId: string | null;
  currentJob: any | null;
}

interface ExportContextType {
  exportStates: Record<string, ExportState>;
  updateExportState: (projectId: string, updates: Partial<ExportState>) => void;
  clearExportState: (projectId: string) => void;
  getExportState: (projectId: string) => ExportState | null;
}

const defaultExportState: ExportState = {
  projectId: null,
  isExporting: false,
  isDownloading: false,
  exportProgress: 0,
  exportStatus: '',
  completedJobId: null,
  currentJob: null,
};

const ExportContext = createContext<ExportContextType | null>(null);

export const ExportProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [exportStates, setExportStates] = useState<Record<string, ExportState>>({});

  const updateExportState = useCallback((projectId: string, updates: Partial<ExportState>) => {
    setExportStates(prev => ({
      ...prev,
      [projectId]: {
        ...prev[projectId] || { ...defaultExportState, projectId },
        ...updates,
      },
    }));
  }, []);

  const clearExportState = useCallback((projectId: string) => {
    setExportStates(prev => {
      const newStates = { ...prev };
      delete newStates[projectId];
      return newStates;
    });
  }, []);

  const getExportState = useCallback((projectId: string): ExportState | null => {
    return exportStates[projectId] || null;
  }, [exportStates]);

  return (
    <ExportContext.Provider value={{
      exportStates,
      updateExportState,
      clearExportState,
      getExportState,
    }}>
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