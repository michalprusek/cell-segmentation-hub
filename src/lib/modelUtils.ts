// Define types locally to avoid circular dependency
export type ModelType =
  | 'hrnet'
  | 'cbam_resunet'
  | 'unet_spherohq'
  | 'unet_attention_aspp'
  | 'sperm'
  | 'wound';

export type ModelCategory = 'spheroid' | 'sperm' | 'wound';

export interface ModelPerformance {
  avgTimePerImage: number; // seconds
  throughput: number; // images per second
  p95Latency: number; // seconds
  batchSize: number; // optimal batch size
}

export interface ModelInfo {
  id: ModelType;
  name: string;
  displayName: string;
  description: string;
  size: 'small' | 'medium' | 'large';
  defaultThreshold: number;
  category: ModelCategory;
  performance?: ModelPerformance;
}

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
      category: 'spheroid',
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
      category: 'spheroid',
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
      category: 'spheroid',
      performance: {
        avgTimePerImage: 0.181,
        throughput: 5.5,
        p95Latency: 0.286,
        batchSize: 4,
      },
    },
    unet_attention_aspp: {
      id: 'unet_attention_aspp',
      size: 'medium',
      defaultThreshold: 0.2,
      category: 'spheroid',
      performance: {
        avgTimePerImage: 0.35,
        throughput: 2.8,
        p95Latency: 0.5,
        batchSize: 1,
      },
    },
    sperm: {
      id: 'sperm',
      size: 'medium',
      defaultThreshold: 0.5,
      category: 'sperm',
      performance: {
        avgTimePerImage: 0.3,
        throughput: 3.3,
        p95Latency: 0.45,
        batchSize: 1,
      },
    },
    wound: {
      id: 'wound',
      size: 'medium',
      defaultThreshold: 0.5,
      category: 'wound',
      performance: {
        avgTimePerImage: 0.032,
        throughput: 35.0,
        p95Latency: 0.05,
        batchSize: 1,
      },
    },
  };

  const keyMap: Record<ModelType, string> = {
    hrnet: 'hrnet',
    cbam_resunet: 'cbam',
    unet_spherohq: 'unet_spherohq',
    unet_attention_aspp: 'unet_attention_aspp',
    sperm: 'sperm',
    wound: 'wound',
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
  const modelIds: ModelType[] = [
    'hrnet',
    'cbam_resunet',
    'unet_spherohq',
    'unet_attention_aspp',
    'sperm',
    'wound',
  ];
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
    category: 'spheroid',
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
    category: 'spheroid',
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
    category: 'spheroid',
    performance: {
      avgTimePerImage: 0.181,
      throughput: 5.5,
      p95Latency: 0.286,
      batchSize: 4,
    },
  },
  unet_attention_aspp: {
    id: 'unet_attention_aspp',
    name: 'UNet Attention-ASPP',
    displayName: 'UNet Attention-ASPP',
    description:
      'Enhanced UNet with Attention Gates and ASPP for detecting dissolving spheroids and small satellite cells',
    size: 'medium',
    defaultThreshold: 0.2,
    category: 'spheroid',
    performance: {
      avgTimePerImage: 0.35,
      throughput: 2.8,
      p95Latency: 0.5,
      batchSize: 1,
    },
  },
  sperm: {
    id: 'sperm',
    name: 'Sperm Morphology',
    displayName: 'Sperm Morphology',
    description:
      'Sperm morphology model with skeleton extraction for head/midpiece/tail measurement',
    size: 'medium',
    defaultThreshold: 0.5,
    category: 'sperm',
    performance: {
      avgTimePerImage: 0.3,
      throughput: 3.3,
      p95Latency: 0.45,
      batchSize: 1,
    },
  },
  wound: {
    id: 'wound',
    name: 'Wound Healing',
    displayName: 'Wound Healing (Scratch Assay)',
    description:
      'U-Net++ with ResNeXt-50 encoder for binary wound segmentation in scratch-assay microscopy timelapses (~32 ms on A5000 GPU)',
    size: 'medium',
    defaultThreshold: 0.5,
    category: 'wound',
    performance: {
      avgTimePerImage: 0.032,
      throughput: 35.0,
      p95Latency: 0.05,
      batchSize: 1,
    },
  },
};
