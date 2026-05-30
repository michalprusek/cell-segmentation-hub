/**
 * Segmentation model whitelist — now derived from the single source of truth
 * in `modelRegistry.ts`. Historically three call sites maintained their own
 * copies and drifted apart (this list had even kept two deleted models,
 * `resunet_advanced` / `resunet_small`). Add or remove a model in
 * `modelRegistry.ts` only.
 */
export {
  SEGMENTATION_MODELS,
  type KnownModelId as SegmentationModel,
} from './modelRegistry';

import { SEGMENTATION_MODELS } from './modelRegistry';

export const SEGMENTATION_MODEL_ERROR_MESSAGE = `Model musí být jeden z podporovaných: ${SEGMENTATION_MODELS.join(', ')}`;
