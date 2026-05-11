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
  /**
   * Read-only inference threshold for the currently selected model.
   * Derived from `getModelInfo(selectedModel).defaultThreshold` — calibrated
   * per-model in `modelUtils.ts`. No longer user-configurable: each model
   * has its own calibrated value (e.g. `unet_attention_aspp` uses 0.2,
   * others 0.5) and a global slider produced inconsistent results.
   */
  confidenceThreshold: number;
  detectHoles: boolean;
  setSelectedModel: (model: ModelType) => void;
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
  setDetectHoles: () => {},
  getModelInfo: () => AVAILABLE_MODELS[0],
  availableModels: AVAILABLE_MODELS,
});
