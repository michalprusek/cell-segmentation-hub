import { createContext } from 'react';
import { ModelType, ModelInfo, ModelPerformance } from '@/lib/modelUtils';

// Re-export types for convenience. These no longer describe anything this
// context holds — the model moved onto the project — but a dozen modules
// import them from here, and the registry is the definition either way.
export type { ModelType, ModelInfo, ModelPerformance };

/**
 * What is left of the per-user model settings: hole detection.
 *
 * `selectedModel`, `confidenceThreshold`, `getModelInfo` and `availableModels`
 * were removed when the model became a property of the project. Use
 * `useProjectModel(projectType, storedModel)` for all four — it resolves the
 * model, its calibrated threshold, and the list this project type may run.
 */
export interface ModelContextType {
  /** Whether an internal hole in the predicted mask becomes a hole polygon
   *  (true) or is filled in (false). Reaches the ML service as
   *  `detect_holes`. Per-user rather than per-project: it describes how the
   *  user wants to annotate, not what is being annotated. */
  detectHoles: boolean;
  setDetectHoles: (detectHoles: boolean) => void;
}

export const ModelContext = createContext<ModelContextType>({
  detectHoles: true,
  setDetectHoles: () => {},
});
