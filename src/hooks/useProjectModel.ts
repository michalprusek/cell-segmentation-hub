import { useMemo } from 'react';
import { useLanguage } from '@/contexts/useLanguage';
import {
  MODEL_TYPE_COMPATIBILITY,
  projectTypeOffersHoleDetection,
  resolveProjectModel,
  type ModelType,
} from '@/lib/models/modelRegistry';
import { getLocalizedModelInfo, type ModelInfo } from '@/lib/modelUtils';
import type { ProjectType } from '@/types';

export interface UseProjectModelResult {
  /** The model this project actually segments with. Never null once the
   *  project type is known — an unset or stranded stored value resolves to the
   *  type's default rather than leaving the caller without a model. */
  model: ModelType | undefined;
  /** Localized info for `model`, for rendering the picker's label. */
  modelInfo: ModelInfo | undefined;
  /** Every model this project type may run, in registry declaration order. */
  compatibleModels: ModelInfo[];
  /** True when the type offers exactly one model, so there is nothing to pick.
   *  Six of the seven project types are in this state. */
  isLocked: boolean;
  /** Whether this project type offers the hole-detection toggle. Only
   *  `spheroid` and `wound` do; everywhere else the parameter is fixed at its
   *  default, so the control would be a setting with no meaning. */
  offersDetectHoles: boolean;
  /** The model's calibrated inference threshold. Read from the RESOLVED model,
   *  not from a global setting — the values differ by a factor of five between
   *  models (microtubule 0.98, spheroid_disintegration 0.2, the rest 0.5), so
   *  a threshold borrowed from another model is a silently wrong request. */
  threshold: number | undefined;
}

/**
 * Resolve the segmentation model for one project.
 *
 * This replaces the per-user global `selectedModel` that used to live in
 * `ModelContext` + localStorage. That value was chosen in Settings, shown as a
 * badge in the header, and had no relationship to the project being
 * segmented — so a wound project opened while `hrnet` was selected blocked at
 * the Segment button with a compatibility modal. The choice now belongs to the
 * project, is filtered to what the project's type can run, and starts on the
 * most accurate of those.
 *
 * The hook takes the project's type and its RAW stored value (`null` = never
 * chosen) rather than reading a context, because both callers — `ProjectDetail`
 * and `SegmentationEditor` — already hold them from `useProjectData`, and
 * passing them keeps this a pure function of its inputs.
 *
 * `projectType` is `undefined` while the project is still loading. Everything
 * returned is `undefined`/empty in that state on purpose: guessing 'spheroid'
 * would render a picker showing five spheroid models for what may turn out to
 * be a wound project, and the user can click during that window.
 */
export function useProjectModel(
  projectType: ProjectType | undefined,
  storedModel: string | null | undefined
): UseProjectModelResult {
  const { t } = useLanguage();

  // `t` is typed `(key, opts?) => string | string[]` repo-wide, while the
  // model localizers want a plain string getter. Narrow once here rather than
  // at each of the two call sites below.
  const tr = useMemo(() => (key: string) => String(t(key)), [t]);

  return useMemo(() => {
    if (!projectType) {
      return {
        model: undefined,
        modelInfo: undefined,
        compatibleModels: [],
        isLocked: false,
        offersDetectHoles: false,
        threshold: undefined,
      };
    }

    const model = resolveProjectModel(projectType, storedModel);
    const compatibleIds = MODEL_TYPE_COMPATIBILITY[projectType];
    const compatibleModels = compatibleIds.map(id =>
      getLocalizedModelInfo(id, tr)
    );
    const modelInfo = getLocalizedModelInfo(model, tr);

    return {
      model,
      modelInfo,
      compatibleModels,
      isLocked: compatibleIds.length <= 1,
      offersDetectHoles: projectTypeOffersHoleDetection(projectType),
      threshold: modelInfo.defaultThreshold,
    };
  }, [projectType, storedModel, tr]);
}
