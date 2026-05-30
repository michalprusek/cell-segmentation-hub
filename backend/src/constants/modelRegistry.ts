/**
 * Single source of truth for backend model identity + project-type compatibility.
 *
 * To add or remove a segmentation model on the backend, edit ONLY this registry.
 * `SEGMENTATION_MODELS`, `KnownModelId` and `MODEL_TYPE_COMPATIBILITY` are all
 * derived from it, so they can never drift apart again. (They previously lived
 * in separate files and HAD drifted — the whitelist still carried two deleted
 * models, `resunet_advanced` / `resunet_small`.)
 *
 * Deliberately NOT modelled here: queue batch sizes / serial-dispatch. Those
 * live in `queueService.ts` as a runtime kill-switch (currently forcing
 * single-image processing to bypass a broken batch endpoint) — a queue concern,
 * not model identity. Keep them out of this registry.
 *
 * Cross-tree (frontend) and cross-language (Python ML) parity is enforced by
 * `scripts/check-model-parity.cjs` plus per-side equality tests.
 */

/** Project-type keys exactly as used by the compatibility map.
 *  NOTE: the microtubule project-type key is the plural `microtubules` while
 *  the model id is the singular `microtubule` — preserved from legacy data. */
export type ProjectTypeKey =
  | 'spheroid'
  | 'spheroid_invasive'
  | 'wound'
  | 'sperm'
  | 'microtubules';

interface BackendModelSpec {
  /** Project types whose picker offers (and whose worker accepts) this model. */
  readonly compatibleProjectTypes: readonly ProjectTypeKey[];
}

/**
 * The canonical model set. Declaration order is load-bearing: the derived
 * `MODEL_TYPE_COMPATIBILITY` preserves it and tests assert the exact arrays.
 */
export const MODEL_REGISTRY = {
  hrnet: { compatibleProjectTypes: ['spheroid'] },
  cbam_resunet: { compatibleProjectTypes: ['spheroid'] },
  unet_spherohq: { compatibleProjectTypes: ['spheroid'] },
  unet_attention_aspp: { compatibleProjectTypes: ['spheroid_invasive'] },
  segformer: { compatibleProjectTypes: ['spheroid'] },
  mamba_unet: { compatibleProjectTypes: ['spheroid'] },
  sperm: { compatibleProjectTypes: ['sperm'] },
  wound: { compatibleProjectTypes: ['wound'] },
  microtubule: { compatibleProjectTypes: ['microtubules'] },
} as const satisfies Record<string, BackendModelSpec>;

/** All known model identifiers — derived, so a typo or a removed model is a
 *  compile error everywhere it is consumed. */
export type KnownModelId = keyof typeof MODEL_REGISTRY;

/** Ordered list of supported model ids (replaces the hand-maintained whitelist). */
export const SEGMENTATION_MODELS = Object.keys(
  MODEL_REGISTRY
) as readonly KnownModelId[];

/** Models compatible with each project type, derived by inverting the registry.
 *  Cross-type segmentation is blocked at both the frontend dropdown and the
 *  backend (400 on submit / rejected in the queue worker). */
export const MODEL_TYPE_COMPATIBILITY: Record<
  ProjectTypeKey,
  readonly KnownModelId[]
> = (() => {
  const out: Record<string, KnownModelId[]> = {};
  for (const [id, spec] of Object.entries(MODEL_REGISTRY)) {
    for (const projectType of spec.compatibleProjectTypes) {
      (out[projectType] ??= []).push(id as KnownModelId);
    }
  }
  return out as Record<ProjectTypeKey, readonly KnownModelId[]>;
})();
