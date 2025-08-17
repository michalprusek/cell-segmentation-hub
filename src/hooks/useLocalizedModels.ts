import { useModel } from '@/contexts/ModelContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { getLocalizedModelInfo, getAllLocalizedModels } from '@/lib/modelUtils';
import { ModelType, ModelInfo } from '@/contexts/ModelContext';

/**
 * Hook that provides localized model information
 */
export function useLocalizedModels() {
  const {
    selectedModel,
    confidenceThreshold,
    setSelectedModel,
    setConfidenceThreshold,
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
    setSelectedModel,
    setConfidenceThreshold,
    getLocalizedModel,
    getAllModels,
    getSelectedModelInfo,
    availableModels: getAllModels(),
  };
}
