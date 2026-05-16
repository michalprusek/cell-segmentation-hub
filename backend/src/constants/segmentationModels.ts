/**
 * Single source of truth for the segmentation model whitelist.
 *
 * Three call sites used to maintain their own copies of this list and
 * drifted apart (review pass-2 found 7 vs 9 vs 9 between Zod /
 * express-validator route / controller). Extract once, import
 * everywhere — a new model added in one place is a compile error
 * (TS) if not added here.
 */
export const SEGMENTATION_MODELS = [
  'hrnet',
  'cbam_resunet',
  'unet_spherohq',
  'unet_attention_aspp',
  'resunet_advanced',
  'resunet_small',
  'sperm',
  'wound',
  'microtubule',
] as const;

export type SegmentationModel = (typeof SEGMENTATION_MODELS)[number];

/** Human-readable error message listing supported models. Mirrored
 *  across the two validators so the message a client sees is the
 *  same regardless of which path rejects them. */
export const SEGMENTATION_MODEL_ERROR_MESSAGE = `Model musí být jeden z podporovaných: ${SEGMENTATION_MODELS.join(', ')}`;
