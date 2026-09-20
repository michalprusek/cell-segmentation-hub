// Model identity, display metadata, and project-type compatibility live in the
// model registry SSOT (`@/lib/models/modelRegistry`). This module re-exports
// the public model surface and the one localization helper built on top of it.
//
// It used to also carry a "recommended preset" framing for the spheroid models
// (SPHEROID_PRESETS / getSpheroidPreset / SPHEROID_PRESET_META, tiers
// fast / accurate / robust). That existed solely for the Settings -> Models
// section, which is gone: the model is chosen on the project page now, filtered
// to what the project's type can run. The tiers were also actively misleading —
// they filed SegFormer under 'fast' and CBAM-ResUNet under 'accurate' when
// SegFormer is the more accurate of the two (93 % IoU, the only published
// figure among the five), because a model that is both cannot occupy two of
// three recommendation slots.
import {
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
