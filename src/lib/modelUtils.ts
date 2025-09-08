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
        avgTimePerImage: 0.204,
        throughput: 4.9,
        p95Latency: 0.309,
        batchSize: 8,
      },
    },
    cbam_resunet: {
      id: 'cbam_resunet',
      size: 'medium',
      defaultThreshold: 0.5,
      performance: {
        avgTimePerImage: 0.377,
        throughput: 2.7,
        p95Latency: 0.482,
        batchSize: 2,
      },
    },
    unet_spherohq: {
      id: 'unet_spherohq',
      size: 'small',
      defaultThreshold: 0.5,
      performance: {
        avgTimePerImage: 0.181,
        throughput: 5.5,
        p95Latency: 0.286,
        batchSize: 4,
      },
    },
  };

  const keyMap: Record<ModelType, string> = {
    hrnet: 'hrnet',
    cbam_resunet: 'cbam',
    unet_spherohq: 'unet_spherohq',
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
  const modelIds: ModelType[] = ['hrnet', 'cbam_resunet', 'unet_spherohq'];
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
    displayName: 'HRNet (Balanced)',
    description: 'Balanced model with good speed and quality, E2E ~309ms',
    size: 'small',
    defaultThreshold: 0.5,
    performance: {
      avgTimePerImage: 0.204,
      throughput: 4.9,
      p95Latency: 0.309,
      batchSize: 8,
    },
  },
  cbam_resunet: {
    id: 'cbam_resunet',
    name: 'CBAM-ResUNet',
    displayName: 'CBAM-ResUNet (Precise)',
    description:
      'Most precise segmentation with attention mechanisms, E2E ~482ms',
    size: 'medium',
    defaultThreshold: 0.5,
    performance: {
      avgTimePerImage: 0.377,
      throughput: 2.7,
      p95Latency: 0.482,
      batchSize: 2,
    },
  },
  unet_spherohq: {
    id: 'unet_spherohq',
    name: 'UNet (SpheroHQ)',
    displayName: 'UNet (Fastest)',
    description:
      'Fastest model after optimizations, excellent for real-time processing, E2E ~286ms',
    size: 'small',
    defaultThreshold: 0.5,
    performance: {
      avgTimePerImage: 0.181,
      throughput: 5.5,
      p95Latency: 0.286,
      batchSize: 4,
    },
  },
};
