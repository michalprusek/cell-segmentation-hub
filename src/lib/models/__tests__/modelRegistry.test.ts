import { describe, it, expect } from 'vitest';
import {
  MODEL_REGISTRY,
  ALL_MODEL_IDS,
  BASIC_MODEL_INFO,
  keyMap,
  MODEL_TYPE_COMPATIBILITY,
  type ModelInfo,
  type ModelType,
} from '@/lib/models/modelRegistry';
import { getAllLocalizedModels } from '@/lib/modelUtils';

/**
 * SSOT contract tests for the frontend model registry. These assert the
 * canonical 9-model set, declaration order, the verified project-type
 * compatibility matrix, and the full derived `ModelInfo` shape — guarding
 * against drift between the registry and what consumers expect.
 */

const CANONICAL_IDS: ModelType[] = [
  'hrnet',
  'cbam_resunet',
  'unet_spherohq',
  'spheroid_disintegration',
  'segformer',
  'mamba_unet',
  'sperm',
  'wound',
  'microtubule',
  'microcapsule',
];

const MODEL_INFO_KEYS: Array<keyof ModelInfo> = [
  'id',
  'name',
  'displayName',
  'description',
  'size',
  'defaultThreshold',
  'category',
  'performance',
];

describe('model registry SSOT', () => {
  it('registry keys are exactly the canonical 10 models, in order', () => {
    expect(Object.keys(MODEL_REGISTRY)).toEqual(CANONICAL_IDS);
    expect(ALL_MODEL_IDS).toEqual(CANONICAL_IDS);
    expect(ALL_MODEL_IDS).toHaveLength(10);
  });

  it('getAllLocalizedModels() returns the 10 models in display order', () => {
    // Passthrough t returns the key itself; we only assert id ordering here.
    const models = getAllLocalizedModels((k: string) => k);
    expect(models.map(m => m.id)).toEqual(CANONICAL_IDS);
  });

  it('MODEL_TYPE_COMPATIBILITY deep-equals the verified matrix (incl. order)', () => {
    expect(MODEL_TYPE_COMPATIBILITY).toEqual({
      spheroid: [
        'hrnet',
        'cbam_resunet',
        'unet_spherohq',
        'segformer',
        'mamba_unet',
      ],
      spheroid_invasive: ['spheroid_disintegration'],
      wound: ['wound'],
      sperm: ['sperm'],
      microtubules: ['microtubule'],
      microcapsule: ['microcapsule'],
    });
  });

  it('BASIC_MODEL_INFO has a full ModelInfo entry (exact keys) for every id', () => {
    expect(Object.keys(BASIC_MODEL_INFO)).toEqual(CANONICAL_IDS);
    for (const id of ALL_MODEL_IDS) {
      const info = BASIC_MODEL_INFO[id];
      expect(info.id).toBe(id);
      expect(Object.keys(info).sort()).toEqual([...MODEL_INFO_KEYS].sort());
      expect(typeof info.name).toBe('string');
      expect(info.name.length).toBeGreaterThan(0);
      expect(typeof info.displayName).toBe('string');
      expect(info.displayName.length).toBeGreaterThan(0);
      expect(typeof info.description).toBe('string');
      expect(info.description.length).toBeGreaterThan(0);
      expect(['small', 'medium', 'large']).toContain(info.size);
      expect(typeof info.defaultThreshold).toBe('number');
      expect(typeof info.category).toBe('string');
      expect(info.performance).toBeDefined();
    }
  });

  it('preserves the exact static metadata for each model (zero behavior change)', () => {
    expect(BASIC_MODEL_INFO).toEqual({
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
      spheroid_disintegration: {
        id: 'spheroid_disintegration',
        name: 'Spheroid Disintegration',
        displayName: 'Spheroid Disintegration',
        description:
          'UNet++ / EfficientNet-B5 3-class model (background / corona / core) for disintegrating spheroids; predicts the dense core directly for a correct Disintegration Index',
        size: 'medium',
        defaultThreshold: 0.2,
        category: 'spheroid',
        performance: {
          avgTimePerImage: 0.7,
          throughput: 1.5,
          p95Latency: 1.0,
          batchSize: 1,
        },
      },
      segformer: {
        id: 'segformer',
        name: 'SegFormer',
        displayName: 'SegFormer',
        description:
          'Transformer-based model (SegFormer-B0) for bright-field spheroids — highest accuracy (93% IoU) and very fast (~13 ms/image)',
        size: 'small',
        defaultThreshold: 0.5,
        category: 'spheroid',
        performance: {
          avgTimePerImage: 0.2,
          throughput: 5.0,
          p95Latency: 0.3,
          batchSize: 4,
        },
      },
      mamba_unet: {
        id: 'mamba_unet',
        name: 'Mamba-UNet',
        displayName: 'Mamba-UNet',
        description:
          'U-Net with a bidirectional Mamba (state-space) bottleneck — best robustness on out-of-distribution images (external labs, unknown optics, drug-treated, unusual morphologies)',
        size: 'large',
        defaultThreshold: 0.5,
        category: 'spheroid',
        performance: {
          avgTimePerImage: 0.236,
          throughput: 4.2,
          p95Latency: 0.249,
          batchSize: 2,
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
          'U-Net with MiT-B5 (SegFormer) encoder for binary wound segmentation in scratch-assay microscopy timelapses (~32 ms on A5000 GPU, 90% IoU on external test set)',
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
      microtubule: {
        id: 'microtubule',
        name: 'Microtubule (v7)',
        displayName: 'Microtubule (DINOv3 + PySOAX)',
        description:
          'Instance segmentation for IRM/TIRF microtubule time-lapses. DINOv3-L ViT-L/16 backbone + DPT-style fusion produces a per-pixel 32-d embedding that PySOAX uses to extract individual MT centerlines. The embedding also drives automatic cross-frame tracking for kymograph analysis. Slow (~8 s/frame) but the only model in the platform producing polyline output.',
        size: 'large',
        defaultThreshold: 0.5,
        category: 'microtubule',
        performance: {
          avgTimePerImage: 8.0,
          throughput: 0.13,
          p95Latency: 10.0,
          batchSize: 1,
        },
      },
      microcapsule: {
        id: 'microcapsule',
        name: 'Microcapsule',
        displayName: 'Microcapsule',
        description:
          'Instance segmentation for microcapsules (round objects) in bright-field microscopy. A compact U-Net distilled from Meta SAM 3 returns one clean, full-resolution boundary per capsule and separates touching capsules with a watershed; capsules cut off by the image border are flagged and excluded from metrics (area, perimeter, compactness).',
        size: 'small',
        defaultThreshold: 0.5,
        category: 'microcapsule',
        performance: {
          avgTimePerImage: 0.3,
          throughput: 3.0,
          p95Latency: 0.6,
          batchSize: 1,
        },
      },
    });
  });

  it('keyMap maps each id to its i18n key segment (cbam_resunet → "cbam")', () => {
    expect(keyMap).toEqual({
      hrnet: 'hrnet',
      cbam_resunet: 'cbam',
      unet_spherohq: 'unet_spherohq',
      spheroid_disintegration: 'spheroid_disintegration',
      segformer: 'segformer',
      mamba_unet: 'mamba_unet',
      sperm: 'sperm',
      wound: 'wound',
      microtubule: 'microtubule',
      microcapsule: 'microcapsule',
    });
  });
});
