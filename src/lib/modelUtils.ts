// Model identity, display metadata, and project-type compatibility now live
// in the model registry SSOT (`@/lib/models/modelRegistry`). This module
// re-exports the public model surface and the localization helpers built on
// top of it. The spheroid-preset framing below is view-layer only (not model
// identity) and intentionally stays here, not in the registry.
import {
  ALL_MODEL_IDS,
  BASE_MODEL_INFO,
  BASIC_MODEL_INFO,
  keyMap,
  type ModelCategory,
  type ModelInfo,
  type ModelPerformance,
  type ModelType,
} from '@/lib/models/modelRegistry';

// Re-exported from the registry SSOT so existing consumers
// (`import { ... } from '@/lib/modelUtils'`) are untouched.
export { BASIC_MODEL_INFO };
export type { ModelCategory, ModelInfo, ModelPerformance, ModelType };

/**
 * Recommended-preset framing for the standard spheroid models. Three tiers are
 * surfaced as primary cards (Fast/Accurate/Robust); the rest fall into a
 * collapsed "Additional" group. View-layer only — not part of ModelInfo.
 */
export type SpheroidPresetTier = 'fast' | 'accurate' | 'robust' | 'additional';

/** The standard spheroid models that participate in the preset framing.
 *  Excludes `unet_attention_aspp` (the disintegrated/invasive model, shown in
 *  its own section). `satisfies Record<SpheroidModelId, …>` makes forgetting to
 *  classify a newly-added spheroid model a compile error. */
type SpheroidModelId =
  | 'hrnet'
  | 'cbam_resunet'
  | 'unet_spherohq'
  | 'segformer'
  | 'mamba_unet';

export const SPHEROID_PRESETS = {
  segformer: 'fast',
  cbam_resunet: 'accurate',
  mamba_unet: 'robust',
  hrnet: 'additional',
  unet_spherohq: 'additional',
} as const satisfies Record<SpheroidModelId, SpheroidPresetTier>;

/** Preset tier for a model id. Non-spheroid (or unmapped) ids fall back to
 *  'additional' so the lookup stays total over ModelType. */
export const getSpheroidPreset = (id: ModelType): SpheroidPresetTier =>
  (SPHEROID_PRESETS as Record<string, SpheroidPresetTier>)[id] ?? 'additional';

/** Icon for each of the three primary preset tiers. */
export const SPHEROID_PRESET_META: Record<
  Exclude<SpheroidPresetTier, 'additional'>,
  { icon: string }
> = {
  fast: { icon: '⚡' },
  accurate: { icon: '🎯' },
  robust: { icon: '🌍' },
};

/**
 * Get localized model information using the translation function
 */
export function getLocalizedModelInfo(
  modelId: ModelType,
  t: (key: string) => string
): ModelInfo {
  const baseModel = BASE_MODEL_INFO[modelId];
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
  return ALL_MODEL_IDS.map(id => getLocalizedModelInfo(id, t));
}
