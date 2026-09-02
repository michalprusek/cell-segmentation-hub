/**
 * Which three tiles a hover card shows.
 *
 * A model shows its own three, in generated order. A PROJECT TYPE takes one
 * tile from each compatible model before taking a second from any of them:
 * `spheroid` has five models and fifteen tiles, and three consecutive HRNet
 * frames would answer "what does HRNet output look like" when the question the
 * picker is asking is "is this the kind of image I have". Round-robin puts
 * three different models — and therefore three different labs' images — in
 * front of the reader instead.
 *
 * Order is derived from `ALL_MODEL_IDS`, so it follows the registry's
 * declaration order rather than whatever order the generator emitted.
 */

import { ALL_MODEL_IDS, type ModelType } from '@/lib/models/modelRegistry';
import {
  SPECIMEN_PREVIEWS,
  type SpecimenPreview,
} from '@/lib/specimens/previewIndex';
import type { ProjectType } from '@/types';

/** Tiles a hover card shows at once. */
export const PREVIEWS_PER_CARD = 3;

const byModel = new Map<ModelType, SpecimenPreview[]>();
for (const preview of SPECIMEN_PREVIEWS) {
  const list = byModel.get(preview.model);
  if (list) list.push(preview);
  else byModel.set(preview.model, [preview]);
}

/** The model's own examples — real frames it segmented itself. */
export function previewsForModel(
  model: ModelType,
  limit = PREVIEWS_PER_CARD
): readonly SpecimenPreview[] {
  return (byModel.get(model) ?? []).slice(0, limit);
}

/** Examples of the project type, spread across the models that can run on it. */
export function previewsForProjectType(
  projectType: ProjectType,
  limit = PREVIEWS_PER_CARD
): readonly SpecimenPreview[] {
  const groups = ALL_MODEL_IDS.map(model =>
    (byModel.get(model) ?? []).filter(p => p.projectType === projectType)
  ).filter(group => group.length > 0);

  const picked: SpecimenPreview[] = [];
  const deepest = Math.max(0, ...groups.map(group => group.length));
  for (let rank = 0; rank < deepest && picked.length < limit; rank++) {
    for (const group of groups) {
      if (picked.length >= limit) break;
      if (group[rank]) picked.push(group[rank]);
    }
  }
  return picked;
}
