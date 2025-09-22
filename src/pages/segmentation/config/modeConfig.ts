import { EditMode } from '../types';

/**
 * Single Source of Truth (SSOT) for edit mode behavior configuration.
 * This centralized configuration prevents regressions and ensures consistency
 * across all components using mode-specific logic.
 *
 * IMPORTANT: When adding new modes, carefully consider their behavior patterns
 * and update the appropriate configuration arrays.
 */
export const MODE_BEHAVIOR_CONFIG = {
  /**
   * Modes that should PREVENT canvas deselection when clicking empty areas.
   * These are typically interactive modes where users place points/vertices.
   *
   * - AddPoints: User clicks polygon edges to add new vertices
   * - Slice: User clicks to place slice start/end points
   * - CreatePolygon: User clicks to place vertices for new polygon creation
   *
   * NOTE: Preventing deselection allows uninterrupted point placement workflows.
   */
  PREVENT_CANVAS_DESELECTION: [
    EditMode.AddPoints,
    EditMode.Slice,
    EditMode.CreatePolygon, // Added after UX evaluation - prevents interruption during creation
  ] as const,

  /**
   * Modes that REQUIRE a polygon to be selected to function properly.
   * These modes operate on existing polygons and cannot work without selection.
   *
   * - EditVertices: Modifies existing polygon vertices
   * - Slice: Cuts existing polygon into two parts
   * - AddPoints: Adds points to existing polygon edges
   */
  REQUIRES_POLYGON_SELECTION: [
    EditMode.EditVertices,
    EditMode.Slice,
    EditMode.AddPoints,
  ] as const,

  /**
   * Modes that modify polygon geometry and should trigger history snapshots.
   * These modes change the actual polygon coordinate data.
   */
  GEOMETRY_MODIFYING_MODES: [
    EditMode.EditVertices,
    EditMode.Slice,
    EditMode.AddPoints,
    EditMode.CreatePolygon,
  ] as const,

  /**
   * Interactive modes that involve point placement workflows.
   * These modes typically require multiple user clicks to complete operations.
   */
  INTERACTIVE_POINT_PLACEMENT_MODES: [
    EditMode.CreatePolygon,
    EditMode.AddPoints,
    EditMode.Slice,
  ] as const,

  /**
   * Read-only modes that only allow viewing without modification.
   * These modes should have minimal UI interference.
   */
  READ_ONLY_MODES: [
    EditMode.View,
  ] as const,

  /**
   * Destructive modes that remove or delete elements.
   * These modes should have confirmation dialogs or undo support.
   */
  DESTRUCTIVE_MODES: [
    EditMode.DeletePolygon,
  ] as const,
} as const;

/**
 * Utility function to check if a mode should prevent canvas deselection.
 * Used in canvas onClick handlers to maintain polygon selection during interactive modes.
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

/**
 * Utility function to check if a mode requires polygon selection.
 * Used to disable mode switches or show selection prompts.
 *
 * @param mode - The edit mode to check
 * @returns true if the mode requires a polygon to be selected
 */
export const requiresPolygonSelection = (mode: EditMode): boolean => {
  return MODE_BEHAVIOR_CONFIG.REQUIRES_POLYGON_SELECTION.includes(mode as any);
};

/**
 * Utility function to check if a mode modifies polygon geometry.
 * Used to trigger history snapshots and undo/redo functionality.
 *
 * @param mode - The edit mode to check
 * @returns true if the mode modifies polygon coordinates
 */
export const isGeometryModifyingMode = (mode: EditMode): boolean => {
  return MODE_BEHAVIOR_CONFIG.GEOMETRY_MODIFYING_MODES.includes(mode as any);
};

/**
 * Utility function to check if a mode involves interactive point placement.
 * Used to customize cursor styles and interaction feedback.
 *
 * @param mode - The edit mode to check
 * @returns true if the mode involves point placement workflows
 */
