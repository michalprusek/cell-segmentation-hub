import { describe, it, expect } from 'vitest';
import {
  MODEL_REGISTRY,
  SEGMENTATION_MODELS,
  MODEL_TYPE_COMPATIBILITY,
} from '../modelRegistry';

const CANONICAL_IDS = [
  'hrnet',
  'cbam_resunet',
  'unet_spherohq',
  'unet_attention_aspp',
  'segformer',
  'mamba_unet',
  'sperm',
  'wound',
  'microtubule',
  'microcapsule',
] as const;

describe('backend model registry SSOT', () => {
  it('registry keys are exactly the canonical 10 models', () => {
    expect(Object.keys(MODEL_REGISTRY).sort()).toEqual(
      [...CANONICAL_IDS].sort()
    );
  });

  it('SEGMENTATION_MODELS derives from the registry and drops deleted models', () => {
    expect([...SEGMENTATION_MODELS].sort()).toEqual([...CANONICAL_IDS].sort());
    expect(SEGMENTATION_MODELS).not.toContain('resunet_advanced');
    expect(SEGMENTATION_MODELS).not.toContain('resunet_small');
  });

  it('MODEL_TYPE_COMPATIBILITY reproduces the verified matrix exactly (incl. order)', () => {
    expect(MODEL_TYPE_COMPATIBILITY).toEqual({
      spheroid: [
        'hrnet',
        'cbam_resunet',
        'unet_spherohq',
        'segformer',
        'mamba_unet',
      ],
      spheroid_invasive: ['unet_attention_aspp'],
      wound: ['wound'],
      sperm: ['sperm'],
      microtubules: ['microtubule'],
      microcapsule: ['microcapsule'],
    });
  });
});
