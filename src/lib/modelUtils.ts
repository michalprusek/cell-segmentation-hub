import { ModelType, ModelInfo } from '@/contexts/ModelContext';

/**
 * Get localized model information using the translation function
 */
export function getLocalizedModelInfo(
  modelId: ModelType,
  t: (key: string) => string
): ModelInfo {
  const baseModels: Record<
    ModelType,
    Omit<ModelInfo, 'name' | 'displayName' | 'description'>
  > = {
    hrnet: {
      id: 'hrnet',
      size: 'small',
      defaultThreshold: 0.5,
    },
    resunet_small: {
      id: 'resunet_small',
      size: 'medium',
      defaultThreshold: 0.5,
    },
    resunet_advanced: {
      id: 'resunet_advanced',
      size: 'large',
      defaultThreshold: 0.5,
    },
  };

  const keyMap: Record<ModelType, string> = {
    hrnet: 'hrnet',
    resunet_small: 'cbam',
    resunet_advanced: 'ma',
  };

  const baseModel = baseModels[modelId];
  const key = keyMap[modelId];

  return {
    ...baseModel,
    name: t(`settings.modelSelection.models.${key}.name`),
    displayName: t(`settings.modelSelection.models.${key}.name`),
    description: t(`settings.modelSelection.models.${key}.description`),
  };
}

/**
 * Get all localized models
 */
export function getAllLocalizedModels(t: (key: string) => string): ModelInfo[] {
  const modelIds: ModelType[] = ['hrnet', 'resunet_small', 'resunet_advanced'];
  return modelIds.map(id => getLocalizedModelInfo(id, t));
}

/**
 * Get basic model info without localization (for contexts that can't use t())
 */
export const BASIC_MODEL_INFO: Record<
  ModelType,
  Omit<ModelInfo, 'name' | 'displayName' | 'description'> & {
    name: string;
    displayName: string;
    description: string;
  }
> = {
  hrnet: {
    id: 'hrnet',
    name: 'HRNet',
    displayName: 'HRNet (Small)',
    description: 'Fast and efficient model for real-time segmentation',
    size: 'small',
    defaultThreshold: 0.5,
  },
  resunet_small: {
    id: 'resunet_small',
    name: 'CBAM-ResUNet',
    displayName: 'CBAM-ResUNet (Medium)',
    description: 'Balanced speed and accuracy',
    size: 'medium',
    defaultThreshold: 0.5,
  },
  resunet_advanced: {
    id: 'resunet_advanced',
    name: 'MA-ResUNet',
    displayName: 'MA-ResUNet (Large)',
    description: 'Highest accuracy with attention mechanisms',
    size: 'large',
    defaultThreshold: 0.5,
  },
};
