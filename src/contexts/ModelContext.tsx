import React, { useState, useEffect, ReactNode, useContext } from 'react';
import { BASIC_MODEL_INFO } from '@/lib/modelUtils';
import {
  ModelContext,
  type ModelType,
  type ModelInfo,
} from './ModelContext.types';
import { AuthContext } from './AuthContext.types';

const AVAILABLE_MODELS: ModelInfo[] = Object.values(BASIC_MODEL_INFO);

interface ModelProviderProps {
  children: ReactNode;
}

const getUserStorageKey = (userId: string | undefined, key: string): string => {
  return userId ? `user_${userId}_${key}` : `guest_${key}`;
};

export const ModelProvider: React.FC<ModelProviderProps> = ({ children }) => {
  const { user } = useContext(AuthContext);
  const [selectedModel, setSelectedModelState] = useState<ModelType>('hrnet');
  const [detectHoles, setDetectHolesState] = useState<boolean>(true);

  useEffect(() => {
    const userId = user?.id;
    const savedModel = localStorage.getItem(
      getUserStorageKey(userId, 'selectedModel')
    ) as ModelType;
    const savedDetectHoles = localStorage.getItem(
      getUserStorageKey(userId, 'detectHoles')
    );

    if (savedModel && AVAILABLE_MODELS.some(m => m.id === savedModel)) {
      setSelectedModelState(savedModel);
    }

    if (savedDetectHoles !== null) {
      setDetectHolesState(savedDetectHoles === 'true');
    }
  }, [user?.id]);

  const setSelectedModel = (model: ModelType) => {
    const userId = user?.id;
    setSelectedModelState(model);
    localStorage.setItem(getUserStorageKey(userId, 'selectedModel'), model);
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

  // Per-model calibrated threshold — read-only, derived from the model
  // catalogue. Old per-user localStorage entries are intentionally not
  // migrated; the new model-specific defaults supersede whatever value the
  // user had previously dialled in.
  const confidenceThreshold = getModelInfo(selectedModel).defaultThreshold;

  return (
    <ModelContext.Provider
      value={{
        selectedModel,
        confidenceThreshold,
        detectHoles,
        setSelectedModel,
        setDetectHoles,
        getModelInfo,
        availableModels: AVAILABLE_MODELS,
      }}
    >
      {children}
    </ModelContext.Provider>
  );
};
