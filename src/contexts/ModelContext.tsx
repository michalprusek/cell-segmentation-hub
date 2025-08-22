import React, { useState, useEffect, ReactNode } from 'react';
import { BASIC_MODEL_INFO } from '@/lib/modelUtils';
import {
  ModelContext,
  type ModelType,
  type ModelInfo,
  type ModelContextType,
} from './ModelContext.types';

// ModelType and ModelInfo are exported from './exports' to avoid Fast Refresh warnings

const AVAILABLE_MODELS: ModelInfo[] = Object.values(BASIC_MODEL_INFO);

interface ModelProviderProps {
  children: ReactNode;
}

export const ModelProvider: React.FC<ModelProviderProps> = ({ children }) => {
  const [selectedModel, setSelectedModelState] = useState<ModelType>('hrnet');
  const [confidenceThreshold, setConfidenceThresholdState] =
    useState<number>(0.5);
  const [detectHoles, setDetectHolesState] = useState<boolean>(true);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedModel = localStorage.getItem('selectedModel') as ModelType;
    const savedThreshold = localStorage.getItem('confidenceThreshold');
    const savedDetectHoles = localStorage.getItem('detectHoles');

    if (savedModel && AVAILABLE_MODELS.some(m => m.id === savedModel)) {
      setSelectedModelState(savedModel);
    }

    if (savedThreshold) {
      const threshold = parseFloat(savedThreshold);
      if (threshold >= 0 && threshold <= 1) {
        setConfidenceThresholdState(threshold);
      }
    }

    if (savedDetectHoles !== null) {
      setDetectHolesState(savedDetectHoles === 'true');
    }
  }, []);

  const setSelectedModel = (model: ModelType) => {
    setSelectedModelState(model);
    localStorage.setItem('selectedModel', model);
  };

  const setConfidenceThreshold = (threshold: number) => {
    // Ensure threshold is between 0 and 1
    const normalizedThreshold = Math.max(0, Math.min(1, threshold));
    setConfidenceThresholdState(normalizedThreshold);
    localStorage.setItem('confidenceThreshold', normalizedThreshold.toString());
  };

  const setDetectHoles = (detectHoles: boolean) => {
    setDetectHolesState(detectHoles);
    localStorage.setItem('detectHoles', detectHoles.toString());
  };

  const getModelInfo = (modelId: ModelType): ModelInfo => {
    return (
      AVAILABLE_MODELS.find(model => model.id === modelId) ||
      AVAILABLE_MODELS[0]
    );
  };

  return (
    <ModelContext.Provider
      value={{
        selectedModel,
        confidenceThreshold,
        detectHoles,
        setSelectedModel,
        setConfidenceThreshold,
        setDetectHoles,
        getModelInfo,
        availableModels: AVAILABLE_MODELS,
      }}
    >
      {children}
    </ModelContext.Provider>
  );
};

// useModel is exported from './exports' to avoid Fast Refresh warnings
