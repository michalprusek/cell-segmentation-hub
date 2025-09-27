import React, { useState, useEffect, ReactNode, useContext } from 'react';
import { BASIC_MODEL_INFO } from '@/lib/modelUtils';
import {
  ModelContext,
  type ModelType,
  type ModelInfo,
  // type ModelContextType,
} from './ModelContext.types';
import { AuthContext } from './AuthContext.types';

// ModelType and ModelInfo are exported from './exports' to avoid Fast Refresh warnings

const AVAILABLE_MODELS: ModelInfo[] = Object.values(BASIC_MODEL_INFO);

interface ModelProviderProps {
  children: ReactNode;
}

// Helper function to get user-specific storage key
const getUserStorageKey = (userId: string | undefined, key: string): string => {
  return userId ? `user_${userId}_${key}` : `guest_${key}`;
};

export const ModelProvider: React.FC<ModelProviderProps> = ({ children }) => {
  const { user } = useContext(AuthContext);
  const [selectedModel, setSelectedModelState] = useState<ModelType>('hrnet');
  const [confidenceThreshold, setConfidenceThresholdState] =
    useState<number>(0.5);
  const [detectHoles, setDetectHolesState] = useState<boolean>(true);

  // Load settings from localStorage on mount and when user changes
  useEffect(() => {
    const userId = user?.id;
    const savedModel = localStorage.getItem(
      getUserStorageKey(userId, 'selectedModel')
    ) as ModelType;
    const savedThreshold = localStorage.getItem(
      getUserStorageKey(userId, 'confidenceThreshold')
    );
    const savedDetectHoles = localStorage.getItem(
      getUserStorageKey(userId, 'detectHoles')
    );

    if (savedModel && AVAILABLE_MODELS.some(m => m.id === savedModel)) {
      setSelectedModelState(savedModel);
    }

    if (savedThreshold) {
      const threshold = parseFloat(savedThreshold);
      // Ensure loaded threshold is within valid range (0.1 to 0.9)
      if (threshold >= 0.1 && threshold <= 0.9) {
        setConfidenceThresholdState(threshold);
      } else if (threshold > 0 && threshold < 0.1) {
        // If old value is below minimum, set to minimum
        setConfidenceThresholdState(0.1);
        localStorage.setItem(
          getUserStorageKey(userId, 'confidenceThreshold'),
          '0.1'
        );
      } else if (threshold > 0.9 && threshold <= 1) {
        // If old value is above maximum, set to maximum
        setConfidenceThresholdState(0.9);
        localStorage.setItem(
          getUserStorageKey(userId, 'confidenceThreshold'),
          '0.9'
        );
      }
    }

    if (savedDetectHoles !== null) {
      setDetectHolesState(savedDetectHoles === 'true');
    }
  }, [user?.id]); // Re-load when user changes

  const setSelectedModel = (model: ModelType) => {
    const userId = user?.id;
    setSelectedModelState(model);
    localStorage.setItem(getUserStorageKey(userId, 'selectedModel'), model);
  };

  const setConfidenceThreshold = (threshold: number) => {
    const userId = user?.id;
    // Ensure threshold is between 0.1 and 0.9 (10% to 90%)
    const normalizedThreshold = Math.max(0.1, Math.min(0.9, threshold));
    setConfidenceThresholdState(normalizedThreshold);
    localStorage.setItem(
      getUserStorageKey(userId, 'confidenceThreshold'),
      normalizedThreshold.toString()
    );
  };

  const setDetectHoles = (detectHoles: boolean) => {
    const userId = user?.id;
    setDetectHolesState(detectHoles);
    localStorage.setItem(
      getUserStorageKey(userId, 'detectHoles'),
      detectHoles.toString()
    );
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