export const isInteractivePointPlacementMode = (mode: EditMode): boolean => {
  return MODE_BEHAVIOR_CONFIG.INTERACTIVE_POINT_PLACEMENT_MODES.includes(mode as any);
};

/**
 * Utility function to check if a mode is read-only.
 * Used to hide editing UI elements and prevent modifications.
 *
 * @param mode - The edit mode to check
 * @returns true if the mode only allows viewing
 */
export const isReadOnlyMode = (mode: EditMode): boolean => {
  return MODE_BEHAVIOR_CONFIG.READ_ONLY_MODES.includes(mode as any);
};

/**
 * Utility function to check if a mode is destructive.
 * Used to show confirmation dialogs and prepare undo states.
 *
 * @param mode - The edit mode to check
 * @returns true if the mode removes or deletes elements
 */
export const isDestructiveMode = (mode: EditMode): boolean => {
  return MODE_BEHAVIOR_CONFIG.DESTRUCTIVE_MODES.includes(mode as any);
};

/**
 * Type-safe helper to get all modes in a specific category.
 * Useful for TypeScript type guards and comprehensive checks.
 */
export type PreventCanvasDeselectionMode = typeof MODE_BEHAVIOR_CONFIG.PREVENT_CANVAS_DESELECTION[number];
export type RequiresPolygonSelectionMode = typeof MODE_BEHAVIOR_CONFIG.REQUIRES_POLYGON_SELECTION[number];
export type GeometryModifyingMode = typeof MODE_BEHAVIOR_CONFIG.GEOMETRY_MODIFYING_MODES[number];
export type InteractivePointPlacementMode = typeof MODE_BEHAVIOR_CONFIG.INTERACTIVE_POINT_PLACEMENT_MODES[number];
export type ReadOnlyMode = typeof MODE_BEHAVIOR_CONFIG.READ_ONLY_MODES[number];
export type DestructiveMode = typeof MODE_BEHAVIOR_CONFIG.DESTRUCTIVE_MODES[number];

/**
 * Validation function to ensure mode configuration consistency.
 * Should be called in tests to catch configuration errors.
 *
 * @throws Error if configuration has inconsistencies
 */
export const validateModeConfiguration = (): void => {
  const allModes = Object.values(EditMode);
  const configuredModes = new Set([
    ...MODE_BEHAVIOR_CONFIG.PREVENT_CANVAS_DESELECTION,
    ...MODE_BEHAVIOR_CONFIG.REQUIRES_POLYGON_SELECTION,
    ...MODE_BEHAVIOR_CONFIG.GEOMETRY_MODIFYING_MODES,
    ...MODE_BEHAVIOR_CONFIG.INTERACTIVE_POINT_PLACEMENT_MODES,
    ...MODE_BEHAVIOR_CONFIG.READ_ONLY_MODES,
    ...MODE_BEHAVIOR_CONFIG.DESTRUCTIVE_MODES,
  ]);

  // Check for missing modes in configuration
  const unconfiguredModes = allModes.filter(mode => !configuredModes.has(mode));
  if (unconfiguredModes.length > 0) {
    console.warn(
      `WARNING: Modes not configured in modeConfig.ts: ${unconfiguredModes.join(', ')}. ` +
      'Consider adding them to appropriate behavior categories.'
    );
  }

  // Verify no contradictions (e.g., read-only mode that modifies geometry)
  const readOnlyButModifying = MODE_BEHAVIOR_CONFIG.READ_ONLY_MODES.filter(mode =>
    MODE_BEHAVIOR_CONFIG.GEOMETRY_MODIFYING_MODES.includes(mode as any)
  );

  if (readOnlyButModifying.length > 0) {
    throw new Error(
      `Configuration error: Modes cannot be both read-only and geometry-modifying: ${readOnlyButModifying.join(', ')}`
    );
  }
};

// Export the configuration for direct access if needed
export default MODE_BEHAVIOR_CONFIG;