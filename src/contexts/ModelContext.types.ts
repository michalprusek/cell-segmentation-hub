import { createContext } from 'react';
import { BASIC_MODEL_INFO } from '@/lib/modelUtils';

export type ModelType = 'hrnet' | 'resunet_small' | 'resunet_advanced';

export interface ModelInfo {
  id: ModelType;
  name: string;
  displayName: string;
  description: string;
  size: 'small' | 'medium' | 'large';
  defaultThreshold: number;
}

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
