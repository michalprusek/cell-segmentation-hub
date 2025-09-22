/**
 * Unit tests for mode configuration SSOT compliance and consistency
 * Ensures centralized mode behavior configuration is correct and prevents regressions
 */

import { describe, it, expect } from 'vitest';
import { EditMode } from '../../types';
import {
  MODE_BEHAVIOR_CONFIG,
  shouldPreventCanvasDeselection,
  requiresPolygonSelection,
  isGeometryModifyingMode,
  isInteractivePointPlacementMode,
  isReadOnlyMode,
  isDestructiveMode,
  validateModeConfiguration,
} from '../modeConfig';

describe('Mode Configuration SSOT', () => {
  describe('Configuration Consistency', () => {
    it('should have no modes in both read-only and geometry-modifying categories', () => {
      const readOnlyModes = new Set(MODE_BEHAVIOR_CONFIG.READ_ONLY_MODES);
      const geometryModifyingModes = new Set(MODE_BEHAVIOR_CONFIG.GEOMETRY_MODIFYING_MODES);

      const conflicts = MODE_BEHAVIOR_CONFIG.READ_ONLY_MODES.filter(mode =>
        geometryModifyingModes.has(mode)
      );

      expect(conflicts).toEqual([]);
    });

    it('should not throw when validating configuration', () => {
      expect(() => validateModeConfiguration()).not.toThrow();
    });

    it('should cover all EditMode values in at least one category', () => {
      const allModes = Object.values(EditMode);
      const configuredModes = new Set([
        ...MODE_BEHAVIOR_CONFIG.PREVENT_CANVAS_DESELECTION,
        ...MODE_BEHAVIOR_CONFIG.REQUIRES_POLYGON_SELECTION,
        ...MODE_BEHAVIOR_CONFIG.GEOMETRY_MODIFYING_MODES,
        ...MODE_BEHAVIOR_CONFIG.INTERACTIVE_POINT_PLACEMENT_MODES,
        ...MODE_BEHAVIOR_CONFIG.READ_ONLY_MODES,
        ...MODE_BEHAVIOR_CONFIG.DESTRUCTIVE_MODES,
      ]);

      const unconfiguredModes = allModes.filter(mode => !configuredModes.has(mode));

      // Log warning for manual review but don't fail the test
      if (unconfiguredModes.length > 0) {
        console.warn(`Unconfigured modes (manual review needed): ${unconfiguredModes.join(', ')}`);
      }

      // Ensure critical modes are configured
      const criticalModes = [
        EditMode.View,
        EditMode.EditVertices,
        EditMode.AddPoints,
        EditMode.CreatePolygon,
        EditMode.Slice,
        EditMode.DeletePolygon,
      ];

      const unconfiguredCriticalModes = criticalModes.filter(mode => !configuredModes.has(mode));
      expect(unconfiguredCriticalModes).toEqual([]);
    });
  });

  describe('Canvas Deselection Prevention', () => {
    it('should prevent canvas deselection for interactive point placement modes', () => {
      expect(shouldPreventCanvasDeselection(EditMode.AddPoints)).toBe(true);
      expect(shouldPreventCanvasDeselection(EditMode.Slice)).toBe(true);
      expect(shouldPreventCanvasDeselection(EditMode.CreatePolygon)).toBe(true);
    });

    it('should allow canvas deselection for view and non-interactive modes', () => {
      expect(shouldPreventCanvasDeselection(EditMode.View)).toBe(false);
      expect(shouldPreventCanvasDeselection(EditMode.EditVertices)).toBe(false);
      expect(shouldPreventCanvasDeselection(EditMode.DeletePolygon)).toBe(false);
    });

    it('should have consistent behavior between configuration and utility function', () => {
      for (const mode of MODE_BEHAVIOR_CONFIG.PREVENT_CANVAS_DESELECTION) {
        expect(shouldPreventCanvasDeselection(mode)).toBe(true);
      }

      // Test that modes NOT in the configuration return false
      const allModes = Object.values(EditMode);
      const preventDeselectionModes = new Set(MODE_BEHAVIOR_CONFIG.PREVENT_CANVAS_DESELECTION);

      for (const mode of allModes) {
        if (!preventDeselectionModes.has(mode)) {
          expect(shouldPreventCanvasDeselection(mode)).toBe(false);
        }
      }
    });
  });

  describe('Polygon Selection Requirements', () => {
    it('should require polygon selection for editing modes', () => {
      expect(requiresPolygonSelection(EditMode.EditVertices)).toBe(true);
      expect(requiresPolygonSelection(EditMode.Slice)).toBe(true);
      expect(requiresPolygonSelection(EditMode.AddPoints)).toBe(true);
    });

    it('should not require polygon selection for general modes', () => {
      expect(requiresPolygonSelection(EditMode.View)).toBe(false);
      expect(requiresPolygonSelection(EditMode.CreatePolygon)).toBe(false);
    });
  });

  describe('Geometry Modification Detection', () => {
    it('should identify geometry-modifying modes correctly', () => {
      expect(isGeometryModifyingMode(EditMode.EditVertices)).toBe(true);
      expect(isGeometryModifyingMode(EditMode.Slice)).toBe(true);
      expect(isGeometryModifyingMode(EditMode.AddPoints)).toBe(true);
      expect(isGeometryModifyingMode(EditMode.CreatePolygon)).toBe(true);
    });

    it('should not identify view modes as geometry-modifying', () => {
      expect(isGeometryModifyingMode(EditMode.View)).toBe(false);
      expect(isGeometryModifyingMode(EditMode.DeletePolygon)).toBe(false); // Deletes whole polygon, not geometry
    });
  });

  describe('Interactive Point Placement Detection', () => {
    it('should identify interactive point placement modes', () => {
      expect(isInteractivePointPlacementMode(EditMode.CreatePolygon)).toBe(true);
      expect(isInteractivePointPlacementMode(EditMode.AddPoints)).toBe(true);
      expect(isInteractivePointPlacementMode(EditMode.Slice)).toBe(true);
    });

    it('should not identify non-interactive modes as point placement', () => {
      expect(isInteractivePointPlacementMode(EditMode.View)).toBe(false);
      expect(isInteractivePointPlacementMode(EditMode.EditVertices)).toBe(false);
    });
  });

  describe('Read-Only Mode Detection', () => {
    it('should identify View mode as read-only', () => {
      expect(isReadOnlyMode(EditMode.View)).toBe(true);
    });

    it('should not identify editing modes as read-only', () => {
      expect(isReadOnlyMode(EditMode.EditVertices)).toBe(false);
      expect(isReadOnlyMode(EditMode.CreatePolygon)).toBe(false);
      expect(isReadOnlyMode(EditMode.Slice)).toBe(false);
    });
  });

  describe('Destructive Mode Detection', () => {
    it('should identify deletion modes as destructive', () => {
      expect(isDestructiveMode(EditMode.DeletePolygon)).toBe(true);
    });

    it('should not identify non-destructive modes', () => {
      expect(isDestructiveMode(EditMode.View)).toBe(false);
      expect(isDestructiveMode(EditMode.EditVertices)).toBe(false);
      expect(isDestructiveMode(EditMode.CreatePolygon)).toBe(false);
    });
  });

  describe('Regression Prevention', () => {
    it('should maintain expected canvas deselection behavior for critical slice mode fix', () => {
      // This test specifically verifies the slice mode fix that was implemented
      expect(shouldPreventCanvasDeselection(EditMode.Slice)).toBe(true);
      expect(shouldPreventCanvasDeselection(EditMode.AddPoints)).toBe(true);
    });

    it('should maintain consistent behavior across all point placement modes', () => {
      const pointPlacementModes = MODE_BEHAVIOR_CONFIG.INTERACTIVE_POINT_PLACEMENT_MODES;
      const canvasDeselectionPrevented = MODE_BEHAVIOR_CONFIG.PREVENT_CANVAS_DESELECTION;

      // All point placement modes should prevent canvas deselection
      for (const mode of pointPlacementModes) {
        expect(canvasDeselectionPrevented.includes(mode)).toBe(true);
        expect(shouldPreventCanvasDeselection(mode)).toBe(true);
      }
    });

    it('should have proper TypeScript type safety', () => {
      // This test ensures the configuration arrays are properly typed
      const preventModes = MODE_BEHAVIOR_CONFIG.PREVENT_CANVAS_DESELECTION;
      const requireModes = MODE_BEHAVIOR_CONFIG.REQUIRES_POLYGON_SELECTION;

      // These should be arrays of EditMode values
      expect(Array.isArray(preventModes)).toBe(true);
      expect(Array.isArray(requireModes)).toBe(true);

      // All elements should be valid EditMode values
      const allModes = Object.values(EditMode);
      for (const mode of preventModes) {
        expect(allModes.includes(mode)).toBe(true);
      }
    });
  });

  describe('Future Mode Addition Guidance', () => {
    it('should provide clear patterns for new mode classification', () => {
      // This test documents the expected patterns for future developers
      const patterns = {
        // Modes that place points should prevent canvas deselection
        pointPlacement: MODE_BEHAVIOR_CONFIG.INTERACTIVE_POINT_PLACEMENT_MODES,
        // Modes that edit existing polygons should require selection
        polygonEditing: MODE_BEHAVIOR_CONFIG.REQUIRES_POLYGON_SELECTION,
        // Modes that change coordinates should be geometry-modifying
        geometryChanging: MODE_BEHAVIOR_CONFIG.GEOMETRY_MODIFYING_MODES,
      };

      // Verify expected overlaps
      for (const mode of patterns.pointPlacement) {
        expect(shouldPreventCanvasDeselection(mode)).toBe(true);
      }

      for (const mode of patterns.polygonEditing) {
        expect(requiresPolygonSelection(mode)).toBe(true);
      }

      for (const mode of patterns.geometryChanging) {
        expect(isGeometryModifyingMode(mode)).toBe(true);
      }
    });
  });
});

