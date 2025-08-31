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
      performance: {
        avgTimePerImage: 0.2,
        throughput: 5.5,
        p95Latency: 0.3,
        batchSize: 8,
      },
    },
    cbam_resunet: {
      id: 'cbam_resunet',
      size: 'medium',
      defaultThreshold: 0.5,
      performance: {
        avgTimePerImage: 0.3,
        throughput: 3.0,
        p95Latency: 0.7,
        batchSize: 2,
      },
    },
  };

  const keyMap: Record<ModelType, string> = {
    hrnet: 'hrnet',
    cbam_resunet: 'cbam',
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
  const modelIds: ModelType[] = ['hrnet', 'cbam_resunet'];
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
    displayName: 'HRNet (Fast)',
    description:
      'Fast and efficient model for real-time segmentation (~0.2s per image)',
    size: 'small',
    defaultThreshold: 0.5,
    performance: {
      avgTimePerImage: 0.2,
      throughput: 5.5,
      p95Latency: 0.3,
      batchSize: 8,
    },
  },
  cbam_resunet: {
    id: 'cbam_resunet',
    name: 'CBAM-ResUNet',
    displayName: 'CBAM-ResUNet (Precise)',
    description:
      'Precise segmentation with attention mechanisms (~0.3s per image)',
    size: 'medium',
    defaultThreshold: 0.5,
    performance: {
      avgTimePerImage: 0.3,
      throughput: 3.0,
      p95Latency: 0.7,
      batchSize: 2,
    },
  },
};
