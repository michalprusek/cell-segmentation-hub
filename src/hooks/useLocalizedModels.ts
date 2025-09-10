import { useModel } from '@/contexts/useModel';
import { useLanguage } from '@/contexts/useLanguage';
import {
  getLocalizedModelInfo,
  getAllLocalizedModels,
  ModelType,
  ModelInfo,
} from '@/lib/modelUtils';

/**
 * Hook that provides localized model information
 */
export function useLocalizedModels() {
  const {
    selectedModel,
    confidenceThreshold,
    detectHoles,
    setSelectedModel,
    setConfidenceThreshold,
    setDetectHoles,
  } = useModel();
  const { t } = useLanguage();

  const getLocalizedModel = (modelId: ModelType): ModelInfo => {
    return getLocalizedModelInfo(modelId, t);
  };

  const getAllModels = (): ModelInfo[] => {
    return getAllLocalizedModels(t);
  };

  const getSelectedModelInfo = (): ModelInfo => {
    return getLocalizedModelInfo(selectedModel, t);
  };

  return {
    selectedModel,
    confidenceThreshold,
    detectHoles,
    setSelectedModel,
    setConfidenceThreshold,
    setDetectHoles,
    getLocalizedModel,
    getAllModels,
    getSelectedModelInfo,
    availableModels: getAllModels(),
  };
}