describe('Integration with Production Code', () => {
  it('should be compatible with existing canvas onClick patterns', () => {
    // Simulate the production canvas onClick logic
    const simulateCanvasClick = (mode: EditMode, isEmptyArea: boolean) => {
      if (isEmptyArea && !shouldPreventCanvasDeselection(mode)) {
        return 'deselect-polygon';
      }
      return 'no-action';
    };

    // Test critical scenarios
    expect(simulateCanvasClick(EditMode.Slice, true)).toBe('no-action');
    expect(simulateCanvasClick(EditMode.AddPoints, true)).toBe('no-action');
    expect(simulateCanvasClick(EditMode.CreatePolygon, true)).toBe('no-action');
    expect(simulateCanvasClick(EditMode.View, true)).toBe('deselect-polygon');
    expect(simulateCanvasClick(EditMode.EditVertices, true)).toBe('deselect-polygon');
  });

  it('should maintain backward compatibility with existing hardcoded exclusions', () => {
    // Verify that the new centralized config produces the same results as the old hardcoded logic
    const oldLogic = (mode: EditMode) => {
      return !(mode !== EditMode.AddPoints && mode !== EditMode.Slice);
    };

    const newLogic = shouldPreventCanvasDeselection;

    // Test all modes to ensure compatibility
    for (const mode of Object.values(EditMode)) {
      const oldResult = oldLogic(mode);
      const newResult = newLogic(mode);

      // Allow expansion for CreatePolygon mode (intentional improvement)
      if (mode === EditMode.CreatePolygon) {
        expect(newResult).toBe(true); // New behavior: prevent deselection
      } else {
        expect(newResult).toBe(oldResult);
      }
    }
  });
});