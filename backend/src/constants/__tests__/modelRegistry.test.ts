import { describe, it, expect } from 'vitest';
import {
  MODEL_REGISTRY,
  SEGMENTATION_MODELS,
  MODEL_TYPE_COMPATIBILITY,
  BATCH_LIMITS,
  SERIAL_DISPATCH_MODELS,
  DEFAULT_BATCH_LIMIT,
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
] as const;

describe('backend model registry SSOT', () => {
  it('registry keys are exactly the canonical 9 models', () => {
    expect(Object.keys(MODEL_REGISTRY).sort()).toEqual([...CANONICAL_IDS].sort());
  });

  it('SEGMENTATION_MODELS derives from the registry and drops deleted models', () => {
    expect([...SEGMENTATION_MODELS].sort()).toEqual([...CANONICAL_IDS].sort());
    expect(SEGMENTATION_MODELS).not.toContain('resunet_advanced');
    expect(SEGMENTATION_MODELS).not.toContain('resunet_small');
  });

  it('MODEL_TYPE_COMPATIBILITY reproduces the verified matrix exactly (incl. order)', () => {
    expect(MODEL_TYPE_COMPATIBILITY).toEqual({
      spheroid: ['hrnet', 'cbam_resunet', 'unet_spherohq', 'segformer', 'mamba_unet'],
      spheroid_invasive: ['unet_attention_aspp'],
      wound: ['wound'],
      sperm: ['sperm'],
      microtubules: ['microtubule'],
    });
  });

  it('BATCH_LIMITS reproduces the legacy overrides (others = 8)', () => {
    expect(BATCH_LIMITS).toEqual({
      hrnet: 8,
      cbam_resunet: 4,
      unet_spherohq: 8,
      unet_attention_aspp: 8,
      segformer: 8,
      mamba_unet: 8,
      sperm: 2,
      wound: 8,
      microtubule: 1,
    });
    expect(DEFAULT_BATCH_LIMIT).toBe(8);
  });

  it('SERIAL_DISPATCH_MODELS contains only microtubule (legacy parity)', () => {
    expect([...SERIAL_DISPATCH_MODELS]).toEqual(['microtubule']);
  });
});
