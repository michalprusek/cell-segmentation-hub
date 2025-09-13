import { createContext } from 'react';
import {
  BASIC_MODEL_INFO,
  ModelType,
  ModelInfo,
  ModelPerformance,
} from '@/lib/modelUtils';

// Re-export types for convenience
export type { ModelType, ModelInfo, ModelPerformance };

export interface ModelContextType {
  selectedModel: ModelType;
  confidenceThreshold: number;
  detectHoles: boolean;
  setSelectedModel: (model: ModelType) => void;
  setConfidenceThreshold: (threshold: number) => void;
  setDetectHoles: (detectHoles: boolean) => void;
  getModelInfo: (modelId: ModelType) => ModelInfo;
  availableModels: ModelInfo[];
}

const AVAILABLE_MODELS: ModelInfo[] = Object.values(BASIC_MODEL_INFO);

export const ModelContext = createContext<ModelContextType>({
  selectedModel: 'hrnet',
  confidenceThreshold: 0.5,
  detectHoles: true,
  setSelectedModel: () => {},
  setConfidenceThreshold: () => {},
  setDetectHoles: () => {},
  getModelInfo: () => AVAILABLE_MODELS[0],
  availableModels: AVAILABLE_MODELS,
});
