import { EditMode } from '../types';

/**
 * Which edit modes suppress canvas deselection.
 *
 * A click on empty canvas normally clears the selection. In these modes it must
 * not: they are multi-click point-placement workflows, and losing the selection
 * mid-sequence aborts the operation the user is halfway through.
 *
 * This file once carried five more categories (REQUIRES_POLYGON_SELECTION,
 * GEOMETRY_MODIFYING_MODES, INTERACTIVE_POINT_PLACEMENT_MODES, READ_ONLY_MODES,
 * DESTRUCTIVE_MODES) with a predicate each, plus a validator. None ever had a
 * caller — the behaviours they described are decided inline in
 * `useAdvancedInteractions` and `useEnhancedSegmentationEditor` — so they
 * documented an SSOT that was not one. Add a category back only together with
 * the code that reads it.
 */
export const MODE_BEHAVIOR_CONFIG = {
  /**
   * - AddPoints: user clicks polygon edges to add new vertices
   * - Slice: user clicks to place slice start/end points
   * - CreatePolygon / CreatePolyline: user clicks to place vertices
   */
  PREVENT_CANVAS_DESELECTION: [
    EditMode.AddPoints,
    EditMode.Slice,
    EditMode.CreatePolygon,
    EditMode.CreatePolyline,
  ] as const,
} as const;

/**
 * Whether a canvas click on empty space should leave the selection alone.
 *
 * @param mode - The current edit mode
 * @returns true if canvas clicks should NOT deselect polygons
 *
 * @example
 * ```typescript
 * onClick={e => {
 *   if (
 *     e.target === e.currentTarget &&
 *     !shouldPreventCanvasDeselection(editMode)
 *   ) {
 *     handlePolygonSelection(null);
 *   }
 * }}
 * ```
 */
export const shouldPreventCanvasDeselection = (mode: EditMode): boolean => {
  return MODE_BEHAVIOR_CONFIG.PREVENT_CANVAS_DESELECTION.includes(mode as any);
};
